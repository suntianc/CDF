import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StaticSkillPackageResource {
  relativePath: string;
  content: string;
}

export interface StaticSkillPackage {
  name: string;
  markdown: string;
  resources: readonly StaticSkillPackageResource[];
}

function normalizeResourcePath(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (
    path.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
    || normalized === 'SKILL.md'
  ) {
    throw new Error(`Invalid static Skill resource path: ${relativePath}`);
  }
  return normalized;
}

function getDeclaredFiles(skillPackage: StaticSkillPackage): Map<string, string> {
  const files = new Map<string, string>([['SKILL.md', skillPackage.markdown]]);
  for (const resource of skillPackage.resources) {
    const relativePath = normalizeResourcePath(resource.relativePath);
    if (files.has(relativePath)) {
      throw new Error(`Duplicate static Skill resource path: ${resource.relativePath}`);
    }
    files.set(relativePath, resource.content);
  }
  return files;
}

function getPackageHash(skillPackage: StaticSkillPackage, files: ReadonlyMap<string, string>): string {
  const hash = crypto.createHash('sha256').update(skillPackage.name).update('\0');
  for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relativePath).update('\0').update(content).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function listFiles(rootDir: string, currentDir = rootDir): string[] {
  if (!fs.existsSync(currentDir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(rootDir, entryPath));
    } else {
      files.push(path.relative(rootDir, entryPath));
    }
  }
  return files.sort();
}

function isCompletePackage(targetDir: string, files: ReadonlyMap<string, string>): boolean {
  const declaredPaths = [...files.keys()].sort();
  const actualPaths = listFiles(targetDir);
  if (actualPaths.length !== declaredPaths.length) return false;
  if (actualPaths.some((actualPath, index) => actualPath !== declaredPaths[index])) return false;
  return declaredPaths.every((relativePath) => (
    fs.readFileSync(path.join(targetDir, relativePath), 'utf-8') === files.get(relativePath)
  ));
}

function writePackage(targetDir: string, files: ReadonlyMap<string, string>): void {
  for (const [relativePath, content] of files) {
    const filePath = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

/** Publishes a complete, content-addressed static Skill directory with one atomic rename. */
export function materializeStaticSkillPackage(
  builtInSkillsRoot: string,
  skillPackage: StaticSkillPackage,
): string {
  const files = getDeclaredFiles(skillPackage);
  const packageRoot = path.join(builtInSkillsRoot, skillPackage.name);
  const contentHash = getPackageHash(skillPackage, files);
  const targetVersionDir = path.join(packageRoot, contentHash);
  const targetSkillDir = path.join(targetVersionDir, skillPackage.name);
  fs.mkdirSync(packageRoot, { recursive: true });

  if (isCompletePackage(targetSkillDir, files)) return targetSkillDir;

  const stagingDir = fs.mkdtempSync(path.join(packageRoot, `.staging-${contentHash}-${process.pid}-`));
  const stagingSkillDir = path.join(stagingDir, skillPackage.name);
  try {
    writePackage(stagingSkillDir, files);
    try {
      fs.renameSync(stagingDir, targetVersionDir);
      return targetSkillDir;
    } catch (error) {
      if (isCompletePackage(targetSkillDir, files)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        return targetSkillDir;
      }
      if (!fs.existsSync(targetVersionDir)) throw error;

      const fallbackVersionDir = path.join(packageRoot, `${contentHash}-${crypto.randomUUID()}`);
      fs.renameSync(stagingDir, fallbackVersionDir);
      return path.join(fallbackVersionDir, skillPackage.name);
    }
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
