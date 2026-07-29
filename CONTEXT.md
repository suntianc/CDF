# CDF

CDF is a local-first desktop Agent workstation where users organize tasks, context, Agents, capabilities, workflows, process, and artifacts on their own machine.

## Language

**Agent Workstation**:
A local desktop workspace for directing Agents, inspecting their process, approving actions, and preserving artifacts.
_Avoid_: chat page, SaaS dashboard

**Project**:
A local workspace rooted at a user-selected directory, with an immutable Scene and Project-owned files, instructions, Skills, knowledge, and artifacts. It hosts execution context but does not own Agent definitions.
_Avoid_: Agent container, Agent Library, mutable Scene workspace

**Project Context**:
The runtime package of a Project's identity, root directory, immutable Scene, instructions, Project Skills, local resources, and Project-scoped capability context supplied to root and delegated executions. It excludes Agent definitions, Master Agent Prompts, Conversation Snapshots, and mutable Agent Run state.
_Avoid_: Agent configuration, Conversation state, global settings

**Agent Library**:
The app-wide management surface for the global Agent catalog, independent of Project selection and Project lifecycle. It manages the protected Master and Default General-purpose identities plus user-created Custom Agents.
_Avoid_: Project Agent list, Scene Agent list

**Conversation**:
The user-visible exchange in a session, including user prompts, Agent responses, tool activity, approvals, and process status.
_Avoid_: chat log, message list

**Conversation Working State**:
The resumable, non-user-facing context that preserves Agent progress across turns for the lifetime of a Conversation and is deleted with that Conversation.
_Avoid_: checkpoint thread, Agent Run state, long-term memory

**Conversation Prompt Snapshot**:
The immutable Master Agent Prompt captured when a Conversation is created. Later edits or resets affect only new Conversations, preserving behavior and prompt-cache stability within the existing Conversation.
_Avoid_: live Master prompt, Project prompt setting, per-run prompt refresh

**Conversation Skill Snapshot**:
The immutable set of Skill identities and discovery metadata exposed when a Conversation is created. Later Scene Skill Exposure changes affect only new Conversations, and Agent Skill Preloads can select only Skills already present in the snapshot, preserving the existing Conversation's system-context shape and prompt-cache stability.
_Avoid_: live Skill catalog, Project-wide visibility, copied Skill package

**Agent**:
An app-wide, reusable identity and configuration for model-guided work, including its role and capability preferences. Its definition is shared across Projects; it is associated with a Project only when participating in an execution and does not own mutable execution state.
_Avoid_: Project-owned Agent, runtime, worker, Agent Run

**Agent Role**:
The immutable classification of an Agent as Master, Default General-purpose, or Custom. Role determines protected identity and root-versus-delegation eligibility; it is never inferred from Project ownership, default selection, or mutable configuration.
_Avoid_: is_default, Project role, editable Agent type

**Agent Run**:
One execution initiated by a Conversation instruction, ending in completion, failure, interruption by loss of its live execution context, or explicit termination; waiting for approval remains in progress. A Conversation may host many sequential Agent Runs but at most one in progress, and cannot be deleted while one is in progress.
_Avoid_: running Conversation, generation, Workflow Run

**Agent Run Termination**:
The sole user-directed stop operation, preventing future work and propagating best-effort cancellation to every Delegated Agent Run and unresolved approval owned by the parent Agent Run. It does not roll back completed side effects and cannot guarantee interruption of an external action already in progress.
_Avoid_: rollback, transactional cancellation, child stop

**Agent Run Approval Block**:
The aggregate state in which every unfinished branch of an Agent Run is waiting for a Tool Approval Decision and no work can otherwise progress. Individual approvals surface immediately even while the parent Agent Run remains running.
_Avoid_: pending approval count, hidden approval

**Delegated Agent Run**:
A child execution initiated by an Agent Run against a target Agent to perform scoped work, freezing that Agent's current global configuration and the parent's Project Context once at creation into isolated mutable execution state. Its identity and outcome remain part of Conversation history even if the Agent definition is later edited or deleted; single and parallel delegation are launch forms of the same concept.
_Avoid_: subagent, task subagent, parallel worker

**Delegated Agent Configuration Snapshot**:
The immutable, process-lifetime configuration captured when a Delegated Agent Run is created, allowing queued and active work to survive edits or deletion of its target Agent definition. It is not restart recovery state: after an application restart, a new Delegated Agent Run resolves the target Agent's latest configuration.
_Avoid_: Conversation Agent catalog snapshot, persisted subagent definition, live Agent lookup

**Delegated Run Status**:
The lifecycle state of a Delegated Agent Run: queued, running, waiting for approval, completed, failed, cancelled by termination of its parent Agent Run, or interrupted by loss of its live execution context. A Delegated Agent Run cannot be cancelled independently.
_Avoid_: generic stopped status, worker status, child stop

**Delegation Target Set**:
The stable set of global Agent identities exposed as delegation targets when a parent Agent Run starts. Agent Catalog changes appear in the next parent Agent Run, while each selected target's current configuration is frozen only when its Delegated Agent Run is created.
_Avoid_: live Agent catalog, Conversation Agent snapshot, Project Agent list

**Delegation Concurrency Window**:
The four Delegated Agent Runs a parent Agent Run may keep active at once, including runs waiting for approval. Additional delegated runs remain queued until an active run reaches a terminal state.
_Avoid_: unlimited delegation, model-call concurrency only

