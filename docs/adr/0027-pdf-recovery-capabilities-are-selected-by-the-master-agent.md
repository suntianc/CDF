# PDF recovery capabilities are chosen with user direction

Issue #61 recovery orchestration will let the Master Agent discover available PDF Recovery Capabilities and ask the user to choose when there are meaningful trade-offs, rather than assuming one fixed recovery executor. A recovery capability may be a multimodal model-backed Agent, a user-configured vision-capable MCP tool, a local CLI, or a future native page-analysis tool.

The first meaningful recovery-route decision should ask the user and offer to remember the choice as a project-level PDF Recovery Preference. The first slice records that preference as Agent-facing guidance in the Project `AGENTS.md`, not in a dedicated database table or settings UI. Later parsing in the same Project can reuse that preference automatically, while still asking again when the preferred capability is unavailable, the document needs a different capability class, or the plan introduces a new privacy, network, or cost risk.

The remembered preference stores a PDF Recovery Route or capability category, not a hard binding to a specific MCP server id, model id, CLI path, or provider instance. Concrete tool or provider instances are resolved at parse time from the Project's currently available capabilities.

The Master Agent owns flexible recovery planning: it reads Marker diagnostics and parse evidence, discovers viable capabilities, explains the trade-offs to the user, records the user's chosen recovery route or remembered preference, and records which capability produced each overlay. The parser module does not choose providers, call model APIs, or assume MiniMax-M3 or any other specific model as the production recovery path.
