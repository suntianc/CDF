/**
 * Classify runtime errors that are worth retrying rather than treating as terminal.
 * Used by model/tool retry middleware and by Conversation/Workflow error propagation.
 */
export function isTransientRuntimeError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes('timeout') ||
    name.includes('network') ||
    name.includes('rate') ||
    // undici/fetch stream cut: TypeError: terminated (LangChain isNetworkError)
    message === 'terminated' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('network error') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}
