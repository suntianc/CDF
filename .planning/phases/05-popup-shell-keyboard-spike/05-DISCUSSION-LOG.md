# Phase 5: Popup Shell + Keyboard Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 5-Popup Shell + Keyboard Spike
**Areas discussed:** Row 内容, 空状态, 选择持久, 过滤方式

---

## Row 内容 (each row's display)

| Option | Description | Selected |
|--------|-------------|----------|
| 仅命令名 | 极简：只显示命令名。Phase 5 SPIKE 阶段最简项。后续 phase 可加 description/keybind。 | ✓ |
| 名 + 描述 | 名字 + 一行描述（灰色小字），5 行 popup 中有详情眼。cmdk 默认效果。 | |
| 名 + 描述 + 源 badge | 名字 + 描述 + 源 badge + keybind hint。信息密度高，但 5 行 popup 可能较满。 | |

**User's choice:** 仅命令名（极致简，Phase 5 首选）
**Notes:** User explicitly noted "Phase 5 首选" — 极致简 is the SPIKE principle. Future phases (Phase 6+) will add description + source badge.

---

## 空状态 + no-commands 状态

| Option | Description | Selected |
|--------|-------------|----------|
| 3 系统占位 + "无匹配" 文本提示 | Phase 5 弹 3 系统命令占位（即便插件源未注册）。过滤无匹配时显示 "无匹配" 文本提示。 | ✓ |
| 硬编码 3 占位 + 输入框不显示任何提示 | 始终硬编码 3 占位。过滤无匹配时空零行。 | |
| 3 系统占位 + 占位交互提示 | 3 占位 + 空状态提示（如 "试 /go"），辅助用户理解。 | |

**User's choice:** 3 系统占位 + 占位交互提示
**Notes:** Interpretation: always show 3 system placeholders (`/goal` `/context` `/plan`) as visual baseline. When user types filter that matches nothing, show a single interactive hint line (not empty rows, not 3 placeholders) — communicates "popup is alive, try different input". Specific hint text left to Claude's discretion (C-01).

---

## 重开选中 (selection persistence across opens)

| Option | Description | Selected |
|--------|-------------|----------|
| 每次重置到顶 | 每次 popup 打开都高亮第一行（最上面）。可预测。cmdk 默认。 | ✓ |
| 记住上次输入 (本 session 范围内) | 记住 popup 关闭时选中的行。session 内重开时恢复。 | |

**User's choice:** 每次重置到顶（推荐）
**Notes:** User initially found the question unclear ("这个什么意思"); after rephrasing with concrete scenario (open popup, type `/go`, Esc, reopen with `/c` — where's cursor?), user picked "reset to top" for predictability. Frecency (SLASH-16 in Future Requirements) is the upgrade path if users later want this.

---

## 过滤方式

| Option | Description | Selected |
|--------|-------------|----------|
| substring + 名字 | 子串 + 忽略大小写 + NFKC 归一化，匹命令名。Claude Code 同款。 | ✓ |
| fuzzy (fuzzysort / cmdk shouldFilter) | 模糊匹配（typo 容忍）。宽容但可能匹到不需项。 | |
| substring 名字 + fuzzy 描述 | 名字 substring 匹 + 描述 fuzzy 匹。 | |

**User's choice:** substring + 名字（简单）
**Notes:** User initially found the question unclear ("这个又是什么意思"); after rephrasing with concrete examples (`go` 匹 `goal` vs fuzzy `clrst` 匹 `clear-stats`), user picked substring. NFKC normalization for CJK compatibility is implicit (per research SUMMARY PITFALLS P6 #64941). Description search deferred (Phase 6+ when descriptions exist).

---

## Claude's Discretion

- **C-01:** Exact text of the interactive hint placeholder (D-03) — pick clear short hint fitting CDF's tone.
- **C-02:** Visual position of popup (above vs below textarea) — default below, can flip for small viewports.
- **C-03:** `cmdk.Command.List` vs `cmdk.Command.Group` for the 3 system placeholders — pick cleaner.

---

## Deferred Ideas

- Description column in popup rows (Phase 6+ when plugin commands have descriptions)
- Source badge column (Phase 6+ when plugin registry is wired)
- Frecency-based ordering (SLASH-16, v1.2+)
- Description search filter (requires descriptions; deferred)
- Active filter highlight (bold the matched substring; v1.2 polish)
- Args parsing for plugin commands (locked in REQUIREMENTS.md as "extra text = natural-language context")
- Project custom command authoring UX (SLASH-21, v1.2+)
- Voice input fallback (SLASH-22, v1.2+)
- `/goal` SQLite persistence (SLASH-15, v1.2+)
- MCP args schema form (SLASH-14, v1.2+)
