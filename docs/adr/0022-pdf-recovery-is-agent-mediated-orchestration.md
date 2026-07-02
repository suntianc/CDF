# PDF recovery is Agent-mediated orchestration

Issue #61 will implement PDF recovery as Agent-mediated orchestration rather than parser-internal LLM fallback. Marker remains the default parser path; recovery is triggered by parser failure, timeout, weak diagnostics, or an explicit user request for higher-cost visual repair.

The parser module supplies structured evidence: diagnostics, page numbers, Marker output, and page-scoped artifacts. A configured Agent owns provider/model choice, permission checks, cost confirmation, user confirmation, and recovery strategy. MiniMax-M3 remains evidence from the PDF parsing Spike, not a production contract name or hardcoded model path.
