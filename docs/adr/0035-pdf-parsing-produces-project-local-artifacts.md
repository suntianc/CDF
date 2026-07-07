# PDF parsing produces project-local artifacts

Issue #61 will write PDF parsing results as project-local PDF Parse Artifacts under CDF's `.cdf` area, such as `.cdf/pdf-parses/<parse-id>/`. The artifact may contain parse metadata, the recovered Markdown view, diagnostics, overlays, and minimal provenance.

The Conversation should summarize the result and point to the artifact rather than streaming a large parse JSON into the timeline. A PDF Parse Artifact is not a Paper Library import, does not create a paper metadata record by itself, and does not write any retrieval index. Later Paper Library and Paper Reading Skill workflows consume these artifacts explicitly through lookup-first agentic reading.

The artifact should not copy the original PDF by default. It records source metadata such as absolute source path, file size, SHA-256 hash, and parse timestamp. If a user chooses to import the PDF into the Paper Library, the Paper Library workflow owns durable PDF storage.

Artifact directories should use a stable, sortable id derived from parse timestamp plus source hash prefix, for example `.cdf/pdf-parses/2026-07-02T153000Z-bdfaa68d/`. Titles are not used for artifact ids because they may be unavailable before parsing, long, duplicated, or filesystem-hostile.

Issue #61 does not automatically clean old PDF Parse Artifacts. After issue #33 chose agentic paper reading instead of a prebuilt retrieval index, these artifacts remain the source-of-truth parse output for on-demand reuse by the PDF Parsing Skill and Paper Reading Skill. CDF should not compact, archive, or remove them automatically.

PDF Parse Artifacts are local work products and should be gitignored by default, for example `.cdf/pdf-parses/`. They may contain full paper text, recovered content, provider-derived text, and large diagnostics artifacts. In contrast, the concise PDF Recovery Preference block in `AGENTS.md` is project guidance and may be committed when the Project wants to share that preference with collaborators.

Issue #61 should ensure this ignore behavior through Project initialization or the PDF Parsing Skill workflow, rather than relying only on this repository's root `.gitignore`. When a Project uses PDF parsing artifacts, CDF should make sure `.cdf/pdf-parses/` is ignored in that Project unless the user deliberately opts into another sharing/export path.