**Default General-purpose Agent**:
The single global, always-available, system-reserved Agent identity used as a delegation target when no specialized Agent is required. It is shared across Projects, cannot be removed or renamed, and receives the active Project Context only when launched through single or parallel delegation; it is not itself a Delegated Agent Run.
_Avoid_: Project-owned Agent, general-purpose subagent, default worker, fallback-only Agent

**Master Agent**:
The single global, persistent, protected Agent identity that leads every Conversation and Workflow Run. It is the only Agent whose prompt varies by Scene: Agent management permits editing or resetting one independent complete prompt per Scene, while every other configuration field is read-only and deletion is forbidden.
_Avoid_: Project-owned Master, optional default Agent, Scene-specific Agent identity, runtime projection, Research Agent, Delegated Agent

**Custom Agent**:
A user-created, app-wide Agent identity with a globally unique name and delegation key, used only as a delegation target for the Master Agent. Its complete configuration is shared across Projects, and each invocation combines it with the parent execution's Project Context to produce a Delegated Agent Run; it never becomes the root Agent of a Conversation or Workflow Run.
_Avoid_: duplicate Agent name, Project-specific Agent, Project override, root Agent, Workflow master, Delegated Agent Run, direct Conversation Agent

**Scene Default Prompt**:
The product-authored complete system prompt that every supported Scene must define and that supplies the reset value for that Scene's Master Agent Prompt. Scene registration and default-prompt registration are one invariant; resetting one Scene does not affect any other Scene.
_Avoid_: hidden base layer, mandatory prompt prefix, original Project prompt

**Master Agent Prompt**:
One of the complete, independently user-editable system prompts stored by the global Master Agent, selected by the active Project's Scene when a new Conversation or Workflow Run is created. Each begins from its Scene Default Prompt, may replace any part of it, and is neither a shared base-plus-overlay nor automatically merged with product changes.
_Avoid_: Project-owned prompt, additive instructions, prompt overlay, immutable Scene prompt

**Global Skill**:
A CDF Built-in Skill or user-global Skill managed outside any one Project and made available across Projects through product-level configuration. Global Skills require Scene Skill Exposure because they are not inherently scoped to one Project Scene; dormant Enterprise sources are outside the first delivery.
_Avoid_: Project Skill, globally enabled Skill, built-in-only Skill

**Project Skill**:
A Skill discovered from a Project's own files, including its primary, nested, and Project-configured additional Skill directories, and therefore already scoped to that Project and its immutable Scene. It is neither listed nor configured in product-level Skill UI.
_Avoid_: Global Skill, Scene-disabled Skill, product-managed Skill

**Scene Skill Exposure**:
A user-configurable switch on each Global Skill for every supported Scene, controlling whether that Skill is exposed in Projects of that Scene. CDF supplies planned defaults for Built-in Skills, user-global Skills default to all Scenes, and the switch set expands as Scenes are added; it never applies to Project Skills or binds Agents to Scenes.
_Avoid_: Agent Scene binding, Project Skill setting, installation state, tool permission

**Scene Skill Set**:
The Skills available within a Project: every Project Skill plus the Global Skills whose Scene Skill Exposure is enabled for the Project's Scene. Skill-authored invocation metadata still applies, but there are no user, Project, or Agent visibility overrides.
_Avoid_: Agent Skill list, installed Skills, tool grant, built-in-only list

**Delegated Approval Wait**:
The state in which one Delegated Agent Run pauses without timeout for a tool decision while sibling Delegated Agent Runs may continue. Its parent delegation remains in progress; unlike a Stage Gate, it does not pause the whole Workflow Run.
_Avoid_: global approval pause, Stage Gate, approval timeout

**Conversation Approval Set**:
The unresolved tool decisions belonging to one active Agent Run and its Delegated Agent Runs, ordered for presentation but independently resolvable. It is not a FIFO queue and may contain approvals from several delegated executions.
_Avoid_: approval queue, pending approval

**Approval History**:
The read-only record of resolved or invalidated Tool Approval Decisions, their owning Agent Runs, action summaries, timestamps, and resulting execution outcomes. Decisions leave the Conversation Approval Set after resolution or execution interruption but remain explainable in their Delegated Agent Run history.
_Avoid_: pending approval archive, actionable history

**Tool Approval Decision**:
A user's approve or reject response to one gated tool action. An approved action becomes independently eligible to execute, while rejection returns a standard rejection observation without terminating its Agent Run or blocking approved sibling actions.
_Avoid_: run rejection, task cancellation, batch approval, rejection feedback

**Tool Action Batch**:
The tool actions proposed by one Agent in a single reasoning turn. Actions that already have permission may execute immediately, gated actions resolve through that Agent Run's Active Tool Approval, and the next reasoning turn waits until every action in the batch has resolved.
_Avoid_: approval batch, combined tool decision

**Active Tool Approval**:
The earliest unresolved gated action currently presented for one Agent Run. Each Delegated Agent Run has at most one Active Tool Approval and advances through its actions in proposal order, while approvals belonging to different delegated executions remain independently resolvable.
_Avoid_: global approval dialog, batch approval card

**Delegated Permission Context**:
The approval policy of a Delegated Agent Run, inherited unchanged from its parent Agent Run's Conversation Approval Mode. Agent configuration may narrow tool visibility but cannot alter approval behavior.
_Avoid_: worker approval mode, Agent permission override

**Conversation Approval Mode**:
The user-selected approval policy for an Agent Run and every Delegated Agent Run it starts: strict, Agent-decides, or bypass. It is the single approval-mode decision for the full execution tree.
_Avoid_: per-Agent approval mode, worker mode

