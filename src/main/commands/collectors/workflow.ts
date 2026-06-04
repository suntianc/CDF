import db from '../../database';
import type { SlashCommand } from '../../../shared/types';

/** D-10: workflow name must be lowercase kebab-case to register as `/<name>`. */
const VALID_NAME = /^[a-z0-9-]+$/;

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Phase 6 Workflow collector.
 *
 * - D-11: lightweight SQL selecting only `id`, `name`, `description`. Does NOT
 *   use `db:getWorkflows` IPC (which carries heavy `graph_data`).
 * - D-10: filters to `status='active'` AND name matches `^[a-z0-9-]+$`.
 * - Single source failure is non-fatal: if the projects table has no match for
 *   `projectPath`, returns `[]` (does not throw — P6.1).
 */
export async function collectWorkflowCommands(projectPath: string): Promise<SlashCommand[]> {
  let rows: WorkflowRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT id, name, description FROM workflows
         WHERE project_id = (SELECT id FROM projects WHERE path = ?)
           AND status = ?`
      )
      .all(projectPath, 'active') as WorkflowRow[];
  } catch {
    return [];
  }

  return rows
    .filter((row) => VALID_NAME.test(row.name))
    .map((row) => ({
      name: row.name,
      description: row.description || '',
      source: 'workflow' as const,
      target: row.id,
      sourceLabel: 'workflow',
      badge: '[workflow]',
    }));
}
