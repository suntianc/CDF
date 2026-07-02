# PDF recovery comparison traces are development-only

CDF will not retain or expose baseline-vs-recovery diffs during normal production PDF parsing. Users and downstream workflows should consume the best available Recovered Paper Parse View, with concise provenance and diagnostics, rather than comparing Marker output against recovered output.

Baseline-vs-recovery comparison is useful for CDF developers when evaluating parser quality, regression behavior, recovery prompts, and capability selection. That data belongs behind an explicit development or diagnostics switch as a PDF Recovery Comparison Trace, not in the default product state or user workflow.

Production recovery output keeps only PDF Recovery Provenance: recovery capability, source page or block, diagnostic code, and whether a metered or network route was approved. Full prompts, full provider responses, page image copies, and baseline-vs-recovery diffs are excluded unless diagnostics tracing is explicitly enabled.