**Agent Tool Scope**:
The subset of its parent Agent Run's available tools that a target Agent may use. With no explicit selection it inherits the full parent scope; an explicit selection narrows built-in tools individually and MCP capabilities by server, and can never introduce a capability unavailable to the parent.
_Avoid_: tool grant, child-only tool, MCP addition, per-MCP-tool binding

**Delegated Run Continuation**:
The resumption of a paused Delegated Agent Run with its captured configuration while the hosting application process remains alive. After a restart, the prior execution is interrupted; any later delegation from the restored Conversation starts a new run from the target Agent's latest configuration while preserving that Conversation's Prompt and Skill Snapshots.
_Avoid_: task resurrection, process recovery, Agent catalog snapshot

**Delegated Failure Isolation**:
The rule that failure of one Delegated Agent Run terminates only that execution while sibling delegated executions continue. The parent delegation aggregates all child outcomes unless the parent Agent Run itself is terminated.
_Avoid_: fail-fast delegation batch, cascading child failure

**Conversation Timeline Projection**:
The user-visible ordering of Conversation events as a readable timeline of messages, tool activity, folded process, streaming state, and approvals.
_Avoid_: message list mapping, transcript renderer

**Conversation Runtime Projection**:
The user-visible state derived from an Agent run while a Conversation is active, including streaming progress, tool activity, approvals, delegated work, parallel worker summaries, transient plans, completion, failure, and retry affordances.
_Avoid_: stream handler, session store event reducer, runtime UI state

**Conversation Runtime Registry**:
The per-Conversation registry of in-progress runtime projections and terminal projections not yet reconciled with durable Conversation history, including background Conversations that are not currently visible. A Conversation has at most one in-progress Agent Run, while different Conversations may run concurrently.
_Avoid_: active-session streaming cache, global streaming state, session store cache

**Runtime Stream Projection**:
The main-process translation of an Agent run's raw runtime stream — reasoning and text tokens, tool boundaries, delegated work, subagent output, turn ends — into the Conversation event stream the renderer consumes, deciding think-block folding, text backpressure, delegated-task correlation, and turn completion versus approval hand-off.
_Avoid_: runLLMChat internals, stream loop, iterator glue

**Activity Panel Projection**:
The user-visible projection of Agent runtime activity into a panel view, including run status, tool activity, approvals, delegated work, and parallel worker summaries.
_Avoid_: task panel state, activity UI props

**Conversation Viewport Surface**:
The shared visual surface for displaying a Conversation, responsible for switching between the master Conversation, delegated task views, and parallel worker views, and for rendering projected timeline items, transient status, and view-local banners.
_Avoid_: chat area, messages viewport, conversation renderer

**Conversation Welcome Surface**:
The pre-Conversation visual surface shown before a Conversation is active, responsible for presenting welcome copy, the Welcome Composer Input, entry actions, project and setup shortcuts, and pre-Conversation status or error affordances.
_Avoid_: welcome page, empty chat, landing page

**Conversation Composer Dock**:
The active Conversation bottom dock that hosts the Session Composer Input, transient plan progress, model and approval controls, and generation controls.
_Avoid_: input panel, bottom composer, chat composer bar

**Conversation Plan Disclosure**:
The view-local disclosure state for a Conversation's transient plan, including whether current plan progress is visible, expanded, or cleared after completion.
_Avoid_: todo state, plan UI logic, task list toggle

**Conversation Workspace Shell**:
The page-level shell that wires Project, Conversation, Composer, model, command, runtime, and viewport dependencies into the Conversation surfaces without owning their domain rules.
_Avoid_: ChatArea business logic, chat page, conversation controller

**Model Selection Surface**:
The shared Composer Input surface for choosing the model used by a Conversation instruction, including provider groups, model candidates, current-selection display, empty-provider affordance, and dropdown interaction.
_Avoid_: model dropdown, provider picker, model selector

**Conversation Draft Name**:
The initial Conversation name derived from a Welcome Composer Input before the Conversation exists.
_Avoid_: sessionName, welcome title, draft text title

**Composer Input**:
The interactive input surface where a user prepares an instruction before it becomes a Conversation event.
_Avoid_: textarea, prompt box

**Command Entry**:
A Composer Input form that routes the user's instruction through a named command or capability instead of a plain Conversation send.
_Avoid_: slash token, slash text

**Path Mention**:
A Composer Input reference to a project-local file or directory that remains visible in the instruction as a local path mention.
_Avoid_: at token, file pill

**Composer Attachment**:
Media or other local context attached while preparing a Composer Input instruction before it becomes part of a Conversation event.
_Avoid_: pasted image, imageBase64

**Composer Input Surface**:
The shared visual shell for Composer Input, responsible for rendering the input surface, popovers, leading tokens, attachment previews, and event wiring while delegating input behavior to the Composer Input controller.
_Avoid_: composer business logic, send handler

**Composer Submission**:
The orchestration that turns a prepared Composer Input intent into a Conversation or Command Entry side effect.
_Avoid_: send handler, submit button logic, composer UI

**Scene**:
A domain-specific mode of a Project that determines its Scene Workspace, pre-configured Agents, available Skills, and specialized panels. A Scene is chosen when creating a Project and cannot be changed afterward. The project navigation sidebar stays uniform across Scenes; only the workspace to its right changes.
_Avoid_: mode, template, theme, workspace type, sidebar layout

**Scene Workspace**:
The main working surface shown for the selected Project, determined by its Scene. The general Scene's workspace is the existing Conversation workspace; other Scenes add specialized panels around or alongside the Conversation.
_Avoid_: main view, page, layout mode

