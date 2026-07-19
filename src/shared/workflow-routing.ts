import type { WorkflowStage, WorkflowStageRoute } from './workflows';

export function normalizeWorkflowStages(stages: WorkflowStage[]): WorkflowStage[] {
  return stages.map((stage, index) => {
    if (typeof stage.terminal === 'boolean' || Array.isArray(stage.routes)) {
      return { ...stage, terminal: stage.terminal === true, routes: stage.routes ?? [] };
    }
    const next = stages[index + 1];
    return {
      ...stage,
      terminal: !next,
      routes: next ? [{
        id: `route:${stage.id}:${next.id}`,
        targetStageId: next.id,
        condition: '',
      }] : [],
    };
  });
}

export function validateWorkflowStages(stages: WorkflowStage[]): string[] {
  const errors: string[] = [];
  if (stages.length === 0) return ['Workflow requires an entry Stage'];
  const ids = new Set<string>();
  for (const stage of stages) {
    if (!stage.id.trim()) errors.push(`${stage.name || 'Unnamed Stage'}: Stage requires a stable id`);
    else if (ids.has(stage.id)) errors.push(`${stage.name}: duplicate Stage id ${stage.id}`);
    ids.add(stage.id);
  }
  const routeIds = new Set<string>();
  for (const stage of stages) {
    const routes = stage.routes ?? [];
    if (stage.terminal && routes.length > 0) errors.push(`${stage.name}: terminal stage cannot have outgoing routes`);
    if (!stage.terminal && routes.length === 0) errors.push(`${stage.name}: non-terminal stage requires an outgoing route`);
    for (const route of routes) {
      if (!route.id.trim()) errors.push(`${stage.name}: route requires a stable id`);
      else if (routeIds.has(route.id)) errors.push(`${stage.name}: duplicate route id ${route.id}`);
      routeIds.add(route.id);
      if (!route.targetStageId) errors.push(`${stage.name}: route target is required`);
      else if (!ids.has(route.targetStageId)) errors.push(`${stage.name}: route target does not exist`);
      if (route.targetStageId === stage.id) errors.push(`${stage.name}: self-route is not allowed`);
    }
    if (routes.length > 1) {
      routes.forEach((route) => {
        if (!route.condition.trim()) errors.push(`${stage.name}: every alternative route requires a condition`);
      });
    }
  }
  if (!stages.some((stage) => stage.terminal)) {
    errors.push('Workflow requires at least one explicit terminal Stage');
  }

  const entryId = stages[0].id;
  for (const stage of stages) {
    for (const route of stage.routes ?? []) {
      if (route.targetStageId === entryId) {
        errors.push(`${stage.name}: the first listed Stage is the only entry and cannot be a route target`);
      }
    }
  }

  if (errors.some((error) => error.includes('Stage id') || error.includes('stable id'))) {
    return errors;
  }
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (stageId: string) => {
    if (visiting.has(stageId)) {
      errors.push(`${byId.get(stageId)?.name ?? stageId}: route cycle detected`);
      return;
    }
    if (visited.has(stageId)) return;
    visiting.add(stageId);
    for (const route of byId.get(stageId)?.routes ?? []) {
      if (byId.has(route.targetStageId)) visit(route.targetStageId);
    }
    visiting.delete(stageId);
    visited.add(stageId);
  };
  visit(entryId);
  for (const stage of stages) {
    if (!visited.has(stage.id)) errors.push(`${stage.name}: Stage is unreachable from the entry`);
  }
  return errors;
}

export function selectWorkflowStageRoute(
  stage: WorkflowStage,
  routeId?: string,
): WorkflowStageRoute | null {
  const routes = stage.routes ?? [];
  if (stage.terminal) return null;
  if (routes.length === 1 && !routeId) return routes[0];
  const selected = routes.find((route) => route.id === routeId);
  if (!selected) throw new Error(`Unknown route for Stage ${stage.id}: ${routeId ?? '(missing)'}`);
  return selected;
}
