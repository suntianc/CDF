# Phase 2 — UI Review

**Audited:** 2026-05-20
**Baseline:** 02-UI-SPEC.md (design contract)
**Screenshots:** captured (desktop 1440×900, tablet 768×1024, mobile 375×812)
**Registry audit:** no third-party registries — clean

---

## Pillar Scores

| Pillar               | Score   | Key Finding                                  |
| -------------------- | ------- | -------------------------------------------- |
| 1. Copywriting       | 3/4     | All CTAs match spec; queue label minor deviation |
| 2. Visuals           | 3/4     | Clear hierarchy; missing left-edge accent bar on active conversations |
| 3. Color             | 4/4     | Hex-perfect match to UI-SPEC; dark mode fully implemented |
| 4. Typography        | 3/4     | Core hierarchy follows spec; arbitrary values used for additional tokens |
| 5. Spacing           | 3/4     | Standard Tailwind scale used; many arbitrary pixel values outside spec scale |
| 6. Experience Design | 3/4     | Loading/error/empty states covered; missing skeleton for conversation load |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Active conversation left-edge accent bar** — Users can't visually distinguish the active conversation by its left-edge accent bar (spec requires `border-l` accent). Currently only uses background highlight. — Add `border-l-2 border-[#171717] dark:border-white` to active conversation item in `ConversationList.tsx:48`

2. **Arbitrary spacing values in component internals** — 20+ instances of `text-[13px]`, `rounded-[6px]`, `leading-[18px]`, `h-[38px]`, etc. — While some match spec exceptions (13px, 11px), others like `rounded-[16px]`, `h-[38px]` are undocumented. — Migrate to Tailwind standard tokens where possible; document remaining exceptions in spec.

3. **Missing conversation loading skeleton** — Spec defines a `loading (skeleton)` state for conversation items, but no skeleton UI exists. — Add a skeleton shimmer when conversations are being loaded from SessionManager.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Match against UI-SPEC copywriting contract:**

| Element                       | Spec Copy                              | Actual                                  | Status |
| ----------------------------- | -------------------------------------- | --------------------------------------- | ------ |
| Send button                   | 发送                                   | 发送                                    | ✓      |
| Stop button                   | 停止                                   | 停止                                    | ✓      |
| Input placeholder             | 输入消息，或 `/gsd-*` 执行命令          | 输入消息，或 /gsd-* 执行命令            | ✓      |
| Welcome heading               | 我们该做什么？                          | 我们该做什么？                          | ✓      |
| New conversation button       | 新建对话                               | 新建对话                                | ✓      |
| Empty conversations           | 暂无对话<br>点击「新建对话」开始        | 暂无对话                                | Δ      |
| Conversation list header      | 对话历史                               | 对话历史                                | ✓      |
| Status: sending               | 发送中                                 | 发送中                                  | ✓      |
| Status: sent                  | 已发送                                 | 已发送                                  | ✓      |
| Status: guided                | 已引导                                 | 已引导                                  | ✓      |
| Status: stopped               | 已停止                                 | 已停止                                  | ✓      |
| Error title                   | 回复出错了                             | 回复出错了 (via chunk.type === 'error') | ✓      |
| Error: connection             | 连接失败：...请检查 API Key...          | 连接失败：...请检查 API Key...          | ✓      |
| Retry button                  | 重试                                   | 重试                                    | ✓      |
| Code block copy tooltip       | 复制                                   | 复制                                    | ✓      |
| Sent toast                    | 已发送（green, 2s auto-dismiss）       | 已发送 (green, 2s timeout)              | ✓      |
| Queue fold label              | 显示 N 条消息排队                       | 有 N 条消息排队                         | Δ      |
| Queue fold icon               | ⏫                                     | ChevronUp (lucide)                      | Δ      |
| GSD result: success           | 执行成功                               | 执行成功                                | ✓      |
| GSD result: error             | 执行失败                               | 执行失败                                | ✓      |

