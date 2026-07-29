import crypto from 'crypto';
import type { ToolMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { createMiddleware } from 'langchain';
import { createDeepAgent, CompositeBackend, StateBackend } from 'deepagents';
import log from '../logger';
import { assembleDeepAgentRuntime, extractPathMentionContext } from './runtime-assembly';
import {
  createBuiltInTools,
  getRuntimeToolNames,
  loadMcpTools,
  loadRegistryTools,
  resolveInterruptOn,
} from './shared-infra';
import { readAgentToolScope, selectDelegatedToolScope } from './agent-tool-scope';
import { resolveDelegatedModelOverrides } from './delegated-model-selection';
import { ProjectConfinedFilesystemBackend } from './project-confined-backend';
import { DEEPAGENT_CHECKPOINT_NAMESPACE } from './conversation-working-state';
import { subagentStepStorage } from './subagent-step-storage';
import type {
  DelegatedRuntimeAdapter,
  DelegatedRuntimeRequest,
} from './delegated-agent-run-coordinator';
import type { DelegatedToolActionInput } from './delegated-tool-approval-scheduler';
import {
  DELEGATED_TASK_RESULT_SCHEMA,
  type ApprovalMode,
  type ChatRuntimeOverrides,
  type DelegatedTaskResult,
  type MCPServer,
  type ProjectScene,
} from '../../shared/types';
import type { ConversationSkillSnapshotEntry } from '../../shared/skills';

/**
 * Delegated Agent Run 的隔离运行时构造（ADR-0061 实现本体）。
 *
 * 父运行向子运行的继承契约收敛为 DelegatedParentContext 的显式字段：
 * 审批模式（ADR-0063）、工具 scope 收窄基线（ADR-0062）、Conversation
 * Skill Snapshot 传播、模型选择输入与文件系统限域。coordinator 持有本
 * adapter，而 adapter 仅在执行期经延迟解析取回审批门控入口——原先靠
 * 装配闭包捕获形成的双向绑定改为显式注入。
 */

export interface DelegatedParentContext {
  /** ADR-0063: Delegated Runs inherit the one Conversation approval mode. */
  approvalMode: ApprovalMode;
  /** ADR-0062 收窄基线：父运行的内建工具名集合。 */
  parentBuiltInToolNames: string[];
  /** ADR-0062 收窄基线：父运行可见的 MCP server 标识。 */
  parentMcpServerIds: string[];
  /** 全量已连接 MCP 目录；子候选集 = 全量 - 配置快照排除项。 */
  allMcpServers: MCPServer[];
  /** Conversation Skill Snapshot：子运行 Skill 预载只能从中选择。 */
  skillSnapshot: readonly ConversationSkillSnapshotEntry[] | null;
  /** 父 provider 标识，作为委派模型选择的回退输入。 */
  providerId: string;
  /** 父模型 overrides（含 allowedTools 韧性约束）。 */
  parentOverrides: ChatRuntimeOverrides | undefined;
  project: { name: string; path: string; scene?: ProjectScene };
  /** 文件系统限域根（含 Project 根与既定附加根）。 */
  agentFileRoots: string[];
  sessionId: string;
}

type DeepAgentMiddleware = NonNullable<
  NonNullable<Parameters<typeof createDeepAgent>[0]>['middleware']
>;

export type DelegatedResilienceMiddlewareFactory = (
  ...allowedToolSets: Array<string[] | undefined>
) => DeepAgentMiddleware;

export type RunDelegatedToolAction = <T>(
  input: DelegatedToolActionInput<T>,
) => Promise<T | ToolMessage>;

export interface DelegatedRuntimeExecutionDependencies {
  assembleRuntime: typeof assembleDeepAgentRuntime;
  createAgentGraph: typeof createDeepAgent;
  loadMcpTools: typeof loadMcpTools;
  createBuiltInTools: typeof createBuiltInTools;
  loadRegistryTools: typeof loadRegistryTools;
  /** ADR-0063: 解析子运行审批门控集合；生产默认用 shared-infra 真实现。 */
  resolveInterruptOn: typeof resolveInterruptOn;
}

export interface CreateDelegatedRuntimeAdapterOptions {
  /**
   * 审批门控窄能力的延迟解析：coordinator 构造时持有 adapter，adapter 仅在
   * run() 执行期取回执行单次 tool action 的 callback，不感知 coordinator。
   */
  resolveRunDelegatedToolAction: () => RunDelegatedToolAction;
  /** 子运行韧性中间件工厂（工具/模型重试与失败观察归属装配层）。 */
  createResilienceMiddleware: DelegatedResilienceMiddlewareFactory;
  dependencies?: Partial<DelegatedRuntimeExecutionDependencies>;
}

function createDelegatedToolApprovalMiddleware(
  runDelegatedToolAction: RunDelegatedToolAction,
  delegatedRunId: string,
  gatedToolNames: Set<string>,
) {
  return createMiddleware({
    name: 'DelegatedToolApprovalMiddleware',
    wrapToolCall: async (request, handler) => {
      const runtimeTool = request as { tool?: { name?: string } };
      const toolName = request.toolCall?.name || runtimeTool.tool?.name || 'unknown';
      const actionId = request.toolCall?.id || crypto.randomUUID();
      return runDelegatedToolAction({
        delegatedRunId,
        action: {
          id: actionId,
          name: toolName,
          args: (request.toolCall as { args?: unknown })?.args,
        },
        requiresApproval: gatedToolNames.has(toolName),
        execute: async () => handler(request),
      });
    },
  });
}

function createDelegatedProgressCallbacks(request: DelegatedRuntimeRequest) {
  const onStep = request.onStep;
  if (!onStep) return undefined;

  let tokenBuffer: string[] = [];
  const emitText = (text: string) => {
    if (!text) return;
    onStep({
      type: 'text_chunk',
      ts: Date.now(),
      content: text,
      delegatedRunId: request.delegatedRunId,
    });
  };

  return [{
    handleLLMStart() {
      tokenBuffer = [];
    },
    handleLLMNewToken(token: string) {
      if (token) tokenBuffer.push(token);
    },
    handleLLMEnd(output: unknown) {
      const value = output as {
        generations?: Array<Array<{
          text?: unknown;
          message?: {
            content?: unknown;
            tool_calls?: unknown;
            additional_kwargs?: { tool_calls?: unknown };
          };
        }>>;
      };
      const generation = value.generations?.[0]?.[0];
      const toolCalls = generation?.message?.additional_kwargs?.tool_calls
        ?? generation?.message?.tool_calls;
      const content = generation?.message?.content;
      const hasToolCalls = (Array.isArray(toolCalls) && toolCalls.length > 0)
        || (Array.isArray(content) && content.some((part) => (
          !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool_use'
        )));
      if (hasToolCalls) {
        tokenBuffer = [];
        return;
      }
      if (tokenBuffer.length > 0) {
        for (const token of tokenBuffer) emitText(token);
        tokenBuffer = [];
        return;
      }
      if (typeof content === 'string') {
        emitText(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
            const text = (part as { text?: unknown }).text;
            if (typeof text === 'string') emitText(text);
          }
        }
      } else if (typeof generation?.text === 'string') {
        emitText(generation.text);
      }
    },
  }];
}