**Editable Flow Diagram**:
A user-visible, Project-owned Excalidraw document composed of independently editable shapes, text, and connectors that serves as the shared source for Agent generation and user editing. Subsequent Agent changes apply to the current document rather than regenerating a separate copy; the capability is available across Scenes.
_Avoid_: Scientific Figure, generated image, flattened flowchart, hidden artifact, Research Scene tool

**Flow Diagram Document Version**:
An opaque identity of the exact current contents of an Editable Flow Diagram, used to detect whether a save or Agent edit is still based on that document. It is not ordered and does not represent history.
_Avoid_: Flow Diagram Revision, timestamp, save counter, version number, Project commit

**Flow Diagram Revision**:
A durable snapshot of an Editable Flow Diagram captured immediately before an Agent modifies it and retained independently of the user's Project version control. It is available to Agent operations and automatic recovery without exposing version management or manual rollback controls to the user.
_Avoid_: Project commit, copied backup file, Excalidraw undo entry, user-facing version history, full-Project snapshot

**Research Workflow**:
The Research Scene progression from collecting papers into the Knowledge Base, through source-grounded reading, to user authoring and finally Agent-assisted review of a Manuscript.
_Avoid_: chat workflow, Workflow Skeleton, literature review only

**Skill**:
A progressive-disclosure capability package that teaches an Agent a specialized workflow, domain practice, or operating discipline. Visible Skills are discoverable by default; an Agent's Skill selection emphasizes or preloads a Skill rather than defining the full access boundary.
_Avoid_: plugin, tool, command

**Built-in Skill**:
A Skill distributed and maintained as part of CDF, with behavior, security, and upgrades owned by CDF even when adapted from a third-party source. Adapted Skills retain their upstream provenance and required license notices but do not depend on runtime installation from upstream.
_Avoid_: bundled third-party dependency, runtime-installed Skill, copied upstream Skill

**Skill Preload**:
An Agent-level emphasis that loads a selected Global Skill's full instructions at Agent startup. Project Skills cannot be stored in an app-wide Agent configuration; they remain discoverable from the active Project at runtime, and preload does not grant or deny access to any Skill.
_Avoid_: Project Skill binding, whitelist, permission

**MCP Server Exclusion**:
An Agent-level rule that hides specific MCP servers from an Agent. Configured MCP servers are visible to every Agent by default; an exclusion is the exception, not a grant. MCP tools have no progressive disclosure or partial-visibility states.
_Avoid_: MCP binding, MCP whitelist, MCP mount, agent MCP selection

**Connected Account**:
A user-authorized external account or subscription route that CDF may use for provider-hosted capabilities through OAuth, browser login state, CLI/token-plan auth, or another account-level authorization flow. It owns login/logout, account identity, authorization scope, token refresh, subscription or plan status, account health, and the account's declared or discovered subscription capabilities. It is the aggregation boundary for subscription/product capabilities and is separate from API-key/base-URL LLM model configuration.
_Avoid_: LLM provider, model provider, API key entry, tool config

**LLM Provider**:
An app-wide API-key/base-URL text model integration that CDF may use for Conversation and Agent reasoning, including API key, base URL, local model runtime, available text models, default text model, and context limit. It remains the accepted name for CDF's existing model-provider configuration. An LLM Provider may also be the authorization source for API-backed capability routes, but it is not a subscription/product capability aggregation surface and is separate from Connected Account login state.
_Avoid_: connected account, OAuth login, capability connection, tool config

**Capability Connection**:
A configured app-wide route that makes one CDF capability usable through a specific authorization source, such as a Connected Account, API key, local runtime, or future provider integration. Multiple Capability Connections may exist for the same capability, and runtime selection may consider the current Conversation model context, explicit user choice, availability, quota, privacy, cost, or task fit.
_Avoid_: account, API key, model provider, LLM provider, tool config

**Background Capability Job**:
A durable execution of a registered long-running capability request that continues independently of the Agent Run that submitted it and later reports structured progress and completion back to its originating Conversation. Its originating Conversation cannot be deleted while the job is non-terminal.
_Avoid_: background tool call, detached Agent Run, provider task

**Provider Task**:
A provider-owned asynchronous operation created while executing a Background Capability Job. Its provider task ID and lifecycle remain internal to the Capability Adapter and are distinct from the CDF job identity.
_Avoid_: background capability job, CDF job, Agent task

**Capability Profile**:
The declared or discovered set of capabilities available through one authorization source or subscription plan, such as text chat, image generation, image editing, speech synthesis, video generation, music generation, search, or quota status. Capability Profiles describe what an account, LLM Provider, token plan, or local runtime can offer; Capability Connections turn those offers into callable CDF capability routes.
_Avoid_: tool list, provider type, model list, subscription label

**Capability Adapter**:
A provider-facing implementation of a CDF capability that translates the shared capability request and result shape into one provider, account type, token plan, or local runtime. It is hidden behind the public Agent Tool for that capability.
_Avoid_: public tool, provider tool, model provider, account

**Capability Route Hint**:
An optional preference passed with a public Agent Tool call to express the user's requested capability source category, such as Gemini, Grok, Codex, MiniMax token plan, or automatic selection. It is a routing hint, not provider-specific tool parameters and not a guarantee that the route is available.
_Avoid_: provider parameters, default provider, active provider, hardcoded adapter

**Capability Availability Surface**:
A Settings surface attached to the owning source settings for inspecting and managing capability route health. In the first version, subscription/account-backed capability availability appears inside the AI Subscription Surface, API-backed capability availability appears inside LLM Provider details, and local/MCP-backed capability availability appears inside Tools and MCP; it is not a standalone top-level page and is not the source of truth for manually asserting provider capabilities.
_Avoid_: manual capability checklist, provider settings page, tool list, model selector

