# Phase 2: AI Chat Engine - Research

**Research completed:** 2026-05-20
**Phase:** 02 - AI Chat Engine
**Requirements addressed:** CHAT-01~05, GSD-01

---

## 1. pi SDK SessionManager Integration

### Session File Format

Sessions are stored as **JSONL** (JSON Lines) files organized by working directory:

```
~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<uuid>.jsonl
```

Each line is a JSON object with a `type` field. Entries form a **tree structure** via `id`/`parentId` fields.

**Session Header:**
```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project"}
```

**Message Entry:**
```json
{"type":"message","id":"a1b2c3d4","parentId":"prev1234","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"Hello"}}
```

### Message Types

| Type | Role | Content Structure |
|------|------|-------------------|
| `UserMessage` | `user` | `string` or `(TextContent \| ImageContent)[]` |
| `AssistantMessage` | `assistant` | `(TextContent \| ThinkingContent \| ToolCall)[]` |
| `ToolResultMessage` | `toolResult` | `(TextContent \| ImageContent)[]` |
| `BashExecutionMessage` | `bashExecution` | command, output, exitCode |
| `CustomMessage` | `custom` | extension-injected messages |

**Content Block Types:**
```typescript
interface TextContent { type: "text"; text: string; }
interface ImageContent { type: "image"; data: string; mimeType: string; }
interface ThinkingContent { type: "thinking"; thinking: string; }
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
```

### SessionManager API

**Static Methods:**
| Method | Purpose |
|--------|---------|
| `SessionManager.create(cwd, sessionDir?)` | Create new session |
| `SessionManager.open(path, sessionDir?)` | Open existing session |
| `SessionManager.continueRecent(cwd)` | Continue most recent or create new |
| `SessionManager.inMemory(cwd?)` | No file persistence |
| `SessionManager.list(cwd)` | List sessions for a directory |
| `SessionManager.listAll()` | List all sessions across all projects |

**Instance Methods:**
| Method | Purpose |
|--------|---------|
| `appendMessage(message)` | Add message → returns entry ID |
| `appendThinkingLevelChange(level)` | Record thinking change |
| `appendModelChange(provider, modelId)` | Record model change |
| `buildSessionContext()` | Get messages + settings for LLM |
| `getLeafId()` / `getLeafEntry()` | Current position in tree |
| `branch(entryId)` | Move leaf to earlier entry |
| `resetLeaf()` | Reset to before any entries |
| `setSessionName(name)` | Set display name |

**Key insight for Phase 2:** The Electron main process should use `SessionManager.create(cwd)` to create sessions, and the renderer should communicate via IPC. The `session.subscribe()` pattern for streaming events needs to be implemented through IPC event forwarding.