**Δ Queue fold label:** Uses "有 {N} 条消息排队" instead of spec "显示 N 条消息排队". Minor wording difference — functional but deviates from contract.
**Δ Queue fold icon:** Uses `ChevronUp` lucide icon instead of spec `⏫` symbol.
**Δ Empty conversations secondary text:** Spec says to show "点击「新建对话」开始" as secondary text below "暂无对话", but only the primary message is shown.

**Additional findings:**
- `ConversationList.tsx:38` — "暂无对话" appears, no secondary text
- `InputArea.tsx:170` — "已发送" toast with green color, 2s auto-dismiss ✓
- `ChatPanel.tsx:105` — "思考中..." placeholder during generation ✓

---

### Pillar 2: Visuals (3/4)

**Implemented vs. Spec Visual Hierarchy:**

- **Message list as focal point** (`ChatPanel.tsx`) — Messages in scrolling list, correct ✓
- **Input area as secondary** (`InputArea.tsx`) — Fixed bottom, prominent send/stop ✓
- **Sidebar conversation list** (`ConversationList.tsx`) — Section in sidebar, 10-item limit ✓

**Conversation active item style:**
- Spec requires: `left-edge accent bar` + `bg: #f5f5f5`
- Actual (`ConversationList.tsx:48`): uses only `bg-[#f5f5f5]` background highlight
- **Issue:** Missing `border-l-2` left-edge accent bar. The active conversation item is visually indistinguishable from a hovered item.

**Avatar usage:**
- Spec requires: `Avatar` shadcn component, 28×28px, user avatar (fallback: initials), positioned above-right/above-left
- Actual (`MessageBubble.tsx`): Avatar is **imported but never rendered** — no avatar appears in message bubbles at all

**Visual hierarchy implementation:**
- Spec defines 3-tier focal point: Message list > Input area > Sidebar — implemented ✓
- WelcomeDialog centered in empty chat state — implemented ✓
- GSD command autocomplete dropdown above input — implemented ✓
- Queue positioned between messages and input — implemented ✓

**Icon-only buttons:**
- `title` attributes present on all icon-only buttons: 「新建对话」「复制」「立即发送」「删除」「上传图片」「添加工作区」 ✓
- No `aria-label` attributes found — all use `title` which is adequate for tooltip support

**Queue fold/unfold structure:**
- `ChevronUp` icon used instead of spec `⏫` — minor visual deviation
- Collapsible component used with 200ms transition — spec requirement met ✓

---

### Pillar 3: Color (4/4)

**Tailwind class distribution:**
```
text-primary:    5  (shadcn ui components only)
bg-primary:      3  (shadcn ui components only)
border-primary:  0
text-muted:     13
bg-muted:       10
text-destructive: 3
bg-destructive:   2
```

**Hex color audit against UI-SPEC:**

| Role                  | Spec Value | Usage Check                                   | Status |
| --------------------- | ---------- | --------------------------------------------- | ------ |
| Page body bg (light)  | #fafafa    | `App.tsx:320 bg-[#fafafa]`                    | ✓      |
| Page body bg (dark)   | #171717    | `App.tsx:320 dark:bg-[#171717]`               | ✓      |
| Card bg (light)       | #ffffff    | `MessageBubble.tsx` AI bubble bg              | ✓      |
| Card bg (dark)        | #1a1a1a    | `MessageBubble.tsx` dark mode AI bubble       | ✓      |
| Accent (light)        | #171717    | User bubble bg, send button, Welcome CTA      | ✓      |
| Body text             | #4d4d4d    | AI message text, nav inactive                 | ✓      |
| Mute text             | #888888    | Timestamps, queue count, status tags          | ✓      |
| Hairline (light)      | #ebebeb    | Borders, dividers across all components       | ✓      |
| Hairline (dark)       | #2a2a2a    | Dark mode borders, dividers                   | ✓      |
| Success               | #16a34a    | 「已发送」tag, GSD success border              | ✓      |
| Warning               | #f59e0b    | 「发送中」tag                                   | ✓      |
| Error                 | #ee0000    | Delete button, error card border, stopped tag | ✓      |
| Link                  | #0070f3    | 「查看更多」button, tool call                 | ✓      |
| Queue card bg (light) | #f5f5f5    | `MessageQueue.tsx` queue item bg              | ✓      |
| Queue card border     | #ebebeb    | `MessageQueue.tsx` item border                | ✓      |
| GSD success bg        | #f0fdf4    | `GSDResultCard.tsx:31`                        | ✓      |
| GSD error bg          | #fef2f2    | `GSDResultCard.tsx:32`                        | ✓      |
| Thinking block bg     | #fafafa    | `ThinkingBlock.tsx` header bg                 | ✓      |
| Error card bg         | #fee2e2    | `GSDResultCard.tsx:59` error message bg       | ✓      |

