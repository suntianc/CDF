import type Database from 'better-sqlite3';

export interface WorkflowRunStartupReconciliationResult {
  abortedRunCount: number;
}

export function reconcileOrphanWorkflowRunsAtStartup(
  db: Database.Database,
  now = Date.now(),
): WorkflowRunStartupReconciliationResult {
  return db.transaction(() => {
    // Recover a gate transition written by an older build between gate creation
    // and the waiting status update. A pending gate is durable and resumable.
    db.prepare(`UPDATE workflow_runs
      SET status = 'waiting_gate', updated_at = ?
      WHERE status = 'running'
        AND EXISTS (
          SELECT 1 FROM workflow_stage_gates
          WHERE workflow_stage_gates.run_id = workflow_runs.id
            AND workflow_stage_gates.status = 'pending'
        )`).run(now);

    // Remaining `running` work requires an in-memory Agent runtime, which cannot
    // survive a main-process restart.
    const result = db.prepare(`UPDATE workflow_runs
      SET status = 'aborted',
          error = COALESCE(error, 'Application stopped before the Workflow run completed'),
          ended_at = COALESCE(ended_at, ?),
          updated_at = ?
      WHERE status = 'running'`).run(now, now);

    // Clear stale projections that no longer have an owned Workflow Run.
    db.prepare(`UPDATE sessions
      SET workflow_run_id = NULL, workflow_run_status = NULL
      WHERE (workflow_run_id IS NOT NULL OR workflow_run_status IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM workflow_runs WHERE workflow_runs.session_id = sessions.id
        )`).run();

    // workflow_runs.session_id is the authoritative relationship. Repair both
    // the reverse link and every projected Session status after torn writes.
    db.prepare(`UPDATE sessions
      SET workflow_run_id = (
            SELECT workflow_runs.id FROM workflow_runs
            WHERE workflow_runs.session_id = sessions.id
            LIMIT 1
          ),
          workflow_run_status = (
            SELECT workflow_runs.status FROM workflow_runs
            WHERE workflow_runs.session_id = sessions.id
            LIMIT 1
          )
      WHERE EXISTS (
        SELECT 1 FROM workflow_runs WHERE workflow_runs.session_id = sessions.id
      )`).run();

    return { abortedRunCount: result.changes };
  })();
}