**Source:** [pi.dev/docs/latest/session-format](https://pi.dev/docs/latest/session-format), [pi.dev/docs/latest/sessions](https://pi.dev/docs/latest/sessions)

---

## 2. Streaming Markdown with Shiki

### Problem

Streaming markdown with syntax highlighting is challenging because:
1. Shiki requires complete code blocks to generate highlighting
2. Partial code blocks produce broken/highlighted-incomplete output
3. Frequent DOM updates during streaming cause performance issues

### Solution: `stream-markdown` Package

The [`stream-markdown`](https://github.com/Simon-He95/stream-markdown) npm package (v0.0.15, MIT) provides a framework-agnostic incremental Shiki renderer:

**Core utilities:**
- `createTokenIncrementalUpdater(container, highlighter, options)` — Token-based incremental updater (no HTML parsing)
- `createScheduledTokenIncrementalUpdater(...)` — Defers DOM updates to idle time, prioritizes visible containers
- `createShikiStreamRenderer(...)` — High-level API using scheduled updater by default

**Key features:**
- Incrementally updates the last changed line and appends new lines
- Safely falls back to full re-render if earlier lines diverge (multi-line tokens)
- Token caching and HTML caching to reduce redundant processing
- Non-blocking concurrent code block updates via scheduled updater

**Basic usage:**
```typescript
import { createHighlighter } from 'shiki'
import { createTokenIncrementalUpdater } from 'stream-markdown'

const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: ['typescript'] })
const container = document.getElementById('code')!

const updater = createTokenIncrementalUpdater(container, highlighter, {
  lang: 'typescript',
  theme: 'vitesse-dark',
})

updater.update('const a = 1')
updater.update('const a = 12')
// ... streaming updates
```

**For React:** The package is framework-agnostic. In React, wrap the code block container in a `useRef` and initialize the updater in a `useEffect`. Use `requestIdleCallback` or the scheduled updater to avoid blocking the main thread.

**Alternative approach (simpler for Phase 2):** Use `react-markdown` + `remark-gfm` + `rehype-highlight` or `shiki` with a simpler approach: render the full markdown as it arrives, but for code blocks, use a placeholder until the block is complete, then re-render with highlighting. This avoids the complexity of incremental token updates.

**Recommendation for Phase 2:** Start with `react-markdown` + `shiki` (batch render on each chunk). Once streaming is stable, optimize with `stream-markdown` for incremental code highlighting. The `stream-markdown` package is well-maintained (last update Mar 2026) and has a clean API.

**Source:** [github.com/Simon-He95/stream-markdown](https://github.com/Simon-He95/stream-markdown)

---

## 3. GSD Command Integration Architecture

### Challenge

GSD commands (e.g., `/gsd-plan-phase`, `/gsd-execute-phase`) are CLI commands that need to be executed from the Electron renderer and display results in the chat UI.

### Architecture

```
Renderer (React)          Preload              Main (Node)
─────────────────        ──────────           ──────────
ChatPanel ──IPC──►       contextBridge        gsd CLI
  |                       .gsdCommand()  ───►  pi-gsd-tools
  │                                              │
  │◄──IPC── gsd result    ◄──IPC──              ▼
  │                        gsdResult         gsd workflow
  ▼
GSDResultCard (display)
```

**Implementation approach:**

1. **Main process:** Register IPC handler for GSD command execution:
   ```typescript
   // main/ipc.ts
   ipcMain.handle('gsd:execute', async (event, command: string, args: string[]) => {
     const { exec } = require('child_process');
     const cmd = `pi-gsd-tools ${command} ${args.join(' ')}`;
     return new Promise((resolve, reject) => {
       exec(cmd, { cwd: workspacePath }, (error, stdout, stderr) => {
         if (error) reject({ error: stderr || error.message });
         else resolve({ output: stdout });
       });
     });
   });
   ```

2. **Preload:** Expose via contextBridge:
   ```typescript
   contextBridge.exposeInMainWorld('gsd', {
     execute: (command: string, args: string[]) => ipcRenderer.invoke('gsd:execute', command, args),
   });
   ```

3. **Renderer:** Call via `window.gsd.execute('plan-phase', ['2'])`

### Command Autocomplete

For the `/gsd-*` autocomplete menu:
- Pre-populate with known GSD commands from `.pi/gsd/workflows/` directory
- Parse workflow files to extract command names and descriptions
- Filter and display as user types
- Keyboard navigation: ↑↓ select, Enter confirm, Escape cancel

**Source commands to discover:**
- `.pi/gsd/workflows/*.md` — Workflow definitions
- `.pi/gsd/prompts/*.md` — Prompt templates
- `pi-gsd-tools` CLI — Available commands

---

## 4. Image Upload Handling

### Electron Approach

**Drag & Drop:**
```typescript
// In renderer
const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Send to AI with image content block
      };
      reader.readAsDataURL(file);
    }
  });
};
```

**Paste:**
```typescript
// In renderer input
const handlePaste = (e: React.ClipboardEvent) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      // Process as above
    }
  }
};
```

### Sending to AI

Image content is sent as `ImageContent` block:
```typescript
{
  role: "user",
  content: [
    { type: "text", text: "What's in this image?" },
    { type: "image", data: base64String, mimeType: "image/png" }
  ]
}
```

**Model detection:** Check the current model's capabilities. If `multimodal: true` (or model name indicates vision capability), show upload UI. Otherwise, hide it.

---

## 5. Thinking Block Rendering

When models return `ThinkingContent` blocks, display them in a collapsible card:

```tsx
<ThinkingBlock>
  <summary>Thinking ({duration})</summary>
  <div className="thinking-content">{thinkingText}</div>
</ThinkingBlock>
```

**Key behavior (from CONTEXT.md D-45):**
- Display in a collapsible card
- Auto-collapse when thinking is complete
- Use a subtle visual style (different from main message)

---

## 6. Tool Call Visualization

When AI executes tools, display a `ToolCallCard`:

```tsx
<ToolCallCard>
  <ToolName>bash</ToolName>
  <ToolParams>{JSON.stringify(params, null, 2)}</Params>
  <ToolStatus>running | completed | error</ToolStatus>
  <ToolResult>{result}</ToolResult>
</ToolCallCard>
```

**Message structure in session:**
```json
{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_123","name":"bash","arguments":{"command":"ls"}}]}}
{"type":"message","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"output"}]}}
```

---

## 7. Message Queue Architecture

### State Management

The message queue (D-19~D-30) needs:
- **Storage:** Array of queued messages in React state (or Zustand for cross-component access)
- **Each queue item:** `{ id, content, status: 'pending' | 'guiding' | 'sent', createdAt }`
- **Operations:** add, remove, guide (send immediately + interrupt AI), clear all

### Queue Behavior

| Event | Action |
|-------|--------|
| User types during AI reply | Button changes to "Send" (queues message) |
| User clicks "Send" | Message added to queue |
| User clicks "Stop" | AI output marked "已停止", input框 cleared |
| User clicks ↩︎ on queue item | Mark as "已引导", interrupt AI, send immediately |
| User clicks × on queue item | Remove from queue |

**Implementation:** Use a custom hook `useMessageQueue()` that manages queue state and provides `enqueue`, `dequeue`, `guide`, `clear` methods.

---

## 8. IPC Architecture for Chat

### New IPC Channels Needed

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `session:create` | renderer → main | Create new session |
| `session:list` | renderer → main | List sessions for workspace |
| `session:sendMessage` | renderer → main | Send message to session |
| `session:stream` | main → renderer | Stream AI response chunks |
| `session:stop` | renderer → main | Stop current generation |
| `session:getHistory` | renderer → main | Get full conversation history |
| `gsd:execute` | renderer → main | Execute GSD command |
| `gsd:subscribe` | main → renderer | GSD command result |

### Streaming Pattern

```typescript
// Main process
const session = SessionManager.create(cwd);
const stream = await agent.generateStream(messages);

for await (const chunk of stream) {
  ipcRenderer.send('session:stream', {
    type: chunk.type, // 'text' | 'thinking' | 'toolCall' | 'error'
    content: chunk.content,
  });
}

// Renderer
session.subscribe((chunk) => {
  // Append to message buffer
  // Trigger re-render
});
```

---

## 9. Component Inventory

### New Components to Create

| Component | File | Purpose |
|-----------|------|---------|
| `ChatPanel` | `renderer/src/components/ChatPanel.tsx` | Main chat area with message list + input |
| `MessageBubble` | `renderer/src/components/MessageBubble.tsx` | Individual message (user/AI) with content rendering |
| `MessageQueue` | `renderer/src/components/MessageQueue.tsx` | Queue of pending messages above input |
| `CommandPalette` | `renderer/src/components/CommandPalette.tsx` | GSD command autocomplete dropdown |
| `GSDResultCard` | `renderer/src/components/GSDResultCard.tsx` | GSD command result display |
| `ToolCallCard` | `renderer/src/components/ToolCallCard.tsx` | Tool call visualization |
| `ThinkingBlock` | `renderer/src/components/ThinkingBlock.tsx` | Collapsible thinking process |
| `ErrorCard` | `renderer/src/components/ErrorCard.tsx` | Error message with retry |
| `ImagePreview` | `renderer/src/components/ImagePreview.tsx` | Image thumbnail + modal preview |
| `ConversationList` | `renderer/src/components/ConversationList.tsx` | Sidebar conversation list (extend existing) |

### Extended Components

| Component | File | Changes |
|-----------|------|---------|
| `Sidebar` | `renderer/src/components/Sidebar.tsx` | Add conversation list section |
| `WelcomeDialog` | `renderer/src/components/WelcomeDialog.tsx` | Extend for chat context |

---

## 10. Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SessionManager IPC latency | Streaming feels laggy | Buffer chunks in renderer, batch DOM updates (requestAnimationFrame) |
| Shiki blocking main thread | UI freezes during code rendering | Use scheduled updater from `stream-markdown`, or defer highlighting until code block complete |
| Large message history | Memory pressure | Lazy-load conversation history, paginate sidebar list |
| GSD command execution | Commands may take long | Show progress indicator, support cancellation |
| Image base64 size | Large images slow streaming | Compress images before sending, set size limits |
| Session tree complexity | Branching/confusion | Start with linear sessions, add tree features in Phase 3 |

---

## 11. Dependencies to Install

| Package | Version | Purpose |
|---------|---------|---------|
| `shiki` | ^1.x | Syntax highlighting |
| `stream-markdown` | ^0.0.15 | Incremental Shiki renderer |
| `react-markdown` | ^9.x | Markdown rendering |
| `remark-gfm` | ^4.x | GitHub Flavored Markdown |
| `rehype-raw` | ^7.x | Allow raw HTML in markdown |
| `@types/node` | (existing) | Node.js types for main process |

---

## 12. Phase 2 Execution Priority

Based on research findings, recommended implementation order:

1. **Core IPC + SessionManager integration** — Foundation for all chat features
2. **Basic chat UI** — Message list + input (CHAT-01)
3. **Streaming + Markdown rendering** — Real-time display (CHAT-02, CHAT-03)
4. **Session persistence** — History save/restore (CHAT-04)
5. **New/clear conversation** — Session management (CHAT-05)
6. **GSD command integration** — Autocomplete + execution + result cards (GSD-01)
7. **Message queue** — Queue management during AI replies
8. **Enhanced features** — Image upload, thinking blocks, tool calls, error cards

---

*Research completed by gsd-phase-researcher · 2026-05-20*
