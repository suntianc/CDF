import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, Shield, AlertCircle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ApprovalMode } from '../../../../shared/types';

interface ApprovalModeSelectorProps {
  className?: string;
  dropUp?: boolean;
}

const MODE_OPTIONS: { value: ApprovalMode; icon: React.ReactNode; danger?: boolean }[] = [
  { value: 'strict', icon: <Shield className="w-3.5 h-3.5" /> },
  { value: 'agent_decides', icon: <Brain className="w-3.5 h-3.5" /> },
  { value: 'bypass', icon: <AlertCircle className="w-3.5 h-3.5" />, danger: true },
];

export function ApprovalModeSelector({ className, dropUp }: ApprovalModeSelectorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ApprovalMode>('strict');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electronAPI.store.get('approvalMode').then((saved) => {
      if (saved === 'strict' || saved === 'agent_decides' || saved === 'bypass') {
        setMode(saved);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (newMode: ApprovalMode) => {
    setMode(newMode);
    setOpen(false);
    window.electronAPI.store.set('approvalMode', newMode).catch(() => {});
  };

  const modeLabel = (m: ApprovalMode) => {
    if (m === 'strict') return t('approvalMode.strict');
    if (m === 'agent_decides') return t('approvalMode.agentDecides');
    return t('approvalMode.bypass');
  };

  const modeDesc = (m: ApprovalMode) => {
    if (m === 'strict') return t('approvalMode.strictDesc');
    if (m === 'agent_decides') return t('approvalMode.agentDecidesDesc');
    return t('approvalMode.bypassDesc');
  };

  const currentOption = MODE_OPTIONS.find((o) => o.value === mode) ?? MODE_OPTIONS[0];

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors select-none outline-none cursor-pointer"
        aria-label={t('approvalMode.label')}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={mode === 'bypass' ? 'text-orange-500 dark:text-orange-400' : ''}>{currentOption.icon}</span>
        <span className={mode === 'bypass' ? 'text-orange-500 dark:text-orange-400 font-semibold' : ''}>{modeLabel(mode)}</span>
        <ChevronDown className="w-3 h-3 ml-0.5 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('approvalMode.label')}
          className={`absolute left-0 z-50 w-[280px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-md ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={mode === option.value}
              onClick={() => handleSelect(option.value)}
              className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs transition-colors first:rounded-t-md last:rounded-b-md hover:bg-[var(--color-bg-hover)] cursor-pointer ${
                mode === option.value ? 'bg-[var(--color-bg-hover)] font-medium' : ''
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${option.danger ? 'text-orange-500 dark:text-orange-400' : 'text-[var(--color-text-secondary)]'}`}>
                {option.icon}
              </span>
              <div className="flex-1 min-w-0 pr-1">
                <div className={`font-semibold text-xs ${option.danger ? 'text-orange-500 dark:text-orange-400' : 'text-[var(--color-text-primary)]'}`}>
                  {modeLabel(option.value)}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]/80 leading-normal whitespace-normal break-words">
                  {modeDesc(option.value)}
                </div>
              </div>
              {mode === option.value && (
                <Check className="w-3.5 h-3.5 shrink-0 self-center text-[var(--color-text-primary)] ml-1" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
