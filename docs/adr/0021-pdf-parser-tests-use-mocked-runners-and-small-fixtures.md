# PDF parser tests use mocked runners and small fixtures

CDF's first PDF parsing tests will validate the production contract with mocked Marker runners and small committed fixtures rather than committing the Spike's academic PDF corpus or requiring live Marker model execution in CI. The real corpus from `.planning/pdf-parsing/corpus/` remains useful for local/manual acceptance, while automated tests cover mapping, diagnostics, fallback-not-implemented behavior, and PDF Parse Job timeout, status, and cancellation paths.
