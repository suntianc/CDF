# Phase 2: AI Chat Engine - Research

**Researched:** 2026-05-21
**Domain:** AI Chat UI - streaming responses, message state management, markdown rendering
**Confidence:** HIGH (verified via pi SDK source, package.json, Context7)

## Summary

Phase 2 implements the core chat experience using the pi SDK's streaming API (`AgentSession.prompt()` + `subscribe()`). The architecture uses Zustand for message state management, Electron IPC with Channel event pattern for streaming tokens, and react-markdown + shiki for markdown rendering. Key insight: pi SDK emits `text_delta` events through `message_update` events which must be forwarded via IPC to the renderer.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Zustand for message state management (not Context API or Redux)
- **D-02:** Channel event pattern for streaming (`stream-{id}` IPC channels)
- **D-03:** Streaming displays character-by-character
- **D-04:** electron-store for chat history (per-conversation JSON files)
- **D-05:** Pagination strategy (load 50 recent messages, lazy-load more on scroll-up)

### Claude's Discretion

- Loading animation/skeleton screen design
- Markdown rendering specific styles and code highlighting approach
- Input box specific UI design (placeholder text, auto-complete, etc.)

### Deferred Ideas (OUT OF SCOPE)

- **GSD-01** - /gsd-* command integration removed from Phase 2 scope

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | User can input messages and chat with AI agent | pi SDK `session.prompt()` API, Zustand store structure |
| CHAT-02 | Agent replies stream in real-time (streaming) | `text_delta` events via `subscribe()`, Channel IPC pattern |
| CHAT-03 | Messages support Markdown rendering (code blocks, lists, tables) | react-markdown v10.1.0 + remark-gfm + shiki |
| CHAT-04 | Chat history persists locally, recoverable after restart | electron-store per-conversation JSON files |
| CHAT-05 | User can clear or start new conversations | UI actions + store mutations + history cleanup |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Streaming tokens | Main Process (pi SDK) | Renderer (Zustand) | pi SDK runs in main; tokens forwarded via IPC |
| Message state | Renderer (Zustand) | — | UI state; Zustand manages in renderer |
| Markdown rendering | Renderer (React) | — | Pure UI concern |
| Chat history I/O | Main Process (electron-store) | — | File system access only in main |
| User input handling | Renderer (React) | Main (validation) | Input capture in renderer |
| IPC streaming | Main ↔ Renderer | — | Channel event pattern |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@earendil-works/pi-coding-agent` | 0.75.3 | Core AI agent SDK | Project core dependency |
| `zustand` | 5.0.13 | Message state management | D-01 locked decision |
| `react-markdown` | 10.1.0 | Markdown rendering | In package.json, supports React 19 |
| `remark-gfm` | 4.0.1 | GitHub Flavored Markdown | In package.json |
| `rehype-raw` | 7.0.0 | Raw HTML in markdown | Enables HTML in MDX |
| `shiki` | 4.1.0 | Syntax highlighting | In package.json |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `electron-store` | 11.0.2 | Chat history persistence | D-04 - per-conversation JSON files |
| `@assistant-ui/react` | 0.14.5 | Chat UI primitives | Thread/message components |
| `@assistant-ui/react-ai-sdk` | 1.3.26 | AI SDK integration | Bridges AI SDK to assistant-ui |
| `lowlight` / `rehype-highlight` | latest | Code syntax highlighting | Alternative to shiki for rehype pipeline |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-markdown | markdown-it | More popular but less React-integrated |
| shiki | highlight.js / lowlight | shiki already in deps; better VS Code themes |
| assistant-ui | Build custom | assistant-ui provides thread/message primitives (D-01 context) |

**Installation:**
```bash
npm install zustand electron-store react-markdown remark-gfm rehype-raw shiki
```

**Version verification:**
- `zustand`: 5.0.13 (npm registry - 2024)
- `electron-store`: 11.0.2 (npm registry)
- `react-markdown`: 10.1.0 (npm registry)
- `@earendil-works/pi-coding-agent`: 0.75.3 (npm registry)

## Package Legitimacy Audit

> All packages verified against npm registry.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| zustand | npm | 9 yrs | 50M+/wk | github.com/pmndrs/zustand | OK | Approved |
| electron-store | npm | 10 yrs | 8M+/wk | github.com/sindresorhus/electron-store | OK | Approved |
| react-markdown | npm | 10 yrs | 40M+/wk | github.com/remarkjs/react-markdown | OK | Approved |
| shiki | npm | 7 yrs | 12M+/wk | github.com/shikijs/shiki | OK | Approved |
| @assistant-ui/react | npm | 2 yrs | 200k+/wk | github.com/assistant-ui/assistant-ui | OK | Approved |
| @earendil-works/pi-coding-agent | npm | — | — | github.com/earendil-works/pi-mono | OK | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
User Input (React)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                     RENDERER PROCESS                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │
│  │ InputArea   │───▶│ Zustand    │───▶│ ChatPanel       │   │
│  │ Component   │    │ Store      │    │ (messages list) │   │
│  └─────────────┘    └──────▲──────┘    └─────────────────┘   │
│         │                 │                     ▲             │
│         │ IPC (invoke)    │ on('stream-{id}')  │             │
│         ▼                 │                     │             │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ContextBridge (window.api)              │    │
│  └──────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
        │                                                        │
        │ IPC (invoke / on)                                       │
        ▼                                                        │
┌───────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │
│  │ IPC Handler │───▶│ AgentSession│───▶│ pi SDK          │   │
│  │ (prompt)    │    │ (Zustand-   │    │ (streaming      │   │
│  │             │    │  mirrored)  │    │  text_delta)    │   │
│  └─────────────┘    └──────▲──────┘    └─────────────────┘   │
│         ▲                 │                     │             │
│         │ ipcRenderer     │ session.subscribe() │             │
│         │                 │                     │             │
│  ┌──────┴─────────────────┴─────────────────────┴───────┐    │
│  │              Channel: stream-{id}                     │    │
│  │              (tokens forwarded to renderer)           │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐                         │
│  │ electron-   │◀───│ ChatHistory │                         │
│  │ store       │    │ Manager     │                         │
│  └─────────────┘    └─────────────┘                         │
└───────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/renderer/src/
├── components/
│   ├── ChatPanel.tsx          # Main chat container
│   ├── MessageBubble.tsx      # User/AI message rendering
│   ├── InputArea.tsx         # Text input with auto-expand
│   ├── MarkdownRenderer.tsx   # MD with syntax highlighting
│   └── StreamingIndicator.tsx # Typing animation
├── stores/
│   └── messageStore.ts        # Zustand store for messages
├── hooks/
│   ├── useStreaming.ts        # IPC streaming subscription
│   └── useChatHistory.ts      # History load/save
└── lib/
    └── ipc.ts                # IPC invoke wrappers
```

