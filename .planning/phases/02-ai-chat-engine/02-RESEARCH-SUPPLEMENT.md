# Phase 2: AI Chat Engine — Research Supplement (UI-SPEC Integration)

**Created:** 2026-05-20
**Purpose:** Bridge between existing RESEARCH.md and UI-SPEC.md for the planner.
**Research mode:** Re-research with UI-SPEC context (`--research` flag).

---

## 1. UI-SPEC to Implementation Mapping

The UI-SPEC defines the following design contract. Here's how it maps to implementation:

### New shadcn Components to Install

| Component   | npm package          | Implementation context                                   |
| ----------- | -------------------- | -------------------------------------------------------- |
| ScrollArea  | `@radix-ui/react-scroll-area` | Message list scrolling, conversation list         |
| Collapsible | `@radix-ui/react-collapsible` | Message queue fold/unfold, thinking block         |
| Avatar      | `@radix-ui/react-avatar`      | User/AI message bubble avatars (28×28px)          |
| Command     | `cmdk`                       | GSD command autocomplete palette                   |
| Alert       | `@radix-ui/react-alert-dialog` | Error cards, retry UI                             |

**Action:** `npx shadcn add scroll-area collapsible avatar command alert`

### New npm Dependencies

| Package                                     | Purpose                                        |
| ------------------------------------------- | ---------------------------------------------- |
| `shiki` ^1.x                                | Syntax highlighting for markdown code blocks   |
| `react-markdown` ^9.x                       | Markdown rendering                             |
| `remark-gfm` ^4.x                           | GitHub Flavored Markdown                       |
| `rehype-raw` ^7.x                           | Raw HTML in markdown                           |
| `stream-markdown` ^0.0.15                   | Incremental Shiki renderer (optional perf)     |

### IPC Channels (New)

| Channel              | Direction       | Purpose                                          |
| -------------------- | --------------- | ------------------------------------------------ |
| `session:create`     | renderer→main   | Create new pi SDK session                        |
| `session:list`       | renderer→main   | List sessions for current workspace              |
| `session:sendMessage`| renderer→main   | Send message to current session                  |
| `session:stream`     | main→renderer   | Stream AI response chunks to renderer            |
| `session:stop`       | renderer→main   | Stop current AI generation                       |
| `session:getHistory` | renderer→main   | Load full conversation history                   |
| `session:setName`    | renderer→main   | Set conversation title                           |
| `session:delete`     | renderer→main   | Delete a conversation                            |
| `gsd:execute`        | renderer→main   | Execute GSD command via pi-gsd-tools CLI         |

### New React Components

From UI-SPEC Component Definitions:

| Component          | Props                                                     | Consumes from                                     |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------- |
| ChatPanel          | `session: AgentSession \| null`                           | SessionManager, IPC stream events                  |
| MessageBubble      | `message, role: 'user'\|'assistant', type: 'text'\|'thinking'\|'toolCall'` | Markdown renderer, shiki      |
| InputArea          | `onSend, onStop, onImagePaste, disabled, isGenerating`    | Textarea, paste handler, image upload             |
| MessageQueue       | `items: QueuedMessage[], onGuide, onDelete`               | Collapsible shadcn component                      |
| CommandPalette     | `commands: GSDCommand[], onSelect`                        | cmdk (shadcn Command)                              |
| GSDResultCard      | `status, command, output, onRetry`                        | Alert shadcn variant                              |
| ToolCallCard       | `name, args, status, result`                              | Badge shadcn component                            |
| ThinkingBlock      | `content, isComplete`                                     | Collapsible shadcn component                      |
| ErrorCard          | `message, onRetry`                                        | Alert shadcn variant="destructive"                |
| ImagePreview       | `src, open, onClose`                                      | Dialog shadcn (extend)                            |
| ConversationList   | `conversations, activeId, onSelect`                       | ScrollArea shadcn component                       |

### Bridge Between Existing Components and New Components

| Existing Component | How to Extend for Phase 2                                  |
| ------------------ | ---------------------------------------------------------- |
| Sidebar.tsx        | Add ConversationList section between app title and nav      |
| WelcomeDialog.tsx  | Reuse as empty chat state (already done in Phase 1)        |
| ipc.ts (main)      | Add session:*, gsd:* IPC handlers                          |
| main.css           | Already has `@import "tailwindcss"` + shadcn — no changes  |
| package.json       | Add new deps: shiki, react-markdown, remark-gfm, rehype-raw|

