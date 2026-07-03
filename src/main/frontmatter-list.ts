export function parseFrontmatterStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
  }
  if (typeof raw !== 'string') return [];

  const items: string[] = [];
  let current = '';
  let parenDepth = 0;
  for (const char of raw) {
    if (char === '(') parenDepth += 1;
    if (char === ')' && parenDepth > 0) parenDepth -= 1;
    if ((char === ',' || /\s/.test(char)) && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);
  return items;
}