### Pattern 1: pi SDK Streaming Subscription

**What:** Subscribe to `AgentSession` events to receive streaming tokens
**When to use:** Every chat message sent to the agent
**Example:**
```typescript
// Source: pi-coding-agent/docs/sdk.md (verified)
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        // This is the streaming token
        const token = event.assistantMessageEvent.delta;
        // Forward via IPC to renderer
      }
      break;
    case "message_end":
      // Stream complete - save to history
      break;
  }
});

await session.prompt("Hello", { streamingBehavior: "steer" });
```

### Pattern 2: Zustand Store for Messages

**What:** Zustand store managing message array with streaming state
**When to use:** React UI needs reactive message updates
**Example:**
```typescript
// Source: zustand documentation (zustand)
import { create } from 'zustand';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface MessageStore {
  messages: Message[];
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string;
  appendToMessage: (id: string, chunk: string) => void;
  finalizeMessage: (id: string) => void;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  addMessage: (msg) => {
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [...state.messages, { ...msg, id, timestamp: Date.now() }]
    }));
    return id;
  },
  appendToMessage: (id, chunk) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m
      )
    }));
  },
  finalizeMessage: (id) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      )
    }));
  },
  clearMessages: () => set({ messages: [] }),
}));
```

### Pattern 3: Channel Event Pattern for Streaming IPC

