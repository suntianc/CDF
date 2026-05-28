import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from './flowStore';

describe('flowStore history', () => {
  beforeEach(() => {
    useFlowStore.getState().clearHistory();
  });

  it('should push history and undo/redo correctly', () => {
    const store = useFlowStore.getState();
    const initialNodes = [{ id: '1', data: { label: 'Start' } }] as any;
    const initialEdges = [] as any;

    store.pushHistory(initialNodes, initialEdges);
    expect(useFlowStore.getState().historyIndex).toBe(0);
    expect(useFlowStore.getState().canUndo()).toBe(false);

    // Push new state
    const nextNodes = [
      { id: '1', data: { label: 'Start' } },
      { id: '2', data: { label: 'Agent' } }
    ] as any;
    store.pushHistory(nextNodes, initialEdges);
    expect(useFlowStore.getState().historyIndex).toBe(1);
    expect(useFlowStore.getState().canUndo()).toBe(true);

    // Undo
    const undoResult = store.undo();
    expect(undoResult).not.toBeNull();
    expect(undoResult?.nodes).toHaveLength(1);
    expect(useFlowStore.getState().historyIndex).toBe(0);
    expect(useFlowStore.getState().canUndo()).toBe(false);

    // Redo
    const redoResult = store.redo();
    expect(redoResult).not.toBeNull();
    expect(redoResult?.nodes).toHaveLength(2);
    expect(useFlowStore.getState().historyIndex).toBe(1);
  });

  it('should handle non-serializable properties safely without throwing', () => {
    const store = useFlowStore.getState();
    const nodes = [
      {
        id: '1',
        data: { label: 'Start', someFunc: () => {} },
        _internal: Symbol('reactflow')
      }
    ] as any;
    store.pushHistory(nodes, []);
    expect(useFlowStore.getState().historyIndex).toBe(0);
  });
});

