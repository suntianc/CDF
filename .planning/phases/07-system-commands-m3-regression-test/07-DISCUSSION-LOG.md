# Phase 7: System Commands + M3 Regression Test - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 7-System Commands + M3 Regression Test
**Areas discussed:** /goal placeholder design, /context scope, SLASH-REGRESSION location, /plan placeholder

---

## /goal X placeholder bubble content

| Option | Description | Selected |
|--------|-------------|----------|
| `[system] 正在执行 /goal…` | ROADMAP 原文 — 占位文案；X 内容只写入 store | ✓ |
| 显示 X 内容 (e.g. `[system] 设置目标: write tests`) | placeholder 显示用户输入的 X | |
| 完全无占位气泡 | dispatcher 静默分支；不渲染 UI | |

**User's choice:** `[system] 正在执行 /goal…`
**Notes:** 客人大人 2026-06-04 决策。Phase 6 dispatcher 的 SystemSilent 分支已实现 `console.log` 占位；Phase 7 升级为真实 UI feedback（toast + bubble）。X 内容只写入 `sessionGoals` Map，不显示。

---

## /context [all] vs /context

| Option | Description | Selected |
|--------|-------------|----------|
| `/context` = 当前 session；`/context all` = 全部 sessions | ROADMAP 原文 | |
| `/context` = 当前 session（不管 args） | 所有 args 都返回当前 session | |
| 移除 [all] 标记 | 删除 [all] 语义 | |
| **当前 session，统计维度为 session 加载的对话 + skills + mcp + workflow** | 扩展 scope | ✓ |

**User's choice:** 当前 session，统计维度为 session 所加载的对话、skills、mcp、workflow 等数据
**Notes:** 客人大人 2026-06-04 决策 — 比 ROADMAP 原文 scope 更宽。Phase 7 需要新增 IPC 通道 `context:currentSession` 一次性拉全 (conversation tokens + skills tokens + mcp tools tokens + workflows tokens)。

---

## SLASH-REGRESSION location

| Option | Description | Selected |
|--------|-------------|----------|
| llm-adapter.test.ts | 贴近 patch-package 同一层 | ✓ |
| llm.test.ts | 贴近 sendMessage 入口 | |
| 两处都加 | 双层覆盖 | |

**User's choice:** llm-adapter.test.ts
**Notes:** 客人大人 2026-06-04 决策。`llm-adapter.ts` 是 Anthropic SDK 适配器层（与 patch-package 同一层），是 `<think>` chunk 的诞生地。SLASH-REGRESSION 验证 patch-package 锁定 `@langchain/anthropic@1.4.0` 的 reasoning roundtrip 仍正常。

---

## /plan placeholder bubble

| Option | Description | Selected |
|--------|-------------|----------|
| 需要，样式不同于 /goal | 带 [plan] 标记；plan 气泡持续存在 | ✓ |
| 不需要，直接进入 LLM 流 | 首个 `message_chunk` (think block) 本身就是进度指示 | |

**User's choice:** 需要，样式不同于 /goal
**Notes:** 客人大人 2026-06-04 决策。`/plan` 的气泡会**持续存在**（直到 LLM 返回第一个 `message_chunk`），与 `/goal` 瞬时气泡形成对比。视觉上带 `[plan]` 前缀区分。

---

## Claude's Discretion

- **C-01:** 3 个气泡的具体颜色 / 图标 / 排版 —— 沿用 Phase 5 message item 样式 + `[system]` / `[plan]` 前缀
- **C-02:** `/goal X` 的 X 是否 trim —— `args.trim()` 一致
- **C-03:** `/plan` 描述是否截断 —— 不截断
- **C-04:** 气泡消失时机 —— 用户发下一条消息时自动消失（与现有 chat bubbles 行为一致）
- **C-05:** Session 切换的 sessionGoals 处理 —— 保留 Map 全部
- **C-06:** 5 行 sniff 的精确位置 —— `handleSend` 函数体内前 5 行
- **C-07:** IPC `context:currentSession` 通道签名 —— `(sessionId: string) => Promise<{ breakdown, total }>`
- **C-08:** Token 估算精度 —— `String.length * 0.25` 粗估；gpt-tokenizer 推 v1.2

## Deferred Ideas

### 推 Phase 8 polish
- Source badge 视觉打磨
- Skeleton/spinner 加载态
- CJK NFKC 强化

### 推 v1.2+
- SLASH-15 (`/goal` SQLite 持久化)
- SLASH-17 (命令别名)
- 精确 token 计数 (gpt-tokenizer)
