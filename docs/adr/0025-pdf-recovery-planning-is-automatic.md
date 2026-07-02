# PDF recovery planning is automatic

Issue #61 will support automatic whole-PDF parsing from the user's point of view. The user provides a PDF parsing request; CDF first runs the Marker baseline parse, then an Agent creates a PDF Recovery Plan from diagnostics, source grounding gaps, and parse evidence.

Recovery may execute internally in page-scoped units to control cost, token budget, retries, and source grounding, but users are not required to manually pick pages. If recovery requires networked or metered model use, the Agent may ask for one explicit confirmation for the planned recovery work rather than turning recovery into a manual page-selection workflow.
