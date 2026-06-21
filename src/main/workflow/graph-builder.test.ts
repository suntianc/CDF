import { describe, expect, it, vi } from 'vitest';
import { buildWorkflowGraph, matchesCondition, createFanOutRouter } from './graph-builder';
import type { WorkflowDefinition, WorkflowNode } from '../../shared/types';

describe('buildWorkflowGraph', () => {
  it('should compile and run ReactFlow graphs with non-canonical start/end ids', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'agent-1', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Agent', agentId: 'agent-a' } },
        { id: 'end-1', type: 'end', position: { x: 0, y: 240 }, data: { label: '结束' } },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'agent-1' },
        { id: 'e2', source: 'agent-1', target: 'end-1' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => ({
      result: `ran:${node.id}`,
    }));
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    expect(result.nodeOutputs).toEqual({
      'agent-1': { result: 'ran:agent-1' },
    });
  });

  it('should route conditional edges by routeValue from node routing output', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'router', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Router', agentId: 'router-agent' } },
        { id: 'approved', type: 'agent', position: { x: -120, y: 240 }, data: { label: 'Approved', agentId: 'approved-agent' } },
        { id: 'rejected', type: 'agent', position: { x: 120, y: 240 }, data: { label: 'Rejected', agentId: 'rejected-agent' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: '结束' } },
      ],
      edges: [
        { id: 'start-router', source: 'start', target: 'router' },
        {
          id: 'router-approved',
          source: 'router',
          target: 'approved',
          metadata: { condition: 'review_result', routeValue: 'approved' },
        },
        {
          id: 'router-rejected',
          source: 'router',
          target: 'rejected',
          metadata: { condition: 'review_result', routeValue: 'rejected' },
        },
        { id: 'approved-end', source: 'approved', target: 'end' },
        { id: 'rejected-end', source: 'rejected', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => {
      if (node.id === 'router') {
        return { result: 'approved', routing: { review_result: 'approved' } };
      }
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    expect(result.nodeOutputs.router).toEqual({
      result: 'approved',
      routing: { review_result: 'approved' },
    });
    expect(result.nodeOutputs.approved).toEqual({ result: 'ran:approved' });
    expect(result.nodeOutputs.rejected).toBeUndefined();
  });

  it('should route conditional edges by comparison operators', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'review', type: 'review', position: { x: 0, y: 120 }, data: { label: '审查', agentId: 'review-agent', reviewSpec: 'score quality' } },
        { id: 'pass', type: 'task', position: { x: -120, y: 240 }, data: { label: '通过', agentId: 'pass-agent', taskDescription: 'ship' } },
        { id: 'fix', type: 'task', position: { x: 120, y: 240 }, data: { label: '返工', agentId: 'fix-agent', taskDescription: 'fix' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: '结束' } },
      ],
      edges: [
        { id: 'start-review', source: 'start', target: 'review' },
        {
          id: 'review-pass',
          source: 'review',
          target: 'pass',
          metadata: { condition: 'review', operator: 'gte', routeValue: '80', compareValue: '80' },
        },
        {
          id: 'review-fix',
          source: 'review',
          target: 'fix',
          metadata: { condition: 'review', operator: 'lt', routeValue: '80', compareValue: '80' },
        },
        { id: 'pass-end', source: 'pass', target: 'end' },
        { id: 'fix-end', source: 'fix', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => {
      if (node.id === 'review') return { result: 'score 86', routing: { review: '86' } };
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    expect(result.nodeOutputs.pass).toEqual({ result: 'ran:pass' });
    expect(result.nodeOutputs.fix).toBeUndefined();
  });

  it('should compare string and numeric conditional values', () => {
    expect(matchesCondition('approved', 'eq', 'approved')).toBe(true);
    expect(matchesCondition('rejected', 'ne', 'approved')).toBe(true);
    expect(matchesCondition('86', 'gt', '80')).toBe(true);
    expect(matchesCondition('70', 'gte', '80')).toBe(false);
  });

  // ---- TG-06: 边界测试 ----

  it('should throw on compile when graph has no edges (unreachable nodes)', async () => {
    // LangGraph 要求所有节点从 START 可达，无边图编译时抛出 UnreachableNodeError
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'agent-1', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Agent', agentId: 'a' } },
        { id: 'end', type: 'end', position: { x: 0, y: 240 }, data: { label: 'End' } },
      ],
      edges: [],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => ({
      result: `ran:${node.id}`,
    }));
    expect(() => builder.compile()).toThrow('not reachable');
  });

  it('should pass upstream outputs when node has multiple sources', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'agent-a', type: 'agent', position: { x: -80, y: 120 }, data: { label: 'A', agentId: 'a' } },
        { id: 'agent-b', type: 'agent', position: { x: 80, y: 120 }, data: { label: 'B', agentId: 'b' } },
        { id: 'merger', type: 'agent', position: { x: 0, y: 240 }, data: { label: 'Merger', agentId: 'm' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-a', source: 'start', target: 'agent-a' },
        { id: 's-b', source: 'start', target: 'agent-b' },
        { id: 'a-m', source: 'agent-a', target: 'merger' },
        { id: 'b-m', source: 'agent-b', target: 'merger' },
        { id: 'm-e', source: 'merger', target: 'end' },
      ],
    };

    let mergerUpstreamOutputs: Record<string, unknown> = {};
    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode, upstreamIds: string[]) => async (state) => {
      if (node.id === 'merger') {
        const nodeOutputs = (state.nodeOutputs as Record<string, unknown>) ?? {};
        for (const uid of upstreamIds) {
          if (uid in nodeOutputs) mergerUpstreamOutputs[uid] = nodeOutputs[uid];
        }
      }
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    await graph.invoke({ inputs: {}, messages: [] });

    expect(Object.keys(mergerUpstreamOutputs)).toHaveLength(2);
    expect(mergerUpstreamOutputs['agent-a']).toBeDefined();
    expect(mergerUpstreamOutputs['agent-b']).toBeDefined();
  });

  it('should route to END by default when condition does not match any edge', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'router', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Router', agentId: 'r' } },
        { id: 'known', type: 'task', position: { x: -100, y: 240 }, data: { label: 'Known', agentId: 'k', taskDescription: 'known' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-r', source: 'start', target: 'router' },
        {
          id: 'r-known',
          source: 'router',
          target: 'known',
          metadata: { condition: 'result', routeValue: 'known' },
        },
        { id: 'known-e', source: 'known', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => {
      if (node.id === 'router') return { result: 'unknown', routing: { result: 'whatever' } };
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    // 不匹配 → 默认路由到 END，known 节点不执行
    expect(result.nodeOutputs.router).toBeDefined();
    expect(result.nodeOutputs.known).toBeUndefined();
  });

  it('should throw when routing decision is completely missing for a conditional edge', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'router', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Router', agentId: 'router-agent' } },
        { id: 'approved', type: 'agent', position: { x: -120, y: 240 }, data: { label: 'Approved', agentId: 'approved-agent' } },
        { id: 'rejected', type: 'agent', position: { x: 120, y: 240 }, data: { label: 'Rejected', agentId: 'rejected-agent' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: '结束' } },
      ],
      edges: [
        { id: 'start-router', source: 'start', target: 'router' },
        {
          id: 'router-approved',
          source: 'router',
          target: 'approved',
          metadata: { condition: 'review_result', routeValue: 'approved' },
        },
        {
          id: 'router-rejected',
          source: 'router',
          target: 'rejected',
          metadata: { condition: 'review_result', routeValue: 'rejected' },
        },
        { id: 'approved-end', source: 'approved', target: 'end' },
        { id: 'rejected-end', source: 'rejected', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => {
      if (node.id === 'router') return { result: 'done' };
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();

    await expect(graph.invoke({ inputs: {}, messages: [] })).rejects.toThrow(/路由条件.*未找到决策值/);
  });

  it('should fallback to END with warning when routing decision exists but does not match any configured edge', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'router', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Router', agentId: 'r' } },
        { id: 'known', type: 'task', position: { x: -100, y: 240 }, data: { label: 'Known', agentId: 'k', taskDescription: 'known' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-r', source: 'start', target: 'router' },
        {
          id: 'r-known',
          source: 'router',
          target: 'known',
          metadata: { condition: 'result', routeValue: 'known' },
        },
        { id: 'known-e', source: 'known', target: 'end' },
      ],
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => {
      if (node.id === 'router') return { result: 'unknown', routing: { result: 'whatever' } };
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    expect(result.nodeOutputs.router).toBeDefined();
    expect(result.nodeOutputs.known).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不匹配任何配置的条件边'));

    warnSpy.mockRestore();
  });

  it('should handle fan-out: multiple parallel edges from same source', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'splitter', type: 'agent', position: { x: 0, y: 120 }, data: { label: 'Split', agentId: 's' } },
        { id: 'path-a', type: 'task', position: { x: -100, y: 240 }, data: { label: 'A', agentId: 'a', taskDescription: 'path A' } },
        { id: 'path-b', type: 'task', position: { x: 100, y: 240 }, data: { label: 'B', agentId: 'b', taskDescription: 'path B' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-s', source: 'start', target: 'splitter' },
        { id: 's-a', source: 'splitter', target: 'path-a' },
        { id: 's-b', source: 'splitter', target: 'path-b' },
        { id: 'a-e', source: 'path-a', target: 'end' },
        { id: 'b-e', source: 'path-b', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async () => ({
      result: `ran:${node.id}`,
    }));
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    // fan-out: 两条路径都执行
    expect(result.nodeOutputs['path-a']).toBeDefined();
    expect(result.nodeOutputs['path-b']).toBeDefined();
  });
});

// ---- Phase 15: Send API fan-out/fan-in 测试 ----

describe('createFanOutRouter', () => {
  it('should return Send[] for each item in nodeOutputs', () => {
    const router = createFanOutRouter('parallel-1', 'parallel-1__worker');
    const state = {
      nodeOutputs: {
        'parallel-1': { items: ['a', 'b', 'c'], count: 3 },
      },
    };
    const result = router(state as any);
    expect(Array.isArray(result)).toBe(true);
    const sends = result as any[];
    expect(sends).toHaveLength(3);
    expect(sends[0].node).toBe('parallel-1__worker');
    expect(sends[0].args.__fanout_item).toBe('a');
    expect(sends[0].args.__fanout_index).toBe(0);
    expect(sends[1].args.__fanout_item).toBe('b');
    expect(sends[1].args.__fanout_index).toBe(1);
    expect(sends[2].args.__fanout_item).toBe('c');
    expect(sends[2].args.__fanout_index).toBe(2);
  });

  it('should return END for empty items array', () => {
    const router = createFanOutRouter('parallel-1', 'parallel-1__worker');
    const state = {
      nodeOutputs: {
        'parallel-1': { items: [], count: 0 },
      },
    };
    const result = router(state as any);
    expect(result).toBe('__end__');
  });

  it('should respect concurrencyLimit', () => {
    const router = createFanOutRouter('parallel-1', 'parallel-1__worker', 2);
    const state = {
      nodeOutputs: {
        'parallel-1': { items: ['a', 'b', 'c', 'd', 'e'], count: 5 },
      },
    };
    const result = router(state as any);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
  });
});

describe('buildWorkflowGraph parallel node (Send fan-out/fan-in)', () => {
  it('should fan-out parallel node via Send API and collect all worker outputs', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'p1', type: 'parallel', position: { x: 0, y: 120 }, data: { label: 'Parallel', nodeKind: 'parallel', agentId: 'a' } },
        { id: 'end', type: 'end', position: { x: 0, y: 240 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-p', source: 'start', target: 'p1' },
        { id: 'p-e', source: 'p1', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async (state) => {
      const fanoutItem = state.__fanout_item;
      if (fanoutItem !== undefined) {
        // worker 角色
        return { result: `processed:${fanoutItem}`, item: fanoutItem };
      }
      // dispatcher 角色
      return { items: ['a', 'b', 'c'], count: 3 };
    });
    const graph = builder.compile();
    const result = await graph.invoke({ inputs: {}, messages: [] });

    // dispatcher output
    expect(result.nodeOutputs['p1']).toMatchObject({ items: ['a', 'b', 'c'], count: 3 });
    // worker outputs（fan-in via spread-merge reducer）
    expect(result.nodeOutputs['p1__worker:0']).toMatchObject({ result: 'processed:a' });
    expect(result.nodeOutputs['p1__worker:1']).toMatchObject({ result: 'processed:b' });
    expect(result.nodeOutputs['p1__worker:2']).toMatchObject({ result: 'processed:c' });
  });

  it('should fan-in: downstream node can read all worker outputs after parallel completes', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'p1', type: 'parallel', position: { x: 0, y: 120 }, data: { label: 'Parallel', nodeKind: 'parallel', agentId: 'a' } },
        { id: 'agg', type: 'agent', position: { x: 0, y: 240 }, data: { label: 'Aggregator', agentId: 'b' } },
        { id: 'end', type: 'end', position: { x: 0, y: 360 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-p', source: 'start', target: 'p1' },
        { id: 'p-a', source: 'p1', target: 'agg' },
        { id: 'a-e', source: 'agg', target: 'end' },
      ],
    };

    let aggInputNodeOutputs: Record<string, unknown> = {};

    const builder = buildWorkflowGraph(workflow, (node: WorkflowNode) => async (state) => {
      if (node.id === 'p1') {
        const fanoutItem = state.__fanout_item;
        if (fanoutItem !== undefined) {
          return { result: `done:${fanoutItem}` };
        }
        return { items: ['x', 'y'], count: 2 };
      }
      if (node.id === 'agg') {
        aggInputNodeOutputs = (state.nodeOutputs as Record<string, unknown>) ?? {};
        return { result: 'aggregated' };
      }
      return { result: `ran:${node.id}` };
    });
    const graph = builder.compile();
    await graph.invoke({ inputs: {}, messages: [] });

    // aggregator 应能看到所有 worker 输出
    expect(aggInputNodeOutputs['p1__worker:0']).toMatchObject({ result: 'done:x' });
    expect(aggInputNodeOutputs['p1__worker:1']).toMatchObject({ result: 'done:y' });
  });

  it('should handle empty items array gracefully without error', async () => {
    const workflow: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
        { id: 'p1', type: 'parallel', position: { x: 0, y: 120 }, data: { label: 'Parallel', nodeKind: 'parallel', agentId: 'a' } },
        { id: 'end', type: 'end', position: { x: 0, y: 240 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 's-p', source: 'start', target: 'p1' },
        { id: 'p-e', source: 'p1', target: 'end' },
      ],
    };

    const builder = buildWorkflowGraph(workflow, (_node: WorkflowNode) => async (state) => {
      const fanoutItem = state.__fanout_item;
      if (fanoutItem !== undefined) {
        return { result: `processed:${fanoutItem}` };
      }
      // dispatcher 返回空 items
      return { items: [], count: 0 };
    });
    const graph = builder.compile();
    // 空 items 不应报错，直接结束
    const result = await graph.invoke({ inputs: {}, messages: [] });
    expect(result.nodeOutputs['p1']).toMatchObject({ items: [], count: 0 });
    expect(result.nodeOutputs['p1__worker:0']).toBeUndefined();
  });
});
