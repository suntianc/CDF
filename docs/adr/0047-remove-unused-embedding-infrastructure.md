# Remove unused embedding infrastructure after choosing agentic paper reading

## Status

Accepted

Issue #33 replaced the planned PDF-to-embedding-to-vector-retrieval path with an agentic reading funnel: Paper Entry metadata and abstract triage, on-demand Structured Paper Parse reuse, full-text reading, and citations grounded by Paper Source Location. Because no current CDF feature consumes vector indexes, issue #90 removes the embedding runtime, Settings surface, IPC/preload/types, vector storage dependency, packaging rules, and glossary terms rather than preserving a dormant future hook.

This supersedes ADR-0041 and ADR-0042. Historical spike material may still mention embedding as paper content or experiment subject, but CDF no longer treats Embedding Pipeline, Embedding Source, or Vector Index as active product concepts.
