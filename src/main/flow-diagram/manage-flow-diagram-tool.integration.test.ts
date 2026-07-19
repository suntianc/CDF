import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManageFlowDiagramTool } from './manage-flow-diagram-tool';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/cdf-user-data') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

describe('manage_flow_diagram real Tool integration', () => {
  let root: string;
  let projectPath: string;
  let stateRoot: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-tool-'));
    projectPath = path.join(root, 'project');
    stateRoot = path.join(root, 'state');
    fs.mkdirSync(projectPath);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates, edits, rolls back, and exports through the public Agent Tool seam', async () => {
    const tool = createManageFlowDiagramTool(projectPath, { stateRoot });
    const format = JSON.parse(await tool.invoke({ action: 'read_format' }));
    expect(format).toMatchObject({ ok: true, action: 'read_format' });

    const created = JSON.parse(await tool.invoke({
      action: 'create',
      name: 'Tool Flow',
      elements: [{
        id: 'start',
        type: 'rectangle',
        x: 20,
        y: 20,
        width: 160,
        height: 80,
      }],
    }));
    expect(created).toMatchObject({
      ok: true,
      data: { relativePath: 'diagrams/tool-flow.excalidraw' },
    });
    const filePath = path.join(projectPath, 'diagrams', 'tool-flow.excalidraw');
    const original = fs.readFileSync(filePath);

    const edited = JSON.parse(await tool.invoke({
      action: 'edit',
      file_path: filePath,
      operations: [{
        op: 'add',
        elements: [{
          id: 'finish',
          type: 'ellipse',
          x: 260,
          y: 20,
          width: 160,
          height: 80,
        }],
      }],
    }));
    expect(edited).toMatchObject({
      ok: true,
      data: { summary: { added: 1, updated: 0, deleted: 0 } },
    });
    expect(fs.readFileSync(filePath)).not.toEqual(original);

    expect(JSON.parse(await tool.invoke({
      action: 'rollback',
      file_path: filePath,
    }))).toMatchObject({ ok: true, action: 'rollback' });
    expect(fs.readFileSync(filePath)).toEqual(original);

    const exported = JSON.parse(await tool.invoke({
      action: 'export',
      file_path: filePath,
      format: 'svg',
    }));
    expect(exported).toMatchObject({
      ok: true,
      data: { relativePath: 'diagrams/tool-flow.svg', mimeType: 'image/svg+xml' },
    });
    expect(fs.readFileSync(path.join(projectPath, 'diagrams', 'tool-flow.svg'), 'utf8')).toMatch(/^<svg/);
  });
});
