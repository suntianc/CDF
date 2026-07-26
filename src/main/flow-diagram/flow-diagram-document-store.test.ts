import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFlowDiagramDocumentStore } from './flow-diagram-document-store';

function sceneJson(elementIds: string[] = []): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://cdf.local',
    elements: elementIds.map((id) => ({
      id,
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 60,
    })),
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }, null, 2);
}

describe('FlowDiagramDocumentStore', () => {
  let projectPath: string;
  let filePath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-doc-store-'));
    filePath = path.join(projectPath, 'diagram.excalidraw');
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('atomically replaces the document when the base content still matches', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const notified: string[] = [];
    const store = createFlowDiagramDocumentStore({
      projectPath,
      notifyFileChange: (changed) => notified.push(changed),
    });

    const next = sceneJson(['one', 'two']);
    await expect(store.saveDocument('diagram.excalidraw', next, original))
      .resolves.toEqual({ ok: true });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(next);
    expect(notified).toEqual([filePath]);
    expect(fs.readdirSync(projectPath).filter((name) => name.includes('cdf-tmp'))).toEqual([]);
  });

  it('returns a conflict with the current content when the document changed externally', async () => {
    const original = sceneJson(['one']);
    const external = sceneJson(['agent']);
    fs.writeFileSync(filePath, external);
    const store = createFlowDiagramDocumentStore({ projectPath });

    const result = await store.saveDocument('diagram.excalidraw', sceneJson(['mine']), original);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'SOURCE_CHANGED',
        message: expect.stringContaining('changed'),
        currentContent: external,
      },
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(external);
  });

  it('serializes concurrent saves so the later writer observes the earlier one', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });

    const [first, second] = await Promise.all([
      store.saveDocument('diagram.excalidraw', sceneJson(['first']), original),
      store.saveDocument('diagram.excalidraw', sceneJson(['second']), original),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const conflict = outcomes.find((outcome) => !outcome.ok);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
    const finalContent = fs.readFileSync(filePath, 'utf-8');
    expect([sceneJson(['first']), sceneJson(['second'])]).toContain(finalContent);
  });

  it('writes without a CAS guard when no base content is supplied', async () => {
    fs.writeFileSync(filePath, sceneJson(['whatever']));
    const store = createFlowDiagramDocumentStore({ projectPath });

    const next = sceneJson(['fresh']);
    await expect(store.saveDocument('diagram.excalidraw', next, null))
      .resolves.toEqual({ ok: true });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(next);
  });

  it('rejects invalid scenes at the write boundary without touching the document', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });

    const result = await store.saveDocument('diagram.excalidraw', '{"not":"excalidraw"}', original);

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('rejects documents outside the Project and non-diagram extensions', async () => {
    const store = createFlowDiagramDocumentStore({ projectPath });

    await expect(store.saveDocument('../outside.excalidraw', sceneJson(), null))
      .resolves.toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_PROJECT' } });
    await expect(store.saveDocument('notes.txt', sceneJson(), null))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_EXTENSION' } });
  });
});
