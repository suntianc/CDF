# PDF recovery does not write RAG indexes

Issue #61 will produce a `StructuredPaperParse` plus PDF Recovery Overlays, and may expose a Recovered Paper Parse View for downstream consumers, but it will not automatically write recovered content into any retrieval index. Parsing, recovery, durable paper-library storage, and Paper Reading Skill consumption remain separate workflow boundaries.

After issue #33 chose agentic paper reading and issue #90 removed the unused retrieval infrastructure, the Recovered Paper Parse View is consumed on demand by Skills and Agents as source-grounded text. The PDF parser and recovery orchestrator keep producing parse evidence rather than reserving placeholder paths for derived retrieval stores.
