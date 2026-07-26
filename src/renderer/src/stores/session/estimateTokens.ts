export function estimateTokens(text: string): number {
  if (!text) return 0;
  let englishChars = 0;
  let cjkChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkChars++;
    } else {
      englishChars++;
    }
  }
  return Math.ceil(englishChars / 4) + Math.ceil(cjkChars * 1.5);
}
