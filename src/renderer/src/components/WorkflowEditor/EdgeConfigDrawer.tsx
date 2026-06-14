import { useEffect, useState } from 'react';
import { GitBranch, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [condition, setCondition] = useState('');
  const [operator, setOperator] = useState<'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'>('eq');
  const [routeValue, setRouteValue] = useState('');

  useEffect(() => {
    const metadata = getMetadata(edge);
    setLabel(typeof edge?.label === 'string' ? edge.label : '');
    setCondition(metadata.condition ?? '');
    setOperator(metadata.operator ?? 'eq');
    setRouteValue(metadata.compareValue ?? metadata.routeValue ?? '');
  }, [edge]);

  const handleSave = () => {
    if (!edge) return;
    const nextMetadata: WorkflowEdge['metadata'] = {};
    if (condition.trim()) {
      nextMetadata.condition = condition.trim();
      nextMetadata.operator = operator;
      nextMetadata.routeValue = routeValue.trim() || edge.target;
      nextMetadata.compareValue = routeValue.trim() || edge.target;
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
    <div className="flex flex-col flex-1 overflow-hidden" aria-label={t('workflow.edgeConfig.title')}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <span className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-[var(--color-accent)]" />
              {t('workflow.edgeConfig.title')}
            </span>

          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            <div className="rounded-lg border border-[var(--color-info)]/20 bg-[var(--color-info-dim)]/40 p-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
              <div className="font-semibold text-[var(--color-text-primary)] mb-1">{t('workflow.edgeConfig.normalEdge')}</div>
              {t('workflow.edgeConfig.normalEdgeDesc')}
              <div className="font-semibold text-[var(--color-text-primary)] mt-3 mb-1">{t('workflow.edgeConfig.conditionalEdge')}</div>
              {t('workflow.edgeConfig.conditionalEdgeDesc')}
            </div>
            {isConditional && (
              <>

                <div className="form-group">
                  <label className="form-label">{t('workflow.edgeConfig.edgeLabel')}</label>
                  <input
                    className="form-input"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('workflow.edgeConfig.edgeLabelPlaceholder')}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t('workflow.edgeConfig.operator')}</label>
                  <CustomSelect
                    value={operator}
                    onChange={(val) => setOperator(val as typeof operator)}
                    options={[
                      { value: 'eq', label: `= ${t('workflow.edgeConfig.opEq')}` },
                      { value: 'ne', label: `!= ${t('workflow.edgeConfig.opNe')}` },
                      { value: 'gt', label: `> ${t('workflow.edgeConfig.opGt')}` },
                      { value: 'lt', label: `< ${t('workflow.edgeConfig.opLt')}` },
                      { value: 'gte', label: `>= ${t('workflow.edgeConfig.opGte')}` },
                      { value: 'lte', label: `<= ${t('workflow.edgeConfig.opLte')}` },
                    ]}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t('workflow.edgeConfig.matchValue')}</label>
                  <input
                    className="form-input"
                    value={routeValue}
                    onChange={(e) => setRouteValue(e.target.value)}
                    placeholder={t('workflow.edgeConfig.matchValuePlaceholder')}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    {t('workflow.edgeConfig.matchValueDesc')}
                  </p>
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
              {t('workflow.edgeConfig.deleteEdge')}
            </button>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary cursor-pointer" onClick={onClose}>
                {isConditional ? t('workflow.edgeConfig.cancel') : t('workflow.edgeConfig.close')}
              </button>
              {isConditional && (
                <button className="btn btn-primary cursor-pointer" onClick={handleSave}>
                  {t('workflow.edgeConfig.save')}
                </button>
              )}
            </div>
          </div>
    </div>
  );
}
