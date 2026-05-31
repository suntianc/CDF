export function getFolderName(path?: string): string {
  if (!path) return '';
  const trimmed = path.replace(/[/\\]+$/, '');
  const lastIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastIdx === -1) return trimmed;
  return trimmed.slice(lastIdx + 1);
}
