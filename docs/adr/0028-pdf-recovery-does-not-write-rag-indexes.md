# PDF recovery does not write RAG indexes

Issue #61 will produce a `StructuredPaperParse` plus PDF Recovery Overlays, and may expose a Recovered Paper Parse View for downstream consumers, but it will not automatically write recovered content into a RAG or vector index. Parsing, recovery, durable paper-library storage, chunking, and retrieval indexing remain separate workflow boundaries.

Keeping indexing out of the first recovery slice lets later Paper Library or RAG work define how the Recovered Paper Parse View should be chunked, embedded, versioned, cited, and refreshed without forcing those policies into the PDF parser or recovery orchestrator.
