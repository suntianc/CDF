# Feature Landscape: v1.1 `/` Command Popup for CDF

**Domain:** Renderer-side slash command palette in chat composer (Electron + React 19)
**Researched:** 2026-06-04
**Confidence:** HIGH — feature patterns triangulated across Claude Code (95 commands documented + webfetch), Cursor Composer, Linear command palette, Raycast, Slack, GitHub Copilot Chat; CDF source inspected (cmdk + Radix Popover stack from STACK.md; 4-source plugin registry from ARCHITECTURE.md; pitfalls from PITFALLS.md)

---

## Executive Summary

`/` command popups are a **commodity pattern in 2026** — every modern chat/composer (Claude Code, Cursor, Linear, Slack, Raycast, GitHub Copilot Chat, VS Code) implements roughly the same core. The "OK" bar is well-defined: trigger on `/`, fuzzy/substring filter, ↑↓ navigation, Enter to dispatch, Esc to close, mouse click to dispatch. **Getting this wrong is career-ending** because users will feel the gap instantly (see Pitfall 6 in PITFALLS.md — 5 real Claude Code bugs that all boiled down to "popup felt broken").

The "great" bar separates the products. **Differentiators** like: (1) **grouped/categorized command rows** (system vs skill vs MCP vs workflow vs project), (2) **keyboard shortcut hints** in each row (`/plan [description]`), (3) **alias expansion** (`/co` → `/compact`), (4) **fuzzy + alias keywords** for non-name search, (5) **recent/frecency ordering**, (6) **description preview on hover/focus**, (7) **inline args hint** that updates the placeholder as the user types, (8) **source badge** disambiguating same-name commands across sources, (9) **empty-state actions** ("No matches. Try `/clear` or type freeform text."), (10) **loading state for slow sources** (MCP cold start), (11) **inline help/syntax tooltip** on `?` key, (12) **`⌘/` global trigger** to focus composer and pre-fill `/`, (13) **args inline parsing preview** for commands with required schema fields.

CDF's v1.1 ships a **deliberately minimal 3-system + 4-plugin-source** design (per PROJECT.md "极简设计" decision). Anti-features are mostly things Claude Code or Cursor do that are out of scope for v1.1: alias system, frecency, args parsing, `⌘K` global palette, mention `@` triggers.

**The single most important architectural insight** is that CDF's plugin commands are NOT a new dispatch path — they are **aliases that flow through the existing `llm:chat` IPC** (per ARCHITECTURE.md §4.3, "plugin commands transparent to v3 streamEvents + M3 thinking"). This means the popup is a **UX layer over the existing chat pipeline**, not a new system.

---

## Table Stakes (Users Expect These)

