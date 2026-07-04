# PDF recovery capability viability is agent-judged

Issue #69 landed `discoverPdfRecoveryCapabilities` with an `--runtime-metadata <jsonFile>` contract and keyword heuristics (`mcpToolLooksVisionCapable`, `agentModelLooksMultimodal`) so the script could adjudicate route viability from agent-reported tool/model metadata. That design — briefly recorded as an earlier version of this ADR — is overturned before implementation of issue #71 began. The Master Agent reading its own tool descriptions is strictly better judgment than a keyword regex re-deriving the same conclusion from a JSON snapshot, and the metadata contract's only purpose was to let weaker code repeat what the agent already knew.

The replacement splits judgment by who can see what:

- **The script keeps probing `local-first`** — Marker availability is a real in-process probe (`marker --help`), deterministic and owned by the script. An agent-supplied `local-first` claim is ignored (with an info diagnostic) so the probe cannot be bypassed.
- **The Agent judges `vision-capability` and `multimodal-agent`** from its own visible tool list (post-#70/ADR 0044 that list is the full ground truth) and its own model modality, and passes the verdict as a plain `--viable-routes` list — the runtime-metadata JSON contract is deleted.
- **The script keeps the deterministic envelope** that serves ADR 0026/0027: preference resolution against the viable set (a stored route preference that is no longer viable re-asks the user), plan-confirmation gating on route risks, route-option privacy/cost text templates, next actions when the viable set is empty, and input diagnostics: absent `--viable-routes` degrades to marker-only probing with an info diagnostic (not-evaluated is distinct from not-viable), unknown route values are skipped with a warning diagnostic.

SKILL.md guidance gives the Agent judgment *semantics*, not a judgment *algorithm*: what each route category requires (a visible tool that accepts image input; a currently configured model that accepts images), one-line category clarifications, and the asymmetric-consequence principle (when unsure, omit — a missed route resurfaces through next actions, while a falsely claimed route fails at execution and wastes the user's choice and confirmation). No keyword lists, no checklists.

Considered and rejected:

- **Agent-reported metadata JSON + script heuristic adjudication** (the overturned original): duplicates the agent's knowledge into a fragile per-invocation JSON layer so a regex can re-judge it; all of the contract-hardening work it required bought no better verdicts.
- **Runtime metadata producer** (the original #69 follow-up): still rejected for the same reasons as before — stale-file lifetime and concurrent-run clobbering problems for state the agent already has.
- **Full prompt-only judgment**: dropping the deterministic envelope too. Rejected — confirmation gating, preference re-asking, and no-capability next actions remain tested library behavior, not prompt behavior.

Consequence: offer consistency for vision/multimodal routes now rests on prompt behavior — an accepted trade-off; execution failures still degrade to diagnostics (ADR 0036), and CDF still maintains no model-capability table in the runtime. Issue #71 is rescoped to this design.
