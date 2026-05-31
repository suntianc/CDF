---
phase: 260531-umu-node-output-schema
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/shared/node-output-schemas.ts
  - src/main/workflow/output-validator.ts
  - src/main/workflow/node-executor.ts
  - src/main/workflow/node-executor.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Task 节点输出通过 TaskOutputSchema 强校验（summary/status/artifacts）"
    - "Review 节点输出通过 ReviewOutputSchema 强校验（在 task 基础上增加 verdict/issues）"
    - "Loop/ForEach 节点输出通过各自 schema 强校验"
    - "校验失败自动重试（最多 5 轮），将校验错误反馈给 Agent 重新生成"
    - "超过 5 轮重试后降级：保留原始文本，标记 _degraded + _validationErrors"
    - "现有 routing 提取机制完全不变"
    - "Schema 定义在 shared 层（src/shared/node-output-schemas.ts），可供 main 和 renderer 使用"
  artifacts:
    - path: "src/shared/node-output-schemas.ts"
      provides: "所有节点类型的 Zod schema 定义及类型导出"
      exports: ["ArtifactSchema", "TaskOutputSchema", "ReviewOutputSchema", "LoopIterationSchema", "LoopOutputSchema", "ForEachItemSchema", "ForEachOutputSchema", "getSchemaForNodeKind", "DegradedOutput"]
    - path: "src/main/workflow/output-validator.ts"
      provides: "输出校验 + 自动重试 + 降级容错逻辑"
      exports: ["validateOutput", "buildRetryContext", "executeWithValidation", "MAX_RETRIES"]
    - path: "src/main/workflow/node-executor.ts"
      provides: "集成校验到节点执行流程"
    - path: "src/main/workflow/node-executor.test.ts"
      provides: "校验/重试/降级场景的测试覆盖"
  key_links:
    - from: "node-executor.ts:invokeAgent"
      to: "output-validator.ts:executeWithValidation"
      via: "校验+重试包装"
      pattern: "executeWithValidation\\(invokeAgent"
    - from: "output-validator.ts:validateOutput"
      to: "node-output-schemas.ts:getSchemaForNodeKind"
      via: "按 nodeKind 选取 schema"
      pattern: "getSchemaForNodeKind\\(nodeKind\\)"
    - from: "output-validator.ts:buildRetryContext"
      to: "z.toJSONSchema"
      via: "Zod v4 将 schema 序列化为 JSON Schema 注入 retry prompt"
      pattern: "z\\.toJSONSchema\\(schema\\)"
---

<objective>
为工作流节点输出实现 JSON Schema 强校验机制：每种节点类型使用内置 Zod schema（task/review/loop/foreach），校验失败自动重试最多 5 轮，超限后降级容错。

Purpose: Agent 输出格式不可控导致下游节点解析失败。通过内置 schema + 自动重试保证结构化输出一致性，同时降级机制防止死循环。
Output: 3 个文件（2 新建 + 1 修改）组成完整校验链路
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/shared/types.ts
@src/main/workflow/node-executor.ts
@src/main/workflow/node-executor.test.ts
@src/main/workflow/graph-builder.ts
@src/main/workflow/state-schema.ts

<interfaces>
<!-- Zod 已在项目中使用 (v4.4.3)，shared/types.ts 已有 DELEGATED_TASK_RESULT_SCHEMA 作为参考 -->
<!-- Zod v4 API: safeParse() 返回 { success, data } | { success, error: { issues } } -->
<!-- z.toJSONSchema(schema) 可用，生成标准 JSON Schema 供 LLM 理解 -->

From src/shared/types.ts (现有类型参考):
```typescript
export const DELEGATED_TASK_RESULT_SCHEMA = z.object({
  status: z.enum(['success', 'failure']),
  artifacts: z.array(z.string()),
  summary: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type WorkflowAgentNodeKind = 'task' | 'loop' | 'review' | 'foreach';
```

From src/main/workflow/node-executor.ts (关键函数签名):
```typescript
export function createAgentNodeExecutor(
  node: WorkflowNode,
  upstreamNodeIds: string[] = [],
): (state: Record<string, unknown>, onLog?: (log: string) => void) => Promise<Record<string, unknown>>;

export function extractWorkflowRouting(output: string): Record<string, string> | undefined;

// 内部助手:
function extractJsonCandidate(text: string): unknown;
function getLastMessageText(result: any): string;
```

