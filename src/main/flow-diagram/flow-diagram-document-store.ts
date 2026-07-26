import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runProjectFileMutation } from '../services/project-file-mutation';
import {
  FlowDiagramSceneError,
  parseFlowDiagramScene,
} from './flow-diagram-scene';
import {
  FLOW_DIAGRAM_SOURCE_CHANGED,
  type FlowDiagramDocumentSaveResult,
} from '../../shared/flow-diagrams';

/**
 * Flow Diagram 文档存储：`.excalidraw` 文档一致性的唯一拥有者。
 *
 * 用户编辑器 autosave 与 Agent `manage_flow_diagram` 编辑共享同一套
 * 原子 compare-and-swap 替换原语与按 Project 的写串行化；写边界执行
 * 场景校验，冲突以带当前内容的结构化结果返回（ADR-0071 / #200）。
 */

export class FlowDiagramOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlowDiagramOperationError';
  }
}

const PROTECTED_SEGMENTS = new Set(['.git', '.cdf', 'node_modules', 'out', 'dist']);

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingAncestor(candidatePath: string): string {
  let current = candidatePath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function resolveProjectOwnedPath(
  projectPath: string,
  requestedPath: string,
  expectedExtension: string,
): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new FlowDiagramOperationError('PATH_REQUIRED', 'A non-empty Project path is required.');
  }
  if (trimmed.startsWith('~')) {
    throw new FlowDiagramOperationError('PATH_OUTSIDE_PROJECT', 'Home-relative paths are not allowed.');
  }
  const resolvedProjectPath = fs.realpathSync(projectPath);
  const target = path.resolve(projectPath, trimmed);
  if (!isWithin(path.resolve(projectPath), target)) {
    throw new FlowDiagramOperationError(
      'PATH_OUTSIDE_PROJECT',
      'The requested path is outside the current Project.',
    );
  }
  const relative = path.relative(projectPath, target);
  const segments = relative.toLowerCase().split(path.sep).filter(Boolean);
  if (
    segments.some((segment) => PROTECTED_SEGMENTS.has(segment))
    || segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))
  ) {
    throw new FlowDiagramOperationError(
      'PROTECTED_PATH',
      'The requested path is protected and cannot be used for a Flow Diagram.',
    );
  }
  if (path.extname(target).toLowerCase() !== expectedExtension) {
    throw new FlowDiagramOperationError(
      'INVALID_EXTENSION',
      `The requested path must end with ${expectedExtension}.`,
    );
  }

  const ancestor = nearestExistingAncestor(target);
  const realAncestor = fs.realpathSync(ancestor);
  if (!isWithin(resolvedProjectPath, realAncestor)) {
    throw new FlowDiagramOperationError(
      'PATH_OUTSIDE_PROJECT',
      'The requested path resolves outside the current Project.',
    );
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new FlowDiagramOperationError('SYMLINK_NOT_ALLOWED', 'Flow Diagram paths cannot be symlinks.');
  }
  return target;
}

export function hashBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function temporaryPathFor(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.cdf-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
}

export async function replaceFileAtomicallyIfUnchanged(
  filePath: string,
  bytes: Buffer,
  expectedBytes: Buffer | null,
): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (expectedBytes === null) {
      try {
        await fs.promises.link(temporaryPath, filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new FlowDiagramOperationError(
            'SOURCE_CHANGED',
            'The Flow Diagram changed before the operation could be applied.',
          );
        }
        throw error;
      }
      return;
    }

    let currentBytes: Buffer;
    try {
      currentBytes = fs.readFileSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FlowDiagramOperationError(
          'SOURCE_CHANGED',
          'The Flow Diagram changed before the operation could be applied.',
        );
      }
      throw error;
    }
    if (!currentBytes.equals(expectedBytes)) {
      throw new FlowDiagramOperationError(
        'SOURCE_CHANGED',
        'The Flow Diagram changed before the operation could be applied.',
      );
    }
    // CDF mutations for this Project hold the shared coordinator lock. rename is
    // the single atomic publication step, so readers never observe partial bytes.
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

/** Unconditional atomic replacement: same temp + rename publication, no CAS guard. */
async function replaceFileAtomically(filePath: string, bytes: Buffer): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

export async function removeFileAtomicallyIfUnchanged(
  filePath: string,
  expectedBytes: Buffer,
): Promise<void> {
  let currentBytes: Buffer;
  try {
    currentBytes = fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FlowDiagramOperationError(
        'SOURCE_CHANGED',
        'The Flow Diagram changed before the operation could be completed.',
      );
    }
    throw error;
  }
  if (!currentBytes.equals(expectedBytes)) {
    throw new FlowDiagramOperationError(
      'SOURCE_CHANGED',
      'The Flow Diagram changed before the operation could be completed.',
    );
  }
  await fs.promises.unlink(filePath);
}

export async function writeNewFileAtomically(filePath: string, bytes: Buffer): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await fs.promises.link(temporaryPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new FlowDiagramOperationError(
          'FILE_EXISTS',
          'The requested output already exists; no file was overwritten.',
        );
      }
      throw error;
    }
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

export interface CreateFlowDiagramDocumentStoreOptions {
  projectPath: string;
  notifyFileChange?: (filePath: string) => void;
}

export interface FlowDiagramDocumentStore {
  /**
   * Editor autosave entry: validates the scene, then atomically replaces the
   * document when its bytes still equal `expectedContent`. `null` skips the
   * CAS guard but keeps the atomic temp + rename publication. A conflict
   * returns the current on-disk content so the caller can surface it.
   */
  saveDocument(
    filePath: string,
    content: string,
    expectedContent: string | null,
  ): Promise<FlowDiagramDocumentSaveResult>;
}

export function createFlowDiagramDocumentStore(
  options: CreateFlowDiagramDocumentStoreOptions,
): FlowDiagramDocumentStore {
  const projectPath = path.resolve(options.projectPath);
  const notify = (filePath: string) => options.notifyFileChange?.(filePath);

  return {
    async saveDocument(filePath, content, expectedContent) {
      let target: string;
      try {
        target = resolveProjectOwnedPath(projectPath, filePath, '.excalidraw');
      } catch (error) {
        return failureResult(error, 'PATH_OUTSIDE_PROJECT');
      }
      try {
        parseFlowDiagramScene(content);
      } catch (error) {
        return failureResult(error, 'INVALID_SCENE');
      }

      return runProjectFileMutation(projectPath, async () => {
        try {
          const bytes = Buffer.from(content, 'utf-8');
          if (expectedContent === null) {
            await replaceFileAtomically(target, bytes);
          } else {
            await replaceFileAtomicallyIfUnchanged(
              target,
              bytes,
              Buffer.from(expectedContent, 'utf-8'),
            );
          }
          notify(target);
          return { ok: true } as const;
        } catch (error) {
          if (
            error instanceof FlowDiagramOperationError
            && error.code === FLOW_DIAGRAM_SOURCE_CHANGED
          ) {
            let currentContent: string | null = null;
            try {
              currentContent = fs.readFileSync(target, 'utf-8');
            } catch {
              currentContent = null;
            }
            return {
              ok: false as const,
              error: { code: FLOW_DIAGRAM_SOURCE_CHANGED, message: error.message, currentContent },
            };
          }
          return failureResult(error, 'WRITE_FAILED');
        }
      });
    },
  };
}

function failureResult(error: unknown, fallbackCode: string): FlowDiagramDocumentSaveResult {
  if (error instanceof FlowDiagramOperationError || error instanceof FlowDiagramSceneError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: { code: fallbackCode, message: 'The Flow Diagram document could not be saved safely.' },
  };
}
