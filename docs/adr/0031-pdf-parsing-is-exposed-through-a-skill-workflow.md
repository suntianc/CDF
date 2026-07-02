# PDF parsing is exposed through a Skill workflow

Issue #61 should expose PDF parsing and recovery as an Agent-facing PDF Parsing Skill rather than a pile of user-facing PDF tools. From the user's point of view, the task is "parse this PDF automatically"; the Skill owns the workflow: run the Marker baseline, inspect diagnostics, create a PDF Recovery Plan, ask for recovery route preference when needed, apply recovery, and return the best recovered result.

PDF-specific execution should live in the Skill package as scripts/resources where possible, with `SKILL.md` describing when and how Agents should run them. This keeps the global Agent Tool surface lightweight and reserved for broadly reusable primitives such as file, shell, fetch, browser, and generic Agent coordination capabilities.

The product boundary is the Skill-guided workflow, not asking users or Agents to manually sequence many global PDF tools. If a low-level global tool already exists from the Marker slice, #61 should treat it as an implementation compatibility detail and prefer moving PDF-specific orchestration into the PDF Parsing Skill.
