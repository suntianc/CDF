---
phase: quick
plan: 260527-isd-todo-run-values
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/llm.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "todos 变化通过 run.values 事件驱动即时推送到前端，无轮询延迟"
    - "run.values 迭代结束后（agent 执行完成）仍能推送最终 todos 状态"
    - "中断或错误场景下 todos 状态仍能正确推送"
  artifacts:
    - path: "src/main/llm.ts"
      provides: "run.values 消费逻辑替换 startTodoPolling"
      contains: "run.values"
  key_links:
    - from: "src/main/llm.ts::run.values"
      to: "src/main/llm.ts::checkAndSendTodos"
      via: "todos diff detection + IPC send"
      pattern: "checkAndSendTodos"
---

<objective>
将 todo 轮询机制（500ms setInterval）替换为 run.values 事件驱动方式。

Purpose: 消除轮询延迟，实现 todos 变化即时推送，减少不必要的 getState 调用。
Output: 修改后的 src/main/llm.ts，移除 startTodoPolling，添加 run.values 消费逻辑。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@src/main/llm.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 用 run.values 替换 startTodoPolling 轮询机制</name>
  <files>src/main/llm.ts</files>
  <behavior>
    - Test: run.values 消费逻辑在每个 state snapshot 中检测 todos 变化并推送 IPC
    - Test: run.values 迭代结束后推送最终 todos 状态
    - Test: startTodoPolling 函数及其调用点被完全移除
    - Test: checkAndSendTodos 函数保留，签名和 IPC 推送逻辑不变
    - Test: signal.aborted 时 run.values 迭代正确终止
  </behavior>
  <action>
修改 `src/main/llm.ts`，执行以下变更（所有变更在同一文件内）：

**1. 删除 `startTodoPolling` 函数（第 293-312 行）**

完全移除该函数定义。

**2. 在 `runLLMChat` 函数中移除所有轮询相关代码**

- 第 326 行：删除 `let stopTodoPolling = () => {};`
- 第 341 行：删除 `stopTodoPolling = startTodoPolling(runtime, payload.sessionId, sender, channel, lastTodosJsonRef, controller.signal);`
- 第 791 行（finally 块内）：删除 `stopTodoPolling();`

**3. 在 `runLLMChat` 的 while 循环内，添加 `valuesStreamPromise` 并行消费 `run.values`**

在 `const toolStreamPromise = ...` 之后（第 630 行附近），添加：

```typescript
const valuesStreamPromise = (async () => {
  for await (const values of run.values) {
    if (controller.signal.aborted) break;
    const todos = values?.todos;
    if (Array.isArray(todos)) {
      const todosJson = JSON.stringify(todos);
      if (todosJson !== lastTodosJsonRef.current) {
        lastTodosJsonRef.current = todosJson;
        sender.send(channel, {
          type: 'todos_update',
          todos,
        });
      }
    }
  }
})();
```

然后将第 632 行的：
```typescript
await Promise.all([messageStreamPromise, toolStreamPromise]);
```
改为：
```typescript
await Promise.all([messageStreamPromise, toolStreamPromise, valuesStreamPromise]);
```

**4. 保留现有的手动 `checkAndSendTodos` 调用点**

以下调用点保留不变，作为兜底（确保 todos 在 run.values 未覆盖的边界场景仍能推送）：
- 第 340 行：初始检查（run 开始前）
- 第 348 行：每轮 while 循环开始
- 第 594 行：工具调用成功后
- 第 627 行：工具调用失败后
- 第 633 行：消息和工具流消费完成后
- 第 764 行：主循环结束后
- 第 779 行：错误处理中

`checkAndSendTodos` 函数（第 260-291 行）保持不变，签名和逻辑不变。
  </action>
  <verify>
    <automated>cd /Users/suntc/project/CDF && npx tsc --noEmit --pretty 2>&1 | head -20</automated>
  </verify>
  <done>
    1. `startTodoPolling` 函数已从 llm.ts 中完全移除
    2. `run.values` 的 for-await-of 循环在每个 state snapshot 后检测 todos 变化并推送 IPC
    3. `valuesStreamPromise` 与 `messageStreamPromise`、`toolStreamPromise` 并行执行
    4. TypeScript 编译通过（无类型错误）
    5. `checkAndSendTodos` 函数保留，签名不变
    6. 所有现有的手动 `checkAndSendTodos` 调用点保留作为兜底
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| run.values -> IPC | run.values 产出的 state 数据通过 sender.send 推送到渲染进程 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|------------|
| T-quick-01 | Tampering | npm install | mitigate | 无新依赖引入，仅使用已有 @langchain/langgraph API |
</threat_model>

<verification>
- `npx tsc --noEmit` 无类型错误
- `startTodoPolling` 在代码中不存在（grep 确认）
- `run.values` 在 while 循环内被消费（grep 确认）
- `checkAndSendTodos` 函数仍存在且签名不变
- `valuesStreamPromise` 与 `messageStreamPromise`、`toolStreamPromise` 并行执行
</verification>

<success_criteria>
- todos 变化通过 run.values 事件驱动即时推送，无 500ms 轮询开销
- TypeScript 编译通过
- 现有功能（消息流、工具调用、中断/恢复）不受影响
</success_criteria>

<output>
Create `.planning/quick/260527-isd-todo-run-values/260527-isd-PLAN.md` when done
</output>
