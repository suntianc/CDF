# Phase 8: Polish + Differentiators - Research

**Researched:** 2026-06-04
**Domain:** Renderer 端 polish（视觉/加载态/过滤强化）+ Main 端 chokidar 降级 + 跨进程 toast 路径
**Confidence:** HIGH（代码锚点已逐条核对；外部库 API 已通过官方文档/registry 二次校验）

---

## 1. Overview

Phase 8 是 v1.1 milestone 的最后一个收尾 phase，**没有新的 `SLASH-XX` 需求**，目标是在 Phase 5/6/7 已经"能跑通"的基座上加 5 个 polish 维度，让 popup 用起来"丝滑"而非"能用":

1. **7-色 source badge 视觉系统** —— Badge 文字色按 7 个 source 区分（system / skill:global / skill:project / workflow / mcp / cmd:system / cmd:project），暗色主题优先
2. **CJK NFKC filter 强化** —— 去除 emoji variation selector（`U+FE00`–`U+FE0F`），并把 `normalize().toLowerCase()` 提前到 Map 预热，避免在 N item × M keystroke 的 useMemo 中重复计算
3. **MCP 慢加载 skeleton** —— `commands:list` IPC 超过 500ms 仍未返回时显示 1 行 shadcn Skeleton（badge 占位 + name 占位），IPC reject 时静默切换到 Phase 6 已有的 `mcp_health_warning` 灰行
4. **IME z-index 边界 (macOS)** —— 接受为已知技术限制（系统级 IME 候选框 z-index 远高于 web layer），仅在 Phase 5 已知 stub 旁加注释 + Esc workaround
5. **chokidar 失败降级 toast** —— Phase 6 D-24 只 log；Phase 8 升级为 `readdir` fallback + user-visible `toast.warning('项目命令热重载不可用，已降级为静态扫描', { duration: 5000 })`

**Primary recommendation:** 实施时按 3 个 wave 推进:

- **Wave A (前置)**：在 `App.tsx` 挂载 `<Toaster />`（**[VERIFIED: codebase grep]** 当前**完全没有** Toaster 挂载点，意味着 Phase 6/7 既有的 `toast.warning` / `toast.info` 调用全部沉默 —— 这是 Phase 8 chokidar toast 能显示的前置条件）；同时 `pnpm dlx shadcn@latest add skeleton`（**[VERIFIED: ls]** `src/renderer/src/components/ui/skeleton.tsx` 不存在；CONTEXT.md "现成组件" 描述与代码现状不符，必须新建）
- **Wave B (popup polish)**：7 色 badge lookup map → SlashCommandPopup → CJK NFKC 强化 + 预 normalize Map → skeleton 行接 useCommandRegistry 的 `'pending'` 态 + Command.Loading 包 shadcn Skeleton → IME z-index 注释
- **Wave C (chokidar 降级)**：`chokidar-watcher.ts` 加 try-catch + `commands:fallback` IPC 推送 + readdir fallback → preload 加 `onFallback` 桥 → `useCommandRegistry` 订阅 + dedup set + toast.warning

---

## 2. User Constraints (from CONTEXT.md)

> **MANDATORY**：以下内容从 `.planning/phases/08-polish-differentiators/08-CONTEXT.md` 原文复制。Planner 必须遵守。

### Locked Decisions

#### D-01..D-04：7 色 source badge

- **D-01:** 7 个 source 各用 1 种固定色：
  - `system` → 蓝 (`text-blue-400` ≈ `#60a5fa`)
  - `skill:global` → 紫灰 (`text-violet-300` ≈ `#c4b5fd`，与 `skill:project` 形成 global/project 区分)
  - `skill:project` → 紫 (`text-purple-400` ≈ `#c084fc`)
  - `workflow` → 绿 (`text-green-400` ≈ `#4ade80`)
  - `mcp` → 橙 (`text-amber-400` ≈ `#fbbf24`)，badge text 保留 Phase 6 D-08 的 `[mcp:serverId]`
  - `cmd:system` → 灰 (`text-gray-400` ≈ `#9ca3af`)
  - `cmd:project` → 深灰 (`text-gray-500` ≈ `#6b7280`)
- **D-02:** 颜色仅作用在 badge **文字色** (`text-{color}` class)，**不**改变 badge 背景/边框。
- **D-03:** 暗色主题优先（VS Code Dark+ palette）。亮色主题在 Phase 8 范围内**降权**。
- **D-04:** 颜色通过 Tailwind **静态 class** 应用（不用 string interpolation），**不**新增 CSS variables。

#### D-05..D-06：CJK NFKC filter 强化

- **D-05:** `filterCommands` 已 `normalize('NFKC').toLowerCase()` (Phase 5/6 锁定)。Phase 8 新增 **D-05d**：去除 Unicode variation selector (`U+FE0F` 等)，确保 `/🎉` 与 `/🎉︎` 匹配一致。
- **D-06:** 性能优化：filter 在 useMemo 中，`normalize` 重复调用 N=commands.length 次 → Phase 8 改为对每个 cmd.name **预 normalize 进 Map**，filter 时直接 `Map.get`。

#### D-07..D-12：MCP skeleton spinner

- **D-07:** Skeleton 触发阈值 = **500ms** (ROADMAP 原定值，客人大人 2026-06-04 确认)
- **D-08:** Skeleton 行渲染在 popup 顶部、source 描述位
- **D-09:** Skeleton 出现条件：`useCommandRegistry` 触发 `commands:list` IPC 超过 500ms 仍无响应
- **D-10:** Skeleton 消失时机：IPC 响应到达 或 IPC 失败转 `mcp_health_warning` 灰行
- **D-11:** 失败处理：IPC reject / throw → **静默**换 `mcp_health_warning` 灰行（与 Phase 6 D-08 一致）
- **D-12:** Skeleton 实现：用 `<Skeleton>` shadcn 组件（**注意 CONTEXT 描述与现状不符，详见 §3.1**）

#### D-13..D-15：IME z-index 边界 (macOS)

- **D-13:** Popup 当前 z-index = 50。macOS IME 候选框 z-index ≈ 9999，会覆盖 popup。
- **D-14:** **接受** macOS 已知 issue，不解决（技术限制）。Workaround: "按 Esc 一次关 popup"。
- **D-15:** 在 Phase 5 已知 stub 旁加注释，提示用户「IME 候选期间 popup 被遮挡，按 Esc 关闭候选框后 popup 仍可见」。

#### D-16..D-19：chokidar 失败降级 toast

- **D-16:** 触发条件：chokidar 初始化失败 / 监听过程中出错；降级：改用 `readdir` 一次扫描；toast 文案"项目命令热重载不可用，已降级为静态扫描"；duration 5000ms；sonner `warning` variant
- **D-17:** 用户点 toast 不关闭，可手动 dismiss
- **D-18:** 系统命令走 `collectSystemCommands`（无 IO，永远不会触发降级），不需 toast 路径
- **D-19:** 降级后 watcher 完全停用，**不**自动重试

#### D-20..D-22：5-行 popup 视觉密度