---

## 2. Stream Event Protocol Design

The pi SDK returns `MessageChunk` objects during streaming. The IPC bridge must serialize these to the renderer:

```typescript
// IPC stream event types (main → renderer)
interface StreamEvent {
  type: 'text' | 'thinking' | 'toolCall' | 'toolResult' | 'error' | 'done';
  content: string | ToolCallData;
  metadata?: {
    messageId: string;
    timestamp: string;
    index?: number;  // chunk index for ordering
  };
}
```

**Renderer buffering strategy:**
1. Maintain a `StreamBuffer` array in React state
2. Append each chunk as received
3. Re-render on each chunk (no debounce per D-12)
4. On `'done'` event, finalize the message and flush buffer
5. On `'error'`, display ErrorCard

**Stream lifecycle:**
```
user sends message → main creates session.appendMessage() →
  main calls agent.generateStream(messages) →
  for each chunk: main forwards via IPC 'session:stream' →
  renderer appends to current AI message →
  on 'done': renderer marks message complete →
  on user clicks Stop: renderer sends 'session:stop' → main aborts stream
```

---

## 3. GSD Command Execution Architecture (from UI-SPEC)

The CommandPalette component uses `cmdk` for the autocomplete UI:

```typescript
// Pre-registered GSD commands (discovered from .pi/gsd/workflows/)
const GSD_COMMANDS = [
  { id: 'plan-phase', name: 'plan-phase', description: '规划一个 phase', args: '<phase#>', icon: ... },
  { id: 'execute-phase', name: 'execute-phase', description: '执行一个 phase', args: '<phase#>', icon: ... },
  { id: 'discuss-phase', name: 'discuss-phase', description: '讨论一个 phase', args: '<phase#>', icon: ... },
  // ... etc
];
```

**Execution flow:**
```
renderer detects /gsd- → shows CommandPalette →
  user selects command → sends to main via IPC 'gsd:execute' →
  main spawns child_process (pi-gsd-tools) →
  main streams stdout/stderr back to renderer →
  renderer displays GSDResultCard (success: green, error: red)
```

---

## 4. Session Persistence State Machine

```
App Start
  │
  ▼
[WelcomeDialog]
  │
  ├── user clicks "开始对话" → SessionManager.create(cwd) → ChatPanel (empty)
  │
  ├── user selects conversation → SessionManager.open(path) → ChatPanel (with history)
  │
  └── user clicks "新建对话"
       → SessionManager.continueRecent(cwd) or create new
       → ChatPanel (empty)
  │
  ▼
[ChatPanel active]
  │
  ├── user sends message → session.appendMessage(userMsg) → session.subscribe() →
  │                           IPC stream → render MessageBubble
  │
  ├── user stops → abort stream → mark "已停止"
  │
  └── user switches workspace
       → session saved automatically
       → Show WelcomeDialog
```

---

## 5. Key Integration Points with Phase 1

| Phase 1 Asset                      | Phase 2 Usage                                               |
| ---------------------------------- | ----------------------------------------------------------- |
| `ModelProviderSelector`            | Current model determines multimodal UI visibility           |
| `ProviderConfig` (API Key, model)  | Used by main process to initialize pi SDK agent             |
| `WorkspacePath`                    | Passed to `SessionManager.create(cwd)`                      |
| `electron-store`                   | Already set up — Phase 2 adds session list caching          |
| `shadcn/ui` (button, dialog, etc.) | Reused in chat UI (send button, modals)                     |
| `Tailwind v4` CSS variables        | Color tokens already in place — chat colors use same system |
| `Sidebar` component                | Extended with ConversationList                              |
| `WelcomeDialog` component          | Reused as empty chat state                                  |
| `main/ipc.ts` handler pattern      | Extended with session:* and gsd:* channels                  |
| `contextBridge` preload pattern    | Extended with session and gsd APIs                          |

---

*Research supplement written: 2026-05-20*
*Purpose: Bridge existing RESEARCH.md with new UI-SPEC.md for the planner*