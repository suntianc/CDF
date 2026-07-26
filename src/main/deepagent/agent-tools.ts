import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';
import { createAgentCatalog, type CatalogAgent } from '../agent-catalog';
import { listGlobalSkillViews } from './skill-catalog';

const AGENT_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;

function createGlobalAgentCatalog() {
  return createAgentCatalog(db, {
    initializeSchema: false,
    listGlobalSkillIds: () => listGlobalSkillViews().map((skill) => skill.id),
  });
}

function serialize(agent: CatalogAgent) {
  return { ...agent, effective_slug: agent.slug, library_scope: 'global Agent Library' };
}

function resolveCreateProviderId(providerId: string | null | undefined): string {
  if (providerId) {
    if (!db.prepare('SELECT id FROM llm_providers WHERE id = ?').get(providerId)) throw new Error(`Provider not found: ${providerId}`);
    return providerId;
  }

  const provider = db.prepare('SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').get() as { id: string } | undefined
    ?? db.prepare('SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1').get() as { id: string } | undefined;
  if (!provider) throw new Error('No LLM provider is configured. Configure and activate a provider before creating an Agent.');
  return provider.id;
}

function validateUpdateProviderId(providerId: string | null | undefined): void {
  if (providerId === undefined) return;
  if (!providerId) throw new Error('Cannot clear provider_id; omit it to keep the current provider.');
  if (!db.prepare('SELECT id FROM llm_providers WHERE id = ?').get(providerId)) throw new Error(`Provider not found: ${providerId}`);
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed && AGENT_NAME_REGEX.test(trimmed) ? trimmed : null;
}

export function createAgentTools(
  options: { activeAgentId?: string | null } = {},
) {
  return [
    tool(async () => JSON.stringify(
      createGlobalAgentCatalog().listDelegationTargets().map(serialize),
    ), {
      name: 'list_agents',
      description: '列出全局 Agent Library 中可被 Master Agent 调用的子 Agent，不包含 Master Agent。',
      schema: z.object({}),
    }),
    tool(async (input: {
      name: string;
      description?: string;
      provider_id?: string | null;
      system_prompt?: string;
      mcpServerExclusionIds?: string[];
      skillNames?: string[];
      config?: Record<string, unknown>;
    }) => {
      const name = validateName(input.name);
      if (!name) return JSON.stringify({ error: 'Invalid agent name. Must contain only English letters, numbers, spaces, hyphens, or underscores.' });
      try {
        const providerId = resolveCreateProviderId(input.provider_id);
        const created = createGlobalAgentCatalog().createCustom({
          ...input,
          name,
          provider_id: providerId,
          description: input.description ?? null,
          system_prompt: input.system_prompt ?? null,
          config: input.config ?? null,
        });
        return JSON.stringify(serialize(created));
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'create_agent',
      description: '在全局 Agent Library 中创建一个 Custom Agent；此写操作会影响所有项目。',
      schema: z.object({
        name: z.string(), description: z.string().optional(), provider_id: z.string().nullable().optional(),
        system_prompt: z.string().optional(), mcpServerExclusionIds: z.array(z.string()).optional(),
        skillNames: z.array(z.string()).optional(), config: z.record(z.string(), z.unknown()).optional(),
      }),
    }),
    tool(async (input: {
      id: string;
      name?: string;
      description?: string;
      provider_id?: string | null;
      system_prompt?: string;
      mcpServerExclusionIds?: string[];
      skillNames?: string[];
      config?: Record<string, unknown>;
    }) => {
      const catalog = createGlobalAgentCatalog();
      const existing = catalog.get(input.id);
      if (!existing) return JSON.stringify({ error: `Agent not found: ${input.id}` });
      if (existing.role !== 'custom') return JSON.stringify({ error: `${existing.name} is protected; only Custom Agents can be updated.` });
      if (input.name !== undefined && !validateName(input.name)) return JSON.stringify({ error: 'Invalid agent name. Must contain only English letters, numbers, spaces, hyphens, or underscores.' });
      try {
        validateUpdateProviderId(input.provider_id);
        const updated = catalog.updateCustom(input.id, input);
        return JSON.stringify(serialize(updated));
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'update_agent',
      description: '更新全局 Agent Library 中一个 Custom Agent 的配置；此写操作会影响所有项目。系统 Agent 受保护，不能通过此工具修改。',
      schema: z.object({
        id: z.string(), name: z.string().optional(), description: z.string().optional(), provider_id: z.string().nullable().optional(),
        system_prompt: z.string().optional(), mcpServerExclusionIds: z.array(z.string()).optional(),
        skillNames: z.array(z.string()).optional(), config: z.record(z.string(), z.unknown()).optional(),
      }),
    }),
    tool(async ({ id }: { id: string }) => {
      if (!id.trim()) return JSON.stringify({ error: 'Agent id is required.' });
      if (options.activeAgentId === id) return JSON.stringify({ error: `Cannot delete the agent currently running this chat session (id=${id}).` });
      try {
        const catalog = createGlobalAgentCatalog();
        const existing = catalog.get(id);
        if (!existing) return JSON.stringify({ error: `Agent not found: ${id}` });
        const inFlight = db.prepare("SELECT id FROM agent_runs WHERE agent_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1").get(id);
        if (inFlight) return JSON.stringify({ error: 'Cannot delete agent with an in-flight run.' });
        catalog.deleteCustom(id);
        return JSON.stringify({ deleted: true, id, name: existing.name, library_scope: 'global Agent Library' });
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'delete_agent',
      description: '从全局 Agent Library 删除一个 Custom Agent；此写操作会影响所有项目。',
      schema: z.object({ id: z.string() }),
    }),
  ];
}
