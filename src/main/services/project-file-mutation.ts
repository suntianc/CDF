const projectMutationTails = new Map<string, Promise<void>>();

/** Serialize Project file mutations so Agent tools and renderer autosaves cannot interleave. */
export async function runProjectFileMutation<T>(
  projectPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const previous = projectMutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  projectMutationTails.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectMutationTails.get(key) === tail) projectMutationTails.delete(key);
  }
}
