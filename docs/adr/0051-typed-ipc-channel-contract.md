# Typed IPC channel contract

## Status

Accepted

CDF's renderer↔main IPC goes through a single typed channel contract in `src/shared/ipc-contract.ts`: every invoke channel declares its positional argument tuple and result type in one `IpcInvokeContract` interface, static main→renderer event channels declare payloads in `IpcEventContract`, and the three dynamic per-id channels (`llm:chunk-*`, `workflow:event-*`, `agent:parallel-task-step-*`) get their names from shared typed factory functions used by both the sending and the listening side. The preload bridge calls `typedInvoke`, the main process registers handlers with `typedHandle`; both derive parameter and result types from the contract, so a wrong channel name, a wrong argument list, or a wrong return shape is a compile error. Before this, one logical IPC method was hand-written three times (preload wrapper, `ipcMain.handle` registration, and a hand-copied `ElectronAPI` interface) with `any` payloads at every layer, and the copies had already drifted (`llm:chat`).

The contract is a pure type layer. There is no runtime validation (no zod), no payload normalization, and no code generation. Positional argument tuples were kept exactly as they are on the wire; the migration changed zero runtime behavior. Contract types record what the handler actually consumes and returns — including truths the old hand-copy got wrong, such as `db:saveProvider` returning no timestamps and `llm:chat` returning `{ ok: true }` rather than `void`. Where the renderer disagreed with the handler, the renderer call site was fixed to match; runtime bugs discovered along the way were filed as issues instead of being fixed in the type migration.

`window.electronAPI`'s type is `typeof` the actual object the preload script exposes (`PreloadApi`), declared once in the renderer's `env.d.ts` via a type-only import. The 175-line hand-copied `ElectronAPI` interface was deleted. The type chain is contract → preload → window, so a structural drift between what preload exposes and what the renderer sees is no longer expressible. Preload method and namespace names were kept as-is; the contract does not force method names to equal channel names.

The type system cannot prove that every declared channel actually has a handler registered at runtime, so a registration completeness unit test locks that: it runs the main-process registration entrypoints against a mocked `ipcMain` and asserts the registered channel set equals the contract's channel list in both directions — no missing handlers, no ghost channels outside the contract. The contract file also carries a compile-time check (`_AllInvokeChannelsListed`) that the runtime channel array stays exhaustive.

Two hard-won constraints for contract authors:

- Never declare a channel's `result` as bare `unknown`. Such an entry becomes a match-all candidate for `typedHandle`'s generic inference and silently breaks object-literal narrowing at every other call site (observed on TypeScript 6.0; `NoInfer` does not prevent it). Use a concrete union instead — `store:get` uses a recursive `StoreJsonValue` for this reason.
- Renderer-global test declarations must not re-declare `electronAPI` as `any`: `window` is `Window & typeof globalThis`, so a `declare global { var electronAPI: any }` in any test file poisons the property type for the whole renderer program.

Alternatives considered and rejected: zod-per-channel runtime validation (runtime overhead, triples the migration cost, contradicts the zero-behavior-change requirement for a 103-channel refactor); generating the preload API object from the contract by naming convention (method names ≠ channel names in existing code, escape hatches needed for listener methods returning unsubscribe functions, and a generator is a new abstraction the codebase doesn't need); keeping the hand-written `ElectronAPI` interface locked with `satisfies` (still two copies to edit per channel).
