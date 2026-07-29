import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import log from '../logger';
import { runProjectFileMutation } from '../services/project-file-mutation';
import {
  FlowDiagramSceneError,
  parseFlowDiagramScene,
} from './flow-diagram-scene';
import {
  createFlowDiagramRevisionStore,
  type FlowDiagramRevisionStore,
} from './flow-diagram-revision-store';
import {
  FLOW_DIAGRAM_SOURCE_CHANGED,
  type FlowDiagramDocumentChangeEvent,
  type FlowDiagramDocumentReadResult,
  type FlowDiagramDocumentSaveResult,
  type FlowDiagramDocumentSnapshot,
  type FlowDiagramDocumentVersion,
  type FlowDiagramExportFormat,
} from '../../shared/flow-diagrams';

/**
 * Flow Diagram 文档存储：`.excalidraw` 文档一致性的唯一拥有者。
 *
 * CDF 内部写入按 Project 串行化并使用 opaque content version；发布前会
 * 再次校验版本，随后以 rename 原子发布完整文档。任意外部程序不参与同一
 * 协议，因此外部冲突检测是 best-effort，而非跨平台严格 CAS（ADR-0073）。
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

function resolveProjectOwnedPath(
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

export function hashBytes(bytes: Buffer): FlowDiagramDocumentVersion {
  return crypto.createHash('sha256').update(bytes).digest('hex') as FlowDiagramDocumentVersion;
}

function temporaryPathFor(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.cdf-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
}

function collisionSafePath(basePath: string): string {
  if (!fs.existsSync(basePath)) return basePath;
  const extension = path.extname(basePath);
  const stem = basePath.slice(0, -extension.length);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new FlowDiagramOperationError(
    'PATH_COLLISION',
    'Could not allocate a collision-safe Flow Diagram path.',
  );
}

async function withPreparedTemporaryFile<T>(
  filePath: string,
  bytes: Buffer,
  publish: (temporaryPath: string) => Promise<T>,
): Promise<T> {
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
    return await publish(temporaryPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

async function writeNewFileAtomically(filePath: string, bytes: Buffer): Promise<void> {
  await withPreparedTemporaryFile(filePath, bytes, async (temporaryPath) => {
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
  });
}

export interface CreateFlowDiagramDocumentStoreOptions {
  projectPath: string;
  stateRoot?: string;
  revisionStore?: FlowDiagramRevisionStore;
  notifyFileChange?: (filePath: string) => void;
  notifyDocumentChange?: (event: FlowDiagramDocumentChangeEvent) => void;
  /** Controlled race seam used to verify the documented external-writer guarantee. */
  beforePublish?: (context: {
    filePath: string;
    expectedVersion: FlowDiagramDocumentVersion;
  }) => void | Promise<void>;
}

export type FlowDiagramDocumentMutationResult =
  | {
      ok: true;
      filePath: string;
      document: FlowDiagramDocumentSnapshot;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        currentContent?: string | null;
        currentVersion?: FlowDiagramDocumentVersion | null;
      };
    };

export type FlowDiagramExportWriteResult =
  | { ok: true; filePath: string }
  | { ok: false; error: { code: string; message: string } };

export interface FlowDiagramDocumentStore {
  /** Reads and validates the authoritative document together with its opaque byte identity. */
  readDocument(filePath: string): Promise<FlowDiagramDocumentReadResult>;

  /** Creates exactly one new Project-owned document and never overwrites an existing path. */
  createDocument(
    filePath: string,
    content: string,
    options?: { collisionSafe?: boolean },
  ): Promise<FlowDiagramDocumentMutationResult>;

  /** Records the current revision and applies one Agent-produced candidate document. */
  applyAgentEdit(
    filePath: string,
    content: string,
    expectedVersion: FlowDiagramDocumentVersion,
  ): Promise<FlowDiagramDocumentMutationResult>;

  /** Restores and consumes the latest applicable Agent revision. */
  rollbackDocument(filePath: string): Promise<FlowDiagramDocumentMutationResult>;

