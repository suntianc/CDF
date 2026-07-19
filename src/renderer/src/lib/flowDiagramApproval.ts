export interface FlowDiagramApprovalSummary {
  action: string;
  target: string;
  added: number;
  updated: number;
  deleted: number;
  format?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function summarizeFlowDiagramApproval(args: unknown): FlowDiagramApprovalSummary {
  const input = record(args);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  let added = input.action === 'create' && Array.isArray(input.elements)
    ? input.elements.length
    : 0;
  let updated = 0;
  let deleted = 0;
  for (const value of operations) {
    const operation = record(value);
    if (operation.op === 'add' && Array.isArray(operation.elements)) {
      added += operation.elements.length;
    } else if (operation.op === 'update') {
      updated += 1;
    } else if (operation.op === 'delete') {
      deleted += 1;
    }
  }
  return {
    action: typeof input.action === 'string' ? input.action : 'unknown',
    target: typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.output_path === 'string'
        ? input.output_path
        : 'diagrams/',
    added,
    updated,
    deleted,
    ...(typeof input.format === 'string' ? { format: input.format } : {}),
  };
}
