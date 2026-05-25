export function normalizeProviderApiUrl(apiUrl?: string): string | undefined {
  if (!apiUrl) return apiUrl;

  const trimmed = apiUrl.trim();
  if (!trimmed) return undefined;

  return trimmed;
}

export function isMiniMaxAnthropicApiUrl(apiUrl?: string): boolean {
  const normalized = normalizeProviderApiUrl(apiUrl);
  if (!normalized) return false;

  return (
    /^https:\/\/api\.minimaxi\.com\/anthropic(?:\/|$)/i.test(normalized) ||
    /^https:\/\/api\.minimax\.io\/anthropic(?:\/|$)/i.test(normalized)
  );
}

export function isDeepSeekAnthropicApiUrl(apiUrl?: string): boolean {
  const normalized = normalizeProviderApiUrl(apiUrl);
  if (!normalized) return false;

  return /^https:\/\/api\.deepseek\.com\/anthropic(?:\/|$)/i.test(normalized);
}

export function isAnthropicCompatibleApiUrl(apiUrl?: string): boolean {
  return isMiniMaxAnthropicApiUrl(apiUrl) || isDeepSeekAnthropicApiUrl(apiUrl);
}

export function shouldUseAnthropicAuthToken(apiUrl?: string, apiKey?: string): boolean {
  if (!apiKey) return false;
  return isMiniMaxAnthropicApiUrl(apiUrl) && /^sk-cp-/i.test(apiKey.trim());
}

export function normalizeAnthropicApiUrl(apiUrl?: string): string | undefined {
  const normalized = normalizeProviderApiUrl(apiUrl);
  if (!normalized) return normalized;

  return normalized
    .replace(/\/(v1\/)?(messages|models)\/?$/i, '')
    .replace(/\/v1\/?$/i, '')
    .replace(/\/?$/, '');
}

export function buildOpenAIModelsUrl(apiUrl?: string): string {
  const normalized = normalizeProviderApiUrl(apiUrl) || 'https://api.openai.com/v1';
  const baseUrl = normalized.replace(/\/chat\/completions\/?$/i, '').replace(/\/?$/, '');
  return `${baseUrl}/models`;
}

export function buildAnthropicModelsUrl(apiUrl?: string): string {
  const baseUrl = normalizeAnthropicApiUrl(apiUrl) || 'https://api.anthropic.com';
  return `${baseUrl}/v1/models`;
}