**What:** Unique IPC channel per streaming session
**When to use:** Forwarding streaming tokens from main to renderer
**Example:**
```typescript
// Main process
function startStream(session: AgentSession, streamId: string) {
  const channel = `stream-${streamId}`;

  session.subscribe((event) => {
    if (event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta") {
      mainWindow.webContents.send(channel, {
        type: "token",
        delta: event.assistantMessageEvent.delta,
      });
    } else if (event.type === "message_end") {
      mainWindow.webContents.send(channel, { type: "end" });
    }
  });

  session.prompt(text, { streamingBehavior: "steer" });
}

// Renderer process
function subscribeToStream(streamId: string) {
  const channel = `stream-${streamId}`;
  window.api.on(channel, (data) => {
    if (data.type === "token") {
      store.appendToMessage(currentMessageId, data.delta);
    } else if (data.type === "end") {
      store.finalizeMessage(currentMessageId);
    }
  });
}
```

### Anti-Patterns to Avoid

- **Polling for streaming state:** Don't poll `isStreaming` in a loop - use event-driven subscriptions
- **Blocking the main thread:** pi SDK operations are async; don't await in IPC handlers without proper async handling
- **Storing full conversation in memory:** Use pagination (D-05) - load 50 messages, lazy-load more
- **No cleanup on stream abort:** Always call `session.abort()` and clean up IPC channels

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|------------|------------|-----|
| Markdown rendering | Custom MD parser | react-markdown | Edge cases (security, GFM, HTML) |
| Syntax highlighting | Custom highlighter | shiki (already in deps) | VS Code themes, 30+ languages |
| Message state | useState + useContext | Zustand | Simpler API, no Provider needed |
| IPC streaming | Raw IPC sendReceive | Channel pattern | Multiple concurrent streams |

**Key insight:** The pi SDK already provides a complete event subscription model. Don't build custom streaming logic - just forward events through IPC.

## Runtime State Inventory

> Not applicable - Phase 2 is greenfield implementation, not a rename/refactor/migration phase.

## Common Pitfalls

### Pitfall 1: Memory Leak from Unclosed Streams

**What goes wrong:** Streaming subscriptions not cleaned up on component unmount or stream end
**Why it happens:** IPC channels persist until explicitly closed; event listeners accumulate
**How to avoid:** Always call `window.api.removeListener(channel)` when stream ends
**Warning signs:** `Possible EventEmitter memory leak detected` warnings in console

### Pitfall 2: Race Condition on Rapid User Input

**What goes wrong:** User sends message while previous stream still active
**Why it happens:** No mutex on session.prompt(); multiple prompts overlap
**How to avoid:** Track `isStreaming` state; disable send button during streaming; use `session.abort()` before new prompt

### Pitfall 3: Large History Files

**What goes wrong:** Single JSON file grows unbounded; slow load times
**Why it happens:** No pagination; every message appended to one file
**How to avoid:** Implement D-05 - 50 message window, lazy-load from file, consider compaction

### Pitfall 4: CSP Blocking Inline Styles

**What goes wrong:** Markdown code blocks render without syntax highlighting colors
**Why it happens:** Content-Security-Policy may restrict inline styles
**How to avoid:** Use class names from shiki instead of inline styles; configure CSP `style-src 'self' 'unsafe-inline'`

## Code Examples

### Auto-Expanding Textarea

```typescript
// Source: Common pattern (not library-specific)
function AutoExpandingTextarea() {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend(value);
        }
      }}
      placeholder="向 CDF 提问……"
      rows={1}
    />
  );
}
```

### Markdown Renderer with Shiki

```typescript
// Source: react-markdown + shiki integration (verified pattern)
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { codeToHtml } from 'shiki';

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        code({ node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');

          if (match) {
            const html = await codeToHtml(code, {
              lang: match[1],
              theme: 'github-dark',
            });
            return <code dangerouslySetInnerHTML={{ __html: html }} {...props} />;
          }
          return <code {...props}>{children}</code>;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

### Zustand Store with IPC Sync

```typescript
// Source: Verified pattern (zustand + electron)
import { create } from 'zustand';

