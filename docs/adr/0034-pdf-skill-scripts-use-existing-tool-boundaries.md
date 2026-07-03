# PDF Skill scripts use existing tool boundaries

Issue #61 will not add a dedicated Skill script runner. PDF Parsing Skill scripts should be executed through the existing generic Agent capabilities, especially shell and file tools, with `SKILL.md` describing the correct script entry points, arguments, outputs, and safety rules.

This keeps the Global Agent Tool Surface small and avoids introducing a second execution system just for PDF parsing. The Skill package owns PDF-specific workflow and scripts; existing generic tools provide the execution boundary.

Issue #62 requires these to be real packaged script/resource entry points, not only prose in `SKILL.md`, so migration tests can exercise the PDF Parsing Skill workflow directly.