**Accent reserved usage check:** Accent (#171717 light / #ffffff dark) used on:
1. Send button ✓ (spec item 1)
2. User message bubble ✓ (spec item 4)
3. WelcomeDialog CTA button ✓ (matches polarity-flipped pattern, spec item 5)

**Not used on** (correctly avoided):
- AI message bubbles ✓ (uses #ffffff / #1a1a1a)
- Queue items ✓ (uses #f5f5f5 / #252525)
- Command palette items ✓ (uses #ffffff / #1a1a1a)
- Tool call cards ✓ (uses #f5f5f5 / #252525)
- Thinking blocks ✓ (uses #fafafa / #1c1c1c)

**Hardcoded colors:** All hex values are intentional and match UI-SPEC color table exactly. No deviation found.

**Score rationale:** Perfect 4/4 — every color matches the spec exactly; accent reservation rules followed; dark mode fully implemented with correct dark variants.

---

### Pillar 4: Typography (3/4)

**Core hierarchy vs. spec:**

| Role       | Spec Size/Weight | Actual                        | Status |
| ---------- | ---------------- | ----------------------------- | ------ |
| Body       | 14px/400         | `text-sm` (14px)              | ✓      |
| Label      | 12px/400         | `text-xs` (12px)              | ✓      |
| Heading    | 16px/600         | mixed (`text-sm` + `font-semibold`) | Δ |
| Display    | 24px/600         | `text-[24px] font-semibold`   | Δ |

**Additional tokens vs. spec:**

| Token              | Spec         | Actual                        | Status |
| ------------------ | ------------ | ----------------------------- | ------ |
| Body strong        | 14px/500     | `text-sm font-medium`         | ✓      |
| Caption mono       | 12px/400/mono| `text-xs font-mono`           | ✓      |
| Code               | 13px/400/mono| `text-[13px] font-mono`       | Δ      |
| Status tag         | 11px/400     | `text-[11px]`                 | Δ      |
| Queue preview      | 13px/400/18px| `text-[13px] leading-[18px]`  | Δ      |
| Tool call name     | 13px/600/mono| `text-[13px] font-semibold font-mono` | Δ |

**Distinct font sizes found:**
- `text-xs` (12px) — label, status tags, captions
- `text-sm` (14px) — body text, button labels
- `text-base` (16px) — section headers
- `text-[13px]` — code blocks, queue preview, tool call name
- `text-[11px]` — status tags, timestamp
- `text-[20px]` — SettingsPage heading
- `text-[24px]` — Display/heading (WelcomeDialog)

**Distinct font weights found:**
- `font-normal` (400) — body text
- `font-medium` (500) — labels, button labels, body strong
- `font-semibold` (600) — headings, tool call names

**Font families:**
- Sans: no explicit font-family override — inherits from shadcn preset (Geist/Inter) ✓
- Mono: `font-mono` class used consistently for code, tool call names, status tags ✓

**Issues:**
- `text-[13px]`, `text-[11px]`, `text-[20px]`, `text-[24px]` are arbitrary values outside standard Tailwind text scale. While spec defines these as additional tokens, they are encoded as arbitrary values rather than Tailwind theme extensions
- `text-sm font-semibold` for heading role (spec says 16px/600, tailwind text-base/sm mix)
- `rounded-[6px]` and `rounded-[16px]` — arbitrary border-radius values not in spacing scale

---

### Pillar 5: Spacing (3/4)

**Top spacing classes used:**
```
p-3 (12px) — most common padding
p-4 (16px) — md (default spacing)
px-3, px-4 — horizontal padding
py-2 (8px), py-1.5 (6px) — vertical padding
gap-2 (8px) — sm
m-0, m-1 — minimal margins
space-y-0.5, space-y-1, space-y-1.5 — list spacing
mb-2 (8px), mb-3 (12px) — section margins
```

**Arbitrary spacing values found (outside spec):**
- `h-[38px]` — App.tsx window drag region
- `max-h-[300px]` — ConversationList, CommandPalette
- `max-h-[200px]` — Queue scroll, ToolCallCard output
- `rounded-[6px]` — ConversationList items, ToolCallCard
- `rounded-[16px]` — WelcomeDialog gradient
- `rounded-[100px]` — WelcomeDialog buttons
- `rounded-[8px]` — ProviderForm
- `p-[3px]` — shadcn tabs list
- `h-[calc(100%-1px)]` — shadcn tabs trigger

**Spec spacing scale compliance:**
- Spec says all values should be multiples of 4px: `xs(4)`, `sm(8)`, `md(16)`, `lg(24)`, `xl(32)`, `2xl(48)`, `3xl(64)`
- Pad values like `p-3` (12px) are 4px-multiple conformant ✓
- But `py-1.5` (6px), `gap-1.5` (6px) are not 4px-multiple — these are from standard Tailwind spacing scale (4px-based → 6px is `1.5` units)
- `rounded-[6px]` is not on any spacing scale

**Spec-exempted values (all match spec exceptions section):**
- Message bubble max-width: 720px ✓ (spec exception)
- Input textarea min-h: 40px, max-h: 200px ✓ (spec exception)
- Avatar size: 28×28px ✓ (spec exception, though avatar not rendered)
- Queue padding: `sm` inside ✓
- Code block: 13px, mono ✓

**Recommendation:** While most arbitrary values match spec exceptions, some (rounded-[6px], h-[38px], rounded-[16px], max-h-[300px]) are undocumented. Add these to spec or migrate to standard tokens.

---

### Pillar 6: Experience Design (3/4)

**State coverage analysis:**

| State Type      | Component(s)           | Implemented? | Notes                                  |
| --------------- | ---------------------- | ------------ | -------------------------------------- |
| Loading         | ChatPanel/streaming    | ✓            | "思考中..." animation before first token |
| Loading         | Conversation list      | ✗            | No skeleton/shimmer during load        |
| Empty           | ChatPanel              | ✓            | WelcomeDialog centered in message area |
| Empty           | ConversationList       | ✓            | "暂无对话" message                      |
| Empty           | MessageQueue           | ✓            | Returns null when items.length === 0   |
| Empty           | CommandPalette         | ✓            | "没有找到匹配的命令" (cmdk empty state) |
| Error           | ErrorCard              | ✓            | Alert destructive + retry button       |
| Error           | GSDResultCard          | ✓            | Red border, error message, retry       |
| Error           | ToolCallCard           | ✓            | "error" status badge                   |
| Error           | ConnectionError        | ✓            | API Key check suggestion               |
| Error           | App.tsx stream handler | ✓            | Error chunk handling + error message   |
| Disabled        | InputArea textarea     | ✓            | `disabled` prop during generation      |
| Disabled        | Send button            | ✓            | Disabled when empty or generating      |
| Disabled        | shadcn base components | ✓            | Default disabled styles from shadcn    |
| Streaming       | ChatPanel              | ✓            | Real-time chunk accumulation           |
| Streaming       | MessageBubble          | ✓            | Streaming cursor (spec referenced)     |
| Thinking        | ThinkingBlock          | ✓            | Auto-collapse on complete, Brain icon  |
| Tool call       | ToolCallCard           | ✓            | Running → completed → error states     |
| GSD result      | GSDResultCard          | ✓            | Success (green) / error (red) + retry  |
| Sent toast      | InputArea              | ✓            | Green "已发送", 2s auto-dismiss         |
| Conversation    | ConversationList       | Δ            | No loading skeleton state; no error state |

**Missing states:**
1. **Conversation list loading skeleton:** Spec defines a `loading (skeleton)` state for conversation items. When conversations are being loaded from SessionManager, no skeleton shimmer is shown — the list appears empty until loaded.
2. **Error boundary:** No `<ErrorBoundary>` component found in the App tree. If a component crashes, the entire app will white-screen.
3. **Image upload progress:** Spec doesn't require this, but no upload progress indicator for large images.
4. **Command palette on Escape:** Escape key handling for CommandPalette is specified but embedded in cmdk — need to verify it works correctly.

**Interaction patterns verified:**
- Enter=send, Shift+Enter=newline — ✓ (`InputArea.tsx:109-150`)
- Queue guide (↩︎) sends immediately — ✓ (`MessageQueue.tsx:64`)
- Queue delete (×) removes item — ✓ (`MessageQueue.tsx:73`)
- Thinking block auto-collapses on complete — ✓ (`ThinkingBlock.tsx` with defaultOpen={!isComplete})
- GSD command retry re-executes — ✓ (`GSDResultCard.tsx:93`)
- Send/stop toggle during generation — ✓ (`InputArea.tsx:231-243`)

---

## Registry Safety

**components.json location:** `pi-workbench/components.json`
**Third-party registries:** None
**shadcn preset:** base-nova, neutral base color, geist font

All Phase 2 shadcn components (ScrollArea, Collapsible, Avatar, Command, Alert) are from the shadcn official registry. No third-party registries declared in UI-SPEC.

**Result:** No registry audit flags. ✓

---

## Files Audited

- `pi-workbench/src/renderer/src/App.tsx`
- `pi-workbench/src/renderer/src/components/ChatPanel.tsx`
- `pi-workbench/src/renderer/src/components/MessageBubble.tsx`
- `pi-workbench/src/renderer/src/components/InputArea.tsx`
- `pi-workbench/src/renderer/src/components/ConversationList.tsx`
- `pi-workbench/src/renderer/src/components/MessageQueue.tsx`
- `pi-workbench/src/renderer/src/components/CommandPalette.tsx`
- `pi-workbench/src/renderer/src/components/GSDResultCard.tsx`
- `pi-workbench/src/renderer/src/components/ToolCallCard.tsx`
- `pi-workbench/src/renderer/src/components/ThinkingBlock.tsx`
- `pi-workbench/src/renderer/src/components/ErrorCard.tsx`
- `pi-workbench/src/renderer/src/components/ImagePreview.tsx`
- `pi-workbench/src/renderer/src/components/MarkdownRenderer.tsx`
- `pi-workbench/src/renderer/src/components/WelcomeDialog.tsx`
- `pi-workbench/src/renderer/src/components/Sidebar.tsx`
- `pi-workbench/src/renderer/src/components/ConnectionError.tsx`
- `pi-workbench/src/renderer/src/components/ProviderForm.tsx`
- `pi-workbench/src/renderer/src/pages/SettingsPage.tsx`
- `pi-workbench/src/renderer/src/assets/main.css`
- `pi-workbench/src/renderer/src/assets/base.css`
- `.planning/phases/02-ai-chat-engine/02-UI-SPEC.md`
- `.planning/phases/02-ai-chat-engine/02-CONTEXT.md`
- `.planning/phases/02-ai-chat-engine/02-PLAN-01-SUMMARY.md`
- `.planning/phases/02-ai-chat-engine/02-PLAN-02-SUMMARY.md`
- `.planning/phases/02-ai-chat-engine/02-PLAN-03-SUMMARY.md`
- `.planning/phases/02-ai-chat-engine/02-PLAN-04-SUMMARY.md`
- `.planning/phases/02-ai-chat-engine/02-PLAN-05-SUMMARY.md`