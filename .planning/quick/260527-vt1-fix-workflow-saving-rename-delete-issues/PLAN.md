# Quick Task: Fix Workflow Saving, Rename, and Delete Issues

Fix current bugs in the workflow editor and list views:
1. **Save Notification**: Add toast notifications on successful save / error in `WorkflowEditor.tsx`.
2. **Duplicate Name Validation**: Prevent saving a workflow with a name that already exists in the current project (excluding itself).
3. **Delete Action**: Fix the `deleteWorkflow` method in `workflowStore.ts` to accept and handle an optional `projectId` parameter, so the listing is correctly refreshed after deleting from the workflow list view. Show success/error toast notifications in `WorkflowList.tsx`.
4. **Database Cascade Deletes**: Enable SQLite foreign key constraints in `src/main/database.ts` so cascading deletes (e.g., deleting a workflow removes its execution history) are fully enforced.

## Proposed Changes

### Database Enforcements
- **[database.ts](file:///Users/suntc/project/CDF/src/main/database.ts)**:
  - Add `db.pragma('foreign_keys = ON')` right after connection initialization.

### Store Improvements
- **[workflowStore.ts](file:///Users/suntc/project/CDF/src/renderer/src/stores/workflowStore.ts)**:
  - Update `deleteWorkflow` parameter signature to accept `projectId?: string`.
  - Use `projectId` to refresh the workflows list.

### UI Improvements
- **[WorkflowList.tsx](file:///Users/suntc/project/CDF/src/renderer/src/components/WorkflowEditor/WorkflowList.tsx)**:
  - Add a local toast notification system (state + render container) identical to the one in `ToolSettings.tsx`.
  - Pass `currentProjectId` when invoking `deleteWorkflow`.
  - Trigger success/error toasts upon workflow deletion.
- **[WorkflowEditor.tsx](file:///Users/suntc/project/CDF/src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx)**:
  - Add a local toast notification system.
  - Implement duplicate name checking at save time: query all existing project workflows, verify if a workflow with the same name exists (excluding the current workflow ID), and display a warning toast if found.
  - Display success/error toasts upon successful/failed saves.

## Verification Plan
- Build the project using `npm run build` to verify there are no compilation errors.
- The user can verify the interactive saving alert, duplicate name warning, and successful deletion list refresh.
