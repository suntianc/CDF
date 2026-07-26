import os from 'os';
import path from 'path';
import { FilesystemBackend } from 'deepagents';

/**
 * deepagents 的 FilesystemBackend 在 virtualMode:false 下对绝对路径原样放行，配上
 * rootDir:"/" 等于让 Agent 的 read_file/glob/grep 等文件工具可读写整块磁盘（~/.ssh、
 * 任意 .env）。系统提示词又要求 Agent 用绝对路径，且合法需要写 ~/.cdf/skills（项目外
 * 全局技能），所以不能简单切到 virtualMode:true 的项目沙箱。
 *
 * 这里保留绝对路径语义，但把每次文件操作限制在一组允许根内：项目根、~/.cdf（全局技能/
 * 命令）、os.tmpdir()（内建技能目录 + bash 默认工作目录）、以及显式传入的额外根（如
 * userData）。越界即抛错，交由工具层反馈给模型。
 */

export function computeAgentFileRoots(projectPath: string, extraRoots: string[] = []): string[] {
  const roots = [
    projectPath,
    path.join(os.homedir(), '.cdf'),
    os.tmpdir(),
    ...extraRoots,
  ].filter(Boolean);
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 校验 `p` 是否落在允许根内。相对路径按项目根（约定的工作目录）解析。越界抛错。
 * projectRoot 用于相对路径解析，应为 allowedRoots 中的项目根。
 */
export function assertPathWithinRoots(
  p: string,
  allowedRoots: string[],
  projectRoot: string,
  op: string
): void {
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(projectRoot, p);
  if (!allowedRoots.some((root) => isWithin(root, abs))) {
    throw new Error(
      `Access denied: ${op} is outside the allowed project/app directories: ${p}`
    );
  }
}

export interface ProjectConfinedBackendOptions {
  rootDir?: string;
  virtualMode?: boolean;
  maxFileSizeMb?: number;
  allowedRoots: string[];
  /** 相对路径与未指定搜索目录时使用的默认根（项目根）。 */
  projectRoot: string;
}

export class ProjectConfinedFilesystemBackend extends FilesystemBackend {
  private allowedRoots: string[];
  private projectRoot: string;

  constructor(options: ProjectConfinedBackendOptions) {
    const { allowedRoots, projectRoot, ...backendOptions } = options;
    super(backendOptions);
    this.allowedRoots = allowedRoots.map((root) => path.resolve(root));
    this.projectRoot = path.resolve(projectRoot);
  }

  private guard(p: string, op: string): void {
    assertPathWithinRoots(p, this.allowedRoots, this.projectRoot, op);
  }

  async ls(dirPath: string) {
    this.guard(dirPath, 'ls');
    return super.ls(dirPath);
  }

  async read(filePath: string, offset?: number, limit?: number) {
    this.guard(filePath, 'read');
    return super.read(filePath, offset, limit);
  }

  async readRaw(filePath: string) {
    this.guard(filePath, 'read');
    return super.readRaw(filePath);
  }

  async write(filePath: string, content: string) {
    this.guard(filePath, 'write');
    return super.write(filePath, content);
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean) {
    this.guard(filePath, 'edit');
    return super.edit(filePath, oldString, newString, replaceAll);
  }

  async grep(pattern: string, dirPath?: string, glob?: string | null) {
    // Unscoped grep would otherwise walk from rootDir; pin it to the project root.
    const base = dirPath ?? this.projectRoot;
    this.guard(base, 'grep');
    return super.grep(pattern, base, glob);
  }

  async glob(pattern: string, searchPath?: string) {
    const base = searchPath ?? this.projectRoot;
    this.guard(base, 'glob');
    return super.glob(pattern, base);
  }

  async uploadFiles(files: Array<[string, Uint8Array]>) {
    for (const [p] of files) this.guard(p, 'upload');
    return super.uploadFiles(files);
  }

  async downloadFiles(paths: string[]) {
    for (const p of paths) this.guard(p, 'download');
    return super.downloadFiles(paths);
  }
}
