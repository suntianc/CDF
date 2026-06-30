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
A domain-specific mode of the Agent Workstation that determines the sidebar layout, pre-configured Agents, available Skills, and specialized panels. A Scene is chosen when creating a Project and cannot be changed afterward.
_Avoid_: mode, template, theme, workspace type

**Paper Library**:
A Scene-specific panel that manages collected academic papers — OKF metadata files, locally stored PDFs, and vector indexes for Agent retrieval.
_Avoid_: reference manager, paper database, Zotero

**Writing Project**:
A Scene-specific panel that manages the outline, drafts, and citation references for an academic document (survey or paper) being authored with Agent assistance.
_Avoid_: document editor, word processor

**Experiment Record**:
A Scene-specific panel that tracks code reproduction attempts, datasets, run configurations, and execution results tied to a research project.
_Avoid_: lab notebook, run log

**Crawler Skill**:
A Skill that encodes crawling strategy and instructions for the Obscura tool — what to extract, how to handle pagination and anti-scraping, and how to structure the output. The Skill itself contains no execution logic.
_Avoid_: scraper, spider, bot

**Obscura Browser Tool**:
An Agent Tool that uses the bundled Obscura headless browser to render pages that need a browser environment before extracting page content.
_Avoid_: browser fetch, scraper tool, crawler

**Fetch Tool**:
An Agent Tool for lightweight URL content retrieval when a browser environment is not required.
_Avoid_: browser tool, rendered page crawler