**AI Subscription Surface**:
The user-facing Settings tab for subscription-backed or account-backed AI capabilities. It presents each supported subscription entrypoint as an expandable card, showing only the subscription name and period usage summary by default; the expanded card shows the subscription's capability switch list.
_Avoid_: Connected Accounts page, OAuth settings page, provider capability checklist

**Paper Library**:
A Scene-specific panel that manages collected academic papers — OKF metadata files and locally stored PDFs, with full text reached on demand through Structured Paper Parses.
_Avoid_: reference manager, paper database, Zotero, vector index

**Local Review Corpus**:
The Paper Entries in the current Project whose authorized PDFs have already been collected locally and are therefore eligible as reference evidence during Manuscript review. It excludes live web results and model-recalled literature.
_Avoid_: online search results, global literature corpus, model knowledge

**Review Evidence Funnel**:
The offline path from metadata and abstract triage over the Local Review Corpus to on-demand parse reuse and selective reading of relevant source sections. It does not build or query a full-text retrieval index.
_Avoid_: reading every paper, vector search, online literature search

**Review Evidence Set**:
The exact local evidence used by one Review Simulation: its Manuscript Snapshot, the Paper Entries and source sections actually consulted, and any experiment records explicitly supplied by the user. Evidence not present in this set is not represented as verified.
_Avoid_: entire Knowledge Base, model knowledge, implied experiment access

**Structured Paper Parse**:
A Markdown representation of an academic PDF optimized for Agent retrieval and citation grounding, preserving semantic structure and source location over visual fidelity.
_Avoid_: PDF preview, layout clone, pretty Markdown export

**Structured Paper Parse Contract**:
The target output shape for PDF parsing integration, describing parsed Markdown plus block-level content and Paper Source Location metadata.
_Avoid_: parser API, Markdown format, report template

**Marker Parser Runner**:
The main-process boundary that invokes the locally available Marker command to produce a Structured Paper Parse. It is not an embedded CDF parser distribution.
_Avoid_: bundled parser, PDF engine, Marker integration

**PDF Parse Job**:
A cancellable background execution of a PDF parse request that may outlive the Agent tool call that started it.
_Avoid_: parser promise, blocking parse call, conversion task

**Local PDF Input**:
An absolute path to a readable PDF on the user's machine that a PDF parsing capability may consume without first importing it into the Project.
_Avoid_: project file, Paper Library item, attachment

**PDF Parse Diagnostic**:
A structured signal emitted by a PDF parse attempt, combining severity, stable code, message, and optional page information so Agents can decide whether to retry, narrow the page range, warn the user, or request fallback work.
_Avoid_: log line, parser stderr, free-text warning

**Agent-Mediated PDF Recovery**:
A later PDF recovery path where a configured Agent uses project-approved model providers and page-scoped parser evidence to repair or enrich selected PDF parse results.
_Avoid_: hardcoded LLM API fallback, parser-internal model call, silent reparse

**PDF Recovery Overlay**:
A page-scoped repair or enrichment attached to an existing Structured Paper Parse, recording recovered text, figure or table semantics, diagnostics, and source evidence for selected pages or blocks. Production use keeps the best recovered result and provenance, not a user-facing baseline-vs-recovery diff.
_Avoid_: second full parse, replacement document, fallback parse

**Recovered Paper Parse View**:
A read-time merged view of a baseline Structured Paper Parse plus its PDF Recovery Overlays, intended as the clean input for downstream chunking, indexing, review, or writing workflows. It does not create a second parse record and does not write a RAG index by itself.
_Avoid_: recovered parse record, vector index, duplicate document

**PDF Parse Artifact**:
A project-local file artifact under CDF's `.cdf` area that stores the durable output of a PDF parsing run, such as parse metadata, recovered Markdown, diagnostics, overlays, and provenance. It is not a Paper Library import and does not imply vector indexing.
_Avoid_: paper record, vector index entry, conversation transcript

**PDF Recovery Comparison Trace**:
A developer-only diagnostic artifact that records baseline-vs-recovery differences for parser evaluation, regression analysis, and recovery-strategy tuning. It is disabled in normal production use unless a development or diagnostics switch is explicitly enabled.
_Avoid_: user-facing diff, production recovery state, audit requirement

**PDF Recovery Provenance**:
The minimal production metadata that explains where recovered content came from: the recovery capability, source page or block, diagnostic code, and whether a metered or network route was user-approved. It excludes full prompts, full model responses, baseline-vs-recovery diffs, and page image copies by default.
_Avoid_: prompt log, response transcript, page image archive, comparison trace

**PDF Recovery Plan**:
An Agent-generated plan that selects which pages or blocks need recovery after a baseline PDF parse, based on parser diagnostics, source grounding gaps, and expected value. The user asks for automatic PDF parsing; page selection is an internal recovery-planning step.
_Avoid_: manual page selection, user page-picking workflow, parser retry loop

**PDF Recovery Capability**:
Any Agent-accessible capability that can repair or enrich weak PDF parse evidence, such as a multimodal model provider, a vision-capable MCP tool, a local CLI, or a future native page-analysis tool. The Master Agent discovers viable capabilities and asks the user to choose when meaningful trade-offs exist instead of assuming one fixed model path.
_Avoid_: hardcoded fallback model, fixed recovery provider, parser-owned LLM call

**PDF Parsing Skill**:
An Agent-facing workflow Skill packaged as `SKILL.md` plus supporting scripts/resources, guiding automatic PDF parsing from a user's single intent: run the Marker baseline, inspect diagnostics, plan recovery, ask for route preference when needed, apply recovery, and return the best recovered result. It keeps PDF-specific execution behind the Skill instead of expanding the global Agent Tool surface.
_Avoid_: pile of global PDF tools, parser-only command, manual recovery checklist

