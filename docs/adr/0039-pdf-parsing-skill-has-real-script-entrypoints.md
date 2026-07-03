# PDF Parsing Skill has real script entrypoints

Issue #62 will expose the already-built PDF parsing and recovery logic through real Skill scripts/resources rather than leaving the Skill as instructions around removed global tools. The script surface is baseline parse, Marker preparation, recovery-plan refresh, preference set/clear, recovery application, and recovered-view finalization, so tests can prove the Skill workflow covers the behavior formerly exposed through `parse_pdf`, `pdf_parse_status`, `pdf_parse_cancel`, and recovery helpers.

These scripts should be thin entrypoints over the existing internal shared parsing/recovery modules, not a rewrite of PDF behavior. They should run through existing generic Agent capabilities such as shell and file tools, not through a new Skill script runner, new IPC surface, or new global PDF tools; the Agent-facing entrypoint remains the PDF Parsing Skill package.

ADR 0040 records the execution-channel decision: scripts dispatch through a compiled CDF CLI, and status/cancel are not exposed as Skill scripts because the shell-launched process cannot reliably observe or cancel the Electron main process in-memory job registry.

The old deepagent PDF tool wrapper should be deleted rather than repurposed as a hidden compatibility layer. Shared parsing code belongs in internal modules; Agent-accessible PDF orchestration belongs in Skill scripts/resources.

PDF Skill scripts/resources should not be counted as always-on Global Agent Tool Surface cost. Only the minimal Skill discovery metadata participates in the normal Skill discovery path; script contents and PDF-specific execution details stay out of context accounting unless the Skill workflow explicitly reads or returns them during execution.

Issue #62 is an entrypoint and migration-test cleanup only. It should not change PDF parsing or recovery business semantics such as artifact layout, recovery-plan triggers, route-selection rules, overlay provenance, recovered-view merging, or rerun conditions.

The migration tests should explicitly prove the old tool names are gone from the Agent-facing surface: built-in tool creation, mirrored context-aggregator schemas, token-accounting breakdowns, and deepagent tool registration must not expose `parse_pdf`, `pdf_parse_status`, or `pdf_parse_cancel`. Separate tests should prove the PDF Parsing Skill catalog and packaged resources expose the replacement script entrypoints.

Tests that previously asserted the three PDF global tools were exposed should be deleted or rewritten as Skill workflow tests. The internal parser tests should stay on the shared parsing module, but no test should preserve the old global tool names as a compatibility contract.