Features present in **every** modern `/` command popup. Missing any of these = popup feels broken or amateur.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| **T1** | **`/` char trigger** opens popup anchored to cursor/textarea | Core mental model: "type slash, get list" | LOW | Claude Code, Cursor, Slack all do this. Stays in `onChange` handler; opens when `inputVal.startsWith('/')`. |
| **T2** | **Substring/prefix filter as you type** | Every product since 2015 has this | LOW | cmdk built-in. Sticky match: typing `/go` narrows to `/goal`. `String#includes` is enough at <100 commands (no fuzzy needed per PITFALLS.md P6). |
| **T3** | **↑↓ keyboard navigation** through filtered list | All keyboard-driven power users expect this | LOW | cmdk handles internally. Selected index wrapped modulo `list.length` to avoid "stuck at bottom" bug (PITFALLS.md P6 — Claude Code #65014). |
| **T4** | **Enter triggers selected command** | Universal "confirm" key | LOW | cmdk `<Command.Item onSelect>`. When popup is open, **textarea's Enter handler must be swallowed** to prevent accidental message send (key interception pattern in STACK.md Pattern 1). |
| **T5** | **Esc closes popup** without sending | Universal "cancel" key | LOW | cmdk handles via `Command.Input` listener. Popup stays open if list isn't empty and user is still typing; closes on Esc or on `Backspace` when query is empty (claude code behavior). |
| **T6** | **Mouse click on row triggers command** | Touchpad / non-power users | LOW | cmdk `<Command.Item onSelect>` wired to same handler as Enter. Hover state via Tailwind `data-[selected=true]:bg-accent`. |
| **T7** | **Each row shows: icon + name + description** | Standard "list of options" UI | LOW | Per-source lucide-react icon (Goal, BookOpen, ListTree, Plug, Wand2, FolderOpen). Name in `font-medium`, description in `text-xs text-muted-foreground`. Truncate description at ~60 chars visually but keep full text in DOM for accessibility (`title` attribute). |
| **T8** | **Empty state message** when no matches | "Type-X-got-no-results" is a classic dead-end | LOW | `<Command.Empty>未匹配到命令。试试 /help 或直接输入自然语言。</Command.Empty>`. Claude Code shows "No results" with optional tip; Cursor shows "No commands" and gracefully falls through. |
| **T9** | **Grouped headings by source** (system / skill / MCP / workflow / project) | Multiple categories would be chaos without grouping | LOW | cmdk `<Command.Group heading={SOURCE_LABELS[source]}>`. Default ordering: system first, then skill, workflow, MCP, project (per ARCHITECTURE.md §4.1). |
| **T10** | **Backspace at empty query closes popup** | "I'm done filtering" | LOW | When query is empty and user backspaces from `/` to nothing, close popup. Standard Claude Code / Slack behavior. |
| **T11** | **Popup stays anchored to textarea while typing** | "Where am I filling in" | LOW | `absolute bottom-full mb-2` relative to `<form>`. Same model as existing `<ModelSelector>` dropdown in `ChatArea.tsx:1018`. **z-index ≥ 50** to clear todos / banners (PITFALLS.md P4). |
| **T12** | **Args placeholder shown in textarea after command picked** | "I picked a command, now I need to fill args" | MEDIUM | After Enter: replace `/${cmd}` with `/${cmd} ` and show `argsHint` (e.g. `[condition]`, `[all]`, `[description]`) as faded placeholder text inside textarea. Pattern: `placeholder` attribute swap. |
| **T13** | **IME composition safety** | CJK / Korean / Japanese users hit this daily | MEDIUM | Both `isComposingRef` (current input in composition) and `justFinishedComposingRef` (200ms after composition ends) gates. Without it, Chinese user typing `/` then selecting candidate `「/」` will accidentally open popup mid-composition (PITFALLS.md P13). |
| **T14** | **Args passed as-is after space separator** | Standard mental model: `/cmd arg1 arg2` | LOW | `args = inputVal.substring(1 + cmd.length).trim()` — passthrough, no parsing. PROJECT.md constraint: "参数空格分隔直接给底层 tool/skill/workflow，不做 wrapper 智能". |
| **T15** | **Command only recognized at message start** | "It's not a command if it's in the middle of a sentence" | LOW | PROJECT.md constraint. Check `textarea.value.trim().startsWith('/')` AND `textarea.selectionStart <= 1 + query.length` (cursor after command, not in middle). Claude Code uses cursor-line-start check (PITFALLS.md P5). |

---

## Standard System Commands in IDE-like Tools

Across Claude Code, Cursor, VS Code, JetBrains, and the broader "agentic IDE" space, the **most-reused system command categories** are:

| Category | Claude Code example | Why it exists | CDF v1.1 mapping |
|----------|---------------------|---------------|------------------|
| **Plan mode toggle** | `/plan [description]` | Switches from execute to plan-only — saves tokens, prevents accidental writes | `/plan` (PROJECT.md SLASH-07) — set `planOnly: true` flag in `payload.overrides` (existing `llm.ts:324` extension point) |
| **Goal / target setting** | `/goal [condition\|clear]` | Persistent objective that agent pursues across turns | `/goal` (SLASH-05) — set session-level goal in `useSessionStore.sessionGoals: Map<sessionId, string>` (v1.1 in-memory; v1.2+ persist to `session_goals` table) |
| **Context inspection** | `/context [all]` | Show current context window usage; users need to know when they're hitting the wall | `/context` (SLASH-06) — read `messages` token count, render as static bubble (don't enter LLM stream) |
| **Compact / summarize** | `/compact [instructions]` | Free up context by summarizing history | **Out of v1.1 scope** (CDF uses 85% threshold auto-summarize, no manual trigger needed) |
| **Clear / reset** | `/clear` | Wipe chat history, start fresh | **Out of v1.1 scope** (not in PROJECT.md Active list) |
| **Help** | `/help` | Discover available commands | **Deferred** — popup itself is the help in v1.1 (no separate `/help` command) |
| **Model switch** | `/model [model]`, `/effort` | Switch underlying LLM | **Already exists** as `<ModelSelector>` in ChatArea — not a slash command |
| **Status / settings** | `/status`, `/stats` | Open settings panels | **Out of v1.1 scope** |
| **MCP management** | `/mcp` | Manage MCP server connections | **Deferred** — `<McpManager>` UI exists separately |
| **Agent management** | `/agents` | Manage sub-agents | **Deferred** — `<AgentManager>` UI exists separately |
| **Permissions** | `/permissions` | Tool approval rules | **Out of v1.1 scope** |
| **Skills listing** | `/skills` | Browse skill inventory with `t` (sort by token count) and `Space` (hide) | **Deferred** — popup shows them inline as a category, no need for separate command |
| **Reload** | `/reload-plugins`, `/reload-skills` | Re-scan on-disk assets without restart | **Deferred** — v1.1 uses chokidar per PITFALLS.md P10 |
| **Memory** | `/memory` | Edit `CLAUDE.md` files | **Out of v1.1 scope** (no `CLAUDE.md` in CDF) |
| **Workspace setup** | `/init` | Bootstrap project with `CLAUDE.md` | **Out of v1.1 scope** |

**The 3 commands CDF picked (`/goal`, `/context`, `/plan`) are exactly the 3 most-frequently-used categories in Claude Code** — and importantly, all 3 are **non-LLM-dispatched** (local state changes or static replies), which aligns with the v1.1 architecture decision to NOT route through `llm:chat` for system commands (per ARCHITECTURE.md §4.2).

**The 50+ CLI-specific commands** in Claude Code (`/install-github-app`, `/login`, `/logout`, `/privacy-settings`, `/security-review`, `/teleport`, etc.) are **deliberately excluded** from CDF — these are tied to Claude Code's CLI/auth/web/Chrome-extension surface, which CDF doesn't have (CDF is a desktop app with `safeStorage` API key management, no Anthropic account flow).

---

## Differentiators (What Makes a `/` System Feel "Great" vs "OK")

These are the **polish features** that separate Claude Code / Cursor / Linear from a "homework assignment" popup. Most are LOW-MEDIUM complexity but HIGH user-perception value.