**PDF Parse Skill Script**:
A shell-executed script or supporting resource packaged inside the PDF Parsing Skill. These scripts are thin entrypoints into CDF's compiled PDF Skill CLI for baseline parsing, recovery planning, AGENTS.md preference updates, recovery application, and recovered-view finalization. They are not globally visible Agent Tools and do not expose cross-process status/cancel controls.
_Avoid_: global parse_pdf tool, parser command, PDF tool suite, script-local parser rewrite

**Global Agent Tool Surface**:
The small set of broadly reusable tools exposed to Agents across tasks, such as file, shell, fetch, browser, and generic coordination primitives. Domain-specific workflows should prefer Skills with scripts/resources instead of expanding this surface.
_Avoid_: domain tool pile, workflow-specific tool menu, feature-specific global command set

**PDF Recovery Preference**:
A project-level remembered user direction for how CDF should choose among viable PDF Recovery Capabilities after the first recovery-route decision. It is recorded as Agent-facing guidance in the Project `AGENTS.md`, letting later automatic PDF parsing in the same Project reuse the user's preferred route unless the preference is unavailable, unsafe for the current document, or the recovery plan introduces a new privacy, network, or cost risk.
_Avoid_: asking every time, hidden provider choice, one-off prompt answer

**PDF Recovery Route**:
A stable preference category for recovery capability selection, such as local-first, vision-capability, multimodal-agent, or ask-each-time. A route guides the Master Agent's choice without hard-binding recovery to a specific MCP server, model name, CLI path, or provider instance.
_Avoid_: provider id, model id, tool instance id, executable path

**Paper Source Location**:
The traceable location attached to parsed paper content so an Agent can point back to the original PDF, at minimum page number plus section or heading.
_Avoid_: citation string, markdown anchor, display position

**PDF Parsing Test Corpus**:
A small set of academic PDFs selected to cover parsing risks such as columns, language, formulas, tables, figures, references, and scan quality.
_Avoid_: topic sample, benchmark dataset, reading list

**PDF Parsing Corpus Manifest**:
The reproducibility record for the PDF Parsing Test Corpus, listing each paper's source, version or download date, hash, parsing risk labels, and local reproduction path without committing the PDF itself.
_Avoid_: checked-in fixture set, paper folder, bibliography

**PDF Parsing Evaluation Matrix**:
The Spike report artifact that records each parser's evidence-backed performance across the PDF Parsing Test Corpus and parsing criteria.
_Avoid_: summary verdict, benchmark score, parser ranking

**PDF Parsing Failure Sample**:
A concrete parser failure captured during the Spike, including the original paper location, expected structure, actual output, and failure type.
_Avoid_: bug report, fixture, error log

**PDF Parsing Spike Report**:
The repository document that records the PDF parsing Spike's corpus, evaluation matrix, output contract example, failure samples, recommendation, and handoff notes.
_Avoid_: issue comment, experiment notes, parser docs

**Knowledge Base**:
A project-local collection of Knowledge Entries managed by CDF under the Project's local `.cdf` area and stored in Open Knowledge Format so they remain human-browsable and Agent-readable.
_Avoid_: database, wiki, corpus

**Knowledge Entry**:
A Markdown document with YAML frontmatter that represents one OKF concept document in a Knowledge Base.
_Avoid_: note, record, file

**Paper Entry**:
A Knowledge Entry whose OKF concept type is Paper, representing one collected academic paper with its title, authors, abstract, origin source, tags, bibliographic fields (journal, volume, issue, pages, year, DOI), an optional Journal Metrics Snapshot, and an optional pointer to a locally stored PDF. The Paper Library shows exactly the Paper Entries of a Project's Knowledge Base.
_Avoid_: note about a paper, PDF file, reference string

**Journal Metrics Snapshot**:
Journal-level standing (impact factor, CAS tier, JCR quartile, indexing status) copied into a Paper Entry at collection time, always carrying the metric year and data source. The metrics belong to the journal, not the paper; the snapshot exists so the Paper Library can display, filter, and group papers without a join, and it may go stale until refreshed.
_Avoid_: paper score, live journal ranking, per-paper citation metric

**Bundled Paper Search CLI**:
The version-pinned third-party paper-search CLI shipped with CDF that executes paper metadata search, journal metrics lookup, and open-access PDF discovery for the Paper Search and Paper Collection Skills, driven through Skill-guided shell calls. Its supported config keys are entered in CDF Research Config and synced into the CLI's own 0600 config file; its Sci-Hub fallback is never enabled. The Skills' strategy is the stable interface — the engine is swappable.
_Avoid_: journal_metrics Agent Tool, hand-built registry client, Sci-Hub route

**Paper Search Skill**:
A built-in Skill that only searches and presents candidate academic papers: it runs metadata discovery, enriches candidates with Journal Metrics Snapshots, writes `<projectPath>/.cdf/paper-collection-cache/latest.json` plus `<projectPath>/.cdf/paper-collection-cache/index.json` as a project-local disk cache, and then stops for user selection. It never downloads PDFs and never creates Paper Entries; paid or no-open-PDF candidates are routed to Paper Collection Skill Mode B after the user obtains an authorized local PDF.
_Avoid_: paper importer, downloader, reference manager