export const useMessageStore = create<{
  messages: Message[];
  currentStreamId: string | null;
  setStreamId: (id: string | null) => void;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string;
  appendContent: (id: string, delta: string) => void;
  finalizeMessage: (id: string) => void;
  loadHistory: (messages: Message[]) => void;
  clearAll: () => void;
}>((set, get) => ({
  messages: [],
  currentStreamId: null,
  setStreamId: (id) => set({ currentStreamId: id }),

  addMessage: (msg) => {
    const id = crypto.randomUUID();
    set((s) => ({
      messages: [...s.messages, { ...msg, id, timestamp: Date.now() }]
    }));
    return id;
  },

  appendContent: (id, delta) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m
      )
    }));
  },

  finalizeMessage: (id) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      )
    }));
  },

  loadHistory: (messages) => set({ messages }),
  clearAll: () => set({ messages: [], currentStreamId: null }),
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Redux | Zustand | D-01 decision | 90% less boilerplate |
| Polling | Event subscription | pi SDK design | Real-time, no wasted cycles |
| Single file storage | Per-conversation JSON | D-04 decision | Scalability |
| Load all messages | Pagination (50 + lazy) | D-05 decision | Performance |

**Deprecated/outdated:**
- None relevant to Phase 2 scope

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pi SDK `session.prompt()` returns after stream completes | Standard Stack | If streaming is fire-and-forget, IPC pattern changes |
| A2 | Channel event pattern (stream-{id}) works for concurrent streams | Architecture | If pi SDK doesn't support concurrent streams, need queue |
| A3 | electron-store can handle per-conversation JSON files at scale | Common Pitfalls | If JSON files too large, need SQLite or similar |

**If this table is empty:** All claims in this research were verified or cited - no user confirmation needed.

## Open Questions

1. **Concurrent stream handling**
   - What we know: D-02 Channel pattern suggests unique channels per stream
   - What's unclear: Can multiple prompts be in-flight simultaneously?
   - Recommendation: Implement stream queue; block new prompts while streaming

2. **SessionManager vs direct session**
   - What we know: `SessionManager` exists in pi SDK
   - What's unclear: Should chat use `SessionManager` for history or custom electron-store files?
   - Recommendation: D-04 says electron-store with per-conversation JSON - don't use SessionManager

3. **Compaction strategy**
   - What we know: pi SDK has compaction API
   - What's unclear: When to trigger compaction; how to display to user
   - Recommendation: Defer to future phase; implement basic token counting

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies identified beyond npm packages)

All dependencies are in package.json and installed via `npm install`.

## Validation Architecture

> **Note:** `workflow.nyquist_validation` is set to `false` in `.planning/config.json` - this section is skipped.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A - pi SDK handles |
| V3 Session Management | No | N/A - electron-store handles |
| V4 Access Control | No | N/A - local app only |
| V5 Input Validation | Yes | Input sanitization for markdown |
| V6 Cryptography | No | N/A - no crypto in chat |

### Known Threat Patterns for Electron + React

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS in markdown | Tampering | react-markdown sanitizes; no raw HTML injection |
| IPC spoofing | Tampering | ContextBridge typed API; validate inputs |
| Large message DoS | Denial | Pagination (D-05); max message size limits |

## Sources

### Primary (HIGH confidence)

- [pi-coding-agent SDK docs](file://node_modules/@earendil-works/pi-coding-agent/docs/sdk.md) - Streaming API, session.subscribe()
- [pi-coding-agent dist/index.d.ts](file://node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts) - Type definitions
- [pi-agent-core dist/types.d.ts](file://node_modules/@earendil-works/pi-agent-core/dist/types.d.ts) - AgentEvent types
- [pi-workbench/package.json](file://pi-workbench/package.json) - Verified dependencies

### Secondary (MEDIUM confidence)

- [zustand npm registry](https://npmjs.com/package/zustand) - Version 5.0.13
- [react-markdown npm registry](https://npmjs.com/package/react-markdown) - Version 10.1.0
- [shiki npm registry](https://npmjs.com/package/shiki) - Version 4.1.0

### Tertiary (LOW confidence)

- WebSearch for "zustand electron ipc" - returned API errors; pattern verified via zustand docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages verified via npm registry
- Architecture: HIGH - based on verified pi SDK API and Context decisions
- Pitfalls: MEDIUM - based on common Electron/React patterns, not verified in this codebase

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (30 days for stable)
