import { RunnableLambda } from '@langchain/core/runnables';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { DelegatedAgentRunCoordinator } from './delegated-agent-run-coordinator';

export interface DelegatedSubagentTarget {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface DelegatedSubagentAdapterOptions {
  coordinator: DelegatedAgentRunCoordinator;
  target: DelegatedSubagentTarget;
}

function getDelegatedGoal(input: unknown): string {
  const messages = (input as { messages?: Array<{ content?: unknown }> } | null)?.messages;
  return Array.isArray(messages) && typeof messages[0]?.content === 'string'
    ? messages[0].content
    : '';
}

/**
 * Production DeepAgents boundary for one configured target Agent.
 *
 * The returned shape is a CompiledSubAgent: DeepAgents owns task-tool routing,
 * while CDF owns durable identity and execution through the coordinator.
 */
export function createDelegatedSubagentAdapter(options: DelegatedSubagentAdapterOptions) {
  const { coordinator, target } = options;
  return {
    name: target.slug,
    description: target.description,
    runnable: new RunnableLambda({
      func: async (input: unknown, config?: RunnableConfig) => {
        const invocationConfig = config as typeof config & {
          toolCall?: { id?: unknown };
        };
        const parentAgentRunId = invocationConfig?.configurable?.parentAgentRunId;
        if (typeof parentAgentRunId !== 'string' || !parentAgentRunId) {
          throw new Error('Delegated Agent Run requires parentAgentRunId');
        }
        const taskToolCallId = typeof invocationConfig?.toolCall?.id === 'string'
          ? invocationConfig.toolCall.id
          : null;
        const outcome = await coordinator.runSingle({
          parentAgentRunId,
          targetAgentId: target.id,
          targetAgentSlug: target.slug,
          targetAgentName: target.name,
          taskToolCallId,
          goal: getDelegatedGoal(input),
          input,
          signal: invocationConfig?.signal,
        });
        return {
          ...(input && typeof input === 'object' ? input : {}),
          structuredResponse: outcome,
        };
      },
    }),
  };
}