**Paper Collection Skill**:
A built-in Skill that imports papers into the Paper Library after the user has supplied a resource. Mode A imports selected candidates from the Paper Search cache, reusing cached Journal Metrics Snapshots and downloading only open-access PDFs. Mode B imports a user-provided authorized PDF under `.cdf/knowledge/papers/`, reconciles metadata with the latest cache when possible, and then creates the Paper Entry. It marks consumed cache payloads and can recover archived payloads from `<projectPath>/.cdf/paper-collection-cache/archive/` after the 30 minute threshold.
_Avoid_: discovery skill, paper search, reference manager

**Paper Reading Skill**:
A built-in strategy-only Skill that guides an Agent from Paper Entries to full text: metadata and abstract triage, on-demand parsing through the PDF Parsing Skill with artifact reuse, full-text reading, and citing with Paper Source Location. It introduces no index and no background pipeline.
_Avoid_: RAG system, semantic search, vector retrieval, paper importer

**Manuscript**:
A user-authored academic draft presented to CDF for analysis or evaluation. CDF may analyze it and propose revisions but does not author or directly modify it; Paper Entries remain reference sources that may support the review.
_Avoid_: Paper Entry, collected paper, reference paper

**Manuscript Snapshot**:
The exact version of a Manuscript examined by one Skill invocation, identified by the explicit input-file manifest and content hashes captured for that invocation. It is an identity record, not a copied document or persistent Manuscript entity.
_Avoid_: latest draft, file path alone, manuscript copy

**Manuscript Source Location**:
A traceable location within a Manuscript Snapshot: file path, line range, and section for text sources, or page and section for PDF sources. A finding about an omission instead records the manuscript scope checked rather than claiming support from one passage.
_Avoid_: Paper Source Location, citation string, vague paragraph reference

**Manuscript Review Skill**:
A built-in Skill for examining a Manuscript Snapshot through one of two explicit modes: Manuscript Summary or Review Simulation.
_Avoid_: Paper Analysis Skill, paper audit, Stage review

**Manuscript Summary**:
A source-grounded description of what a Manuscript claims, does, finds, and acknowledges as limitations, without judging publication suitability.
_Avoid_: quick review, acceptance assessment, abstract rewrite

**Bundled Venue Guidance**:
The venue-category expectations adapted into CDF from the selected upstream review resources and versioned with the Manuscript Review Skill. It is offline guidance rather than a live or authoritative statement of a specific journal's current policy.
_Avoid_: official journal policy, live reviewer rubric, venue database

**Review Context**:
The Conversation-scoped target venue explicitly stated by the user for Review Simulation, reused until the user changes it and discarded with the Conversation. It is guidance, not a Project default or a mandatory setup step.
_Avoid_: Project venue, remembered preference, forced review wizard

**Review Standard**:
The evaluation baseline used by a Review Simulation: Bundled Venue Guidance selected from the Review Context when applicable, otherwise the Manuscript Review Skill's generic cross-disciplinary criteria.
_Avoid_: guaranteed venue policy, publication threshold, reviewer preference

**Review Dimension**:
One of the five user-visible perspectives in a Review Simulation: contribution, methodological rigor, experimental evidence, writing and presentation, or related work and citations.
_Avoid_: score category, review stage, checklist item

**Cross-cutting Review Check**:
A concern applied wherever relevant across Review Dimensions, including reproducibility, transparency, ethics, reporting standards, figure integrity, and whether conclusions exceed the evidence.
_Avoid_: sixth Review Dimension, separate review mode, venue score

**Simulated Editorial Recommendation**:
The Review Simulation's `accept`, `minor revisions`, `major revisions`, or `reject` severity summary under its stated Review Standard, determined by the most consequential revision required rather than a count or numerical score. It communicates revision scale and is neither a publication prediction nor a real editorial decision.
_Avoid_: acceptance probability, actual decision, authoritative verdict

**Review Simulation**:
An Agent-generated evaluation of a Manuscript from a reviewer perspective, using a stated Review Standard and Simulated Editorial Recommendation without representing itself as genuine peer review by independent domain experts.
_Avoid_: Peer Review, deep summary, paper score, Stage Gate review

**Report Language**:
The language used for Agent-authored explanations in Manuscript Review Reports and Style Revision Reports, taken from an explicit user preference when present and otherwise from the system environment. Source quotations and English Revision Proposals retain the Manuscript language.
_Avoid_: automatic Manuscript translation, Conversation-language guess, fixed English report

**Manuscript Review Report**:
A durable Markdown artifact produced for one Manuscript Snapshot, recording the Review Standard, Review Evidence Set, source-grounded findings, revision guidance, and any Simulated Editorial Recommendation without overwriting earlier reports.
_Avoid_: Conversation response, live review state, edited Manuscript

**Academic Style Revision Skill**:
A built-in Skill that proposes style-only revisions for an English-language, user-authored Manuscript or selected passage to reduce formulaic expression and improve academic readability while preserving claims, terminology, evidence, and citations. It neither detects AI authorship nor promises to evade AI detectors, and it never modifies its source text directly.
_Avoid_: humanizer, AI detector, detector bypass, translation, content rewriting

**Style Signal**:
A heuristic indication that English academic prose may be formulaic, vague, repetitive, or mechanically structured. A signal is neither evidence of AI authorship nor an automatic requirement to rewrite the passage.
_Avoid_: AI detection result, violation, rewrite trigger, score

**Protected Manuscript Element**:
Any factual or syntactic element a style-only revision must preserve exactly or semantically, including quantities, units, formulas, technical identifiers, citations, experimental conditions, uncertainty, negation, and claim strength. When preservation cannot be assured, the passage remains unchanged and is flagged for the user.
_Avoid_: optional wording, stylistic preference, content to embellish

