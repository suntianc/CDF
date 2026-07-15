import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';
import { createAgentCatalog, type CatalogAgent } from '../agent-catalog';

const AGENT_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;

function getMcpExclusionIds(agentId: string): string[] {
  return (db.prepare('SELECT mcp_server_id FROM agent_mcp_exclusions WHERE agent_id = ?').all(agentId) as Array<{ mcp_server_id: string }>).map((row) => row.mcp_server_id);
}

function getSkillNames(agentId: string): string[] {
  return (db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(agentId) as Array<{ skill_name: string }>).map((row) => row.skill_name);
}

function serialize(agent: CatalogAgent) {
  return {
    ...agent,
    effective_slug: agent.slug,
    mcpServerExclusionIds: getMcpExclusionIds(agent.id),
    skillNames: getSkillNames(agent.id),
  };
}

function saveRelations(agentId: string, input: { mcpServerExclusionIds?: string[]; skillNames?: string[] }): void {
  if (input.mcpServerExclusionIds !== undefined) {
    db.prepare('DELETE FROM agent_mcp_exclusions WHERE agent_id = ?').run(agentId);
    const insert = db.prepare('INSERT INTO agent_mcp_exclusions (agent_id, mcp_server_id) VALUES (?, ?)');
    for (const id of new Set(input.mcpServerExclusionIds)) {
      if (db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id)) insert.run(agentId, id);
    }
  }
  if (input.skillNames !== undefined) {
    db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId);
    const insert = db.prepare('INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, ?)');
    for (const name of new Set(input.skillNames.map((value) => value.trim()).filter(Boolean))) insert.run(agentId, name);
  }
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
  projectId: string,
  options: { activeAgentId?: string | null } = {},
) {
  void projectId; // Agent Catalog is global; #184 removes this transport parameter.
  return [
    tool(async () => JSON.stringify(
      createAgentCatalog(db, { initializeSchema: false }).listDelegationTargets().map(serialize),
    ), {
      name: 'list_agents',
      description: '列出可被 Master Agent 调用的全局子 agent，不包含 Master Agent。',
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
        const catalog = createAgentCatalog(db, { initializeSchema: false });
        const created = db.transaction(() => {
          const agent = catalog.createCustom({
            name,
            description: input.description ?? null,
            provider_id: providerId,
            system_prompt: input.system_prompt ?? null,
            config: input.config ?? null,
          });
          saveRelations(agent.id, input);
          return agent;
        })();
        return JSON.stringify(serialize(created));
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'create_agent',
      description: '创建一个全局 Custom Agent。',
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
      const catalog = createAgentCatalog(db, { initializeSchema: false });
      const existing = catalog.get(input.id);
      if (!existing) return JSON.stringify({ error: `Agent not found: ${input.id}` });
      if (existing.role !== 'custom') return JSON.stringify({ error: `${existing.name} is protected; only Custom Agents can be updated.` });
      if (input.name !== undefined && !validateName(input.name)) return JSON.stringify({ error: 'Invalid agent name. Must contain only English letters, numbers, spaces, hyphens, or underscores.' });
      try {
        validateUpdateProviderId(input.provider_id);
        const updated = db.transaction(() => {
          const agent = catalog.updateCustom(input.id, input);
          saveRelations(agent.id, input);
          return agent;
        })();
        return JSON.stringify(serialize(updated));
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'update_agent',
      description: '更新一个全局 Custom Agent 的配置。系统 Agent 受保护，不能通过此工具修改。',
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
        const catalog = createAgentCatalog(db, { initializeSchema: false });
        const existing = catalog.get(id);
        if (!existing) return JSON.stringify({ error: `Agent not found: ${id}` });
        const inFlight = db.prepare("SELECT id FROM agent_runs WHERE agent_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1").get(id);
        if (inFlight) return JSON.stringify({ error: 'Cannot delete agent with an in-flight run.' });
        catalog.deleteCustom(id);
        return JSON.stringify({ deleted: true, id, name: existing.name });
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    }, {
      name: 'delete_agent',
      description: '删除一个 Custom Agent。',
      schema: z.object({ id: z.string() }),
    }),
  ];
}
