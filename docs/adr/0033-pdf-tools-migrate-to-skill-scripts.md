# PDF tools migrate to Skill scripts

Issue #61 will migrate PDF-specific execution from the Global Agent Tool Surface into the built-in PDF Parsing Skill. The Skill should package PDF behavior as `SKILL.md` plus scripts/resources, so Agents follow one domain workflow instead of discovering and sequencing multiple PDF-specific global tools.

The migration should preserve the Marker-first parsing capability from #30 as internal application behavior while changing the product direction: `parse_pdf`, parse status, cancellation, recovery planning, preference updates, recovery application, recovered-view generation, and diagnostics tracing are PDF-domain operations and should live behind the Skill. Global tools should remain broadly reusable primitives such as file, shell, fetch, browser, and generic coordination.

The first implementation may retain shared parsing/recovery modules as Skill-internal dependencies, but `parse_pdf`, `pdf_parse_status`, and `pdf_parse_cancel` should not remain ordinary model-discoverable global tools or hidden compatibility shims. New #61 functionality should not add more global PDF tools unless a capability proves useful outside PDF parsing.

The cleanup and migration-test work is tracked separately in GitHub issue #62 so issue #61 can stay focused on recovery behavior and workflow design while #62 handles global tool deletion, Skill workflow tests, context accounting updates, and `AGENTS.md` preference-block migration coverage.
