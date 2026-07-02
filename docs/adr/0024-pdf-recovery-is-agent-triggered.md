# PDF recovery is Agent-triggered

PDF recovery in issue #61 will be triggered by an Agent decision or an explicit user request, not automatically by the parser module. `parse_pdf` remains responsible for Marker parsing and structured diagnostics; it does not silently start networked, model-backed, or higher-cost recovery work.

Agents may use diagnostics such as `MARKER_TIMEOUT`, `OCR_ARTIFACTS`, `FIGURE_ONLY_CONTENT`, `MISSING_TABLE_STRUCTURE`, or `WEAK_SOURCE_LOCATION` to propose or start recovery through the existing permission, cost, and user-confirmation boundaries. A user can also request recovery for selected pages or blocks directly.
