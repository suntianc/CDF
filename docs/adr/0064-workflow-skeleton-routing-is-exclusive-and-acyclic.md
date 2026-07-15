# Workflow Skeleton routing is exclusive and acyclic

## Status

Accepted

Workflow Skeletons may define user-authored Stage Routes with natural-language conditions. At a Stage boundary the Master Agent selects exactly one allowed route and explains the choice in its Stage Report; the main process validates only that the route is allowed, and an enabled Stage Gate approves or rejects the report and route together. Routes form an acyclic structure with no parallel Stage activation—parallel work stays in the Run Task Graph—and Gate rejection continues rework inside the current Stage rather than traversing a loop.

A branching Stage has no implicit default route. If the Master cannot responsibly select a route, the Workflow Run enters Workflow Input Wait and the Agent explains the missing information in the Conversation; the user is not exposed to route-selection internals. Authoring remains a Stage list with compact route rows under each Stage rather than returning to a node-canvas editor. Stage-level Skill/tool preferences, Gate-time pre-running, and runtime Skeleton editing remain out of scope for #133.

A valid Skeleton has the first listed Stage as its single entry, at least one explicitly marked Terminal Stage, no routes from a terminal, at least one route from every non-terminal, only existing route targets, no self-route or cycle, and no Stage unreachable from the entry. Saving rejects invalid structures before a Workflow Run can start.