export function createDelegatedRuntimeAdapter(
  parentContext: DelegatedParentContext,
  options: CreateDelegatedRuntimeAdapterOptions,
): DelegatedRuntimeAdapter {
  const {
    approvalMode,
    parentBuiltInToolNames,
    parentMcpServerIds,
    allMcpServers,
    skillSnapshot,
    providerId,
    parentOverrides,
    project,
    agentFileRoots,
    sessionId,
  } = parentContext;
  const deps: DelegatedRuntimeExecutionDependencies = {
    assembleRuntime: assembleDeepAgentRuntime,
    createAgentGraph: createDeepAgent,
    loadMcpTools,
    createBuiltInTools,
    loadRegistryTools,
    resolveInterruptOn,
    ...options.dependencies,
  };

  return {
    run: async (request) => {
      const snapshot = request.configurationSnapshot;
      if (!snapshot) {
        throw new Error(`Delegated target Agent not found: ${request.targetAgentSlug}`);
      }
      const target = snapshot.target;

      // Every Delegated Agent Run owns fresh mutable execution state. Agent
      // configuration is reused, but model/graph/backend/checkpoint/tools are not.
      const childBackend = new CompositeBackend(new StateBackend(), {
        "/": new ProjectConfinedFilesystemBackend({
          rootDir: "/",
          virtualMode: false,
          allowedRoots: agentFileRoots,
          projectRoot: project.path,
        }),
      });
      const childBuiltInTools = deps.createBuiltInTools(project.path, sessionId);
      try {
        childBuiltInTools.push(...deps.loadRegistryTools());
      } catch (error) {
        log.warn('[runtime] Failed to load delegated built-in tools from registry:', error);
      }
      const targetToolScope = readAgentToolScope(target.config);
      const childScope = selectDelegatedToolScope({
        agentConfig: target.config,
        parentBuiltInToolNames,
        childBuiltInTools,
        parentMcpServerIds,
        childMcpServers: allMcpServers.filter(
          (server) => !snapshot.mcpServerExclusionIds.includes(server.id),
        ),
      });
      const childMcpRuntime = await deps.loadMcpTools(target.id, childScope.mcpServers, allMcpServers);
      const childSkillNames = snapshot.globalSkillPreloadRefs;
      const childToolNames = getRuntimeToolNames([
        ...childMcpRuntime.tools,
        ...childScope.builtInTools,
      ]);
      const childOverrides = resolveDelegatedModelOverrides({
        targetProviderId: target.provider_id,
        targetConfig: target.config,
        parentProviderId: providerId,
        parentOverrides,
      });
      const childAssembly = await deps.assembleRuntime(
        target,
        providerId,
        project,
        childSkillNames,
        extractPathMentionContext(request.goal),
        childToolNames,
        childOverrides,
        skillSnapshot,
      );
      for (const warning of childAssembly.assemblyWarnings) {
        log.warn('[runtime] Ignored invalid delegated Agent Skill runtime input:', warning);
      }

      const childInterruptOn = deps.resolveInterruptOn(
        approvalMode,
        getRuntimeToolNames(childMcpRuntime.tools),
      );
      const gatedToolNames = new Set(Object.keys(childInterruptOn));
      const childAgent = deps.createAgentGraph({
        model: childAssembly.model,
        backend: childBackend,
        systemPrompt: childAssembly.systemPrompt || undefined,
        permissions: childAssembly.permissions,
        tools: [...childMcpRuntime.tools, ...childScope.builtInTools],
        middleware: [
          createDelegatedToolApprovalMiddleware(
            options.resolveRunDelegatedToolAction(),
            request.delegatedRunId,
            gatedToolNames,
          ),
          ...options.createResilienceMiddleware(
            parentOverrides?.allowedTools,
            targetToolScope.mode === 'narrow'
              ? [
                  ...(targetToolScope.builtInTools ?? []),
                  ...getRuntimeToolNames(childMcpRuntime.tools),
                ]
              : undefined,
          ),
        ],
        responseFormat: DELEGATED_TASK_RESULT_SCHEMA as unknown as NonNullable<
          NonNullable<Parameters<typeof createDeepAgent>[0]>['responseFormat']
        >,
        checkpointer: new MemorySaver(),
      });
      const progressCallbacks = createDelegatedProgressCallbacks(request);
      const invokeChild = () => childAgent.invoke(
        request.input as Parameters<typeof childAgent.invoke>[0],
        {
          signal: request.signal,
          callbacks: progressCallbacks,
          configurable: {
            thread_id: request.delegatedRunId,
            checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
            delegatedRunId: request.delegatedRunId,
          },
        },
      );
      const childResult = await (request.onStep
        ? subagentStepStorage.run({ onStep: request.onStep }, invokeChild)
        : invokeChild()) as unknown as {
        structuredResponse?: unknown;
        messages?: Array<{ content?: unknown }>;
        __interrupt__?: unknown;
        interrupts?: unknown;
      };
      const childInterrupts = childResult.__interrupt__ ?? childResult.interrupts;
      if (Array.isArray(childInterrupts) && childInterrupts.length > 0) {
        throw new Error('Delegated tool approval is not available for this run');
      }
      const structured = DELEGATED_TASK_RESULT_SCHEMA.safeParse(childResult?.structuredResponse);
      if (structured.success) return structured.data;

      const messages = Array.isArray(childResult?.messages) ? childResult.messages : [];
      const lastMessage = messages[messages.length - 1];
      const content = typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? 'Task completed');
      return {
        status: 'success',
        artifacts: [],
        summary: content.slice(0, 2_000),
      } satisfies DelegatedTaskResult;
    },
  };
}
