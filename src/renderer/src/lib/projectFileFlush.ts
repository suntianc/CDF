type ProjectFileFlush = () => Promise<boolean>;

const projectFileFlushers = new Map<string, ProjectFileFlush>();

export function registerProjectFileFlush(
  filePath: string,
  flush: ProjectFileFlush,
): () => void {
  projectFileFlushers.set(filePath, flush);
  return () => {
    if (projectFileFlushers.get(filePath) === flush) {
      projectFileFlushers.delete(filePath);
    }
  };
}

export async function flushProjectFile(filePath: string): Promise<boolean> {
  return projectFileFlushers.get(filePath)?.() ?? true;
}
