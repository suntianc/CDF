# PDF fallback is Agent-mediated and deferred

CDF's first PDF parsing contract may include fallback options such as `none`, `agent-on-marker-failure`, and `agent-for-selected-pages`, but issue #30 will only execute the Marker path. Non-`none` fallback requests should return a clear diagnostic such as `FALLBACK_NOT_IMPLEMENTED` and point to follow-up Agent-Mediated PDF Recovery work instead of silently ignoring the option or making parser-internal model calls.

The follow-up recovery path should be mediated by a configured Agent that uses CDF's existing provider, permission, cost, and user-confirmation boundaries. The PDF parser module should supply diagnostics, page numbers, Marker output, and page-scoped artifacts for recovery; it should not hardcode MiniMax, OpenAI, Anthropic, or any other direct LLM API path.