From src/main/workflow/graph-builder.ts:
```typescript
// buildWorkflowGraph 的重试策略 (独立于我们的校验重试):
builder.addNode(node.id, executor, {
  retryPolicy: { maxAttempts: node.data.retryCount ?? 1 },
});
// 注意：graph-builder 的 retryPolicy 是节点级别的失败重试，与我们的输出校验重试是不同层次
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 定义节点输出 Zod Schema</name>
  <files>src/shared/node-output-schemas.ts</files>
  <behavior>
    - ArtifactSchema 定义: path (z.string().min(1)), kind (z.string().min(1) 自由文本), description (z.string().optional())
    - TaskOutputSchema 定义: summary (z.string().min(1)), status (z.enum(['success', 'failure'])), artifacts (z.array(ArtifactSchema).optional())
    - ReviewOutputSchema 在 TaskOutputSchema 基础上 extend: verdict (z.enum(['pass', 'fail', 'needs_changes'])), issues (z.array(z.object({ severity: z.enum(['critical', 'major', 'minor']), file: z.string().optional(), description: z.string().min(1) })).optional())
    - LoopIterationSchema 定义: iteration (z.number()), summary (z.string().min(1)), status (z.enum(['success', 'failure'])), artifacts (z.array(ArtifactSchema).optional())
    - LoopOutputSchema 在 TaskOutputSchema 基础上 extend: iterations (z.array(LoopIterationSchema).optional())
    - ForEachItemSchema 定义: index (z.number()), summary (z.string().min(1)), status (z.enum(['success', 'failure'])), artifacts (z.array(ArtifactSchema).optional())
    - ForEachOutputSchema 在 TaskOutputSchema 基础上 extend: results (z.array(ForEachItemSchema).optional()), totalItems (z.number().optional()), successCount (z.number().optional()), failCount (z.number().optional())
    - DegradedOutput 接口: { _degraded: true, _validationErrors: string[], rawText?: string }
    - getSchemaForNodeKind(kind) 函数: switch 'task'/'review'/'loop'/'foreach' 返回对应 schema，default 返回 TaskOutputSchema
    - 所有 schema 和类型均 export
  </behavior>
  <action>
创建 src/shared/node-output-schemas.ts，按决策 D-A-1 为四种节点类型定义内置固定 Zod schema。

关键实现要点：
- 使用 Zod v4 语法（与现有 DELEGATED_TASK_RESULT_SCHEMA 风格一致）
- ReviewOutputSchema 通过 .extend() 继承 TaskOutputSchema 并追加 verdict + issues（决策 D-06）
- LoopOutputSchema 通过 .extend() 继承 TaskOutputSchema 并追加 iterations
- ForEachOutputSchema 通过 .extend() 继承 TaskOutputSchema 并追加 results + 统计字段（决策 D-07）
- artifacts.kind 用 z.string().min(1) 自由文本（决策 artifacts.kind）
- 导出 z.infer 类型别名供 main 层使用
- 导出 getSchemaForNodeKind() 工厂函数，按 nodeKind 返回对应 schema，default 返回 TaskOutputSchema
- 导出 DegradedOutput 接口供 validator 使用
- 不涉及 routing，routing 保持现有机制不变（决策 D-08）
  </action>
  <verify>
    <automated>npx vitest run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|Tests)" | head -5</automated>
  </verify>
  <done>node-output-schemas.ts 文件存在，所有 schema export 可用，TypeScript 编译无错误</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 实现输出校验器（含重试 + 降级）</name>
  <files>src/main/workflow/output-validator.ts</files>
  <behavior>
    - validateOutput(rawText, nodeKind): 从文本提取 JSON → 按 nodeKind 选 schema → safeParse → 返回 { valid, data? } | { valid, errors[] }
    - buildRetryContext(errors, schemaSnapshot): 生成包含校验错误和 schema 的 retry prompt 片段，供 Agent 理解修正方向
    - executeWithValidation(invokeAgent, nodeKind, baseContext, onLog): 调用 agent → 校验 → 失败则注入 retry context 重新调用 → 最多 5 轮 → 超限降级返回 degraded 对象
    - MAX_RETRIES = 5 常量导出
    - 使用 z.toJSONSchema(schema) 将 schema 序列化为 JSON Schema 注入 retry prompt
    - 降级时 onLog 输出警告信息
  </behavior>
  <action>
创建 src/main/workflow/output-validator.ts，实现带重试和降级的输出校验器。

关键实现要点：
- validateOutput()：复用 node-executor.ts 中已有的 extractJsonCandidate() 逻辑提取 JSON，未提取到 JSON 返回明确错误"无法从输出中提取有效的 JSON 结构"
- 使用 getSchemaForNodeKind(nodeKind) 获取对应 schema，调用 safeParse(parsed)
- 校验失败时格式化 issues 为人类可读错误列表（格式: "path.to.field: message"）
- buildRetryContext()：生成清晰的 retry prompt，包含期望的 JSON Schema（通过 z.toJSONSchema(schema) 生成）和具体错误列表，用中文描述
- executeWithValidation()：核心重试循环
  - 首次调用 invokeAgent(baseContext) → 校验
  - 校验失败：onLog 记录错误详情 → buildRetryContext → 拼接 baseContext + retryContext → 再次 invokeAgent
  - 最多 MAX_RETRIES (5) 次，决策 B-1 + B-3
  - 成功：返回 { output, validated }
  - 最终仍失败：返回 { output, degraded: { _degraded: true, _validationErrors: [...], rawText: output } }
  - 降级时 onLog 输出警告"已达最大重试次数 (5)，降级保留原始输出"
- 注意：retry context 拼接时避免 baseContext 过度膨胀（baseContext 中包含上游输出等大量内容，不要重复拼接累积的 retry context）
  - 做法：首次 baseContext 保存为 originalContext，每次 retry 时用 originalContext + buildRetryContext(...) 组合，而非在已有 retry context 上追加
- 工具函数 extractJsonCandidate 直接从 node-executor.ts 导入（不需要重复定义）
  </action>
  <verify>
    <automated>npx vitest run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|Tests)" | head -5</automated>
  </verify>
  <done>output-validator.ts 文件存在，三个导出函数完整，TypeScript 编译无错误</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 集成校验到节点执行器并添加测试</name>
  <files>src/main/workflow/node-executor.ts, src/main/workflow/node-executor.test.ts</files>
  <behavior>
    - task/review 节点：用 executeWithValidation 包装 invokeAgent，输出包含 structuredOutput (validated data) 或 degraded 标记
    - loop 节点：每次迭代的 invokeAgent 通过 executeWithValidation 执行，iteration 记录中存储 structuredOutput
    - foreach 节点：每个 item 的 invokeAgent 通过 executeWithValidation 执行，item 记录中存储 structuredOutput
    - 所有节点的 routing 提取（extractWorkflowRouting）基于原始 output text，不受校验影响
    - 测试: 校验成功场景 → 输出含 structuredOutput；校验失败重试 → invokeAgent 被多次调用；降级场景 → 输出含 _degraded
    - 测试: routing 提取仍基于原始文本，不受校验影响
  </behavior>
  <action>
修改 src/main/workflow/node-executor.ts，将 executeWithValidation 集成到三种执行路径。

**1. 导入：**
从 output-validator 导入 executeWithValidation。从 node-output-schemas 导入类型（仅类型导入）。

**2. Task/Review 节点路径（约 line 528-543）：**
当前代码：
```
const resultText = await invokeAgent(taskContext);
```
替换为调用 executeWithValidation：
- 传入 invokeAgent 函数引用、nodeKind、taskContext、onLog
- const { output: resultText, validated, degraded } = await executeWithValidation(invokeAgent, nodeKind, taskContext, onLog)
- routing 仍从 resultText 提取（extractWorkflowRouting 保持不变）
- return 中增加 validated 或 degraded 字段：
  - 如果有 validated：{ result: resultText, structuredOutput: validated, nodeId, agentId, duration_ms, routing? }
  - 如果有 degraded：{ result: resultText, _degraded: true, _validationErrors: degraded._validationErrors, nodeId, agentId, duration_ms, routing? }

**3. Loop 节点路径（约 line 385-435）：**
每次迭代中，将 `const resultText = await invokeAgent(iterationContext)` 替换为 executeWithValidation 调用：
- const { output: resultText, validated, degraded } = await executeWithValidation(invokeAgent, nodeKind, iterationContext, onLog)
- iteration 记录中增加 structuredOutput 和/或 degraded 标记
- routing 仍从 resultText 提取
- 最终返回对象不变（result, iterations, iteration_count, max_iterations, nodeId, agentId, duration_ms, routing），但 iterations 数组中的每项增加 structuredOutput/degraded

**4. ForEach 节点路径（约 line 438-526）：**
每个 item 的 invokeAgent(itemContext) 替换为 executeWithValidation 调用：
- const { output: resultText, validated, degraded } = await executeWithValidation(invokeAgent, nodeKind, itemContext, onLog)
- item 记录中增加 structuredOutput 和/或 degraded 标记
- 最终返回对象不变但 results 数组中的每项增加 structuredOutput/degraded

**5. 保持 extractWorkflowRouting 不变：**
routing 提取始终基于原始的 resultText（agent 文本输出），与校验无关。决策 D-08。

**6. extractJsonCandidate 保持不变：**
这个函数仍在 node-executor.ts 中原地保留（output-validator.ts 会 import 它）。

**测试修改 (node-executor.test.ts)：**
需要新增以下测试场景：
a) task 节点输出通过校验 → 返回含 structuredOutput
b) task 节点输出首次失败、第二次通过 → invokeAgent 被调用 2 次
c) task 节点输出连续 5 次失败 → 返回含 _degraded: true 和 _validationErrors
d) review 节点输出含 verdict + issues → 校验通过
e) loop 节点迭代中某轮校验失败后重试成功 → iteration 记录正确
f) routing 提取基于原始文本，即使校验失败也不影响 routing

测试 mock 策略：
- output-validator.ts 自身内部使用 extractJsonCandidate + safeParse，这些不需要 mock
- 需要能够控制 invokeAgent 的返回值来测试不同场景
- 可以利用现有的 createDeepAgentMock 控制 agent.invoke 返回值
- 对于 degradation 测试：让 agent 连续返回不符合 schema 的文本 5 次以上
  </action>
  <verify>
    <automated>npx vitest run src/main/workflow/node-executor.test.ts --reporter=verbose</automated>
  </verify>
  <done>所有测试通过，task/review/loop/foreach 节点输出均经过 schema 校验，重试和降级逻辑正常工作</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Agent LLM 输出 → Schema 校验 | LLM 输出不可信，必须经过 Zod schema 校验 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-umu-01 | Tampering | Agent 输出文本 | mitigate | Zod schema safeParse 强校验，不合规输出触发重试或降级 |
| T-umu-02 | Denial of Service | 校验重试循环 | mitigate | MAX_RETRIES=5 硬限制，超限降级不阻塞工作流 |
| T-umu-03 | Information Disclosure | 校验错误详情 | accept | 校验错误仅注入 Agent retry prompt（同一次执行上下文），不暴露给用户 |
| T-umu-04 | Elevation of Privilege | artifacts.path | accept | artifacts 仅记录路径字符串，不执行文件系统操作；实际文件操作由 Agent tools 完成 |
| T-umu-SC | Tampering | npm 依赖 Zod v4 | accept | Zod 已是项目现有依赖（v4.4.3），无新增安装 |
</threat_model>

<verification>
整体验证：
1. `npx vitest run src/main/workflow/node-executor.test.ts` 全部通过
2. `npx tsc --noEmit` 无类型错误
3. 手动验证：创建工作流 → 运行 task 节点 → 确保输出含 summary/status 字段
</verification>

<success_criteria>
- [ ] 四种节点类型（task/review/loop/foreach）的输出均经过 Zod schema 校验
- [ ] 校验失败自动重试（最多 5 轮），重试 prompt 包含具体错误和期望的 JSON Schema
- [ ] 超 5 轮后降级：输出标记 `_degraded: true` + `_validationErrors`
- [ ] 现有 routing 机制完全不受影响（extractWorkflowRouting 基于原始文本）
- [ ] 所有现有测试通过 + 新增校验场景测试覆盖
- [ ] TypeScript 编译无错误
</success_criteria>

<output>
Create `.planning/quick/260531-umu-node-output-schema/260531-umu-SUMMARY.md` when done
</output>
