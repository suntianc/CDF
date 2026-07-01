# PDF parsing optimizes for Agent retrieval

CDF's PDF parsing Spike should judge candidate parsers by whether they produce a Structured Paper Parse that Agents can retrieve, cite, and chunk for RAG, not by how closely the Markdown resembles the original PDF's visual layout. The production interface behind `parsePDF(filePath)` should therefore prefer preserved section order, paragraph integrity, formula/table semantics, references, and source location over human-facing Markdown polish.

If Marker and multimodal LLM parsing are both good enough for the Structured Paper Parse, CDF should prefer the offline-capable Marker path by default. A multimodal LLM parser should become the default only if the PDF Parsing Evaluation Matrix shows a clear advantage on critical semantic criteria such as formulas, tables, scanned pages, or source grounding, and its latency and cost are acceptable for routine Paper Library ingestion.

Multimodal LLM parsing should otherwise be treated as an optional enhancement or fallback path rather than a peer default for routine Paper Library ingestion. It is appropriate when Marker fails, when a scanned or visually complex paper needs recovery, or when the user explicitly requests a higher-cost reparse for a specific paper.

A Structured Paper Parse must preserve Paper Source Location metadata rather than returning only plain Markdown. The minimum source location is page number plus section or heading for each major parsed block; parser-provided bounding boxes or paragraph-level coordinates are useful enhancements but are not a first-version requirement.

The Spike should not produce production parsing code, but it must leave a Structured Paper Parse Contract example for the integration issue. The example should show how the chosen parser can map into CDF's target shape, including parsed Markdown, block-level content, block type, section, page range, and optional parser-specific location details.

The Spike report should preserve PDF Parsing Failure Samples for both candidate parser families, not only the final recommendation. Each useful failure sample should include the paper location, the expected structure, the actual parser output, and the failure type so the integration issue can convert them into regression tests or manual acceptance cases.

Closing the Spike is not complete until the selected parser, default and fallback strategy, Structured Paper Parse Contract summary, and failure sample location are handed off to the PDF parsing integration issue. If the Spike identifies a meaningful multimodal fallback path that should not be part of the first integration slice, it should be split into a follow-up issue instead of being hidden in the report.

The Spike report should live in the repository as `docs/spikes/pdf-parsing.md`. GitHub issue comments should summarize the decision and link to the document, while the document owns the durable matrix, contract example, and failure samples.

The PDF Parsing Test Corpus should be reproducible without committing academic PDF files into the repository. The Spike report should include a PDF Parsing Corpus Manifest with source links, version or download date, file hashes, parsing risk labels, and local reproduction path conventions; production tests should use legally redistributable fixtures or generated PDFs instead of copyrighted paper PDFs.

The PDF Parsing Evaluation Matrix should use a consistent rating scale instead of free-form prose in every cell. Qualitative criteria should use `pass`, `partial`, `fail`, or `n/a` plus one sentence of evidence; quantitative criteria such as speed and cost should include the measured value plus the same rating so the final recommendation is comparable across parser families.
