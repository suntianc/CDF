# PDF tools migrate to Skill scripts

Issue #61 will migrate PDF-specific execution from the Global Agent Tool Surface into the built-in PDF Parsing Skill. The Skill should package PDF behavior as `SKILL.md` plus scripts/resources, so Agents follow one domain workflow instead of discovering and sequencing multiple PDF-specific global tools.

The migration should keep compatibility with the Marker-first #30 implementation while changing the product direction: `parse_pdf`, parse status, cancellation, recovery planning, preference updates, recovery application, recovered-view generation, and diagnostics tracing are PDF-domain operations and should live behind the Skill where possible. Global tools should remain broadly reusable primitives such as file, shell, fetch, browser, and generic coordination.

The first implementation may retain existing global PDF tools as hidden or compatibility shims while the Skill scripts call the shared parsing module directly. New #61 functionality should not add more global PDF tools unless a capability proves useful outside PDF parsing.

The cleanup and migration-test work is tracked separately in GitHub issue #62 so issue #61 can stay focused on recovery behavior and workflow design while #62 handles global tool hiding, compatibility tests, Skill workflow tests, context accounting updates, and `AGENTS.md` preference-block migration coverage.
