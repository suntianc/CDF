import { app } from 'electron';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  notifyFileChange,
  notifyFlowDiagramDocumentChange,
} from '../services/file-watcher';
import {
  createFlowDiagramService,
  type FlowDiagramService,
} from './flow-diagram-service';
import { renderFlowDiagramExportAdapter } from './flow-diagram-export-adapter';

const elementSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).catchall(z.unknown());

const editOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    elements: z.array(elementSchema).min(1),
  }).strict(),
  z.object({
    op: z.literal('update'),
    id: z.string().min(1),
    patch: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    op: z.literal('delete'),
    id: z.string().min(1),
  }).strict(),
]);

const manageFlowDiagramSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read_format') }).strict(),
  z.object({
    action: z.literal('create'),
    file_path: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    elements: z.array(elementSchema).optional(),
  }).strict(),
  z.object({
    action: z.literal('get'),
    file_path: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('edit'),
    file_path: z.string().min(1),
    operations: z.array(editOperationSchema).min(1),
  }).strict(),
  z.object({
    action: z.literal('rollback'),
    file_path: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal('export'),
    file_path: z.string().min(1),
    format: z.enum(['png', 'svg']),
    output_path: z.string().min(1).optional(),
  }).strict(),
]);

export interface CreateManageFlowDiagramToolOptions {
  service?: FlowDiagramService;
  stateRoot?: string;
}

export function createManageFlowDiagramTool(
  projectPath: string,
  options: CreateManageFlowDiagramToolOptions = {},
) {
  const service = options.service ?? createFlowDiagramService({
    projectPath,
    stateRoot: options.stateRoot ?? path.join(app.getPath('userData'), 'flow-diagrams'),
    notifyFileChange,
    notifyDocumentChange: notifyFlowDiagramDocumentChange,
    renderExport: renderFlowDiagramExportAdapter,
  });

  return tool(
    async (input) => JSON.stringify(await service.execute(input)),
    {
      name: 'manage_flow_diagram',
      description:
        'Create and manage editable Project-owned Excalidraw Flow Diagrams. ' +
        'Call read_format before create/edit to learn the pinned compact native element format. ' +
        'create makes a new .excalidraw artifact; get reads one explicit current source; ' +
        'edit performs precise add/update/delete operations by stable element id; ' +
        'export creates PNG or SVG only when explicitly requested. ' +
        'Call rollback only after explicit user rollback intent such as “undo the Agent change”; ' +
        'never roll back a successful edit automatically. Returns a stable JSON envelope with local artifact display metadata.',
      schema: manageFlowDiagramSchema,
    },
  );
}