  /** Publishes one derived export without overwriting an explicit output path. */
  createExport(input: {
    sourceFilePath: string;
    requestedOutputPath?: string;
    format: FlowDiagramExportFormat;
    bytes: Buffer;
  }): Promise<FlowDiagramExportWriteResult>;

  /**
   * Editor autosave entry: validates the scene, then publishes only while the
   * authoritative document still has `expectedVersion`.
   */
  saveDocument(
    filePath: string,
    content: string,
    expectedVersion: FlowDiagramDocumentVersion,
    mutationId?: string,
  ): Promise<FlowDiagramDocumentSaveResult>;
}

function readCurrentBytes(filePath: string): Buffer {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FlowDiagramOperationError(
        FLOW_DIAGRAM_SOURCE_CHANGED,
        'The Flow Diagram changed before the operation could be applied.',
      );
    }
    throw error;
  }
}

function assertCurrentVersion(
  filePath: string,
  expectedVersion: FlowDiagramDocumentVersion,
): void {
  if (hashBytes(readCurrentBytes(filePath)) !== expectedVersion) {
    throw new FlowDiagramOperationError(
      FLOW_DIAGRAM_SOURCE_CHANGED,
      'The Flow Diagram changed before the operation could be applied.',
    );
  }
}

async function replaceFileAtomicallyIfVersionMatches(
  filePath: string,
  bytes: Buffer,
  expectedVersion: FlowDiagramDocumentVersion,
  beforePublish?: CreateFlowDiagramDocumentStoreOptions['beforePublish'],
): Promise<void> {
  await withPreparedTemporaryFile(filePath, bytes, async (temporaryPath) => {
    assertCurrentVersion(filePath, expectedVersion);
    await beforePublish?.({ filePath, expectedVersion });
    // Revalidate after the controlled race seam, immediately before the one
    // atomic publication step. See ADR-0073 for the remaining external gap.
    assertCurrentVersion(filePath, expectedVersion);
    await fs.promises.rename(temporaryPath, filePath);
  });
}

