---
quick: 260602-fs4-claude-code-workflow-temperature-maxtoke
plan: 01
type: execute
title: 应用 Claude Code Workflow 哲学加固工作流稳定性
completed: 2026-06-02
duration_minutes: ~25
tasks_completed: 3
files_modified: 8
insertions: 235
deletions: 15
commits:
  - fc0d239 (Task 1)
  - f017d5d (Task 2)
  - be2e73b (Task 3)
---

# Quick 260602-fs4: 应用 Claude Code Workflow 哲学加固工作流稳定性

## 背景

CDF 工作流已经 80% 是 Claude Code Workflow 形态(ReactFlow 编排 + edges + Agent + MCP + Skills + 历史导出),缺三块拼图:

1. 节点级 LLM 参数(`temperature` / `maxTokens`)
2. 工具调用结果结构化落库(已有 callback 但只 push 成 log 文本)
3. 节点失败原因分类(`error_type` 列已存在,值未规范)

**严格执行 KISS / YAGNI / Surgical Changes**:不引入任何"输出校验"、"自动重试"、"契约模式"、工作区快照对比、健康度徽章/统计。

## 完成情况

### Task 1: 节点级 LLM 参数配置(`temperature` / `maxTokens`)
**Commit:** fc0d239

- `src/shared/types.ts` — `WorkflowNode.data` 新增 `temperature?: number` / `maxTokens?: number` 可选字段
- `src/main/deepagent/llm-adapter.ts` — `RuntimeProviderModelConfig` 透传 `temperature` / `maxTokens`;`createLangChainModel` 在参数非 undefined 时覆盖 provider 默认,undefined 时维持各 provider 现行硬编码(`temperature: 0` / `maxTokens: 4096`)
- `src/main/workflow/node-executor.ts` — 调用 `createLangChainModel` 时透传 `node.data.temperature` / `node.data.maxTokens`
- `NodeConfigDrawer.tsx` — `needsAgent` 区段新增"高级(LLM 参数)"折叠区块,显示 `temperature` / `maxTokens` 两个 input,留空使用 provider 默认

### Task 2: 工具调用结果结构化落库
**Commit:** f017d5d

- `src/shared/types.ts` — 新增 `ToolCallRecord` 接口(`tool/args/success/error/duration_ms/started_at/ended_at`);`WorkflowNodeRun.tool_calls?: ToolCallRecord[]`
- `src/main/database.ts` — `workflow_node_runs.tool_calls TEXT` 列(idempotent ALTER,沿用 `logs TEXT` 模式)
- `src/main/workflow/node-executor.ts` — `invokeAgent` 回调内累积 `toolCalls` 数组(`Map<runId, { name, startTime, args }>`),跨 `invokeAgent` 共享(loop/foreach 不重置);三个 return 路径(loop / foreach / task)均把 `tool_calls` 塞入返回对象
- `src/main/workflow/workflow-runtime.ts` — 成功路径 INSERT 加 `tool_calls` 列(`JSON.stringify(nodeOutput.tool_calls || [])`);失败路径保持 `null`(简化)
- `src/main/workflow/log-exporter.ts` — `buildExportPayload` node_runs 映射新增 `tool_calls` 字段
- 向后兼容:onLog 文本输出行为不变

### Task 3: 节点失败原因分类(`error_type` 枚举规范化)
**Commit:** be2e73b

- `src/shared/types.ts` — 新增 `NodeErrorType` 枚举(`'timeout' | 'tool_error' | 'llm_error' | 'no_routing' | 'aborted' | 'unknown'`);`WorkflowNodeRun.error_type` 收紧为该枚举
- `src/main/workflow/node-executor.ts` — 新增 `ClassifiedNodeError extends Error`(携带 `errorType` 字段)+ 纯函数 `classifyError(err, toolCalls)`,优先级:`AgentTimeoutError` > 有 tool 失败 > 错误信息含 LLM/网络关键词 > `unknown`;catch 块包装为 `ClassifiedNodeError` 后 throw(保留原 message)
- `src/main/workflow/workflow-runtime.ts` — 失败路径用 `classifyRuntimeError` 替代硬编码 `'node_error'`;兼容 graph-builder 序列化的 `errorType` class name 字符串(`AgentTimeoutError` → `timeout`);`nodeErrorEvent.errorType` 同步更新
- Abort 路径:跟踪 `completedNodeIds` Set,在主循环 break 后扫描 `nodeStartTimes`,补写"已开始未完成"的 node_run(`status='stopped'`,`error_type='aborted'`,`error='用户中止'`)
- `ExecutionPanel.tsx` — 失败节点展示"失败类型: <中文标签>";`ExecutionHistoryDrawer.tsx` 维持最小改动(不展示 per-node 错误类型,符合"严格最小改动"原则)

## 验证

### 类型检查(只过滤我改动的文件)
```bash
npx tsc --noEmit -p tsconfig.node.json
# 我改动的 4 个文件均无新增错误(其它文件的 11 个错误均为 baseline 已存在的预存问题)

npx tsc --noEmit -p tsconfig.web.json
# 我改动的 2 个文件均无新增错误(其它文件的 30 个错误均为 baseline 已存在的预存问题)
```