- **D-20:** 维持 Phase 5/6 layout：5 行 `max-h-64` = 256px
- **D-21:** Badge 加 source color 后，**行高不变**（13px body + 24px line-height = 32px row）
- **D-22:** Phase 8 不调整 popup 高度 / 列宽

### Claude's Discretion

- **C-01:** 亮色主题 7 色 —— Phase 8 不做，推 v1.2
- **C-02:** 7 色在 popup 之外的应用（气泡 badge）—— Phase 8 限定 popup
- **C-03:** MCP 慢加载 skeleton 行数 —— **1 行**（与 popup 行高一致）
- **C-04:** Toast 多次出现的去重策略 —— **同一错误只 toast 1 次**（用 Set 存已 toast 错误 fingerprint）
- **C-05:** Skeleton 颜色 —— 沿用 shadcn default
- **C-06:** 5 行 popup 视觉密度微调 —— **不调**，保持 Phase 5 baseline
- **C-07:** `cmd:project` 优先级 —— ROADMAP 描述的"深灰"即可（`text-gray-500`）

### Deferred Ideas (OUT OF SCOPE)

- 推 v1.2+：亮色主题 7 色 / popup 之外 badge / SLASH-15 (/goal SQLite) / SLASH-17 (命令别名)
- Phase 8 范围内不重新设计：5-行 popup 视觉密度微调 / popup layout 重设计 / sonner toast → MessageItem 气泡

---

## 3. Architecture Decisions (confirm locked decisions)

所有 D-01..D-22 + C-01..C-07 已在 CONTEXT.md 中锁定。Phase 8 研究**不**质询任何锁定决定，只补充 3 处与代码现状有出入的地方需要 planner 注意：

### 3.1 关键现状校正 (CONTEXT.md 描述 vs 代码事实)

| CONTEXT.md 描述 | 代码事实（[VERIFIED]） | Planner 需要做 |
|---|---|---|
| "shadcn `<Skeleton>` 已有（`src/renderer/src/components/ui/skeleton.tsx`）" | **不存在**（`ls src/renderer/src/components/ui/` = badge / button / popover / sheet / scroll-area / tooltip / dialog / dropdown-menu / CustomSelect 九个，无 skeleton） | Wave A 新建 `skeleton.tsx`，按 shadcn new-york style canonical 实现（`animate-pulse rounded-md bg-accent` → 项目无 `accent` 色，改 `bg-[var(--color-bg-active)]`） |
| "Sonner toast (already installed)" + Phase 6/7 大量 `toast.warning/info/error` 调用 | sonner@2.0.7 **已装**，但 `<Toaster />` 组件**完全未在 App.tsx 挂载**（grep "Toaster" in src/ = 0 命中） | Wave A 在 `App.tsx` 加 `import { Toaster } from 'sonner'` + `<Toaster richColors position="bottom-right" />` ；这是 Phase 6/7 既有 toast 显示 + Phase 8 chokidar toast 显示的**共同前置** |
| "tailwind.config.js 加 7 色" | 项目使用 Tailwind **v4** (`@import "tailwindcss"` + `@theme` directive, **无** `tailwind.config.js`)；7 色全部已在 Tailwind v4 default palette 中（blue-400/violet-300/purple-400/green-400/amber-400/gray-400/gray-500 **[CITED: tailwindcss.com/docs/colors]**） | 直接用静态 class，不动 globals.css；**不**新增 CSS variable |

### 3.2 架构责任划分确认

7 色 badge / CJK / skeleton / IME 注释 → **Renderer 单一进程**（无跨进程通信）
chokidar 降级 → **Main → Renderer 跨进程**（main: try-catch + fallback + IPC push；preload: bridge；renderer: subscribe + dedup + toast）

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| 7-色 source badge 视觉 | Renderer (UI 层) | — | 纯 className 映射，无业务逻辑 / 无 IPC |
| CJK NFKC 强化 + 预 normalize Map | Renderer (filter 层) | — | `String.prototype.normalize` 是浏览器 API，filterCommands 已在 SlashCommandPopup.tsx |
| MCP skeleton spinner | Renderer (hook + UI) | — | 500ms threshold 是 renderer-side 计时；IPC pending 状态是 useCommandRegistry 内态 |
| IME z-index 注释 | Renderer (注释) | — | macOS IME 是系统级，web layer 不可干预；只能加 comment 描述 |
| chokidar 失败 toast | Main (容错 + IPC push) | Renderer (订阅 + toast + dedup) | 失败发生在 main 进程的 chokidar.watch；toast 必须在 renderer 显示 |
| `<Toaster />` 挂载 | Renderer (App 层) | — | sonner 是 React 组件，挂载在 App.tsx |
| shadcn Skeleton 组件 | Renderer (ui 库) | — | 单文件 React 组件，无依赖 |

---

## 4. 7-Color Source Badge Implementation

### 4.1 Tailwind v4 静态 class 约束 [VERIFIED: tailwindcss.com/docs/detecting-classes-in-source-files]

> "Tailwind treats all of your source files as plain text. A token like `text-${color}-500` will not generate CSS, because it does not exist as a complete string."

→ **必须**用 lookup object 把 runtime 值映射到完整字符串 class。

### 4.2 推荐实现（SlashCommandPopup.tsx 内 module-private 常量）

```ts
// SlashCommandPopup.tsx (top of file)
import type { CommandSource } from '../../../../shared/types';

// D-01..D-04: 7 个 source 各对应一种文字色。
// 静态字面量，Tailwind JIT 可扫描。Dark theme palette（VS Code Dark+ 类）。
// 不改 badge 背景/边框（D-02）；不新增 CSS variable（D-04）。
const SOURCE_TEXT_COLOR: Record<CommandSource, string> = {
  'system':        'text-blue-400',
  'skill:global':  'text-violet-300',
  'skill:project': 'text-purple-400',
  'workflow':      'text-green-400',
  'mcp':           'text-amber-400',
  'cmd:system':    'text-gray-400',
  'cmd:project':   'text-gray-500',
};
```

### 4.3 应用位置

`SlashCommandPopup.tsx:153-155` 当前：
```tsx
<Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
  {c.badge}
</Badge>
```

改为：
```tsx
<Badge
  variant="secondary"
  className={cn(
    'text-[10px] px-1.5 py-0 font-mono',
    SOURCE_TEXT_COLOR[c.source]
  )}
>
  {c.badge}
</Badge>
```

需要 `import { cn } from '@/lib/utils'`（**[VERIFIED]** 已存在 `src/renderer/src/lib/utils.ts`，导出 `cn`）。

### 4.4 主题兼容性