export function createFlowDiagramDocumentStore(
  options: CreateFlowDiagramDocumentStoreOptions,
): FlowDiagramDocumentStore {
  const projectPath = path.resolve(options.projectPath);
  const notifyFile = (filePath: string) => {
    try {
      options.notifyFileChange?.(filePath);
    } catch (error) {
      log.warn('[flow-diagram-store] file notification failed after publication:', error);
    }
  };
  const notifyDocument = (
    filePath: string,
    version: FlowDiagramDocumentVersion,
    mutationId?: string,
  ) => {
    notifyFile(filePath);
    try {
      options.notifyDocumentChange?.({ filePath, version, mutationId });
    } catch (error) {
      log.warn('[flow-diagram-store] document notification failed after publication:', error);
    }
  };
  let revisionStore = options.revisionStore;
  const revisions = (): FlowDiagramRevisionStore => {
    if (!revisionStore) {
      if (!options.stateRoot) {
        throw new FlowDiagramOperationError(
          'REVISION_STORE_UNAVAILABLE',
          'Flow Diagram revision storage is not configured.',
        );
      }
      revisionStore = createFlowDiagramRevisionStore(projectPath, options.stateRoot);
    }
    return revisionStore;
  };

  return {
    async readDocument(filePath) {
      try {
        const target = resolveProjectOwnedPath(projectPath, filePath, '.excalidraw');
        const bytes = fs.readFileSync(target);
        const content = bytes.toString('utf-8');
        parseFlowDiagramScene(content);
        return {
          ok: true,
          document: { content, version: hashBytes(bytes) },
        };
      } catch (error) {
        return failureResult(error, 'READ_FAILED');
      }
    },

    async createDocument(filePath, content, createOptions) {
      let requestedTarget: string;
      try {
        requestedTarget = resolveProjectOwnedPath(projectPath, filePath, '.excalidraw');
        parseFlowDiagramScene(content);
      } catch (error) {
        return failureResult(error, 'CREATE_FAILED');
      }

      return runProjectFileMutation(projectPath, async () => {
        const bytes = Buffer.from(content, 'utf-8');
        try {
          const target = createOptions?.collisionSafe
            ? collisionSafePath(requestedTarget)
            : requestedTarget;
          await writeNewFileAtomically(target, bytes);
          const version = hashBytes(bytes);
          notifyDocument(target, version);
          return {
            ok: true,
            filePath: target,
            document: { content, version },
          };
        } catch (error) {
          return failureResult(error, 'CREATE_FAILED');
        }
      });
    },

    async applyAgentEdit(filePath, content, expectedVersion) {
      let target: string;
      let candidateBytes: Buffer;
      try {
        target = resolveProjectOwnedPath(projectPath, filePath, '.excalidraw');
        parseFlowDiagramScene(content);
        candidateBytes = Buffer.from(content, 'utf-8');
      } catch (error) {
        return failureResult(error, 'INVALID_SCENE');
      }

      return runProjectFileMutation(projectPath, async () => {
        let currentBytes: Buffer;
        try {
          currentBytes = readCurrentBytes(target);
          parseFlowDiagramScene(currentBytes);
          assertCurrentVersion(target, expectedVersion);
        } catch (error) {
          return error instanceof FlowDiagramOperationError
            && error.code === FLOW_DIAGRAM_SOURCE_CHANGED
            ? sourceChangedResult(target, error.message)
            : failureResult(error, 'READ_FAILED');
        }

        let revisionToken: string;
        try {
          revisionToken = await revisions().record(target, currentBytes, candidateBytes);
        } catch (error) {
          return failureResult(
            new FlowDiagramOperationError('REVISION_FAILED', safeErrorMessage(error)),
            'REVISION_FAILED',
          );
        }

        try {
          await replaceFileAtomicallyIfVersionMatches(
            target,
            candidateBytes,
            expectedVersion,
            options.beforePublish,
          );
        } catch (error) {
          try {
            await revisions().consumeLatest(target, revisionToken);
          } catch (cleanupError) {
            return failureResult(
              new FlowDiagramOperationError('REVISION_FAILED', safeErrorMessage(cleanupError)),
              'REVISION_FAILED',
            );
          }
          return error instanceof FlowDiagramOperationError
            && error.code === FLOW_DIAGRAM_SOURCE_CHANGED
            ? sourceChangedResult(target, error.message)
            : failureResult(error, 'WRITE_FAILED');
        }

        const version = hashBytes(candidateBytes);
        notifyDocument(target, version);
        return {
          ok: true,
          filePath: target,
          document: { content, version },
        };
      });
    },

    async rollbackDocument(filePath) {
      let target: string;
      try {
        target = resolveProjectOwnedPath(projectPath, filePath, '.excalidraw');
      } catch (error) {
        return failureResult(error, 'ROLLBACK_FAILED');
      }

      return runProjectFileMutation(projectPath, async () => {
        let currentBytes: Buffer;
        try {
          currentBytes = readCurrentBytes(target);
          parseFlowDiagramScene(currentBytes);
        } catch (error) {
          return failureResult(error, 'ROLLBACK_FAILED');
        }

        let revision;
        try {
          revision = await revisions().peekLatest(target);
          if (!revision) {
            throw new FlowDiagramOperationError(
              'NO_REVISION',
              'No applicable Agent edit revision is available for this Flow Diagram.',
            );
          }
          parseFlowDiagramScene(revision.sourceBytes);
        } catch (error) {
          return failureResult(error, 'ROLLBACK_FAILED');
        }

        const currentVersion = hashBytes(currentBytes);
        if (currentVersion !== revision.appliedSourceHash) {
          return sourceChangedResult(
            target,
            'The Flow Diagram changed after the latest Agent edit; rollback was not applied.',
          );
        }

        try {
          await replaceFileAtomicallyIfVersionMatches(
            target,
            revision.sourceBytes,
            currentVersion,
            options.beforePublish,
          );
        } catch (error) {
          return error instanceof FlowDiagramOperationError
            && error.code === FLOW_DIAGRAM_SOURCE_CHANGED
            ? sourceChangedResult(target, error.message)
            : failureResult(error, 'ROLLBACK_FAILED');
        }

        const rollbackVersion = hashBytes(revision.sourceBytes);
        try {
          await revisions().consumeLatest(target, revision.token);
        } catch (error) {
          try {
            await replaceFileAtomicallyIfVersionMatches(
              target,
              currentBytes,
              rollbackVersion,
            );
          } catch {
            return failureResult(
              new FlowDiagramOperationError(
                'ROLLBACK_RESTORE_FAILED',
                'Rollback failed and the previous source could not be restored.',
              ),
              'ROLLBACK_RESTORE_FAILED',
            );
          }
          return failureResult(
            new FlowDiagramOperationError('REVISION_FAILED', safeErrorMessage(error)),
            'REVISION_FAILED',
          );
        }

        const content = revision.sourceBytes.toString('utf-8');
        notifyDocument(target, rollbackVersion);
        return {
          ok: true,
          filePath: target,
          document: { content, version: rollbackVersion },
        };
      });
    },

    async createExport(input) {
      let requestedTarget: string;
      try {
        const source = resolveProjectOwnedPath(
          projectPath,
          input.sourceFilePath,
          '.excalidraw',
        );
        const extension = `.${input.format}`;
        requestedTarget = input.requestedOutputPath
          ? resolveProjectOwnedPath(projectPath, input.requestedOutputPath, extension)
          : resolveProjectOwnedPath(
              projectPath,
              path.join(
                path.dirname(path.relative(projectPath, source)),
                `${path.basename(source, '.excalidraw')}${extension}`,
              ),
              extension,
            );
      } catch (error) {
        return failureResult(error, 'EXPORT_FAILED');
      }

      return runProjectFileMutation(projectPath, async () => {
        try {
          const target = input.requestedOutputPath
            ? requestedTarget
            : collisionSafePath(requestedTarget);
          await writeNewFileAtomically(target, input.bytes);
          notifyFile(target);
          return { ok: true, filePath: target };
        } catch (error) {
          return failureResult(error, 'EXPORT_FAILED');
        }
      });
    },

    async saveDocument(filePath, content, expectedVersion, mutationId) {
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
          await replaceFileAtomicallyIfVersionMatches(
            target,
            bytes,
            expectedVersion,
            options.beforePublish,
          );
          const version = hashBytes(bytes);
          notifyDocument(target, version, mutationId);
          return {
            ok: true,
            document: { content, version },
          } as const;
        } catch (error) {
          if (
            error instanceof FlowDiagramOperationError
            && error.code === FLOW_DIAGRAM_SOURCE_CHANGED
          ) {
            let currentContent: string | null = null;
            let currentVersion: FlowDiagramDocumentVersion | null = null;
            try {
              const currentBytes = fs.readFileSync(target);
              currentContent = currentBytes.toString('utf-8');
              currentVersion = hashBytes(currentBytes);
            } catch {
              currentContent = null;
            }
            return {
              ok: false as const,
              error: {
                code: FLOW_DIAGRAM_SOURCE_CHANGED,
                message: error.message,
                currentContent,
                currentVersion,
              },
            };
          }
          return failureResult(error, 'WRITE_FAILED');
        }
      });
    },
  };
}

function failureResult(
  error: unknown,
  fallbackCode: string,
): Extract<FlowDiagramDocumentSaveResult, { ok: false }> {
  if (error instanceof FlowDiagramOperationError || error instanceof FlowDiagramSceneError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: { code: fallbackCode, message: 'The Flow Diagram document could not be saved safely.' },
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The Flow Diagram operation could not be completed safely.';
}

function sourceChangedResult(
  filePath: string,
  message: string,
): FlowDiagramDocumentMutationResult {
  let currentContent: string | null = null;
  let currentVersion: FlowDiagramDocumentVersion | null = null;
  try {
    const currentBytes = fs.readFileSync(filePath);
    currentContent = currentBytes.toString('utf-8');
    currentVersion = hashBytes(currentBytes);
  } catch {
    currentContent = null;
  }
  return {
    ok: false,
    error: {
      code: FLOW_DIAGRAM_SOURCE_CHANGED,
      message,
      currentContent,
      currentVersion,
    },
  };
}
