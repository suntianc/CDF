# Phase 8: Polish + Differentiators - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 8-Polish + Differentiators
**Areas discussed:** 7-color source badge, MCP skeleton threshold, chokidar failure degradation

---

## 7-color source badge palette

| Option | Description | Selected |
|--------|-------------|----------|
| ROADMAP 原描述 + 暗色主题 | VS Code Dark+ 主题 palette; Claude 决定具体 hex | ✓ |
| Claude 全权决定（按 Claude Code / GitHub Primer 惯例） | 主题一致性差 | |

**User's choice:** 用 ROADMAP 原描述 + 暗色主题
**Notes:** 客人大人 2026-06-04 决策。Phase 6 默认 `<Badge>` 升级为 7 色彩色（Tailwind static class: `text-{color}-{500}`），不破坏 5 行 popup 视觉密度（D-21）。

---

## MCP skeleton spinner threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 500ms (ROADMAP 原定) | 快加载不闪，本地 mcp server 体验稳定 | ✓ |
| 200ms (更早出) | 本地加载也闪 | |
| 全局 spinner (无阈值) | 一致性最好但本地闪 | |

**User's choice:** 500ms (ROADMAP 原定阈值)
**Notes:** 客人大人 2026-06-04 决策。Skeleton 触发在 useCommandRegistry hook 内；500ms 是 setTimeout 阈值，IPC 响应到达时 clearTimeout。失败转 `mcp_health_warning` 灰行。

---

## Chokidar failure degradation

| Option | Description | Selected |
|--------|-------------|----------|
| readdir 一次扫描 + UI toast 降级提示 | 用户不被打断，仍可工作 | ✓ |
| 完整禁用 + 静默（仅 log） | 文件变动后不能 refresh | |
| 重试 3 次后降级 | 偶发失败不打扰用户 | |

**User's choice:** readdir 一次扫描 + UI toast 降级提示
**Notes:** 客人大人 2026-06-04 决策。Phase 6 D-24 仅 log 升级为 user-visible toast。降级后 watcher 完全停用不重试。Sonner `warning` variant, duration 5000ms。

---

## Claude's Discretion

- **C-01:** 亮色主题 7 色彩色 —— Phase 8 不做
- **C-02:** 7 色彩色应用到 popup 之外 —— Phase 8 限定 popup
- **C-03:** MCP skeleton 行数 —— 1 行
- **C-04:** toast dedup —— 1 次 / 错误指纹 Set
- **C-05:** Skeleton 颜色 —— shadcn default
- **C-06:** popup 视觉密度微调 —— 不调
- **C-07:** cmd:project 与 cmd:system 同色但深灰 —— ROADMAP 描述即可

## Deferred Ideas

### 推 v1.2+
- 亮色主题 polish（C-01）
- SLASH-15 SQLite 持久化
- SLASH-17 命令别名

### Phase 8 范围内不动
- 5 行 popup 视觉密度
- 重新设计 popup layout
- 替换 sonner toast 为 MessageItem
