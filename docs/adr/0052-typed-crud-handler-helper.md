# typedCrud handler helper

## Status

Accepted

CDF's main-process IPC registration in `src/main/ipc-handlers.ts` mixes two kinds of residents under one closure: shallow CRUD hand-offs (`db:deleteSession` is one `DELETE` statement with no transformation) and the real invariants the file actually protects (path-traversal whitelists in `commands:readBody`, the slug self-collision carve-out in `db:saveAgent`, image validation in `db:saveMessage`, the EasyScholar key migration, the default-Agent selection for new sessions, OAuth URL opening in `aiSubscriptions:startLogin`). The contract-completeness test catches the registered-channel set but the implementation stack of 1,328 lines puts both kinds of handler at the same depth, so the most important logic is the hardest to find. New channels get added next to the trivial ones; reviewers can't tell which lines they need to read carefully.

`typedCrud` is a single helper that absorbs the shallow case. It accepts one channel name plus exactly one of `read` / `write` / `remove` callbacks — providing zero or more than one throws at registration time, so a channel can never silently register as a no-op (an empty handler would make the contract-completeness test blind to a missing implementation). Each callback receives only the contract args — no `db` handle in the call signature; the inline callback in `ipc-handlers.ts` closes over the module's `db` binding directly. The helper registers the channel through `typedHandle` (ADR-0051) so the contract still gates the channel name, args, and result type. The helper deliberately does not know SQL, does not know the row shape, and does not know about field post-processing: anything beyond "one prepared statement, run, return" stays as a hand-written `typedHandle` call.

The first batch — `db:deleteProject`, `db:deleteSession`, `db:deleteMessage`, `db:deleteProvider` — demonstrates the contract: each handler shrinks from a 3-line `typedHandle` block to a 5-line `typedCrud` call whose body is the literal SQL. A new channel that fits the pattern is one helper call; a new channel that doesn't fit stays a hand-written `typedHandle` block, where the next reader can see the invariant instead of scanning a CRUD one-liner.

The contract-completeness test from #106 stays the source of truth: the registered-channel set must equal the contract's channel list in both directions. `typedCrud` registers through `typedHandle` so the test never needs to be aware of the helper.

Excluded from the helper by design: any handler that does field masking (`db:getProviders` re-projects `api_key` to `'••••••••'`), JSON reparsing (`db:getMessages` rehydrates `imageBase64` from `image_data`), write-then-return post-processing (`db:renameProject` returns a synthesized row, `db:createProject` triggers `initializeScenePreset` and filesystem side-effects), or anything that combines multiple SQL statements (`db:setActiveProvider` runs two UPDATEs). These stay as hand-written `typedHandle` calls — that's where the real invariants live, and the helper exists precisely to make them visible by removing the noise around them.

Alternatives considered and rejected:

- A helper that takes inline SQL: rejected because it puts SQL into the IPC layer, widening the access surface and making the helper responsible for column shape mapping.
- A per-entity factory (`projectsCrud()`, `sessionsCrud()`, ...): rejected as eight small functions that share zero behavior across domains; the only shared part is the channel-to-callback dispatch.
- A schema-aware helper that auto-generates CRUD from table metadata: rejected as reinventing a domain layer inside the IPC layer for channels whose whole body is one prepared statement.
- A `read` + `write` + `remove` single call that always registers three handlers: rejected because the user-supplied `read` for `db:deleteSession` would have to be a no-op, and the helper would have to invent "skip the read on a delete-only channel" semantics. The single-callback-per-typedCrud-invocation shape is what the contract really is.

The dead seam `agentInstances` Map (line 928, written by `deepagents:createAgent` and never read) is removed in the third batch of this refactor — the `deepagents:createAgent` channel becomes a thin `typedHandle` that returns a generated `agentId` without keeping the instance anywhere.
