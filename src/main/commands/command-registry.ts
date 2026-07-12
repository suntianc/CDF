import type { CommandConflictError, SlashCommand } from '../../shared/types';
import { collectMcpCommands } from './collectors/mcp';
import { collectProjectCommands } from './collectors/project';
import { collectSkillCommands } from './collectors/skill';
import { collectSystemCommands } from './collectors/system';
import type { SkillCatalogOptions } from '../deepagent/skills-runtime/skill-sources';
import { detectConflicts } from './conflict-detector';

export interface HealthWarning {
  type: 'mcp_health_warning';
  message: string;
}

export interface RegistryResult {
  commands: SlashCommand[];
  conflicts: CommandConflictError[];
  warnings: HealthWarning[];
}

/** Phase 6 4-source registry merger.
 *
 *  - `Promise.allSettled` provides failure isolation per source (P6.1: a single
 *    collector throwing does not prevent the other 3 from returning).
 *  - `commands` array preserves ALL rows (D-05: two rows kept on conflict; P6.2:
 *    do NOT dedupe; conflicts are info, not removal signal).
 *  - `conflicts` is computed via `detectConflicts` which returns the array (D-07
 *    lock: does NOT throw).
 *  - `warnings` carries the mcp_health_warning iff `hasAgentMcp === true` AND
 *    no MCP tools loaded (P6.5 discrimination).
 */
export async function collectAllCommands(
  projectPath: string,
  agentId: string,
  skillOptions: SkillCatalogOptions = {}
): Promise<RegistryResult> {
  // Run all 4 collectors through Promise.allSettled. The system collector is
  // sync but we still wrap it in a settled promise to ensure uniform error
  // handling (P6.1: any single collector failing should not block the others).
  const [system, mcp, skills, projects] = await Promise.allSettled([
    Promise.resolve().then(() => collectSystemCommands()),
    collectMcpCommands(agentId),
    collectSkillCommands(projectPath, skillOptions),
    collectProjectCommands(projectPath),
  ]);

  const mcpResult = mcp.status === 'fulfilled' ? mcp.value : null;
  const mcpCommands: SlashCommand[] = mcpResult?.commands ?? [];

  const commands: SlashCommand[] = [
    ...(system.status === 'fulfilled' ? system.value : []),
    ...mcpCommands,
    ...(skills.status === 'fulfilled' ? skills.value : []),
    ...(projects.status === 'fulfilled' ? projects.value : []),
  ];

  const conflicts = detectConflicts(commands);

  const warnings: HealthWarning[] =
    mcpResult && mcpResult.hasAgentMcp && mcpCommands.length === 0
      ? [{ type: 'mcp_health_warning', message: 'MCP 工具加载失败，请检查连接' }]
      : [];

  return { commands, conflicts, warnings };
}
