import type { AgentToolScopeConfig } from '../../shared/agents';

interface NamedTool {
  name?: unknown;
}

interface IdentifiedMcpServer {
  id: string;
}

interface SelectDelegatedToolScopeInput<
  TTool extends NamedTool,
  TServer extends IdentifiedMcpServer,
> {
  agentConfig: string | Record<string, unknown> | null | undefined;
  parentBuiltInToolNames: string[];
  childBuiltInTools: TTool[];
  parentMcpServerIds: string[];
  childMcpServers: TServer[];
}

function parseAgentConfig(
  value: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function readAgentToolScope(
  agentConfig: string | Record<string, unknown> | null | undefined,
): AgentToolScopeConfig {
  const raw = parseAgentConfig(agentConfig).toolScope;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { mode: 'inherit' };
  }
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'narrow') return { mode: 'inherit' };
  return {
    mode: 'narrow',
    builtInTools: Array.isArray(value.builtInTools)
      ? value.builtInTools.filter((item): item is string => typeof item === 'string')
      : [],
    mcpServerIds: Array.isArray(value.mcpServerIds)
      ? value.mcpServerIds.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export function selectDelegatedToolScope<
  TTool extends NamedTool,
  TServer extends IdentifiedMcpServer,
>(input: SelectDelegatedToolScopeInput<TTool, TServer>): {
  mode: AgentToolScopeConfig['mode'];
  builtInTools: TTool[];
  mcpServers: TServer[];
} {
  const scope = readAgentToolScope(input.agentConfig);
  const parentToolNames = new Set(input.parentBuiltInToolNames);
  const parentServerIds = new Set(input.parentMcpServerIds);
  const selectedToolNames = scope.mode === 'narrow'
    ? new Set(scope.builtInTools)
    : null;
  const selectedServerIds = scope.mode === 'narrow'
    ? new Set(scope.mcpServerIds)
    : null;

  return {
    mode: scope.mode,
    builtInTools: input.childBuiltInTools.filter((item) => (
      typeof item.name === 'string'
      && parentToolNames.has(item.name)
      && (!selectedToolNames || selectedToolNames.has(item.name))
    )),
    mcpServers: input.childMcpServers.filter((item) => (
      parentServerIds.has(item.id)
      && (!selectedServerIds || selectedServerIds.has(item.id))
    )),
  };
}
