import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface RevisionStackEntry {
  snapshot: string;
  createdAt: number;
}

interface RevisionManifest {
  files: Record<string, RevisionStackEntry[]>;
}

export interface FlowDiagramRevisionStore {
  record(filePath: string, sourceBytes: Buffer): Promise<void>;
  popLatest(
    filePath: string,
    apply?: (sourceBytes: Buffer) => Promise<void>,
  ): Promise<Buffer | null>;
}

function sha256(value: string): string {
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
    if (fs.existsSync(path.join(this.repositoryPath, '.git'))) return;
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

  private fileKey(filePath: string): string {
    return sha256(path.relative(this.projectPath, filePath).replace(/\\/g, '/'));
  }

  private readManifest(): RevisionManifest {
    if (!fs.existsSync(this.manifestPath)) return { files: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as RevisionManifest;
      return parsed && parsed.files && typeof parsed.files === 'object'
        ? parsed
        : { files: {} };
    } catch {
      throw new Error('Flow Diagram revision stack is unreadable.');
    }
  }

  async record(filePath: string, sourceBytes: Buffer): Promise<void> {
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
        { snapshot: snapshotRelativePath, createdAt: Date.now() },
      ];
      writeJsonAtomically(this.manifestPath, manifest);
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

  async popLatest(
    filePath: string,
    apply?: (sourceBytes: Buffer) => Promise<void>,
  ): Promise<Buffer | null> {
    if (!fs.existsSync(this.repositoryPath)) return null;
    const key = this.fileKey(filePath);
    const manifest = this.readManifest();
    const stack = manifest.files[key] ?? [];
    const latest = stack.at(-1);
    if (!latest) return null;
    const snapshotPath = path.join(this.repositoryPath, latest.snapshot);
    const sourceBytes = fs.readFileSync(snapshotPath);

    if (apply) await apply(sourceBytes);

    const nextStack = stack.slice(0, -1);
    if (nextStack.length > 0) manifest.files[key] = nextStack;
    else delete manifest.files[key];
    writeJsonAtomically(this.manifestPath, manifest);
    return sourceBytes;
  }
}

export function createFlowDiagramRevisionStore(
  projectPath: string,
  stateRoot: string,
): FlowDiagramRevisionStore {
  return new GitFlowDiagramRevisionStore(projectPath, stateRoot);
}
