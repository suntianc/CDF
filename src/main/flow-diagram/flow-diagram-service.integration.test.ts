import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFlowDiagramService,
  type FlowDiagramService,
} from './flow-diagram-service';
import type { ExcalidrawScene } from './flow-diagram-scene';

function scene(elements: Array<Record<string, unknown>> = []): ExcalidrawScene {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://cdf.local',
    elements: elements as ExcalidrawScene['elements'],
    appState: {
      gridSize: 20,
      viewBackgroundColor: '#ffffff',
      currentItemStrokeColor: '#1b1b1f',
    },
    files: {},
  };
}

function rectangle(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'rectangle',
    x: 20,
    y: 20,
    width: 180,
    height: 80,
    angle: 0,
    strokeColor: '#1b1b1f',
    backgroundColor: '#f4d7de',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  };
}

function text(id: string, value: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'text',
    x: 40,
    y: 45,
    width: 120,
    height: 25,
    angle: 0,
    strokeColor: '#1b1b1f',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 2,
    version: 1,
    versionNonce: 2,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    fontSize: 20,
    fontFamily: 1,
    text: value,
    rawText: value,
    originalText: value,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    ...overrides,
  };
}

function writeScene(filePath: string, value: ExcalidrawScene): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return bytes;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('FlowDiagramService integration', () => {
  let root: string;
  let projectPath: string;
  let stateRoot: string;
  let service: FlowDiagramService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-diagram-'));
    projectPath = path.join(root, 'project');
    stateRoot = path.join(root, 'cdf-state');
    fs.mkdirSync(projectPath, { recursive: true });
    service = createFlowDiagramService({ projectPath, stateRoot });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('describes the compact format for the pinned Excalidraw SDK', async () => {
    const result = await service.execute({ action: 'read_format' });

    expect(result).toMatchObject({
      ok: true,
      action: 'read_format',
      data: {
        document: { type: 'excalidraw', version: 2 },
        sdk: '@excalidraw/excalidraw@0.18.1',
      },
    });
    expect(result.ok && result.data.attribution).toContain('MIT');
    expect(result.ok && result.data.actions).toEqual(
      expect.arrayContaining(['create', 'get', 'edit', 'rollback', 'export']),
    );
  });

  it('creates a valid Project-owned document at a visible collision-safe default path', async () => {
    const first = await service.execute({
      action: 'create',
      name: 'Release Flow',
      elements: [rectangle('start'), text('start-label', 'Start')],
    });
    const second = await service.execute({
      action: 'create',
      name: 'Release Flow',
      elements: [rectangle('next')],
    });

    expect(first).toMatchObject({
      ok: true,
      action: 'create',
      data: {
        relativePath: 'diagrams/release-flow.excalidraw',
        artifact: { kind: 'flow_diagram', mimeType: 'application/vnd.excalidraw+json' },
      },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { relativePath: 'diagrams/release-flow-2.excalidraw' },
    });
    const created = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'diagrams', 'release-flow.excalidraw'), 'utf8'),
    );
    expect(created).toMatchObject({ type: 'excalidraw', version: 2 });
    expect(created.elements.map((element: { id: string }) => element.id)).toEqual([
      'start',
      'start-label',
    ]);
  });

  it('rejects escape, protected, non-diagram, symlink, and explicit overwrite paths', async () => {
    const outside = path.join(root, 'outside.excalidraw');
    const existing = path.join(projectPath, 'existing.excalidraw');
    writeScene(existing, scene());
    const externalDir = path.join(root, 'external');
    fs.mkdirSync(externalDir);
    fs.symlinkSync(externalDir, path.join(projectPath, 'linked'));

    for (const filePath of [
      outside,
      '.git/diagram.excalidraw',
      'notes/diagram.json',
      'linked/diagram.excalidraw',
      existing,
    ]) {
      const result = await service.execute({
        action: 'create',
        file_path: filePath,
        elements: [],
      });
      expect(result).toMatchObject({ ok: false, action: 'create' });
    }
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('gets only an explicit current Project source scene', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    writeScene(filePath, scene([rectangle('one')]));

    const missingTarget = await service.execute({ action: 'get' });
    const loaded = await service.execute({ action: 'get', file_path: filePath });

    expect(missingTarget).toMatchObject({
      ok: false,
      error: { code: 'TARGET_REQUIRED' },
    });
    expect(loaded).toMatchObject({
      ok: true,
      action: 'get',
      data: {
        relativePath: 'diagram.excalidraw',
        scene: { type: 'excalidraw', version: 2 },
      },
    });
  });

  it('adds native editable elements while preserving the existing scene and isolating revisions from user Git', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const originalScene = scene([rectangle('existing')]);
    originalScene.files = {
      image1: {
        id: 'image1',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,iVBORw0KGgo=',
        created: 1,
      },
    };
    writeScene(filePath, originalScene);
    git(projectPath, 'init');
    git(projectPath, 'config', 'user.email', 'test@cdf.local');
    git(projectPath, 'config', 'user.name', 'CDF Test');
    git(projectPath, 'add', 'diagram.excalidraw');
    git(projectPath, 'commit', '-m', 'baseline');
    fs.writeFileSync(path.join(projectPath, 'notes.txt'), 'staged');
    git(projectPath, 'add', 'notes.txt');
    fs.writeFileSync(path.join(projectPath, 'draft.txt'), 'dirty');
    const beforeHead = git(projectPath, 'rev-parse', 'HEAD');
    const beforeBranch = git(projectPath, 'branch', '--show-current');
    const beforeIndex = git(projectPath, 'diff', '--cached', '--binary');

    const result = await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('added', { x: 260 })] }],
    });

    expect(result).toMatchObject({
      ok: true,
      action: 'edit',
      data: { summary: { added: 1, updated: 0, deleted: 0 } },
    });
    const updated = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExcalidrawScene;
    expect(updated.elements[0]).toEqual(originalScene.elements[0]);
    expect(updated.elements[1]).toMatchObject({ id: 'added', type: 'rectangle', x: 260 });
    expect(updated.files).toEqual(originalScene.files);
    expect(updated.appState).toEqual(originalScene.appState);
    expect(git(projectPath, 'rev-parse', 'HEAD')).toBe(beforeHead);
    expect(git(projectPath, 'branch', '--show-current')).toBe(beforeBranch);
    expect(git(projectPath, 'diff', '--cached', '--binary')).toBe(beforeIndex);
    expect(git(projectPath, 'status', '--porcelain')).not.toContain('cdf-state');
    expect(fs.existsSync(path.join(stateRoot, 'flow-diagram-revisions'))).toBe(true);
  });

  it('updates and deletes exact stable ids without regenerating untouched content or broken bindings', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const untouched = rectangle('untouched', { x: 400, seed: 987 });
    const container = rectangle('container', {
      boundElements: [
        { id: 'label', type: 'text' },
        { id: 'arrow', type: 'arrow' },
      ],
    });
    const label = text('label', 'Old', { containerId: 'container' });
    const arrow = {
      ...rectangle('arrow', {
        type: 'arrow',
        width: 200,
        height: 0,
        points: [[0, 0], [200, 0]],
        startBinding: { elementId: 'container', focus: 0, gap: 1 },
        endBinding: { elementId: 'untouched', focus: 0, gap: 1 },
        endArrowhead: 'arrow',
      }),
    };
    writeScene(filePath, scene([container, label, arrow, untouched]));

    const updateResult = await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'update', id: 'label', patch: { text: 'New' } }],
    });
    expect(updateResult).toMatchObject({
      ok: true,
      data: { summary: { added: 0, updated: 1, deleted: 0 } },
    });
    const afterUpdate = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExcalidrawScene;
    expect(afterUpdate.elements.find((element) => element.id === 'label')).toMatchObject({
      id: 'label',
      text: 'New',
      originalText: 'New',
    });
    expect(afterUpdate.elements.find((element) => element.id === 'untouched')).toEqual(untouched);

    const deleteResult = await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'delete', id: 'container' }],
    });
    expect(deleteResult).toMatchObject({
      ok: true,
      data: { summary: { added: 0, updated: 0, deleted: 2 } },
    });
    const afterDelete = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ExcalidrawScene;
    expect(afterDelete.elements.find((element) => element.id === 'container')?.isDeleted).toBe(true);
    expect(afterDelete.elements.find((element) => element.id === 'label')?.isDeleted).toBe(true);
    expect(afterDelete.elements.find((element) => element.id === 'arrow')?.startBinding).toBeNull();
    expect(afterDelete.elements.find((element) => element.id === 'untouched')).toEqual(untouched);
  });

  it('returns stable errors for missing, deleted, incompatible, and duplicate ids without changing source bytes', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const original = writeScene(filePath, scene([
      rectangle('active'),
      rectangle('deleted', { isDeleted: true }),
    ]));

    const inputs = [
      { op: 'update' as const, id: 'missing', patch: { x: 1 } },
      { op: 'delete' as const, id: 'deleted' },
      { op: 'update' as const, id: 'active', patch: { id: 'new-id' } },
      { op: 'update' as const, id: 'active', patch: { strokeWidth: 'wide' } },
      { op: 'add' as const, elements: [rectangle('arrow-without-points', { type: 'arrow' })] },
      { op: 'add' as const, elements: [rectangle('active')] },
    ];
    for (const operation of inputs) {
      const result = await service.execute({
        action: 'edit',
        file_path: filePath,
        operations: [operation],
      });
      expect(result).toMatchObject({ ok: false, action: 'edit' });
      expect(fs.readFileSync(filePath)).toEqual(original);
    }
    expect(await service.execute({ action: 'rollback', file_path: filePath })).toMatchObject({
      ok: false,
      error: { code: 'NO_REVISION' },
    });

    writeScene(filePath, scene([rectangle('same'), rectangle('same')]));
    const duplicate = fs.readFileSync(filePath);
    const result = await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'delete', id: 'same' }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SCENE' } });
    expect(fs.readFileSync(filePath)).toEqual(duplicate);
  });

  it('does not modify the source when revision creation, validation, or replacement fails', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const original = writeScene(filePath, scene([rectangle('one')]));

    const revisionFailure = createFlowDiagramService({
      projectPath,
      stateRoot,
      revisionStore: {
        record: vi.fn(async () => { throw new Error('revision unavailable'); }),
        peekLatest: vi.fn(),
        consumeLatest: vi.fn(),
      },
    });
    expect(await revisionFailure.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('two')] }],
    })).toMatchObject({ ok: false, error: { code: 'REVISION_FAILED' } });
    expect(fs.readFileSync(filePath)).toEqual(original);

    const replacementFailure = createFlowDiagramService({
      projectPath,
      stateRoot,
      replaceFile: vi.fn(async () => { throw new Error('replace interrupted'); }),
    });
    expect(await replacementFailure.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('three')] }],
    })).toMatchObject({ ok: false, error: { code: 'WRITE_FAILED' } });
    expect(fs.readFileSync(filePath)).toEqual(original);
    expect(fs.readdirSync(path.dirname(filePath)).some((name) => name.includes('.cdf-tmp-'))).toBe(false);
    expect(await service.execute({ action: 'rollback', file_path: filePath })).toMatchObject({
      ok: false,
      error: { code: 'NO_REVISION' },
    });
  });

  it('keeps successful edits until an explicit rollback restores the latest applicable revision', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const original = writeScene(filePath, scene([rectangle('one')]));

    await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('two')] }],
    });
    expect(fs.readFileSync(filePath)).not.toEqual(original);

    const rollback = await service.execute({ action: 'rollback', file_path: filePath });

    expect(rollback).toMatchObject({
      ok: true,
      action: 'rollback',
      data: {
        relativePath: 'diagram.excalidraw',
        artifact: { kind: 'flow_diagram' },
      },
    });
    expect(JSON.stringify(rollback)).not.toMatch(/commit|revisionRoot|cdf-state/i);
    expect(fs.readFileSync(filePath)).toEqual(original);
    expect(await service.execute({ action: 'rollback', file_path: filePath })).toMatchObject({
      ok: false,
      error: { code: 'NO_REVISION' },
    });
  });

  it('restores a deleted source from the latest applicable revision', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const original = writeScene(filePath, scene([rectangle('one')]));
    await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('two')] }],
    });
    fs.unlinkSync(filePath);

    expect(await service.execute({ action: 'rollback', file_path: filePath })).toMatchObject({
      ok: true,
      action: 'rollback',
    });
    expect(fs.readFileSync(filePath)).toEqual(original);
  });

  it('restores the current source if consuming a rollback revision fails', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const current = writeScene(filePath, scene([rectangle('current')]));
    const previous = Buffer.from(`${JSON.stringify(scene([rectangle('previous')]), null, 2)}\n`);
    const failingStore = {
      record: vi.fn(async () => 'unused'),
      peekLatest: vi.fn(async () => ({ token: 'latest', sourceBytes: previous })),
      consumeLatest: vi.fn(async () => { throw new Error('manifest write failed'); }),
    };
    const rollbackService = createFlowDiagramService({
      projectPath,
      stateRoot,
      revisionStore: failingStore,
    });

    expect(await rollbackService.execute({ action: 'rollback', file_path: filePath })).toMatchObject({
      ok: false,
      action: 'rollback',
    });
    expect(fs.readFileSync(filePath)).toEqual(current);
  });

  it('keeps the current valid source when the latest rollback revision is invalid', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    writeScene(filePath, scene([rectangle('one')]));
    await service.execute({
      action: 'edit',
      file_path: filePath,
      operations: [{ op: 'add', elements: [rectangle('two')] }],
    });
    const current = fs.readFileSync(filePath);
    const snapshots: string[] = [];
    const collect = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(fullPath);
        else if (entry.name.endsWith('.excalidraw')) snapshots.push(fullPath);
      }
    };
    collect(path.join(stateRoot, 'flow-diagram-revisions'));
    expect(snapshots).toHaveLength(1);
    fs.writeFileSync(snapshots[0], 'not valid json');

    const rollback = await service.execute({ action: 'rollback', file_path: filePath });

    expect(rollback).toMatchObject({ ok: false, error: { code: 'INVALID_SCENE' } });
    expect(fs.readFileSync(filePath)).toEqual(current);
    expect(fs.readdirSync(path.dirname(filePath)).some((name) => name.includes('.cdf-tmp-'))).toBe(false);
  });

  it('validates and exports explicit SVG/PNG artifacts without changing source bytes or revisions', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const exportScene = scene([
      rectangle('box'),
      text('box-text', 'Deploy', { containerId: 'box' }),
      rectangle('logo', {
        type: 'image',
        x: 220,
        width: 40,
        height: 40,
        fileId: 'logo-file',
        status: 'saved',
        scale: [1, 1],
      }),
    ]);
    exportScene.files = {
      'logo-file': {
        id: 'logo-file',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        created: 1,
      },
    };
    const original = writeScene(filePath, exportScene);

    const svgResult = await service.execute({
      action: 'export',
      file_path: filePath,
      format: 'svg',
    });
    const pngResult = await service.execute({
      action: 'export',
      file_path: filePath,
      format: 'png',
      output_path: 'exports/deploy.png',
    });

    expect(svgResult).toMatchObject({
      ok: true,
      action: 'export',
      data: { relativePath: 'diagram.svg', mimeType: 'image/svg+xml' },
    });
    expect(pngResult).toMatchObject({
      ok: true,
      action: 'export',
      data: { relativePath: 'exports/deploy.png', mimeType: 'image/png' },
    });
    expect(fs.readFileSync(path.join(projectPath, 'diagram.svg'), 'utf8')).toMatch(
      /^<svg[\s\S]*Deploy[\s\S]*data:image\/png;base64/,
    );
    expect(fs.readFileSync(path.join(projectPath, 'exports', 'deploy.png')).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(fs.readFileSync(filePath)).toEqual(original);
    expect(fs.existsSync(path.join(stateRoot, 'flow-diagram-revisions'))).toBe(false);
  });

  it('cleans failed export output and rejects unsafe output paths', async () => {
    const filePath = path.join(projectPath, 'diagram.excalidraw');
    const original = writeScene(filePath, scene([rectangle('one')]));
    const failedOutput = path.join(projectPath, 'failed.svg');
    const failingService = createFlowDiagramService({
      projectPath,
      stateRoot,
      renderExport: vi.fn(async () => { throw new Error('renderer failed'); }),
    });

    expect(await failingService.execute({
      action: 'export',
      file_path: filePath,
      format: 'svg',
      output_path: failedOutput,
    })).toMatchObject({ ok: false, error: { code: 'EXPORT_FAILED' } });
    expect(fs.existsSync(failedOutput)).toBe(false);
    expect(await service.execute({
      action: 'export',
      file_path: filePath,
      format: 'png',
      output_path: path.join(root, 'outside.png'),
    })).toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_PROJECT' } });
    expect(fs.readFileSync(filePath)).toEqual(original);
  });
});