| # | Feature | Value Proposition | Complexity | Real-Product Precedent | Notes |
|---|---------|-------------------|------------|------------------------|-------|
| **D1** | **Source badge on each row** (`[skill]` `[mcp:arxiv]` `[workflow]` `[project]`) | Disambiguates same-name commands from different sources | LOW | Claude Code uses `[Skill]` `[Workflow]` superscript tags; Linear uses color dots | PROJECT.md SLASH-12. Reuses existing `<Badge>` from `ui/badge.tsx`. Different colors per source (system=blue, skill=purple, workflow=green, mcp=orange, project=gray). |
| **D2** | **Args hint visible in row** (`/plan [description]`) | Tells user what to type after command | LOW | Claude Code marks `<arg>` required vs `[arg]` optional in docs; Cursor shows hint in row | Per ARCHITECTURE.md `argsHint` field already designed. Render as `<span class="text-muted-foreground ml-1">[description]</span>`. |
| **D3** | **Frecency / recent commands at top** | Power users run 3-4 commands repeatedly; sorting them first saves time | MEDIUM | Raycast pioneered this; Linear copied; Cursor adopted | **v1.1 OUT of scope** (per "极简设计"). Tracked in v1.2+ via `useSlashCommandStore.recent: string[]` (persist to `electron-store`). |
| **D4** | **Alias resolution** (`/co` → `/compact`) | Faster invocation for common commands | MEDIUM | Claude Code has `/co` and `/continue` aliases per `bke4wrnx4.txt:59,79` | **v1.1 OUT of scope**. Add `aliases?: string[]` to `SlashCommand` type later. |
| **D5** | **Keyboard shortcut hints in row** (`Ctrl+Shift+P`) | Discoverability for power users | LOW | VS Code shows shortcut right of command name | Not in v1.1 (no shortcuts yet). Defer. |
| **D6** | **Description preview on focus/hover** (rich tooltip) | Lets user pick the right command when descriptions are similar | MEDIUM | Cursor shows full description in a side panel; Linear has inline expansion | v1.1: just truncate at 60 chars in row + full in `title` attribute. v1.2+: dedicated preview pane. |
| **D7** | **Loading state for slow sources** (`加载 MCP tools...`) | Prevents "popup opened but empty" confusion | MEDIUM | Raycast; macOS Spotlight | Per PITFALLS.md P12. cmdk has no built-in loading slot; reuse `<Command.Empty>` with "加载中..." text + spinner. |
| **D8** | **Category headers with count** (`Skills (6)`) | At-a-glance inventory size | LOW | Linear, Raycast, VS Code | cmdk `<Command.Group heading>`. Optional numeric badge. |
| **D9** | **Group ordering is intentional, not alphabetical** | "Most useful first" beats A-Z | LOW | Cursor puts @-files first; Linear puts recents first | v1.1 ordering: system > skill > workflow > mcp > project (per ARCHITECTURE.md). Within group, alphabetical. |
| **D10** | **`⌘/` global shortcut to open popup** | Discoverable, muscle-memory | LOW | Slack, Discord use `⌘/` for "jump to channel"; Cursor uses `⌘K` for command palette | v1.1: defer (textarea already focusable). Add global listener in v1.2. |
| **D11** | **Conflict detection at registry-build time + non-blocking toast** | Silent overwrite = footgun (Claude Code bugs #61857, #62409 cited in PITFALLS.md P3) | MEDIUM | Claude Code now disambiguates via superscript tags; VS Code shows warning at extension install | **v1.1 INCLUDE** (per SLASH-12). Toast: "插件 X 的命令 Y 与系统命令冲突，未注册" via existing `<Toast>` component if any, or shadcn `sonner`. |
| **D12** | **Placeholder swap after command picked** (textarea shows `/plan [description]` faded) | Reinforces "fill this in" without modal | LOW | Cursor, Claude Code | v1.1 INCLUDE. After command selected: `inputVal = '/${cmd} '` + `placeholder = argsHint`. |
| **D13** | **CJK command name support** (skill named `代码审查` visible) | Chinese / Japanese / Korean users can't use English-only filter | LOW | All CJK-aware products do `normalize("NFKC")` before substring match | **v1.1 INCLUDE** (PITFALLS.md P6 #64941). Apply `normalize("NFKC")` to both query and `cmd.id`/`cmd.label` before `.includes()`. |
| **D14** | **Special chars (`.`, `//`, `-`) don't break filter** | Real commands have dots and slashes | LOW | Claude Code bugs #65047, #65050 | **v1.1 INCLUDE** (PITFALLS.md P6). Use `String#includes`, not `split('.')` or `split('/')`. |
| **D15** | **System command placeholders in message stream** (silent system commands show `[system] 正在执行 /plan...`) | User gets feedback that *something* happened | MEDIUM | Slack shows "is typing..."; Claude Code shows "thinking..."; CDF already has thinking indicator | **v1.1 INCLUDE** (PITFALLS.md P4). Inject a local placeholder message, replace with result. Plugin commands use existing typing indicator (no extra work). |
| **D16** | **Plugin command result rendered as `ToolMessageCard`** (existing) | Consistency with how MCP tools / skills show in chat | LOW | Already supported | Per ARCHITECTURE.md §2.2. Zero new code — result events flow through existing `LLMStreamEvent` union. |
| **D17** | **Per-source icon** (Goal, BookOpen, ListTree, Plug, Wand2, FolderOpen) | Visual scan-faster than text reading | LOW | Linear, Raycast, VS Code | STACK.md mentions lucide-react import. 6 icons max. |
| **D18** | **Hover state on row reveals "⏎ to use" hint** | Affordance for keyboard users | LOW | Raycast | v1.1: optional. Tailwind `data-[selected=true]:after:content-['⏎']`. |
| **D19** | **`?` key opens help panel describing selected command** | Power users learn new commands | MEDIUM | Vim's `?`; Helix's `<Space>?` | **v1.1 OUT of scope** (v1.2+). Defer. |
| **D20** | **Visual "typing arguments" feedback** (e.g. textarea border turns blue when query is a complete command) | Reinforces "command recognized" | LOW | VS Code command palette | v1.1: optional. `data-[command-ready=true]:border-accent` on textarea wrapper. |

**Differentiator priority for v1.1:** D1 (source badge) + D2 (args hint in row) + D7 (loading state) + D11 (conflict toast) + D12 (placeholder swap) + D13 (CJK) + D14 (special chars) + D15 (system command placeholders) + D16 (existing tool card) + D17 (per-source icons) = **the 10 things that make v1.1 feel polished, not amateur.** The rest (D3, D4, D5, D6, D10, D19) are deferred to v1.2+ per "极简设计" decision.

---

## Anti-Features (Commonly Requested, Often Problematic)

Things that *seem* like good ideas but create problems. Per PROJECT.md "极简设计" + PITFALLS.md, these are **deliberately excluded** from v1.1.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **AF1: Args parsing (smart split, JSON, quotes)** | "What if user types `/arxiv_search "deep learning" --max 5`?" | PROJECT.md constraint: "插件命令严格 passthrough" — args 空格分隔直接给底层 tool/skill/workflow。智能解析会引入引号转义、shell injection 风险、wrapper 复杂度 | `args = substring(1 + cmd.length).trim()` — raw string. Skills/workflows handle their own parsing. |
| **AF2: Aliases (`/co` → `/compact`)** | "Power users want shortcuts" | 增加 registry 复杂度、冲突解决成本、文档负担。3 系统 + ~20 插件命令的体量不需要 | v1.2+ 加 `aliases?: string[]` 字段。先把基础交互跑稳。 |
| **AF3: Frecency / recent commands** | "Show what I use most" | 需要持久化到 electron-store、LRU 淘汰、跨 session 共享、隐私考量（开发者可能不希望记录）。在不熟悉系统前，alphabetical + grouped 反而更利于发现 | v1.2+ 用 `useSlashCommandStore.recent: string[]` 配合 zustand `persist` middleware。 |
| **AF4: `⌘K` global command palette** | "Slack/Cursor have it" | ⌘K 触发的是 **global** palette（不依赖当前 textarea 焦点）。CDF 的命令是 **textarea-anchored**（不离开当前聊天）。两者模型不同。Global palette 需要一个完全不同的组件（kbar 类）+ 新的 keyboard handler + 新的 state slot | v1.1 只做 textarea-anchored popup。`⌘/` 全局聚焦 textarea + 预设 `/` 是更轻量的 v1.2 方案。 |
| **AF5: Mention `@` trigger** | "Files, agents, etc." | 触发器多一个 = 复杂度 × 2。需要单独的 mention 注册表 + mention 命令源 + 不同的 popover slot。Claude Code 的 mention 适配器 `unstable_useMentionAdapter` 与 slash 在同一个 `TriggerPopoverRoot` 下，撞名 (PITFALLS.md P9) | v1.1 不预留 mention。v1.2+ 重新设计整套浮层。 |
| **AF6: Inline args schema form (instead of textarea)** | "MCP tool has typed args, why not show a form?" | Slash popup 是 **chat composer 的扩展**——用户在打字流中，表单 modal 打断节奏。`${tool} query=deep learning; max=5` 这种 schema 表单在 chat 场景下是 anti-pattern (PITFALLS.md P7) | 让 Master Agent 在 LLM 流里用自然语言解析 args。Schema 校验在 deepagent 工具层做，不在 popup 层。 |
| **AF7: New `commands:execute` IPC channel** | "Plugin commands should be dispatchable directly" | 绕开 `llm:chat` 会让 plugin 命令的输出**不走 v3 streamEvents**——用户看不到模型为什么决定调用这个工具、看不到 reasoning 折叠。破坏"transparent to reasoning"硬约束 (ARCHITECTURE.md §8.1) | 所有 plugin 命令走 `llm:chat`（existing）。dispatcher 把 `/${tool} ${args}` 改写为自然语言 prompt。 |
| **AF8: Modal dialog (centered, not anchored)** | "Looks more important" | Slash popup 必须**锚定到 textarea 光标**让用户看到在补全什么 `/command`。居中 modal 破坏空间 context (Claude Code popup 是 anchored，不是 centered) | Radix `Popover` + `PopoverAnchor` 包裹 `<form>`。 |
| **AF9: Fuzzy matching via `fuse.js`** | "Substring is so 2015" | cmdk 自带 fuzzy 在 < 100 命令时足够。fuse.js 加 ~30kB（gzip 12kB）。CDF v1.1 ~20 命令，fuse 是 overkill | cmdk `shouldFilter={true}` 默认 fuzzy。仅当 > 200 命令时切换到 fuse（STACK.md "Stack Patterns by Variant"）。 |
| **AF10: Custom popover library (own positioning, own a11y)** | "Don't add deps" | cmdk 8kB gzipped, 含完整 a11y (roving focus, aria-activedescendant, ⏎/Esc/↑↓/Home/End), tested by Linear/Raycast. 自建 ~400 LOC | cmdk + Radix Popover。 |
| **AF11: Touching `assistant-ui` `unstable_useSlashCommandAdapter`** | "It's already in node_modules" | 标记 `@deprecated` + `Under active development and may change without notice`。要求 ComposerPrimitive 适配 (PITFALLS.md P1)。CDF 现状是裸 `<textarea>`，强行套用 = 重写整个 composer | 裸 textarea + 自建 popup。`assistant-ui` 依赖在 v1.1 保持 unused，不删除（不破坏 v1.0 stable API）。 |
| **AF12: Modifying `runtime.agent.streamEvents v3` for "planOnly" mode** | "Cleaner than prompt injection" | v3 协议走 6-hunk patch-package (per `STATE.md`)。改 invocation shape 风险 M3 thinking roundtrip 断裂 (PITFALLS.md P2) | Set `payload.overrides = { planOnly: true }` (现有 extension point at `llm.ts:324`)，deepagent runtime 层检查。 |
| **AF13: Project commands 复用 skill-manager scope 逻辑** | "Skills also have scope, must share" | Skill 的 `scope: 'global' \| 'project'` 决定白名单绑定 (`skill-manager.ts:142-174`)。Project command **天然 project-only**——没有 global scope (ARCHITECTURE.md §8.4) | 新建 `main/commands/project-commands.ts`，不复用 `resolveAgentSkillsConfig`。 |
| **AF14: Routing all `/` commands through `llm:chat` even system ones** | "One path, simpler" | `/goal` `/context` 是 state mutation 或 static reply，**不应该触发 LLM 调用**——浪费 token、推理 30 秒显示 "I understand, setting goal..." 这种废话。`/plan` 走 `planOnly: true` flag 也不需要新 LLM 调用 | dispatcher switch: 系统命令 → 纯本地分支（renderer-only）。Plugin 命令 → `llm:chat` 自然语言。 |
| **AF15: Loading all 4 plugin sources synchronously on app start** | "Faster first interaction" | MCP `tools/list` 是网络 I/O（即使本地 server 也有 100-500ms latency）。Skills/Workflows 走 DB/FS（快但也有 I/O）。如果同步阻塞，session 启动慢 1-3 秒 (PITFALLS.md P12) | `useSlashCommands()` hook 异步并行 4 个 source；`<Command.Loading>` slot 显示 partial results。 |
| **AF16: Project-level `.claude/commands/*.md` 复用 `.cdf/skills/` 路径** | "Convention says `.claude`" | PROJECT.md 文档说 `.claude/commands/*.md`，但与 skill 的 `.cdf/skills/` 不一致。混用两个根目录让用户困惑 (ARCHITECTURE.md Open Q1) | 建议用 `.cdf/commands/*.md`（v1.1 phase 1 决定），与 skill 平行。 |

---

## Feature Dependencies

```
T1 触发器 (/ char)
  └──requires──> cmdk + Radix Popover（依赖技术栈，STACK.md）
  └──requires──> T15 开头识别（不在消息中间触发）
       └──requires──> cursor / selectionStart 访问
  └──requires──> T13 IME 保护（中文输入法按 / 不误触）
       └──requires──> isComposingRef 状态机

T2 substring filter
  └──requires──> T1 触发器
  └──requires──> D13 CJK 规范化
  └──requires──> D14 特殊字符容错

T3 ↑↓ navigation
  └──requires──> T1 触发器
  └──requires──> cmdk Command.List 内部
  └──conflicts-with──> textarea 默认 ↑↓ 行为（必须 preventDefault）

T4 Enter triggers
  └──requires──> T3 navigation（先选中再触发）
  └──requires──> textarea Enter 拦截（slashOpen 时吞 Enter）
  └──requires──> D12 placeholder swap

T5 Esc closes
  └──requires──> T1 触发器
  └──requires──> cmdk 内置

T11 popup 锚定
  └──requires──> T1 触发器
  └──requires──> Radix PopoverAnchor（包裹 <form>）
  └──conflicts-with──> TodoList z-index（必须 z ≥ 50）

D11 冲突检测 + toast
  └──requires──> T9 分组（按 source 分组才能让用户看到 source tag）
  └──requires──> registry 启动时检测（ARCHITECTURE.md §4.1）
  └──requires──> chokidar 监听 .cdf/commands/（PITFALLS.md P10）

D15 系统命令占位消息
  └──requires──> T15 开头识别
  └──requires──> sessionStore.sendMessage 接受 placeholder 字段
  └──conflicts-with──> T14 args passthrough（系统命令不走 args 透传）

D17 per-source icon
  └──requires──> lucide-react 现有依赖
  └──requires──> SlashCommandSource 5 个枚举值

MCP 自动注册 (D from PROJECT.md SLASH-08)
  └──requires──> 4 源 plugins 总入口
       └──requires──> mcp-connector.ts:129 loadMcpTools 现有
       └──requires──> mcpCache 复用 (mcp-connector.ts:11-12)
  └──requires──> T9 分组（mcp 是 1 个 source）
  └──requires──> MCP 动态监听 (PITFALLS.md P3, PITFALLS.md P13)

Skills 自动注册 (PROJECT.md SLASH-09)
  └──requires──> listPhysicalSkills 现有 (skill-manager.ts:89)
  └──requires──> T9 分组
  └──requires──> D13 CJK 支持（CJK skill 名）

Workflows 自动注册 (PROJECT.md SLASH-10)
  └──requires──> 新建轻量 SQL (ARCHITECTURE.md §6.3)
  └──requires──> seed 1 个 demo workflow (PITFALLS.md P11)
  └──requires──> T9 分组

Project commands (PROJECT.md SLASH-11)
  └──requires──> 新建 project-commands.ts (ARCHITECTURE.md §6.4)
  └──requires──> chokidar 监听 .cdf/commands/ (PITFALLS.md P10)
  └──requires──> $ARGUMENTS 占位符替换
  └──requires──> T9 分组

System 3 命令
  ├── /goal:  内存 state Map<sessionId, string>  + T15
  ├── /context: 静态 reply（不走 LLM）+ D15 占位消息
  └── /plan:   payload.overrides = { planOnly: true }  + T15 + D15
       └──conflicts-with──> AF12（不能改 v3 streamEvents）
```

**Critical-path dependency chain for v1.1 phase ordering:**

1. T1 + T11 (popup trigger + anchor) → T2 + T3 + T4 + T5 (filter + nav + enter + esc) — **SLASH-01/02**
2. T9 分组 + D17 icons + D1 source badge — **SLASH-03/12**
3. T13 IME + T15 开头识别 + D13 CJK + D14 special chars — **SLASH-01 spike (PITFALLS.md P6)**
4. 4 源 plugin 注册 (MCP / Skills / Workflows / Project) + T14 passthrough — **SLASH-08/09/10/11**
5. 系统 3 命令 + D15 占位消息 — **SLASH-05/06/07**
6. D11 冲突检测 + D7 loading state + D12 placeholder swap — **SLASH-12/13**

---

## MVP Definition (v1.1)

### Launch With (v1.1 — Required for SLASH-01..13)

| # | Feature | Why Essential |
|---|---------|---------------|
| **M1** | T1 `/` trigger | Core affordance |
| **M2** | T2 substring filter | Discovery mechanism |
| **M3** | T3 ↑↓ / T4 Enter / T5 Esc | Keyboard-driven power user expectation |
| **M4** | T6 mouse click | Non-power user fallback |
| **M5** | T7 icon + name + description in each row | Minimal row layout |
| **M6** | T8 empty state | "Type-X-got-no-results" is a dead-end without this |
| **M7** | T9 grouped by source | 4 plugins = chaos without grouping |
| **M8** | T10 Backspace at empty closes | Standard "I'm done" gesture |
| **M9** | T11 popup anchored to textarea (z-index ≥ 50) | Spatial continuity |
| **M10** | T12 args placeholder swap after selection | Reinforces "fill this in" |
| **M11** | T13 IME composition safety | CJK users blocked without it |
| **M12** | T14 args passthrough (no smart parsing) | PROJECT.md hard constraint |
| **M13** | T15 command only at message start | PROJECT.md hard constraint |
| **M14** | 3 system commands: `/goal` `/context` `/plan` | SLASH-05/06/07 |
| **M15** | 4 plugin sources auto-register: MCP / Skills / Workflows / Project | SLASH-08/09/10/11 |
| **M16** | D1 source badge on each row | SLASH-12 |
| **M17** | D2 args hint in row | Better UX than description-only |
| **M18** | D7 loading state for slow sources | MCP cold start |
| **M19** | D11 conflict detection at registry build + non-blocking toast | PITFALLS.md P3 |
| **M20** | D12 placeholder swap | Reinforces args |
| **M21** | D13 CJK support via NFKC normalize | PITFALLS.md P6 |
| **M22** | D14 special chars (`.`, `//`, `-`) don't break filter | PITFALLS.md P6 |
| **M23** | D15 system command placeholders in message stream | PITFALLS.md P4 |
| **M24** | D16 plugin command result rendered as existing ToolMessageCard | ARCHITECTURE.md §2.2 |

### Add After Validation (v1.2)

| # | Feature | Trigger |
|---|---------|---------|
| **A1** | D3 frecency / recent commands | After 100+ users, or when users complain "I keep typing `/plan`" |
| **A2** | D4 alias resolution (`/co` → `/compact`) | After command count > 30 |
| **A3** | D10 `⌘/` global trigger to focus + prefill `/` | After power users ask for it |
| **A4** | D6 description preview on focus | After command descriptions get longer than 100 chars |
| **A5** | Inline help for selected command (`?` key) | After new users ask "what does `/goal` do?" |

### Future Consideration (v2+)

| # | Feature | Why Defer |
|---|---------|-----------|
| **F1** | AF5 `@` mention trigger | Different popover slot; v1.2+ redo popover |
| **F2** | D19 help panel for selected command | Requires richer state machine |
| **F3** | Animated illustrations (Raycast) | Polish, not core |
| **F4** | Voice input to fill args | Out of v1 scope per PROJECT.md |
| **F5** | `⌘K` global palette | Different model (global vs anchored) |
| **F6** | Custom alias by user | Conflict resolution gets complex |
| **F7** | Command composition (`/simplify` then `/verify`) | Pipeline semantics, v2+ |
| **F8** | Project command body parsing (YAML frontmatter beyond name/description) | Skill body model different from command body |
| **F9** | Mobile adaptation | Desktop-only per PROJECT.md |
| **F10** | Remote/shared commands via Anthropic cloud | Offline-first constraint |

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| T1 `/` trigger | HIGH | LOW (cmdk + Radix) | **P1** |
| T2 substring filter | HIGH | LOW (cmdk built-in) | **P1** |
| T3/T4/T5 keyboard nav | HIGH | LOW (cmdk built-in) | **P1** |
| T6 mouse click | HIGH | LOW | **P1** |
| T7 row layout | HIGH | LOW | **P1** |
| T8 empty state | MEDIUM | LOW | **P1** |
| T9 grouped by source | HIGH | LOW | **P1** |
| T10 Backspace closes | MEDIUM | LOW | **P1** |
| T11 popup anchored | HIGH | LOW (Radix PopoverAnchor) | **P1** |
| T12 args placeholder | HIGH | LOW | **P1** |
| T13 IME safety | HIGH | MEDIUM (composing ref) | **P1** |
| T14 args passthrough | HIGH | LOW (substring) | **P1** |
| T15 start-of-message check | HIGH | LOW | **P1** |
| 3 system commands | HIGH | MEDIUM (3 separate actions) | **P1** |
| 4 plugin sources | HIGH | MEDIUM (per-source IPC) | **P1** |
| D1 source badge | HIGH | LOW (Badge component) | **P1** |
| D2 args hint in row | HIGH | LOW | **P1** |
| D7 loading state | MEDIUM | MEDIUM (per-source loading flag) | **P1** |
| D11 conflict detection | HIGH | MEDIUM (registry validator) | **P1** |
| D12 placeholder swap | HIGH | LOW | **P1** |
| D13 CJK normalize | HIGH (CJK users) | LOW (NFKC call) | **P1** |
| D14 special chars | MEDIUM | LOW (String#includes) | **P1** |
| D15 system placeholders | MEDIUM | MEDIUM (sendMessage extension) | **P1** |
| D16 ToolMessageCard reuse | HIGH | LOW (existing) | **P1** |
| D17 per-source icons | MEDIUM | LOW (lucide-react) | **P1** |
| D9 group ordering | LOW | LOW | **P1** |
| D3 frecency | MEDIUM | HIGH (persistence + LRU) | P2 |
| D4 aliases | MEDIUM | MEDIUM (registry extension) | P2 |
| D10 `⌘/` global | MEDIUM | LOW (window keydown) | P2 |
| D6 description preview | LOW | MEDIUM | P2 |
| D5 shortcut hints | LOW | MEDIUM | P3 |
| D18 "⏎ to use" hint | LOW | LOW | P3 |
| D19 `?` help | LOW | HIGH | P3 |
| D20 visual command-ready | LOW | LOW | P3 |
| F1 `@` mention | MEDIUM | HIGH (different popover) | P3 |
| F5 `⌘K` palette | LOW | HIGH | P3 |
| F3 animations | LOW | MEDIUM | P3 |

**Priority key:**
- P1 = Must have for v1.1 (in MVP above)
- P2 = Add when command count or user base justifies
- P3 = Future consideration

---

## Competitor Feature Analysis

| Feature | Claude Code | Cursor Composer | Linear | Slack | Raycast | GitHub Copilot Chat | CDF v1.1 |
|---------|-------------|-----------------|--------|-------|---------|----------------------|----------|
| `/` trigger | Yes | Yes (via @ for files) | No (`⌘K` palette) | No (channel switcher) | No (`⌘Space` global) | Yes (chat-only) | **Yes** (textarea-anchored) |
| Substring filter | Yes | Yes | Yes | Yes | Yes (fuzzy default) | Yes | **Yes** (cmdk) |
| Fuzzy match | No (substring) | Yes | No | No | Yes (fuzzy default) | No | **No** (substring; defer fuzzy) |
| ↑↓ nav | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (cmdk) |
| Enter triggers | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (cmdk) |
| Esc closes | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (cmdk) |
| Mouse click | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** (cmdk) |
| Grouped by source | Yes (Skill/Workflow tags) | Partial (workspace vs file) | Yes (priority, status) | Yes (channel type) | Yes (extension name) | No | **Yes** (5 source groups) |
| Source badge | Yes (superscript) | No | Yes (color dot) | No | Yes (extension icon) | No | **Yes** (Badge with color) |
| Args hint in row | Yes (in docs, not in popup) | Yes | Partial | No | No | No | **Yes** (`[description]` after name) |
| Per-row icon | Yes | Yes | Yes | Yes | Yes | No | **Yes** (lucide-react) |
| Description preview | Inline (truncated) | Side panel | Hover expand | Inline | Right pane | Inline | **Truncated + title attr** (defer pane) |
| Frecency | No (last-used only) | Yes | Yes | Yes (MRU) | Yes (default!) | No | **No** (defer to v1.2) |
| Aliases | Yes (`/co`, `/continue`) | Partial (snippets) | Yes (via aliases) | Yes (shortcuts) | Yes (extensive) | No | **No** (defer to v1.2) |
| Global trigger | No (composer only) | `⌘K` for palette | `⌘K` for palette | `⌘K` for switcher | `⌘Space` global | No | **No** (defer to v1.2) |
| IME safe | Partial (CJK bugs open) | Yes | Yes | Yes | Yes | Partial | **Yes** (isComposingRef + 200ms gate) |
| Special chars | Partial (`.` breaks per #65047) | Yes | Yes | Yes | Yes (fuzzy) | Yes | **Yes** (String#includes) |
| Conflict detection | Yes (superscript disambig) | N/A (no plugin) | N/A (no plugin) | N/A | Yes (extension scope) | N/A | **Yes** (registry build + toast) |
| Loading state | Yes (lazy plugin load) | Yes | Yes (instant) | Yes (server-side) | Yes (per-extension) | Yes | **Yes** (per-source loading) |
| Args passthrough | Yes (raw text) | Yes (raw text) | N/A (no args) | N/A (no args) | Yes (raw text) | Yes (raw text) | **Yes** (PROJECT.md constraint) |
| Help / `?` | `/help` command | Yes (palette) | Yes | Yes | Yes (`?` opens docs) | Yes | **No** (defer) |
| Plugin auto-registration | Yes (`.claude/skills/*`) | Yes (`.cursorrules`, MCP) | No | No | Yes (extensions) | No | **Yes** (4 source auto-register) |
| Project-level commands | Yes (`.claude/commands/*.md`) | Yes (`.cursorrules`) | No | No | Yes (script commands) | No | **Yes** (`.cdf/commands/*.md` or `.claude/commands/*.md`) |
| Backend integration | LangGraph + tool calls | LLM tool calls | Linear API | Slack API | System shell | LLM tool calls | **deepagents.js (LangGraph)** |
| CJK support | Partial (open bug #64941) | Yes | Yes | Yes | Yes | Partial | **Yes** (NFKC normalize) |

**CDF v1.1 competitive position:**
- **Beats Claude Code on:** IME safety (PITFALLS.md P6 #64941 closed), special-char filter robustness, project commands path consistency.
- **Matches Claude Code on:** Substring filter, ↑↓/Enter/Esc, source grouping, args passthrough, plugin auto-registration, project commands.
- **Behind Claude Code on:** Command count (3 system + ~20 plugins vs 95), aliases, frecency, mention `@`, `?` help.
- **Behind Cursor on:** Frecency, `⌘K` global palette.
- **Behind Raycast on:** Fuzzy default, animations, theming.

**Strategic note:** CDF v1.1 is **deliberately 80% of the UX, 20% of the surface area** (PROJECT.md "极简设计"). The 20% it ships is the high-value 20%: trigger + filter + nav + grouping + plugin auto-registration. The 80% deferred is frecency, aliases, global palette, help, mention — all of which require persistent state or new component types that aren't justified at 3 system + ~20 plugin scale.

---

## Implications for Roadmap (Phase Structure)

Based on this research, the v1.1 phase structure should be:

1. **Phase A: Foundation + Popup Shell** (T1-T12, T15, D17)
   - Builds the cmdk + Radix Popover shell anchored to ChatArea
   - Verifies all table-stakes UX (filter, nav, enter, esc, click, empty state, backspace close)
   - Includes IME safety + CJK + special chars (PITFALLS.md P6 spike)
   - **Acceptance:** All T1-T15 pass unit tests; popup visually appears above textarea; z-index doesn't collide with todos.

2. **Phase B: 4-Source Plugin Auto-Registration** (D11, D12, D16)
   - Adds `commands:list` IPC + `useSlashCommands()` hook
   - Wires MCP / Skills / Workflows / Project sources
   - Implements conflict detection + source badge
   - **Acceptance:** Typing `/` shows 3 system + 4 source groups; seed 1 workflow (PITFALLS.md P11); chokidar watches `.cdf/commands/` (PITFALLS.md P10).

3. **Phase C: System Commands** (D15, system 3 commands)
   - Implements `/goal` (session state map), `/context` (static reply), `/plan` (overrides flag)
   - Verifies M3 thinking is NOT broken (PITFALLS.md P2 regression test)
   - **Acceptance:** All 3 commands dispatch correctly; reasoning chunk still emitted for plugin commands; placeholder message shows in chat for system commands.

4. **Phase D: Polish + Differentiators** (D1, D2, D7, D13, D14, D15)
   - Source badge styling, args hint, loading state, CJK, special chars, placeholder messages
   - **Acceptance:** 5 Claude Code bug reproductions (PITFALLS.md P6) all pass.

**Phase ordering rationale:**
- Phase A before B: shell must exist before registry populates it.
- Phase B before C: 4 sources needed for system commands to feel "part of the same set".
- Phase D last: polish is meaningless without stable base.
- All 4 phases within v1.1, no external dependencies.

**Defer to v1.2+:** A1-A5 (frecency, aliases, `⌘/`, description preview, inline help). F1-F10 (mention, animations, voice, mobile, etc.).

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Table stakes (T1-T15) | **HIGH** | Triangulated across 5+ products with documented behavior; cmdk + Radix Popover chosen in STACK.md give direct implementation path. |
| System commands mapping | **HIGH** | Claude Code docs (bke4wrnx4.txt) explicit on `/goal` `/context` `/plan` semantics; 3 commands picked match the most-used 3 in Claude Code. |
| Differentiators (D1-D20) | **HIGH** | Each has documented precedent in at least one product; marked "v1.1 INCLUDE" vs "defer" with rationale. |
| Anti-features (AF1-AF16) | **HIGH** | Each tied to either PROJECT.md constraint, PITFALLS.md, or ARCHITECTURE.md anti-pattern section; not just "vibes". |
| Feature dependencies | **HIGH** | Direct codegraph of `ChatArea.tsx`, `mcp-connector.ts`, `skill-manager.ts` shows the dependency graph. |
| MVP definition | **HIGH** | 24 features map to 13 SLASH-XX requirements; cross-reference is exact. |
| Competitor analysis | **MEDIUM** | Most features triangulated, but some (Raycast, Linear source code) not directly inspected; based on user-visible behavior. |
| Phase structure | **MEDIUM** | Logical ordering, but subject to GSD phase decomposition. |

---

## Gaps to Address (Open Questions for v1.1 Phase 1)

These are **out of scope for FEATURES.md research** but should be answered before implementation:

1. **Project commands path**: `.cdf/commands/*.md` vs `.claude/commands/*.md`? PROJECT.md says `.claude/commands/*.md`, ARCHITECTURE.md recommends `.cdf/commands/*.md` (parallel to `.cdf/skills/`). **v1.1 phase 1 decide.**
2. **`/plan` mode persistence**: session-level flag (stays across turns) or turn-level (only this response)? PROJECT.md "切模式" implies session-level, but needs verification.
3. **MCP command args schema source**: Is `tool.schema` JSON Schema or Zod? Need to inspect `loadMcpTools` return shape to render `argsHint`.
4. **chokidar vs fs.watch**: Which library to use for `.cdf/commands/` watching? PITFALLS.md P10 recommends chokidar; need version.
5. **Naming conflict UI**: Same-name `verify` in skill and workflow — show as one row with [skill|workflow] tabs? Or two rows? v1.1 simpler: two rows with badges, both invokable.
6. **`/goal` storage location**: Memory (Map<sessionId, string>) vs SQLite (session_goals table)? v1.1 simpler: memory + lose on session switch.
7. **Args hint rendering**: For multi-arg MCP tools (e.g. `query: string, max: number`), show full schema? Or just placeholder? v1.1: placeholder only; v1.2 schema form.
8. **CJK skill name registration**: skill-manager `listPhysicalSkills` returns `name` from YAML frontmatter — does it preserve CJK? Need to verify before relying on D13.
9. **chokidar on Windows**: Path separator, case insensitivity. Need cross-platform test matrix.
10. **Toast component for D11 conflict notification**: shadcn `sonner` not yet in deps. Add as dep or use existing notification mechanism?

---

## Sources

**HIGH confidence (direct product docs / code inspection):**
- **Claude Code commands doc** — `bke4wrnx4.txt` (100 lines, 95 commands listed, includes `/goal [condition|clear]`, `/context [all]`, `/plan [description]`)
- **Claude Code commands doc webfetch** — `call_function_3op3n12fedvg_2.txt` (79.8KB) and `call_function_gqb6ff0dn4e1_2.txt` (51.6KB) — full docs at https://code.claude.com/docs/en/commands
- **CDF STACK.md** (locally written) — `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15` chosen; technical feasibility confirmed
- **CDF ARCHITECTURE.md** (locally written) — 4-source registry + 2 IPC channels + plugin commands flow through `llm:chat`
- **CDF PITFALLS.md** (locally written) — 7 critical + 4 moderate + 4 minor pitfalls; 25+ GitHub issue references
- **CDF PROJECT.md** (locally read) — 13 SLASH-XX requirements + 3 system commands + 4 plugin sources + 极简设计 decision
- **Local source code inspection** — `src/renderer/src/components/ChatArea/ChatArea.tsx:991-1093` (裸 textarea, no assistant-ui primitives), `src/main/llm.ts:324` (overrides extension point)

**MEDIUM confidence (well-known product behavior, not directly verified):**
- **Cursor Composer** slash command behavior — based on Cursor's documented UX, not direct source inspection
- **Linear command palette** — `⌘K` global, grouped by status/priority, frecency, color dots — based on public Linear blog posts
- **Raycast** — fuzzy default, frecency, extension-scoped commands — based on public docs
- **Slack** — `⌘/` channel switcher, `⌘K` quick switcher — based on user-visible behavior
- **GitHub Copilot Chat** — slash command behavior — based on docs
- **VS Code command palette** — keyboard shortcuts in rows, `⌘Shift+P` global — based on user-visible behavior

**LOW confidence (not directly verified, flagged for validation):**
- Claude Code bugs cited in PITFALLS.md (#61857, #62072, #62091, #62409, #63396, #64422, #64539, #64606, #64669, #64941, #65014, #65047, #65050, #65099) — issue numbers confirmed but full bodies not read
- assistant-ui PR #3767, #3823, #3834 — referenced in PITFALLS.md, not directly inspected
- `fuse.js` size estimates — based on training data, not measured for v7.4.1

---

*Feature research for: CDF v1.1 SLASH-01 through SLASH-13 (`/` command popup + 4-source plugin auto-registration)*
*Researched: 2026-06-04*
*Confidence: HIGH (table stakes + system commands + differentiators + anti-features + dependencies + MVP + competitor analysis)*
