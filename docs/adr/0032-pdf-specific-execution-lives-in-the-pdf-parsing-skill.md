# PDF-specific execution lives in the PDF Parsing Skill

Issue #61 should package PDF-specific parsing and recovery execution inside the PDF Parsing Skill as `SKILL.md` plus scripts/resources, instead of expanding the global Agent Tool surface with multiple PDF-specific tools. The Skill is the domain capability; scripts are its execution helpers.

Global Agent Tools should remain lightweight and broadly reusable. PDF-specific actions such as baseline parse orchestration, recovery planning, recovery preference block updates, overlay construction, recovered-view generation, and diagnostics tracing belong behind the Skill workflow unless they prove broadly useful outside PDF parsing.

This may require refactoring the Marker-first #30 tool surface over time. Compatibility can remain during transition, but the direction for #61 is Skill-packaged PDF capability rather than adding more global PDF tools.

Issue #62 sharpens that migration direction: no PDF-specific tool should remain on the Global Agent Tool Surface, including `parse_pdf`. Baseline parsing, status, cancellation, recovery planning, recovery application, preference updates, recovered-view generation, and diagnostics tracing should move into the PDF Parsing Skill package and become invisible as ordinary global tools.
