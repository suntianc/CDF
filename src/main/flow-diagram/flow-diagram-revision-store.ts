import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface RevisionStackEntry {
  snapshot: string;
  appliedSourceHash: string;
  createdAt: number;
}

interface RevisionManifest {
  files: Record<string, RevisionStackEntry[]>;
}

export interface FlowDiagramRevision {
  token: string;
  sourceBytes: Buffer;
  appliedSourceHash: string;
}

export interface FlowDiagramRevisionStore {
  record(filePath: string, sourceBytes: Buffer, appliedSourceBytes: Buffer): Promise<string>;
  peekLatest(filePath: string): Promise<FlowDiagramRevision | null>;
  consumeLatest(filePath: string, token: string): Promise<void>;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runGit(repositoryPath: string, args: string[]): void {
  execFileSync('git', args, {
    cwd: repositoryPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

class GitFlowDiagramRevisionStore implements FlowDiagramRevisionStore {
  private readonly repositoryPath: string;
  private readonly manifestPath: string;

  constructor(
    private readonly projectPath: string,
    stateRoot: string,
  ) {
    const projectIdentity = sha256(fs.realpathSync(projectPath));
    this.repositoryPath = path.join(stateRoot, 'flow-diagram-revisions', projectIdentity);
    this.manifestPath = path.join(this.repositoryPath, 'revision-stack.json');
  }

  private ensureRepository(): void {
    const gitPath = path.join(this.repositoryPath, '.git');
    if (!fs.existsSync(gitPath)) {
      fs.mkdirSync(this.repositoryPath, { recursive: true, mode: 0o700 });
      runGit(this.repositoryPath, ['init', '--quiet']);
      runGit(this.repositoryPath, ['config', 'user.name', 'CDF Flow Diagram Revisions']);
      runGit(this.repositoryPath, ['config', 'user.email', 'flow-diagrams@cdf.local']);
      fs.writeFileSync(
        path.join(this.repositoryPath, '.gitignore'),
        'revision-stack.json\nrevision-stack.json.tmp-*\n',
        'utf8',
      );
      runGit(this.repositoryPath, ['add', '.gitignore']);
      runGit(this.repositoryPath, ['commit', '--quiet', '-m', 'Initialize Flow Diagram revisions']);
    }
    runGit(this.repositoryPath, ['config', 'core.longpaths', 'true']);
  }

  private fileKey(filePath: string): string {
    return sha256(path.relative(this.projectPath, filePath).replace(/\\/g, '/'));
  }

  private readManifest(): RevisionManifest {
    if (!fs.existsSync(this.manifestPath)) return { files: {} };
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      const files = (parsed as Record<string, unknown>).files;
      if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error();
      const validated: RevisionManifest = { files: {} };
      for (const [key, value] of Object.entries(files)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(value) || value.length > 10_000) {
          throw new Error();
        }
        validated.files[key] = value.map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error();
          const record = entry as Record<string, unknown>;
          if (
            typeof record.snapshot !== 'string'
            || !record.snapshot.startsWith(`snapshots/${key}/`)
            || path.posix.normalize(record.snapshot) !== record.snapshot
            || typeof record.appliedSourceHash !== 'string'
            || !/^[a-f0-9]{64}$/.test(record.appliedSourceHash)
            || typeof record.createdAt !== 'number'
            || !Number.isFinite(record.createdAt)
          ) {
            throw new Error();
          }
          return {
            snapshot: record.snapshot,
            appliedSourceHash: record.appliedSourceHash,
            createdAt: record.createdAt,
          };
        });
      }
      return validated;
    } catch {
      throw new Error('Flow Diagram revision stack is unreadable.');
    }
  }

  private resolveSnapshotPath(snapshot: string): string {
    const resolved = path.resolve(this.repositoryPath, snapshot);
    const relative = path.relative(this.repositoryPath, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Flow Diagram revision snapshot is outside internal storage.');
    }
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Flow Diagram revision snapshot is invalid.');
    }
    const realRelative = path.relative(fs.realpathSync(this.repositoryPath), fs.realpathSync(resolved));
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error('Flow Diagram revision snapshot resolves outside internal storage.');
    }
    return resolved;
  }

  async record(
    filePath: string,
    sourceBytes: Buffer,
    appliedSourceBytes: Buffer,
  ): Promise<string> {
    this.ensureRepository();
    const key = this.fileKey(filePath);
    const snapshotName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.excalidraw`;
    const snapshotRelativePath = path.posix.join('snapshots', key, snapshotName);
    const snapshotPath = path.join(this.repositoryPath, snapshotRelativePath);
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true, mode: 0o700 });

    let committed = false;
    try {
      fs.writeFileSync(snapshotPath, sourceBytes, { flag: 'wx', mode: 0o600 });
      runGit(this.repositoryPath, ['add', '--', snapshotRelativePath]);
      runGit(this.repositoryPath, [
        'commit',
        '--quiet',
        '-m',
        `Record Flow Diagram revision ${key.slice(0, 12)}`,
        '--',
        snapshotRelativePath,
      ]);
      committed = true;
      const manifest = this.readManifest();
      const stack = manifest.files[key] ?? [];
      manifest.files[key] = [
        ...stack,
        {
          snapshot: snapshotRelativePath,
          appliedSourceHash: sha256(appliedSourceBytes),
          createdAt: Date.now(),
        },
      ];
      writeJsonAtomically(this.manifestPath, manifest);
      return snapshotRelativePath;
    } catch (error) {
      if (!committed) {
        fs.rmSync(snapshotPath, { force: true });
        try {
          runGit(this.repositoryPath, ['reset', '--quiet', '--', snapshotRelativePath]);
        } catch {
          // The revision repository is internal; the original Project file is still untouched.
        }
      }
      throw error;
    }
  }

  async peekLatest(filePath: string): Promise<FlowDiagramRevision | null> {
    if (!fs.existsSync(this.repositoryPath)) return null;
    const key = this.fileKey(filePath);
    const latest = (this.readManifest().files[key] ?? []).at(-1);
    if (!latest) return null;
    return {
      token: latest.snapshot,
      sourceBytes: fs.readFileSync(this.resolveSnapshotPath(latest.snapshot)),
      appliedSourceHash: latest.appliedSourceHash,
    };
  }

  async consumeLatest(filePath: string, token: string): Promise<void> {
    const key = this.fileKey(filePath);
    const manifest = this.readManifest();
    const stack = manifest.files[key] ?? [];
    const latest = stack.at(-1);
    if (!latest || latest.snapshot !== token) {
      throw new Error('Flow Diagram revision stack changed before it could be consumed.');
    }
    const nextStack = stack.slice(0, -1);
    if (nextStack.length > 0) manifest.files[key] = nextStack;
    else delete manifest.files[key];
    writeJsonAtomically(this.manifestPath, manifest);
  }
}

export function createFlowDiagramRevisionStore(
  projectPath: string,
  stateRoot: string,
): FlowDiagramRevisionStore {
  return new GitFlowDiagramRevisionStore(projectPath, stateRoot);
}