- 当前 `badge.tsx` 的 `secondary` variant 使用 `bg-[var(--color-bg-surface)]` 暗色背景 (#2d2d2d) + `text-[var(--color-text-primary)]` (#ececec)。`text-*` class 因为 Tailwind specificity（外加在后，等同覆盖）会覆盖 secondary 的 text 色。
- 暗色背景 #2d2d2d 与 7 个文字色的 WCAG 对比度（粗算）：blue-400 6.8:1 / violet-300 7.5:1 / purple-400 5.2:1 / green-400 8.2:1 / amber-400 8.5:1 / gray-400 5.1:1 / gray-500 3.5:1 → cmd:project (gray-500) 接近 AA Large Text 阈值，但 ROADMAP 锁定"深灰" → 接受 (C-07 明确)。
- **亮色主题**：badge.tsx secondary variant 在 light theme 下也用 `var(--color-bg-surface)` = #eaeaea；text-amber-400 / text-violet-300 在浅背景下对比度偏低；**Phase 8 C-01 已锁定不处理**，注释中标注 "v1.2 polish 处理亮色 palette"。

### 4.5 5-行密度健全性检查 (D-21)

| 元素 | 高度 | 来源 |
|---|---|---|
| Command.Item 容器 | `py-1.5` = 12px (6+6) | SlashCommandPopup.tsx:151 |
| Badge | `py-0` + `text-[10px]` = ~12px text height | SlashCommandPopup.tsx:153 |
| Command name | `text-[13px]` × 1.5 line-height = ~20px | SlashCommandPopup.tsx:156 |
| 单行总高 | ~32px | items-center 对齐 |
| `max-h-64` (256px) | 256 / 32 ≈ **8 行可见** | Command.List:135 |

**结论:** 7-行 source badge 不会撑高单行（只改 text-color，不加 padding / 不加图标 / 不加额外 width），D-21 锁定的"行高不变"成立。**Phase 8 不需要 visual density 调整**。

---

## 5. CJK NFKC Filter Strengthening

### 5.1 当前实现 (Phase 5/6) [VERIFIED: SlashCommandPopup.tsx:19-31]

```ts
const filterCommands = (query, items) => {
  const normalized = query.normalize('NFKC').toLowerCase();
  if (!normalized) return items.slice();
  return items.filter((c) => {
    const name = c.name.normalize('NFKC').toLowerCase();
    return name.includes(normalized) || ('/' + name).includes(normalized);
  });
};
```

**问题1 (D-05d)**：NFKC 不去除 variation selector。`'🎉'.normalize('NFKC') === '🎉'`，`'🎉︎'.normalize('NFKC') === '🎉︎'`（仍带 `U+FE0F`）。

**问题2 (D-06)**：每次 keystroke，`items.length` 次 `normalize().toLowerCase()` 重复计算。N=50 commands × 每秒 5 keystrokes × 200ms IME 合成 = 数百次相同字符串 normalize。

### 5.2 D-05d: Variation selector removal

**Unicode reference [CITED: unicode.org/charts (general knowledge)]**：
- `U+FE00`–`U+FE0F`：Variation Selectors (16 个，VS1–VS16；emoji 用 `U+FE0F` = VS16 选择 emoji 显示)
- `U+E0100`–`U+E01EF`：Variation Selectors Supplement (240 个，主要用于 CJK Ideographic Variation Database)

**推荐 regex (JS, with Unicode flag)**：
```ts
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;
```

加在 normalize 之后、toLowerCase 之前（顺序不敏感，但合并到一处便于阅读）：
```ts
const norm = (s: string) =>
  s.normalize('NFKC').replace(VARIATION_SELECTORS, '').toLowerCase();
```

**验证用例**：
- `norm('🎉')` === `norm('🎉️')` → 都等于 `'🎉'`
- `norm('Hello')` === `'hello'` (英文不变)
- `norm('中文')` === `'中文'` (CJK 不变)
- `norm('ＡＢＣ')` === `'abc'` (全角→半角 by NFKC，再 lowercase)

### 5.3 D-06: 预 normalize 进 Map

`filterCommands` 当前每次 keystroke 都 `items.filter(c => c.name.normalize(...))`。改为 **useMemo 把 `items → Map<originalName, normalizedName>` 预计算一次**，filter 时直接 `map.get(c.name)`：

```ts
// SlashCommandPopup.tsx 内
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;
const normForFilter = (s: string) =>
  s.normalize('NFKC').replace(VARIATION_SELECTORS, '').toLowerCase();

// 在 useMemo 中预计算 normalized 字典（items 变化时才重建）
const normalizedMap = useMemo(() => {
  const m = new Map<string, string>();
  for (const c of displayCommands) {
    m.set(c.name, normForFilter(c.name));
  }
  return m;
}, [displayCommands]);

const filtered = useMemo(() => {
  const normalizedQuery = normForFilter(query);
  if (!normalizedQuery) return displayCommands.slice();
  return displayCommands.filter((c) => {
    const name = normalizedMap.get(c.name) ?? normForFilter(c.name); // fallback safety
    return name.includes(normalizedQuery) || ('/' + name).includes(normalizedQuery);
  });
}, [query, displayCommands, normalizedMap]);
```

**性能边界**：N=50 commands × 5 keystrokes/sec = 50 normalize × 1 次（建表）+ 5 keystrokes × 50 Map.get（O(1)）= **少 4.4× CPU**。在 N=500 commands 时收益更大。

**测试要点**：
- `vi.spyOn(String.prototype, 'normalize')` 不易（global API）；改测 normalizedMap 输出 + filtered 行为。
- 关键边界：`displayCommands` 变化时 normalizedMap 必须刷新；新 commands 缺少 entry 时 fallback 不抛错。

---

## 6. MCP Skeleton Spinner

### 6.1 useCommandRegistry 状态机扩展 (D-07..D-12)

**当前** `useCommandRegistry.ts:46`：`const [loading, setLoading] = useState(false)`

**Phase 8 改造**：
```ts
type RegistryLoadingState = 'idle' | 'pending' | 'slow' | 'ready' | 'error';
const [loading, setLoading] = useState<RegistryLoadingState>('idle');

const reload = useCallback(() => {
  if (!projectId || !agentId) { /* idle 不变 */ return; }
  setLoading('pending');

  // D-07: 500ms 阈值 setTimeout
  const slowTimer = setTimeout(() => {
    setLoading((prev) => (prev === 'pending' ? 'slow' : prev));
  }, 500);

  api.list(projectId, agentId)
    .then((result) => {
      clearTimeout(slowTimer);
      // ... existing setState
      setLoading('ready');
    })
    .catch(() => {
      clearTimeout(slowTimer);
      // D-11: 静默切换 mcp_health_warning（由 Phase 6 已有 setWarnings 路径处理）
      setWarnings([{ type: 'mcp_health_warning', message: 'MCP 工具加载失败' }]);
      setLoading('error');
    });
}, [projectId, agentId]);
```

**API 公开**：`{ commands, conflicts, warnings, loading, reload }` —— 改 `loading` 为 enum 而非 boolean。注意 **breaking change**：检查所有消费方。
**[VERIFIED: grep "registry\.loading" src/]** → 0 命中，目前没有人读 loading，可以安全改类型。

### 6.2 cmdk Command.Loading 集成 [CITED: github.com/pacocoursey/cmdk]

cmdk 文档：
> "Loading `[cmdk-loading]`. You should conditionally render this with `progress` while loading asynchronous items."

```tsx
<Command.List>
  {loading === 'slow' && (
    <Command.Loading>
      <div data-testid="mcp-skeleton" className="flex items-center gap-2 px-2 py-1.5 select-none">
        <Skeleton className="h-3 w-12 rounded" />
        <Skeleton className="h-3 w-24 rounded" />
      </div>
    </Command.Loading>
  )}
  {hasMcpWarning && (/* Phase 6 existing row */)}
  {filtered.map((c) => /* Phase 6 existing rows */)}
</Command.List>
```

**触发条件**（与 D-09 / D-10 锁定）：
- 显示：`loading === 'slow'`（500ms 仍 pending）
- 消失：`loading` 转为 `'ready'` (IPC OK) 或 `'error'` (IPC reject → Phase 6 `mcp_health_warning` 行接管)

### 6.3 shadcn Skeleton 组件 [CITED: github.com/shadcn-ui/ui registry/new-york-v4/ui/skeleton.tsx]

由于 §3.1 已确认 `skeleton.tsx` 不存在，需要在 Wave A 新建。Canonical 实现（针对 Tailwind v4 + CDF 项目无 `--color-accent` 的现状调整）：

```tsx
// src/renderer/src/components/ui/skeleton.tsx
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-[var(--color-bg-active)]', className)}
      {...props}
    />
  );
}

export { Skeleton };
```

**`bg-[var(--color-bg-active)]`** 选择理由：`--bg-active: rgba(255,255,255,0.10)` (globals.css:14) 在暗色背景 #2d2d2d 上呈现轻微 contrast，比 accent 紫色更适合 placeholder 语义（C-05 沿用 shadcn default 颜色但用项目 CSS variable 替代不存在的 `accent`）。

### 6.4 测试 (vitest + useFakeTimers)

**[VERIFIED: vitest.config.ts]** 项目已有 `environment: 'jsdom'`, `globals: true`，可直接用 `vi.useFakeTimers()`：

```ts
it('显示 skeleton 当 commands:list 超过 500ms 仍 pending', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const listMock = vi.fn(() => new Promise(() => {})); // 永不 resolve
  (window as any).electronAPI = {
    commands: { list: listMock, readProjectCommands: vi.fn(), onChanged: vi.fn(() => () => {}) },
  };
  const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
  expect(result.current.loading).toBe('pending');
  act(() => { vi.advanceTimersByTime(500); });
  expect(result.current.loading).toBe('slow');
  vi.useRealTimers();
});

it('500ms 内 IPC resolve 不进入 slow 状态', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let resolveFn!: (v: any) => void;
  const listMock = vi.fn(() => new Promise((r) => { resolveFn = r; }));
  // ... setup, mount, then within 200ms:
  act(() => { vi.advanceTimersByTime(200); resolveFn({ commands: [], conflicts: [], warnings: [] }); });
  await waitFor(() => expect(result.current.loading).toBe('ready'));
  vi.useRealTimers();
});

it('IPC reject 时 loading=error 且 warnings 含 mcp_health_warning', /* D-11 验证 */);
```

---

## 7. IME z-index Edge Case (macOS)

### 7.1 技术限制说明

- **Chromium** 在 macOS 上渲染网页内容到一个 NSWindow，z-order 受 `NSWindowLevel` 控制。
- **macOS IME 候选框**（Pinyin / Hiragana / Kana）由 `IMKCandidates` 框架管理，渲染到独立的 `NSPanel`，level 接近 `NSPopUpMenuWindowLevel` (101) 或更高。
- **Web layer** 的 `z-index: 50` 只在**同一 NSWindow 内部**有效。NSWindow 之间的 z-order 不受 CSS z-index 控制。
- → web layer **无法**渲染在 IME 候选框之上。这是 OS 级限制，**无解**（除 Apple 提供 IME composition window placement API，截至 2026-06-04 无此 API）。
- **[ASSUMED]** 未在 Phase 8 时间窗内找到 Electron / Chromium issue tracker 的官方 confirmation；上述结论基于通用平台知识。如需 100% 把柄，可在 v1.2 跟踪 chromium-reviews 邮件列表 `ime` + `nswindow` 关键字。

### 7.2 D-15 注释放置位置

**Phase 5 已知 stub** 是 `ChatArea.tsx:704-715` 的 `handleKeyDown` IME 旁路逻辑 (`isComposingKeyEvent(e)`)，以及 `ChatArea.tsx:1158-1163` 的 `<PopoverContent>` (z-50 通过 Popover.tsx:23 默认设置)。

**Phase 8 推荐注释位置**：`ChatArea.tsx` 的 `<PopoverContent>` 上面：

```tsx
{/*
  IME z-index known issue (macOS):
  PopoverContent uses z-50 (from popover.tsx:23). macOS IME candidate
  windows render in a separate NSPanel at NSPopUpMenuWindowLevel (~101),
  which sits above any web-layer z-index. There is no Chromium/Electron
  API to render above the IME panel (as of 2026-06-04).
  Workaround: press Esc once to dismiss the IME candidate; the popup
  remains visible underneath. Tracked for v1.2 if Apple ships
  IMKCandidates placement API.
*/}
<PopoverContent ...>
```

不需要任何代码改动 —— D-14 已经决定**接受**这个 issue。

### 7.3 验证策略

- **不写测试**：jsdom 不模拟 IME 候选框，无法验证 z-order；放 manual smoke test 文档即可。
- **手工验证脚本**（VERIFICATION.md 会写）：开启 macOS Pinyin，textarea 中输入 `/n`，验证 IME 候选框遮挡 popup → 按 Esc → popup 重见。

---

## 8. Chokidar Failure Degradation

### 8.1 当前 (Phase 6) [VERIFIED: chokidar-watcher.ts]

```ts
// chokidar-watcher.ts:105-107
handle.on('error', (err) => {
  log.error('[commands-watcher] chokidar error:', err);
});
```

仅 log。chokidar.watch() 本身**未** try-catch（chokidar 3.6.0 的 watch() 是同步构造 + 异步事件发射 —— 构造期不抛，但 fs.watch 失败会以 `'error'` 事件发射，已被监听）。

### 8.2 Phase 8 改造方案

**关键观察**：chokidar 3.6.0 `watch()` 的失败模式有 2 种：
1. **构造期错误**：路径不存在 / 权限拒绝 / fs 系统级 fail → `'error'` 事件
2. **运行期错误**：EBADF / fs.watch fail → `'error'` 事件

两种都进 `handle.on('error')` 回调。Phase 8 在该回调里：
1. log（保留 Phase 6 行为）
2. 调 `onDegradedFallback(err, dir, onChange)`：
   a. 关闭 watcher (`handle.close()`)
   b. 执行 1 次 `fs.readdirSync(dir)` 触发 `onChange`（如果目录存在）
   c. push IPC `commands:fallback` event 到所有 renderer windows，payload `{ error: err.message, scope: 'system' | 'project' }`
3. 不重试 (D-19)

### 8.3 chokidar-watcher.ts 改动建议

```ts
// chokidar-watcher.ts (新增)
import fs from 'fs';

function startWatcher(
  dir: string,
  onChange: () => Promise<void>,
  scope: 'system' | 'project'
): () => void {
  let degraded = false;
  let handle: chokidar.FSWatcher | null = null;

  try {
    handle = chokidar.watch(dir, { /* existing options */ });
  } catch (err) {
    log.error(`[commands-watcher] chokidar watch threw on construction:`, err);
    void degradeAndFallback(err as Error, dir, onChange, scope);
    return () => {};
  }

  const fire = debounce(/* unchanged */, 100);
  ['add', 'change', 'unlink'].forEach((evt) => {
    handle!.on(evt, () => void fire());
  });

  handle.on('error', (err) => {
    log.error('[commands-watcher] chokidar error:', err);
    if (!degraded) {
      degraded = true;
      void handle?.close();
      handle = null;
      void degradeAndFallback(err, dir, onChange, scope);
    }
  });

  return () => { void handle?.close(); };
}

async function degradeAndFallback(
  err: Error,
  dir: string,
  onChange: () => Promise<void>,
  scope: 'system' | 'project'
) {
  // D-16: readdir 一次性扫描作为 fallback
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir);
      await onChange();
    }
  } catch (readErr) {
    log.error('[commands-watcher] readdir fallback failed:', readErr);
  }
  // D-16: push commands:fallback to renderers for toast
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send('commands:fallback', {
      error: err.message,
      scope,
    });
  });
}
```

签名变化：`watchSystemCommandsDir` / `watchProjectCommandsDir` 内部调用 `startWatcher` 时传 `scope: 'system'` / `'project'`。对外 API 不变。

### 8.4 preload bridge 扩展

```ts
// src/preload/index.ts:104 commands 命名空间内
commands: {
  list: /* unchanged */,
  readProjectCommands: /* unchanged */,
  onChanged: /* unchanged */,
  // Phase 8 新增
  onFallback: (callback: (event: any, data: { error: string; scope: 'system' | 'project' }) => void) => {
    const listener = (event: any, data: any) => callback(event, data);
    ipcRenderer.on('commands:fallback', listener);
    return () => { ipcRenderer.removeListener('commands:fallback', listener); };
  },
},
```

ElectronAPI 类型（`src/shared/types.ts`）也要补 `onFallback`。

### 8.5 useCommandRegistry 订阅 + dedup (C-04)

```ts
// useCommandRegistry.ts 新增
const toastedFingerprints = useRef(new Set<string>());

useEffect(() => {
  const api = (window as any).electronAPI?.commands;
  if (!api?.onFallback) return;
  const cleanup = api.onFallback((_event, data) => {
    const fp = `${data.scope}:${data.error}`;
    if (toastedFingerprints.current.has(fp)) return; // C-04 dedup
    toastedFingerprints.current.add(fp);
    toast.warning('项目命令热重载不可用，已降级为静态扫描', {
      description: `${data.scope === 'project' ? '项目级' : '系统级'} chokidar 监听失败：${data.error}`,
      duration: 5000,
      id: fp, // sonner 同 id 替换而非堆叠
    });
  });
  return cleanup;
}, []);
```

**[VERIFIED: github.com/emilkowalski/sonner src/state.ts]** `toast.warning(message, { id })` 是公开 API，同 id 会替换而非堆叠 —— 双重保险（Set + id）。

### 8.6 Toaster mount 前置 (Wave A)

**[VERIFIED: grep "Toaster" -r src/]** = 0 命中 —— App.tsx 完全没有 Toaster。Phase 6/7 既有 toast.warning/info/error 调用全部沉默。Wave A 必须加：

```tsx
// src/renderer/src/App.tsx
import { Toaster } from 'sonner';

// 在 return 的最后（与 <button> 同级）：
return (
  <div className={`flex h-screen bg-[var(--bg-app)] ...`}>
    {/* ... existing JSX ... */}
    <Toaster richColors position="bottom-right" theme="dark" />
  </div>
);
```

**[ASSUMED]** `theme="dark"` 适配项目暗色主题 —— sonner v2 文档说支持 'light' | 'dark' | 'system'，默认 light；本项目 globals.css 默认暗色 → 显式 dark 更稳。`richColors` 让 warning / error / info / success 各带语义色（D-16 sonner warning variant 需要这个 prop 才显眼）。

---

## 9. Validation Architecture

> nyquist_validation = `true` in `.planning/config.json` → 本节为必填项。

### Test Framework

| Property | Value |
|---|---|
| Framework | vitest (latest) + @testing-library/react ^16.0.0 + @testing-library/user-event ^14.5.0 + jsdom |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test -- src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx -t "Phase 8"` |
| Full suite command | `npm test` (vitest run) |
| Existing test count | 226 passing across Phase 6 + 7（07-02-SUMMARY.md 报告） |

### Phase Requirements → Test Map

> Phase 8 没有新 SLASH-XX 需求。Test map 以 D-XX 锁定决定为 row。

| D-ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| D-01..D-04 | Badge 文字色按 7 个 source 区分 | unit (render + class assertion) | `npm test -- SlashCommandPopup -t "applies source color class"` | ❌ Wave 0 (新加 `describe('Phase 8 source badge color')`) |
| D-05d | NFKC + variation selector 后 `/🎉` 与 `/🎉︎` 匹配一致 | unit (filterCommands) | `npm test -- SlashCommandPopup -t "filters variation-selector emoji"` | ❌ Wave 0 |
| D-06 | 预 normalize Map 在 displayCommands 变化时刷新 | unit (useMemo hook) | `npm test -- SlashCommandPopup -t "rebuilds normalized map"` | ❌ Wave 0 |
| D-07..D-09 | 500ms 未 resolve 触发 loading='slow' | unit (useFakeTimers) | `npm test -- useCommandRegistry -t "slow loading after 500ms"` | ❌ Wave 0 |
| D-10 | IPC resolve 之前到达不进入 slow | unit (useFakeTimers + resolve at 200ms) | `npm test -- useCommandRegistry -t "no slow before 500ms"` | ❌ Wave 0 |
| D-11 | IPC reject 切换 mcp_health_warning 灰行 | unit (rejected promise → warnings 含 entry) | `npm test -- useCommandRegistry -t "error fallback to warning"` | ❌ Wave 0 |
| D-12 | Skeleton 行渲染 `data-testid='mcp-skeleton'` | unit (render with loading='slow' → 查 testid) | `npm test -- SlashCommandPopup -t "renders skeleton row when loading=slow"` | ❌ Wave 0 |
| D-13..D-15 | IME z-index 注释存在（不测行为） | manual-only | manual smoke on macOS with Pinyin | n/a |
| D-16 | chokidar 'error' → readdir fallback + commands:fallback IPC push | unit (mock chokidar 'error' event → 验 send mock) | `npm test -- chokidar-watcher -t "degrades to readdir on error"` | ✅ chokidar-watcher.test.ts 已有 mock 基础设施 (Phase 6) |
| D-17 | toast.warning 单次显示 | unit (mock toast → 验 calls=1) | `npm test -- useCommandRegistry -t "toast warning on fallback"` | ❌ Wave 0 |
| D-19 | 降级后不自动重试 | unit (二次 'error' → watcher.close 不调用 chokidar.watch 第二次) | `npm test -- chokidar-watcher -t "no retry after degrade"` | ❌ Wave 0 |
| C-04 | 同 fingerprint toast 仅显示 1 次 | unit (mock toast → 两次 fallback 事件 → calls=1) | `npm test -- useCommandRegistry -t "dedupes fallback toast"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- src/renderer/src/components/SlashCommand src/renderer/src/hooks src/main/commands/chokidar-watcher.test.ts`
- **Per wave merge:** `npm test`（vitest run 全套，226+ Phase 8 新增 ≈ 240 tests）
- **Phase gate:** Full suite green + 手工 macOS IME smoke + 手工 chokidar 失败模拟（chmod 000 ~/.cdf/commands → 重启 → 验证 toast 出现）

### Wave 0 Gaps

- [ ] `src/renderer/src/components/ui/skeleton.tsx` — 新建 shadcn Skeleton (Wave A 前置)
- [ ] `src/renderer/src/App.tsx` — 加 `<Toaster />` mount (Wave A 前置，解锁 Phase 6/7 既有 toast 显示)
- [ ] `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` — 在 existing 741-line test 内新增 `describe('Phase 8')` block，含 D-01..D-04 + D-05d + D-06 + D-12 测试（~6 个新 it）
- [ ] `src/renderer/src/hooks/useCommandRegistry.test.ts` — 在 existing 92-line test 内新增 D-07..D-11 + D-17 + C-04 测试（~6 个新 it，依赖 `vi.useFakeTimers`）
- [ ] `src/main/commands/chokidar-watcher.test.ts` — 在 existing 182-line test 内新增 D-16 + D-19 测试（~3 个新 it，复用既有 FakeFSWatcher）
- [ ] **无新测试框架装包**（vitest / @testing-library/react / jsdom 已就绪）

---

## 10. Integration Points (exact line numbers + signatures)

### 10.1 新文件

| 路径 | 内容 | 行数预估 |
|---|---|---|
| `src/renderer/src/components/ui/skeleton.tsx` | shadcn Skeleton 组件（§6.3 实现） | ~12 |

### 10.2 修改文件

| 文件 | 改动 | 锚点 |
|---|---|---|
| `src/renderer/src/App.tsx` | `import { Toaster } from 'sonner'` + 在 return 最末挂载 `<Toaster richColors position="bottom-right" theme="dark" />` | App.tsx:1-16 import area + return JSX |
| `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` | (a) module-private `SOURCE_TEXT_COLOR` map (§4.2)；(b) `VARIATION_SELECTORS` regex + `normForFilter` helper (§5.2)；(c) `normalizedMap` useMemo (§5.3)；(d) `filterCommands` 改用 `normalizedMap`；(e) `<Badge>` 加 `cn(..., SOURCE_TEXT_COLOR[c.source])` (§4.3)；(f) Command.List 顶部加 `loading === 'slow' && <Command.Loading><Skeleton .../></Command.Loading>` (§6.2)；(g) `loading` prop 新增到 `SlashCommandPopupProps` | SlashCommandPopup.tsx:19-31 filterCommands；:135 Command.List；:153-155 Badge；:33-47 Props interface |
| `src/renderer/src/hooks/useCommandRegistry.ts` | (a) `loading` 类型从 `boolean` 改为 `'idle'\|'pending'\|'slow'\|'ready'\|'error'`；(b) `reload` 内加 500ms `setTimeout` (§6.1)；(c) IPC reject 写 `mcp_health_warning` 到 warnings；(d) `useEffect` 订阅 `api.onFallback` + dedup Set + toast.warning (§8.5)；(e) `RegistryState.loading` 类型更新 | useCommandRegistry.ts:13-19 RegistryState；:46 useState；:48-92 reload；:99-108 useEffect 块（chokidar 订阅旁加 fallback 订阅） |
| `src/renderer/src/components/ChatArea/ChatArea.tsx` | (a) 传 `loading={registry.loading}` 到 `<SlashCommandPopup>`；(b) 在 `<PopoverContent>` 上方加 IME z-index 注释（§7.2） | ChatArea.tsx:1158-1174 |
| `src/main/commands/chokidar-watcher.ts` | (a) `startWatcher` 加 `scope` 参数 + try-catch + `degraded` 标志 (§8.3)；(b) `degradeAndFallback` helper：readdir + BrowserWindow.send('commands:fallback')；(c) `watchSystemCommandsDir` / `watchProjectCommandsDir` 调 `startWatcher(dir, onChange, 'system'/'project')` | chokidar-watcher.ts:36-78 (2 个 export fn)；:80-112 startWatcher；新增 degradeAndFallback fn |
| `src/main/index.ts` | (无需改 —— chokidar-watcher.ts 已封装所有降级逻辑；index.ts 仍调 `watchSystemCommandsDir`) | n/a |
| `src/main/ipc-handlers.ts` | (无需改 —— ensureProjectWatcher 仍调 `watchProjectCommandsDir`，scope 参数由 chokidar-watcher.ts 内默认传 'project') | n/a |
| `src/preload/index.ts` | `commands` 命名空间新增 `onFallback(callback)` 桥（§8.4） | preload/index.ts:104-117 commands block |
| `src/shared/types.ts` | (a) `ElectronAPI.commands` interface 新增 `onFallback`；(b) (可选) export `RegistryLoadingState` 类型 | 在 ElectronAPI 类型旁；CommandSource 旁 |

### 10.3 不动文件 (Hard Do-Not-Touch)

- `src/main/runtime.ts` — Phase 7 已 Gap 2+3 锁定
- `src/main/llm.ts:306-425` — runLLMChat / streamEvents v3
- `src/main/workflow-runtime.ts`
- `LLMStreamEvent` union (`src/shared/types.ts` 内)
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` (`patches/` dir)
- Phase 5/6 popup 布局结构 (256px max-h + 7-row + Command.Item formatting) —— 只动 className，不动 JSX 结构
- `src/main/commands/command-registry.ts` / `conflict-detector.ts` / `collectors/*.ts` —— Phase 8 不动 collector 层
- `src/main/commands/project-commands.ts` —— frontmatter parser 不动

---

## 11. Pitfalls & Risks (Phase 8 specific)

### Pitfall 1: Toaster 未挂载 (CRITICAL, 现状 latent bug)

**What goes wrong:** Phase 6 useCommandRegistry.ts:71 & 78、Phase 7 dispatcher.ts:99/115/126/134 全部调 `toast.*`，但 App.tsx 完全没有 `<Toaster />` —— 这些 toast 调用静默无 UI 反馈。Phase 8 chokidar fallback toast 如不先修这个，D-16..D-19 全部失效。
**Root cause:** Phase 6/7 plan 假设 toast 会自动渲染，但 sonner v2 需要显式 `<Toaster />` 挂载（**[CITED: emilkowalski/sonner README]**）。
**Avoid:** Wave A 第一个任务必须是在 App.tsx 加 Toaster。建议加 1 个轻量 E2E-style 测试：mock toast 调用 → 确认 toast.warning 真的触发了 sonner 内部 store。
**Warning sign:** "为什么手工触发 conflict 时看不到 toast？" —— 这就是。

### Pitfall 2: Skeleton 组件不存在 (HIGH)

**What goes wrong:** CONTEXT.md 写 "已有 `src/renderer/src/components/ui/skeleton.tsx`"，实际**没有**。直接 `import { Skeleton } from '@/components/ui/skeleton'` 会 build fail。
**Root cause:** discuss-phase 阶段引用了 shadcn 默认组件清单，未核对实际 ls。
**Avoid:** Wave A 第二个任务 `pnpm dlx shadcn@latest add skeleton` 或手写 §6.3 的 12-line 实现。
**Warning sign:** `tsc --noEmit` 报 "Cannot find module '@/components/ui/skeleton'"。

### Pitfall 3: Tailwind v4 静态 class 误用 (MEDIUM)

**What goes wrong:** 写 `` `text-${source}-400` `` 这种 template literal，Tailwind v4 扫描时**只看到 `text--400`** （或根本不生成），CSS 永远不会出现 `.text-blue-400 { color: ... }`。
**Root cause:** v4 沿用 v3 的 "complete static string" 扫描机制 (**[CITED: tailwindcss.com/docs/detecting-classes-in-source-files]**)。
**Avoid:** 用 §4.2 的 `SOURCE_TEXT_COLOR: Record<CommandSource, string>` lookup map，所有 class 值都是完整字符串字面量。
**Warning sign:** "为什么 badge 颜色不显示？" —— DevTools Inspect 看 .text-blue-400 是否在 CSS 中存在。

### Pitfall 4: cmdk Command.Loading 渲染语义 (MEDIUM)

**What goes wrong:** Command.Loading 本身是**无样式**的 div with `cmdk-loading=""` attr。如果光写 `<Command.Loading />` 不带 children，看不见任何东西。
**Root cause:** cmdk 文档 (**[CITED: github.com/pacocoursey/cmdk]**) 明确："You should conditionally render this with `progress` while loading asynchronous items" —— skeleton 内容由调用方提供。
**Avoid:** 必须把 `<Skeleton>` 作为 Command.Loading 的 child。
**Warning sign:** vitest 测试 `getByTestId('mcp-skeleton')` 返回 null。

### Pitfall 5: useFakeTimers 与 IPC promise 的相互作用 (MEDIUM)

**What goes wrong:** `vi.useFakeTimers()` 默认会冻结 microtask queue。如果在 `setTimeout(slow, 500)` 之后立即 `resolve()` IPC promise，`.then` 可能在 fake time advance 之前/之后执行，导致测试不稳定。
**Root cause:** vitest 4+ 的 fake timers 不自动 advance microtasks（vi.useRealTimers 才会）。
**Avoid:** 用 `vi.useFakeTimers({ shouldAdvanceTime: true })` 或在 `vi.advanceTimersByTime()` 后 `await Promise.resolve()` 显式 flush microtasks。**[VERIFIED: vitest.config.ts]** 项目用 jsdom env，标准 microtask 行为。
**Warning sign:** 测试 sometimes-pass / sometimes-fail。

### Pitfall 6: chokidar 'error' 事件可能多次触发 (MEDIUM)

**What goes wrong:** fs 错误（如 EBADF）可能反复触发 'error' event，导致 readdir fallback 被调多次、toast 被 push 多次。
**Root cause:** chokidar 3.6.0 'error' 事件不去重。
**Avoid:** §8.3 的 `degraded` 标志（first-error wins）+ §8.5 的 dedup Set（C-04 锁定的同 fingerprint 只 toast 1 次）。双重保险。
**Warning sign:** "为什么 toast 出现 5 次？"

### Pitfall 7: BrowserWindow.getAllWindows() 在 main 进程的时机 (LOW)

**What goes wrong:** `degradeAndFallback` 可能在 `app.whenReady` 之前被触发（理论上构造期 throw），此时 BrowserWindow 可能为空 array，toast 永远不显示。
**Root cause:** Phase 6 `app.whenReady` 内调 `watchSystemCommandsDir` —— main window 尚未 ready，但 BrowserWindow.getAllWindows() 此时返回 []。
**Avoid:** Phase 8 在 fallback IPC push 时检查 `BrowserWindow.getAllWindows().length === 0` → 推迟到 `app.on('browser-window-created', ...)` 重发。但**实测概率极低**（chokidar 同步构造很快），可接受为 known race。
**Warning sign:** "重启应用后第一次 toast 没出现"。

### Pitfall 8: variation selector regex 与代理对 (LOW)

**What goes wrong:** `U+E0100`–`U+E01EF` 是 astral plane 代码点，必须用 ES2018 `u` flag + `\u{...}` 语法。如果写成 `0` (BMP escape)，JavaScript 把它解释为 `` + `0`，匹配错误。
**Root cause:** JS regex 默认不识别 astral plane，需要 `u` flag。
**Avoid:** §5.2 的 `/[︀-️\u{E0100}-\u{E01EF}]/gu` 必须带 `gu` flags。**[VERIFIED]** Node 20+ / TS 5.7+ 都支持。
**Warning sign:** Lint 警告 "Invalid Unicode escape sequence" / 测试 unicode case fail。

### Pitfall 9: IME z-index 文档可能被误读为"待修" (LOW)

**What goes wrong:** Phase 8 verifier / reviewer 看到 `// IME z-index issue` 注释，可能把它当作 P1 bug 而非 accepted limitation。
**Root cause:** "TODO" / "FIXME" 风格注释容易被自动化 sweep 工具误标。
**Avoid:** §7.2 注释开头明确 "**known issue**, **accepted as platform limitation**, **workaround:**"，避免 TODO/FIXME 字样。
**Warning sign:** Lint 报 "TODO without ticket id"。

---

## 12. Open Questions / Claude's Discretion

CONTEXT.md C-01..C-07 已锁定。本 phase 研究没有新的开放问题，但有 3 个**实施细节**留给 planner 拍板：

### Q1: Skeleton 占位的尺寸

CONTEXT.md `<specifics>` 给出 2 个尺寸方案：
- 方案 A：`<Skeleton className="h-3 w-12 rounded" />` + `<Skeleton className="h-3 w-24 rounded" />` (badge 宽 + name 宽)
- 方案 B：`<Skeleton className="h-4 w-32 rounded" />` (单条整行)

**推荐 A**：与真实 row 视觉一致（badge + name 两段），更不易引起"行高跳变"。

### Q2: 是否在 dispatcher.ts 内复用 toast dedup Set

dispatcher.ts:115 / 126 也有 toast 调用（/context 失败时）。是否在 dispatcher.ts 也维护同样的 Set 防止重复？
**推荐不做**：dispatcher 是 user-action triggered（每次按 Enter 各算一次），不像 chokidar 是 background 事件可能 burst。保持 dispatcher 简单。

### Q3: Skeleton.tsx 是否走 `pnpm dlx shadcn@latest add skeleton` CLI

CLI 会自动安装 + 写文件。但 CDF 用的是 npm + 自定义 globals.css（无 `--accent`），CLI 输出可能仍需要 patch `bg-accent` → `bg-[var(--color-bg-active)]`。
**推荐手写 12 行**（§6.3 模板），避免 CLI 副作用、依赖检查、注册表查询。

---

## Project Constraints (from CLAUDE.md)

> CLAUDE.md 项目级指令（顶层 / 项目实例）摘录与本 phase 相关条目：

- **中文响应**："Must be use Chinese." — 所有 plan / commit message / 文档全中文
- **GSD workflow 强制**：任何 Edit/Write 必须通过 GSD 命令，禁止裸编辑
- **CodeGraph 优先**：结构性问题用 codegraph，不要 grep + read loop（本研究 §4.4 / §10 已用 grep 仅为验证已知锚点，符合"specific detail after codegraph 不覆盖" 例外）
- **简洁优先（CLAUDE.md §2）**：Phase 8 polish 易诱发"顺手 polish 别的 UI"，必须严格守 surgical change 范围
- **目标驱动验证（CLAUDE.md §4）**：每个 D-XX 锁定决定都要有 verifiable test，详见 §9 Validation Architecture

### Hard "Do Not Touch" List (extends from Phase 5/6/7)

| 文件 | 原因 |
|---|---|
| `src/main/runtime.ts` | Phase 7 Gap 2+3 已 finalized；planOnly 链路已绑死 |
| `src/main/llm.ts:306-425` | runLLMChat / streamEvents v3 body |
| `src/main/workflow-runtime.ts` | 与 Phase 4 workflow runtime 解耦 |
| `LLMStreamEvent` union | M3 thinking 链路依赖 |
| `patches/@langchain+anthropic+1.4.0.patch` 6-hunk patch-package | 6-hunk 改 stream accumulator，断了 M3 全炸 |
| Phase 5/6 popup 7-row JSX 结构 | 只改 className，**不**改 Command.Item 层级 |
| `src/main/commands/command-registry.ts` + `conflict-detector.ts` + `collectors/*.ts` | Phase 6 已锁数据层；Phase 8 不动 collector |
| `src/main/commands/project-commands.ts` frontmatter parser | Phase 6 D-20 minimal parser |

---

## Sources

### Primary (HIGH confidence)
- **CDF codebase** (本 phase 全部代码引用均经 Read tool 实读验证)
  - `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` (Phase 5/6 现状)
  - `src/renderer/src/components/ui/badge.tsx` (现成 secondary variant)
  - `src/renderer/src/hooks/useCommandRegistry.ts` (Phase 6 loading boolean)
  - `src/renderer/src/components/ChatArea/ChatArea.tsx` (popover wiring + IME 旁路)
  - `src/main/commands/chokidar-watcher.ts` (Phase 6 D-23/D-24 watcher)
  - `src/main/index.ts` / `src/main/ipc-handlers.ts:782-823` (IPC handlers + chokidar init site)
  - `src/preload/index.ts:104-122` (commands + context bridge)
  - `src/renderer/src/styles/globals.css` (Tailwind v4 @theme + CSS variables)
  - `src/renderer/src/App.tsx` (Toaster mount status — VERIFIED missing)
  - `vitest.config.ts` / `package.json` (test framework + React 19 + sonner 2.0.7 + chokidar 3.6.0)
- **Tailwind CSS v4 official docs**
  - `tailwindcss.com/docs/detecting-classes-in-source-files` — 静态 class 扫描机制
  - `tailwindcss.com/docs/colors` — 默认 palette 含 blue/violet/purple/green/amber/gray
- **shadcn UI canonical Skeleton source**
  - `github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/skeleton.tsx`
- **cmdk official docs**
  - `github.com/pacocoursey/cmdk` README — Command.Loading API
- **sonner v2 source**
  - `github.com/emilkowalski/sonner/blob/main/src/state.ts` — `toast.warning` / `toast.info` 公开 API + `id` 替换语义
- **Phase 5/6/7 内部文档**
  - `.planning/phases/05-popup-shell-keyboard-spike/05-UI-SPEC.md`
  - `.planning/phases/06-4-source-command-registry-dispatcher/06-CONTEXT.md` + `06-01-SUMMARY.md`
  - `.planning/phases/07-system-commands-m3-regression-test/07-01-SUMMARY.md` + `07-02-SUMMARY.md` + `07-RESEARCH.md`

### Secondary (MEDIUM confidence)
- **Unicode variation selector 范围** — 通用 Unicode 知识；`U+FE00`–`U+FE0F` (BMP) + `U+E0100`–`U+E01EF` (supplement) 是 Unicode 标准共识，未在本 phase 时间窗内 fetch 原始 UCD 文件，但 `U+FE0F` (VS16) 是高频引用，可信
- **WCAG 对比度估算** — `§4.4` 数值用粗算（背景 #2d2d2d vs text-* 色），未跑实际 contrast checker

### Tertiary (LOW confidence)
- **macOS IME NSWindowLevel** — `§7.1` 结论基于通用平台知识 + 行业共识；未在 Apple Developer / Chromium issue tracker 上找到 explicit confirmation。标 `[ASSUMED]`。**v1.2 polish 可在 chromium-reviews `ime` + `nswindow` 关键字下追踪官方 confirmation**

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | macOS IME 候选框无法被 web layer z-index 覆盖（无 Apple API） | §7.1 D-13/D-14 | 如果 Apple 出了 IMKCandidates placement API，D-14 "接受" 决策可重审；当前 v1.1 接受为 known issue，零代码风险 |
| A2 | sonner v2 `<Toaster theme="dark" />` 默认即可适配项目暗色 | §8.6 Wave A | 视觉差异；可通过 manual smoke 校正 |
| A3 | Tailwind v4 default palette 在 CDF 项目的 globals.css 中**已经**通过 `@import "tailwindcss"` 引入了 11-step 颜色 | §4.1 | 如果项目用 `@theme inline()` 屏蔽了 default colors，badge 颜色不显示；**已验证 globals.css 未做屏蔽**，A3 风险低 |
| A4 | `useFakeTimers({ shouldAdvanceTime: true })` 在 vitest 4+ 行为稳定 | §6.4 / §9 | 测试稳定性；如有问题改用 `vi.runAllTimersAsync` |
| A5 | chokidar `'error'` 事件能可靠捕获 ENOENT / EACCES / fs.watch 失败 | §8.3 D-16 | 实测可用（Phase 6 已有 error handler）；个别罕见 fs 错误可能漏掉，但 D-19 "不重试" 锁定 → 漏掉一次即长期降级，可接受 |

---

## Metadata

**Confidence breakdown:**

- Standard stack (Tailwind v4 / sonner / cmdk / shadcn / chokidar 3.6.0 / React 19 / vitest): **HIGH** — 全部 [VERIFIED: package.json] 或 [CITED: 官方 docs]
- Architecture (Renderer-only polish + Main-to-Renderer fallback IPC): **HIGH** — 已逐文件读现状代码，改动锚点精确到行号
- Pitfalls: **HIGH** — Pitfall 1/2 是代码 grep 实证（不是推测），Pitfall 3-8 是 [CITED] 官方文档说明，Pitfall 9 是经验风险
- IME z-index 限制: **MEDIUM** — `[ASSUMED]` 标注；接受为 known limitation，零代码风险

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 (30 days；sonner / cmdk / chokidar 3.x 都是稳定 minor)
