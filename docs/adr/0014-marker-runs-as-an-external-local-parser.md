# Marker runs as an external local parser

CDF's first PDF parsing integration will invoke Marker through a main-process runner, using `uvx --from marker-pdf marker_single` or a configured Marker command, instead of bundling Python, Marker, and Marker model caches inside the Electron app. This keeps issue #30 focused on the `StructuredPaperParse` contract, Agent tool access, cancellable background execution, and diagnostics while preserving a future path for a dedicated packaging/install experience.
