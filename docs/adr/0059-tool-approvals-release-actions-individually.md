# Tool approvals release actions individually

## Status

Accepted

CDF authorizes each gated tool action independently: approving one action makes it eligible to execute without waiting for decisions on sibling actions, and rejecting one action neither terminates the Agent Run nor suppresses approved siblings. The Agent's next reasoning turn still waits for every action from that Tool Action Batch to resolve. We chose per-action release over LangChain's batch interrupt because mixed approve/reject decisions must not cause approved work to be discarded, and because it matches Claude Agent SDK's per-tool permission interface.

## Consequences

The delegated runtime needs a per-action permission and execution scheduler rather than relying directly on one LangChain `decisions[]` resume. Each Agent Run presents at most its earliest unresolved gated action; after that action is approved, edited, or rejected and resolved, the next gated sibling becomes active. Different Delegated Agent Runs keep independent active approvals and may execute approved state-changing actions concurrently; #139 introduces no project-wide write lock. The scheduler must preserve stable tool-call identity, prevent duplicate side effects, isolate rejection results, and aggregate the full batch of results before returning control to the model.
