import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  FlowDiagramDocumentChangeEvent,
  FlowDiagramDocumentVersion,
} from '../../shared/flow-diagrams';
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
  let stateRoot: string;
  let filePath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-doc-store-'));
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-doc-state-'));
    filePath = path.join(projectPath, 'diagram.excalidraw');
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  });

  it('reads the authoritative document with an opaque content version', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });

    const result = await store.readDocument('diagram.excalidraw');

    expect(result).toEqual({
      ok: true,
      document: {
        content: original,
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  it('creates a new document without overwriting an existing path', async () => {
    const store = createFlowDiagramDocumentStore({ projectPath, stateRoot });
    const content = sceneJson(['one']);

    const created = await store.createDocument('diagram.excalidraw', content);
    const duplicate = await store.createDocument('diagram.excalidraw', sceneJson(['two']));

    expect(created).toEqual({
      ok: true,
      filePath,
      document: {
        content,
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'FILE_EXISTS' } });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });

  it('allocates collision-safe paths for generated document names inside the Store', async () => {
    const store = createFlowDiagramDocumentStore({ projectPath, stateRoot });

    const first = await store.createDocument(
      'diagrams/generated.excalidraw',
      sceneJson(['one']),
      { collisionSafe: true },
    );
    const second = await store.createDocument(
      'diagrams/generated.excalidraw',
      sceneJson(['two']),
      { collisionSafe: true },
    );

    expect(first).toMatchObject({
      ok: true,
      filePath: path.join(projectPath, 'diagrams', 'generated.excalidraw'),
    });
    expect(second).toMatchObject({
      ok: true,
      filePath: path.join(projectPath, 'diagrams', 'generated-2.excalidraw'),
    });
  });

  it('atomically replaces the document when the base content still matches', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const notified: string[] = [];
    const documentChanges: FlowDiagramDocumentChangeEvent[] = [];
    const store = createFlowDiagramDocumentStore({
      projectPath,
      notifyFileChange: (changed) => notified.push(changed),
      notifyDocumentChange: (change) => documentChanges.push(change),
    });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');

    const next = sceneJson(['one', 'two']);
    const result = await store.saveDocument(
      'diagram.excalidraw',
      next,
      initial.document.version,
      'renderer-save-1',
    );

    expect(result).toEqual({
      ok: true,
      document: {
        content: next,
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    if (result.ok) {
      expect(result.document.version).not.toBe(initial.document.version);
    }
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(next);
    expect(notified).toEqual([filePath]);
    expect(documentChanges).toEqual([{
      filePath,
      version: result.ok ? result.document.version : null,
      mutationId: 'renderer-save-1',
    }]);
    expect(fs.readdirSync(projectPath).filter((name) => name.includes('cdf-tmp'))).toEqual([]);
  });

  it('does not report a published document as failed when a notifier throws', async () => {
    const original = sceneJson(['one']);
    const next = sceneJson(['two']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({
      projectPath,
      notifyFileChange: () => {
        throw new Error('watcher unavailable');
      },
      notifyDocumentChange: () => {
        throw new Error('window closed');
      },
    });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');

    const result = await store.saveDocument(
      'diagram.excalidraw',
      next,
      initial.document.version,
    );

    expect(result).toMatchObject({ ok: true, document: { content: next } });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(next);
  });

  it('returns a conflict with the current content when the document changed externally', async () => {
    const original = sceneJson(['one']);
    const external = sceneJson(['agent']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');
    fs.writeFileSync(filePath, external);

    const result = await store.saveDocument(
      'diagram.excalidraw',
      sceneJson(['mine']),
      initial.document.version,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'SOURCE_CHANGED',
        message: expect.stringContaining('changed'),
        currentContent: external,
        currentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(external);
  });

  it('serializes concurrent saves so the later writer observes the earlier one', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');

    const [first, second] = await Promise.all([
      store.saveDocument('diagram.excalidraw', sceneJson(['first']), initial.document.version),
      store.saveDocument('diagram.excalidraw', sceneJson(['second']), initial.document.version),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const conflict = outcomes.find((outcome) => !outcome.ok);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
    const finalContent = fs.readFileSync(filePath, 'utf-8');
    expect([sceneJson(['first']), sceneJson(['second'])]).toContain(finalContent);
  });

  it('revalidates after the controlled pre-publication race seam', async () => {
    const original = sceneJson(['one']);
    const external = sceneJson(['external']);
    fs.writeFileSync(filePath, original);
    const initialStore = createFlowDiagramDocumentStore({ projectPath });
    const initial = await initialStore.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');
    const store = createFlowDiagramDocumentStore({
      projectPath,
      beforePublish: () => {
        fs.writeFileSync(filePath, external);
      },
    });

    const result = await store.saveDocument(
      'diagram.excalidraw',
      sceneJson(['mine']),
      initial.document.version,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'SOURCE_CHANGED',
        message: expect.stringContaining('changed'),
        currentContent: external,
        currentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(external);
    expect(fs.readdirSync(projectPath).filter((name) => name.includes('cdf-tmp'))).toEqual([]);
  });

  it('owns Agent revision recording and rollback as one document boundary', async () => {
    const original = sceneJson(['one']);
    const edited = sceneJson(['one', 'agent']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath, stateRoot });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');

    const editResult = await store.applyAgentEdit(
      'diagram.excalidraw',
      edited,
      initial.document.version,
    );
    const rollbackResult = await store.rollbackDocument('diagram.excalidraw');

    expect(editResult).toMatchObject({
      ok: true,
      filePath,
      document: { content: edited },
    });
    expect(rollbackResult).toMatchObject({
      ok: true,
      filePath,
      document: { content: original },
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('creates derived exports without exposing file writes to the service', async () => {
    fs.writeFileSync(filePath, sceneJson(['one']));
    const store = createFlowDiagramDocumentStore({ projectPath, stateRoot });
    const bytes = Buffer.from('<svg />');

    const created = await store.createExport({
      sourceFilePath: 'diagram.excalidraw',
      format: 'svg',
      bytes,
    });
    const next = await store.createExport({
      sourceFilePath: 'diagram.excalidraw',
      format: 'svg',
      bytes,
    });

    expect(created).toEqual({
      ok: true,
      filePath: path.join(projectPath, 'diagram.svg'),
    });
    expect(next).toEqual({
      ok: true,
      filePath: path.join(projectPath, 'diagram-2.svg'),
    });
    expect(fs.readFileSync(path.join(projectPath, 'diagram.svg'))).toEqual(bytes);
  });

  it('rejects invalid scenes at the write boundary without touching the document', async () => {
    const original = sceneJson(['one']);
    fs.writeFileSync(filePath, original);
    const store = createFlowDiagramDocumentStore({ projectPath });
    const initial = await store.readDocument('diagram.excalidraw');
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('expected readable document');

    const result = await store.saveDocument(
      'diagram.excalidraw',
      '{"not":"excalidraw"}',
      initial.document.version,
    );

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('rejects documents outside the Project and non-diagram extensions', async () => {
    const store = createFlowDiagramDocumentStore({ projectPath });
    const version = 'untrusted-version' as FlowDiagramDocumentVersion;

    await expect(store.saveDocument('../outside.excalidraw', sceneJson(), version))
      .resolves.toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_PROJECT' } });
    await expect(store.saveDocument('notes.txt', sceneJson(), version))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_EXTENSION' } });
  });
});
