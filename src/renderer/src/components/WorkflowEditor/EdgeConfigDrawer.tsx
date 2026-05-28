import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import { GitBranch, X, Trash2 } from 'lucide-react';
import type { Edge } from '@xyflow/react';
import type { WorkflowEdge } from '../../../../shared/types';
import { CustomSelect } from '../ui/CustomSelect';

interface EdgeConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  edge: Edge | null;
  onUpdateEdge: (edgeId: string, updates: Partial<Edge>) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

function getMetadata(edge: Edge | null): NonNullable<WorkflowEdge['metadata']> {
  return ((edge as Edge & { metadata?: WorkflowEdge['metadata'] } | null)?.metadata ?? {}) as NonNullable<WorkflowEdge['metadata']>;
}

export function EdgeConfigDrawer({ isOpen, onClose, edge, onUpdateEdge, onDeleteEdge }: EdgeConfigDrawerProps) {
  const [label, setLabel] = useState('');
  const [condition, setCondition] = useState('');
  const [operator, setOperator] = useState<'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'>('eq');
  const [routeValue, setRouteValue] = useState('');
  const [maxIterations, setMaxIterations] = useState(10);

  useEffect(() => {
    const metadata = getMetadata(edge);
    setLabel(typeof edge?.label === 'string' ? edge.label : '');
    setCondition(metadata.condition ?? '');
    setOperator(metadata.operator ?? 'eq');
    setRouteValue(metadata.compareValue ?? metadata.routeValue ?? '');
    setMaxIterations(metadata.maxIterations ?? 10);
  }, [edge]);

  const handleSave = () => {
    if (!edge) return;
    const nextMetadata: WorkflowEdge['metadata'] = {};
    if (condition.trim()) {
      nextMetadata.condition = condition.trim();
      nextMetadata.operator = operator;
      nextMetadata.routeValue = routeValue.trim() || edge.target;
      nextMetadata.compareValue = routeValue.trim() || edge.target;
      nextMetadata.maxIterations = Math.max(1, Math.min(50, maxIterations));
    }

    const operatorLabel: Record<typeof operator, string> = { eq: '=', ne: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=' };

    onUpdateEdge(edge.id, {
      label: label.trim() || (condition.trim() ? `${operatorLabel[operator]} ${routeValue.trim() || edge.target}` : undefined),
      animated: Boolean(condition.trim()),
      style: condition.trim() ? { stroke: 'var(--color-warning)' } : undefined,
      metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
    } as Partial<Edge>);
    onClose();
  };

  const isConditional = Boolean(condition.trim());

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="fixed right-0 top-0 bottom-0 w-[400px] bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] z-50 flex flex-col"
          aria-label="边配置"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <Drawer.Title className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-[var(--color-accent)]" />
              边配置
            </Drawer.Title>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {!isConditional && edge && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3 text-[11px] text-[var(--color-text-secondary)]">
                {edge.source} {"->"} {edge.target}
              </div>
            )}

            <div className="rounded-lg border border-[var(--color-info)]/20 bg-[var(--color-info-dim)]/40 p-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              <div className="font-semibold text-[var(--color-text-primary)] mb-1">普通边</div>
              无条件顺序执行。上游节点完成后直接执行下游节点。
              <div className="font-semibold text-[var(--color-text-primary)] mt-3 mb-1">条件边</div>
              根据上游审查节点的输出结果进行条件匹配，满足匹配值后执行此边连接的下游节点。
            </div>

            <div className="form-group">
              <label className="form-label">边标签</label>
              <input
                className="form-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例如：通过 / 失败 / 需要人工判断"
              />
            </div>

            {!isConditional && (
              <div className="form-group">
                <label className="form-label">路由条件键</label>
                <input
                  className="form-input"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="例如：review_result"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                  留空表示普通顺序边；填写后表示从上游 Agent 输出的 routing 对象里读取这个键。
                </p>
              </div>
            )}

            {condition.trim() && (
              <>
                <div className="form-group">
                  <label className="form-label">运算符</label>
                  <CustomSelect
                    value={operator}
                    onChange={(val) => setOperator(val as typeof operator)}
                    options={[
                      { value: 'eq', label: '= 等于' },
                      { value: 'ne', label: '!= 不等于' },
                      { value: 'gt', label: '> 大于' },
                      { value: 'lt', label: '< 小于' },
                      { value: 'gte', label: '>= 大于等于' },
                      { value: 'lte', label: '<= 小于等于' },
                    ]}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">匹配值</label>
                  <input
                    className="form-input"
                    value={routeValue}
                    onChange={(e) => setRouteValue(e.target.value)}
                    placeholder="例如：approved"
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    条件边会用所选运算符比较 routing 中该键的值与这里的值，匹配后执行此边连接的下游节点。
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">最大循环次数</label>
                  <input
                    type="number"
                    className="form-input"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    max={50}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--color-border)] shrink-0">
            <button
              className="btn btn-danger cursor-pointer"
              onClick={() => edge && onDeleteEdge?.(edge.id)}
              disabled={!edge || !onDeleteEdge}
            >
              <Trash2 className="w-4 h-4" />
              删除边
            </button>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary cursor-pointer" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary cursor-pointer" onClick={handleSave}>
                保存
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
