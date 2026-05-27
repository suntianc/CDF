---
status: complete
---

# Quick Task Summary: Fix Workflow Saving, Rename, and Delete Issues

Completed fixes for the workflow editor and listing UI:
1. **Save Notification**: Local toast notifications are triggered upon successful save or errors in the workflow editor.
2. **Duplicate Name Validation**: Save action queries the existing list of workflows and flags if another workflow in the current project has the same name (excluding itself).
3. **Delete Action**: Fixed the `deleteWorkflow` store action to accept `projectId`, solving the display delay. Added deletion alerts in the list view.
4. **Database Cascades**: Added `db.pragma('foreign_keys = ON')` during database initialization so SQLite cascades edits correctly.
5. **Node Config Dropdowns**: Replaced raw select elements in `NodeConfigDrawer.tsx` with styled `CustomSelect` dropdowns for a fully consistent and themed design.
6. **Enforced NOT NULL Constraint**: Added `NOT NULL` constraint to workflows table primary key `id` and cleaned up historical `NULL` id rows caused by earlier ID generation bugs.
