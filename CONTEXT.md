# CDF

CDF is a local-first desktop Agent workstation where users organize tasks, context, Agents, capabilities, workflows, process, and artifacts on their own machine.

## Language

**Agent Workstation**:
A local desktop workspace for directing Agents, inspecting their process, approving actions, and preserving artifacts.
_Avoid_: chat page, SaaS dashboard

**Conversation**:
The user-visible exchange in a session, including user prompts, Agent responses, tool activity, approvals, and process status.
_Avoid_: chat log, message list

**Conversation Timeline Projection**:
The user-visible ordering of Conversation events as a readable timeline of messages, tool activity, folded process, streaming state, and approvals.
_Avoid_: message list mapping, transcript renderer

**Conversation Runtime Projection**:
The user-visible state derived from an Agent run while a Conversation is active, including streaming progress, tool activity, approvals, delegated work, parallel worker summaries, transient plans, completion, failure, and retry affordances.
_Avoid_: stream handler, session store event reducer, runtime UI state

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

**Skill**:
A progressive-disclosure capability package that teaches an Agent a specialized workflow, domain practice, or operating discipline. Visible Skills are discoverable by default; an Agent's Skill selection emphasizes or preloads a Skill rather than defining the full access boundary.
_Avoid_: plugin, tool, command

**Skill Override**:
A visibility rule that changes how a Skill is exposed to an Agent: `on`, `name-only`, `user-invocable-only`, or `off`.
_Avoid_: binding, permission, install state

**Skill Preload**:
An Agent-level emphasis that loads a selected Skill's full instructions at Agent startup. It does not grant or deny access to the Skill.
_Avoid_: binding, whitelist, permission

**MCP Server Exclusion**:
An Agent-level rule that hides specific MCP servers from an Agent. Configured MCP servers are visible to every Agent by default; an exclusion is the exception, not a grant. Distinct from Skill Override — MCP tools have no progressive disclosure, so there are no partial-visibility states.
_Avoid_: MCP binding, MCP whitelist, MCP mount, agent MCP selection

**Paper Library**:
A Scene-specific panel that manages collected academic papers — OKF metadata files and locally stored PDFs, with full text reached on demand through Structured Paper Parses.
_Avoid_: reference manager, paper database, Zotero, vector index

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

**Embedding Pipeline**:
The content-agnostic infrastructure that turns caller-provided text into vectors and stores/queries them. It does not chunk documents and has no knowledge of what the text means; chunking belongs to its consumers.
_Avoid_: RAG system, semantic search feature, indexer

**Embedding Source**:
The model that produces vectors: either the bundled-by-download local model or a cloud embedding API reusing a configured LLM provider's credentials. Chosen explicitly in settings; never switched implicitly.
_Avoid_: provider, backend, auto-detected API

**Vector Index**:
A per-project, rebuildable derived cache of vectors stored in the project's `.cdf` area. Every Vector Index is bound to the single Embedding Source model that created it; queries embed with that same model, and changing Embedding Source requires an explicit, user-confirmed rebuild.
_Avoid_: vector database, source of truth, mixed-model index

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

**Writing Project**:
A Scene-specific panel that manages the outline, drafts, and citation references for an academic document (survey or paper) being authored with Agent assistance.
_Avoid_: document editor, word processor

**Experiment Record**:
A Scene-specific panel that tracks code reproduction attempts, datasets, run configurations, and execution results tied to a research project.
_Avoid_: lab notebook, run log

**Crawler Skill**:
A built-in Skill that encodes crawling strategy — target description, extraction rules, link discovery, pagination, and anti-scraping handling — by orchestrating the Obscura Browser Tool's structured read operations. The Skill carries strategy and instructions only, no execution logic and no wrapper scripts; page fetching and extraction run through the tool, not shell.
_Avoid_: scraper, spider, bot, shell-driven CLI

**Obscura Browser Tool**:
An Agent Tool that uses the bundled Obscura headless browser for single-page read operations: rendering page content (markdown/text/html) and extracting the page's links, cookies, and asset URLs as structured results. Batch crawling, page scripting (`--eval`), and stateful sessions are out of scope.
_Avoid_: browser fetch, scraper tool, crawler

**Fetch Tool**:
An Agent Tool for lightweight URL content retrieval when a browser environment is not required.
_Avoid_: browser tool, rendered page crawler
