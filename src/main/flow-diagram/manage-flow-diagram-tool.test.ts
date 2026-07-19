import { describe, expect, it, vi } from 'vitest';
import { createManageFlowDiagramTool } from './manage-flow-diagram-tool';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/cdf-user-data') },
}));

describe('manage_flow_diagram Agent Tool', () => {
  it('exposes a validated multi-action schema and stable JSON envelope', async () => {
    const execute = vi.fn(async (input) => ({
      ok: true as const,
      action: input.action,
      data: { accepted: input },
    }));
    const tool = createManageFlowDiagramTool('/tmp/project', {
      service: { execute },
    });

    expect(tool.name).toBe('manage_flow_diagram');
    expect(tool.description).toContain('read_format');
    expect(tool.description).toContain('explicit user rollback intent');

    const output = JSON.parse(await tool.invoke({
      action: 'edit',
      file_path: '/tmp/project/diagram.excalidraw',
      operations: [{ op: 'add', elements: [{
        id: 'step',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 120,
        height: 60,
      }] }],
    }));

    expect(output).toMatchObject({ ok: true, action: 'edit' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      action: 'edit',
      operations: [expect.objectContaining({ op: 'add' })],
    }));
  });

  it('rejects malformed action payloads before service execution', async () => {
    const execute = vi.fn();
    const tool = createManageFlowDiagramTool('/tmp/project', {
      service: { execute },
    });

    await expect(tool.invoke({
      action: 'export',
      file_path: '/tmp/project/diagram.excalidraw',
      format: 'pdf',
    } as any)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
