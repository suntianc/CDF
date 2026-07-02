# PDF recovery uses plan-level confirmation for metered work

Automatic PDF parsing may run the local Marker baseline without additional confirmation. After the baseline parse, the Agent may build a PDF Recovery Plan and continue automatically only when the planned work stays local and does not require additional high-privilege actions.

If recovery requires networked model calls, metered provider usage, or sending page images/text to a provider, the Agent must request one plan-level confirmation before execution. The confirmation should explain why recovery is needed, how many pages or blocks are included, which configured Agent/provider will be used, and the expected network/cost implications. After approval, the Agent executes the approved recovery plan without asking page by page.
