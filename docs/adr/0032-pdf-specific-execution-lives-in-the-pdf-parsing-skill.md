# PDF-specific execution lives in the PDF Parsing Skill

Issue #61 should package PDF-specific parsing and recovery execution inside the PDF Parsing Skill as `SKILL.md` plus scripts/resources, instead of expanding the global Agent Tool surface with multiple PDF-specific tools. The Skill is the domain capability; scripts are its execution helpers.

Global Agent Tools should remain lightweight and broadly reusable. PDF-specific actions such as baseline parse orchestration, recovery planning, recovery preference block updates, overlay construction, recovered-view generation, and diagnostics tracing belong behind the Skill workflow unless they prove broadly useful outside PDF parsing.

This may require refactoring the Marker-first #30 tool surface over time. Compatibility can remain during transition, but the direction for #61 is Skill-packaged PDF capability rather than adding more global PDF tools.

Issue #61 includes that migration direction: PDF-specific global tools from the first Marker slice should be moved behind, hidden by, or treated as compatibility internals of the PDF Parsing Skill. The user-facing and Agent-facing primary entry point should be the Skill workflow, with scripts such as baseline parsing, recovery planning, recovery application, preference updates, recovered-view generation, and diagnostics tracing living inside the Skill package.
