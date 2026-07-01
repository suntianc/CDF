# PDF parse jobs do not cache full results first

CDF's first PDF parsing integration will keep `StructuredPaperParse` as the Agent tool result rather than introducing a long-term cache for full parsed Markdown and block content. PDF Parse Jobs may persist minimal metadata and diagnostics so running, failed, canceled, or lost jobs remain explainable, but Paper Library storage, RAG indexing, and parse-result cache invalidation are deferred until those workflows define their own needs.