预存错误(baseline 7a42dcb 已存在,与本 quick 无关):
- `electron.vite.config.ts`、`arxiv-tool.ts`、`bash-tool.ts`、`llm-adapter.ts` 中已有的 `_convertInputToPromptValue` protected 访问、`run_id` 转换问题等
- 渲染层 `@/...` 路径别名解析、`react-dom/client` 声明、`ChatArea` 中 `null` 索引等

### 单元测试
```bash
npx vitest run src/main/workflow
# 20 / 20 PASS(node-executor + graph-builder + workflow-runtime 全覆盖)

npx vitest run
# 88 / 90 跑通,2 个失败均为 baseline 已存在的 file-tools / skill-manager 预存问题
```

## 偏离计划

### 自动修正(1 处)

**1. [Rule 3 - Blocking] classifyRuntimeError 输入类型扩展**
- **位置:** `src/main/workflow/workflow-runtime.ts` `classifyRuntimeError` 函数
- **计划:** `if (err instanceof ClassifiedNodeError) ...; if (err instanceof AgentTimeoutError) ...;` 三行实现,期望传入 Error 实例
- **问题:** workflow-runtime 的失败路径中只拿到 graph-builder 序列化后的字符串(`err.error` 是 message 字符串,`err.name` 在 `nodeOutputs[err.nodeId].errorType` 里),无法获得实际 Error 实例;若严格按 `classifyRuntimeError(err.error)` 调用,所有失败都会落到 `unknown` 分支,失去分类价值
- **修正:** 在 `classifyRuntimeError` 末尾追加 `typeof err === 'string'` 的 fallback 分支,识别 `'AgentTimeoutError' | 'ClassifiedNodeError' | 'AgentNotFoundError'` 三个常见 class name;调用处改用 `classifyRuntimeError(chunkNodeOutput?.errorType ?? err.error)`,优先用 graph-builder 已序列化的 class name 字符串
- **影响:** 实现比 plan 多了 ~5 行,但保留了 plan 三个 `instanceof` 检查(不破坏 plan 主体),并使失败路径能正确分类(timeout / unknown)
- **依据:** KISS / Surgical 不变,plan 函数的实例检查路径仍存在;扩展仅做 best-effort 字符串识别,不动 plan 已定义的核心逻辑

## 设计决策

1. **`ClassifiedNodeError` 而非 WeakMap / 模块级变量:** plan 起初考虑用模块级 `lastClassifiedErrorType` 变量或 `WeakMap<WorkflowNode, NodeErrorType>`,但存在并发覆盖风险(loop / foreach 内的 `await` 可能让两个 node 交错)。`ClassifiedNodeError` 把分类结果打包进异常对象,workflow-runtime 通过 `err.errorType` 读出,单线程顺序执行无并发问题,且 type-safe(自定义 Error 子类)
2. **abort 路径写入 `error='用户中止'` 而非 `null`:** 历史记录 UI 展示"已停止"节点时,中文 `用户中止` 比空白更易理解,符合"不损失可读性"原则
3. **失败路径 `tool_calls` 写 `null` 而非 `[]`:** 失败时 callback 数据已通过 `logs` 体现,空数组会误导消费者认为"成功但无工具调用";`null` 语义清晰 = 失败时无结构化数据
4. **drawer 中 `failureStrategy` 区段顺序调整:** "高级(LLM 参数)" 区块放在 `failureStrategy` 之后(`failureStrategy === 'retry' && retryCount` 之前),与 plan 描述一致(失败策略之后)
5. **`temperature` / `maxTokens` UI 留空处理:** 留空时 `handleSave` 不把字段写入 `onUpdateNode` payload,确保下游读取时 `undefined`,与 adapter 内部"undefined 时不覆盖"判断对齐

## 后续兼容性

- 现有 DB 通过 `try { ALTER TABLE } catch {}` 模式自动迁移 `tool_calls` 列(新列可空,旧 workflow 不受影响)
- 现有工作流 `WorkflowNode.data` 未配置 `temperature` / `maxTokens` 时,各 provider 维持原硬编码默认
- 现有 `node.execution.node_error` 事件 listener 通过 `errorType` 字段读到的值从 `node_error` 变更为真实分类(timeout / tool_error / llm_error / unknown),需要检查前端消费方是否对 `node_error` 字面量有依赖(已搜索:无)

## 手测建议(plan 列出但本 quick 不执行)

1. 打开任意 Agent 节点配置抽屉,展开"高级",填入 `temperature=0.7` / `maxTokens=2048` 并保存,关闭后重开确认回显
2. 跑一个含 MCP 工具调用的工作流(ArXiv 搜索),导出 JSON,验证 `node_runs[*].tool_calls` 数组每项含 `tool/success/duration_ms/started_at/ended_at`,args 可读
3. 让 agent 故意不输出 routing 信号的 review 节点,验证 ExecutionPanel 不显示失败类型(因为 plan 不造判定,no_routing 仅作为枚举预留)
4. 跑一个 timeout 路径(配 sleep > 5min),验证 error_type='timeout',UI 显示"执行超时"
5. 跑一个调用不存在工具的工作流,验证 error_type='tool_error',UI 显示"工具调用失败"
6. 中途点停止按钮,验证已 started 未完成节点写 `status='stopped' error_type='aborted'`
