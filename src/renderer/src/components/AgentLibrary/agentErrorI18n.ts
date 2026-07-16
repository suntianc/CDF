export type AgentErrorTranslationKey =
  | 'agent.globalNameConflict'
  | 'agent.globalDelegationKeyConflict'
  | 'agent.protectedOperationError'
  | 'agent.skillPreloadGlobalOnly'
  | 'agent.saveError'
  | 'agent.operationError';

export function getAgentErrorTranslationKey(
  error: unknown,
  fallback: AgentErrorTranslationKey = 'agent.saveError',
): AgentErrorTranslationKey {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/name conflicts with an existing Agent|globally unique/i.test(message)) return 'agent.globalNameConflict';
  if (/delegation key conflicts with an existing Agent/i.test(message)) {
    return 'agent.globalDelegationKeyConflict';
  }
  if (/protected|only Custom Agents/i.test(message)) return 'agent.protectedOperationError';
  if (/Global Skill|Project Skill/i.test(message)) return 'agent.skillPreloadGlobalOnly';
  return fallback;
}
