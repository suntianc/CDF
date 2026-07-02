# PDF recovery overlays attach to existing parse jobs

Issue #61 recovery results will attach to the original PDF Parse Job and its `StructuredPaperParse` as page-scoped PDF Recovery Overlays. Recovery records selected-page or selected-block repairs, figure/table semantic descriptions, OCR corrections, diagnostics, and source evidence.

CDF will not create a second independent full-document parse for the first recovery slice. Keeping recovery as overlays preserves source grounding, avoids competing document versions, and lets later Paper Library or RAG workflows consume a single best recovered view.

Production use should not retain or expose baseline-vs-recovery diffs by default. Those comparisons are developer diagnostics for parser evaluation and recovery tuning, and should only be captured behind an explicit development or diagnostics switch.
