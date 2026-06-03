---
quick_id: 260603-se4
slug: hotfix-m3-thinking-temperature-minimax-m
status: complete
date: 2026-06-03
commits:
  - 60ea8e0: fix(llm): strip temperature from modelConfig when M3 thinking is enabled
---

# Quick 260603-se4: M3 thinking — strip temperature from modelConfig

**One-liner:** 在 `minimax` / `minimax-overseas` 注入 `thinking: { type: 'adaptive' }` 的同 if-guard 内追加 `delete modelConfig.temperature`,让请求体完全不带 `temperature` 键,符合 Anthropic extended thinking 协议对 `temperature` / `top_p` / `top_k` 三个参数"未设置"的硬约束,消除 MiniMax M3 上游 `400 temperature is not supported when thinking is enabled` 报错。

## Changes

### Code (1 line, in existing if-guard)

`src/main/deepagent/llm-adapter.ts` — 在 `260603-s29` 引入的 if-guard (line 550-553) 内、`modelConfig.thinking = { type: 'adaptive' };` 之后新增一行 `delete modelConfig.temperature;`:

```ts
if (config.providerType === 'minimax' || config.providerType === 'minimax-overseas') {
  modelConfig.thinking = { type: 'adaptive' };
  delete modelConfig.temperature;  // ← NEW
}
```

共享 `modelConfig` 字面量 (lines 530-535) 与 line 536 的 `config.temperature` 覆盖逻辑完全未动 — 共享 case 块内的 deepseek / zhipu / glm-overseas 三个 provider 仍然走 `temperature: 0` 默认路径,不受本次修补影响(它们的 providerType 不匹配新 if-guard)。

### Tests (7 assertions, +7 lines)

`src/main/deepagent/llm-adapter.test.ts` — 在 `260603-s29` 已有的 3 个 it 块内追加 temperature 断言:

1. **Positive — `minimax` + `MiniMax-M3`** (line 90): `expect(model.temperature).toBeUndefined()` — 验证 delete 生效
2. **Positive — `minimax-overseas` + `MiniMax-M3`** (line 102): `expect(model.temperature).toBeUndefined()` — 验证 delete 生效
3. **Negative sweep — openai / anthropic / ollama / deepseek / zhipu** (lines 113, 123, 132, 141, 150): 每个 provider 追加 `expect(model.temperature).toBe(0)` — 验证 delete 不外溢,非 M3 路径仍然带 `temperature: 0`

5 个负向断言的覆盖目标:**确认本次 strip 没有意外影响其他 provider**。任一非 M3 provider 的 `model.temperature` 变成 `undefined` 都会让这个 sweep 失败,等同于本次 hotfix 的回归护栏。

## Deviations from Plan

None — 计划完全按 PLAN.md 执行,无 auto-fix、无 scope 漂移、无 architectural 决策需要上报。

## Verification

- `npx vitest run src/main/deepagent/llm-adapter.test.ts` → **PASS (10) FAIL (0)**
  - 5 个 pre-existing tests (openai / minimax × 2 / minimax-overseas × 2 / deepseek) 通过
  - 3 个 260603-s29 新增 tests (positive × 2 + negative sweep) 通过
  - 2 个 getOllamaBaseUrl tests 通过
- 未跑 `npm run build` / 完整 test suite(per quick-task convention,`file-tools.test.ts` / `skill-manager.test.ts` 有 pre-existing 无关失败)
- Code search: `delete modelConfig.temperature` 唯一出现位置在 if-guard 内,无外溢

## Notes

- 本次是 260603-s29 引入的回归修补。s29 在共享 ChatAnthropic `modelConfig` 内注入 `thinking: { type: 'adaptive' }` 是必要前提,本次 strip temperature 是必要约束 — 两个改动合在一起才让 M3 chat 路径真正可用
- 共享 case 块内包含 5 个 provider (deepseek / minimax / minimax-overseas / zhipu / glm-overseas),但 if-guard 只命中 2 个;`config.temperature` 字段虽然在 line 536 仍会覆盖,但因为该 if-guard 内的 `delete` 在覆盖之后执行,顺序上保证 temperature 被最终移除
- Anthropic extended thinking 协议对 `temperature` / `top_p` / `top_k` 三个参数硬性要求"未设置"(不可为 null、不可为 0)— 本次用 `delete` 而非 `= null`/`= undefined` 是为了从 JSON body 中完全消除该键,符合"未设置"语义
