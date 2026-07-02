# PDF parsing produces project-local artifacts

Issue #61 will write PDF parsing results as project-local PDF Parse Artifacts under CDF's `.cdf` area, such as `.cdf/pdf-parses/<parse-id>/`. The artifact may contain parse metadata, the recovered Markdown view, diagnostics, overlays, and minimal provenance.

The Conversation should summarize the result and point to the artifact rather than streaming a large parse JSON into the timeline. A PDF Parse Artifact is not a Paper Library import, does not create a paper metadata record by itself, and does not write a RAG or vector index. Later Paper Library and RAG workflows can consume these artifacts explicitly.

The artifact should not copy the original PDF by default. It records source metadata such as absolute source path, file size, SHA-256 hash, and parse timestamp. If a user chooses to import the PDF into the Paper Library, the Paper Library workflow owns durable PDF storage.

Artifact directories should use a stable, sortable id derived from parse timestamp plus source hash prefix, for example `.cdf/pdf-parses/2026-07-02T153000Z-bdfaa68d/`. Titles are not used for artifact ids because they may be unavailable before parsing, long, duplicated, or filesystem-hostile.

Issue #61 does not automatically clean old PDF Parse Artifacts. Artifact retention becomes part of the downstream RAG/Paper Library workflow: once issue #33 consumes artifacts for chunking, embedding, and retrieval indexing, it must define whether the artifact remains the source-of-truth parse output, can be compacted, can be archived, or can be safely removed after derived indexes are refreshed.

PDF Parse Artifacts are local work products and should be gitignored by default, for example `.cdf/pdf-parses/`. They may contain full paper text, recovered content, provider-derived text, and large diagnostics artifacts. In contrast, the concise PDF Recovery Preference block in `AGENTS.md` is project guidance and may be committed when the Project wants to share that preference with collaborators.

Issue #61 should ensure this ignore behavior through Project initialization or the PDF Parsing Skill workflow, rather than relying only on this repository's root `.gitignore`. When a Project uses PDF parsing artifacts, CDF should make sure `.cdf/pdf-parses/` is ignored in that Project unless the user deliberately opts into another sharing/export path.