**Full Manuscript Coverage**:
The report status earned only when every expected section in a Manuscript Snapshot has been processed, including section-level inspection and a cross-section consistency pass. Unreadable, failed, skipped, or truncated sections prevent this status and must be disclosed.
_Avoid_: file opened, partial review, silent truncation

**Revision Scope**:
The explicitly selected portion of a Manuscript Snapshot inspected by the Academic Style Revision Skill, either the full Manuscript or specified passages. Full scope means every passage is checked, not that every passage is rewritten.
_Avoid_: rewrite volume, implicit latest draft, automatic replacement range

**Revision Proposal**:
A source-located explanation and candidate rewrite offered by the Academic Style Revision Skill for optional author adoption. It is advisory text, not an approved replacement or final Manuscript content.
_Avoid_: final copy, automatic edit, authorial decision

**Style Revision Report**:
A durable Markdown artifact that presents source-located original passages beside Revision Proposals and their rationale, allowing the user to choose what to apply without changing the Manuscript.
_Avoid_: rewritten Manuscript, automatic patch, detector report

**Crawler Skill**:
A built-in Skill that encodes crawling strategy — target description, extraction rules, link discovery, pagination, and anti-scraping handling — by orchestrating the Obscura Browser Tool's structured read operations. The Skill carries strategy and instructions only, no execution logic and no wrapper scripts; page fetching and extraction run through the tool, not shell.
_Avoid_: scraper, spider, bot, shell-driven CLI

**Obscura Browser Tool**:
An Agent Tool that uses the bundled Obscura headless browser for single-page read operations: rendering page content (markdown/text/html) and extracting the page's links, cookies, and asset URLs as structured results. Batch crawling, page scripting (`--eval`), and stateful sessions are out of scope.
_Avoid_: browser fetch, scraper tool, crawler

**Fetch Tool**:
An Agent Tool for lightweight URL content retrieval when a browser environment is not required.
_Avoid_: browser tool, rendered page crawler

**Workflow Skeleton**:
A user-authored set of Stages with one entry, explicit terminal Stages, exclusive acyclic Stage Routes, and optional Stage Gates that constrain a Workflow Run. It is frozen as a snapshot when a run starts; edits affect only future runs.
_Avoid_: flowchart, node graph, DAG editor

**Stage**:
One unit of a Workflow Skeleton: a name, a task description, acceptance criteria, and a gate toggle. Iteration, review depth, and per-item processing remain natural-language task semantics rather than new Stage kinds.
_Avoid_: node, step, node kind

**Stage Route**:
A user-authored allowed transition from one Stage to another, carrying a natural-language condition within an acyclic route structure. It constrains where the Master Agent may advance without requiring the main process to interpret the condition.
_Avoid_: executable condition, workflow edge, branch node, Stage loop

**Stage Route Selection**:
The Master Agent's exclusive choice of one allowed Stage Route at a Stage boundary, supported by the Stage Report and a rationale. The main process validates route membership, while an enabled Stage Gate lets the user accept or reject the report and selection together; parallel work remains inside the Run Task Graph rather than activating several Stages.
_Avoid_: condition evaluation, automatic branch expression, parallel Stage activation

**Stage Route Blocker**:
The condition in which the Master Agent cannot responsibly select an allowed Stage Route. The current Stage stays active while the Agent explains the missing information in the Conversation and waits for user input, without exposing route internals or inventing a fallback route.
_Avoid_: default route, route chooser, routing error

**Terminal Stage**:
A Stage explicitly marked to complete the Workflow Run after its report and optional human approval. It has no Stage Routes and is distinct from an accidentally incomplete Stage with no configured next step.
_Avoid_: missing route, implicit endpoint

**Workflow Input Wait**:
The non-terminal state of a Workflow Run paused for ordinary user information rather than a Stage Gate decision. The user's next Conversation instruction continues the current Stage.
_Avoid_: waiting gate, failed Workflow Run

**Stage Rework**:
The continuation of the current Stage after its Stage Gate rejects a submitted Stage Report. Rework keeps the Stage active until a later report is approved and does not traverse a Stage Route or create a workflow loop.
_Avoid_: Stage loop, route rollback, new Stage visit

**Stage Gate**:
The human approval boundary at the end of a Stage: the run pauses on the Stage Report and the user approves, sends it back with feedback, or aborts the run. A closed gate still records its Stage Report and passes automatically. While a gate is pending, the run is fully paused — no pre-running the next Stage.
_Avoid_: review node, approval node

**Stage Report**:
The structured completion report a Workflow Run's master Agent submits at a Stage boundary: a self-assessment against the acceptance criteria, the produced artifacts, and the final state of the Stage's tasks in the Run Task Graph. Generated whether or not the gate is open.
_Avoid_: chat summary, stage log

**Workflow Run**:
One execution of a Workflow Skeleton, hosted as a Conversation and driven end-to-end by the Project's Master Agent, which delegates Stage work to other Agents. It reuses Conversation infrastructure — resume, stream projection, approvals — rather than a separate execution engine or user-selectable root Agent.
_Avoid_: workflow execution, node run, custom Workflow master

**Run Task Graph**:
The dependency graph of tasks the master Agent explicitly creates and updates during a Workflow Run, persisted as first-class main-process data and including planned-but-unstarted tasks. Task state advances through its link to delegated subagent work.
_Avoid_: todo list, subtask list, inferred DAG

**Workflow Run Projection**:
The two-layer react-flow projection of a Workflow Run — outer Workflow Skeleton progress and inner Run Task Graph — serving as the run's primary view, with the Conversation timeline as drill-down.
_Avoid_: workflow editor view, minimap
