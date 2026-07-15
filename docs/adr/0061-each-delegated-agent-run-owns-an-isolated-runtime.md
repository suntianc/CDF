# Each Delegated Agent Run owns an isolated runtime

## Status

Accepted

An Agent is reusable configuration, not a shared runtime. Every Delegated Agent Run—whether targeting the Default General-purpose Agent or a user-created Agent—creates and owns an independent model instance, child graph/runtime, checkpoint, cancellation signal, tool scheduler, and approval state. We chose per-run isolation because the same Agent may be invoked concurrently and shared model/runtime objects caused real MiniMax stream termination in the xAI documentation workload; configuration reuse must not imply mutable execution-state reuse.
