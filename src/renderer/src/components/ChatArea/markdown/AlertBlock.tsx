import React from 'react';
import { Info, Lightbulb, AlertCircle, AlertTriangle, AlertOctagon } from 'lucide-react';

// 块级警示（NOTE/TIP/.../DANGER）。MarkdownRenderer 与 StreamdownRenderer 共享：
// 同一份 Tailwind 类串、同一份图标映射，因此一处改色即两栈同步。
//
// Tailwind JIT：以下 class 名均为静态字面量，未走模板插值，构建器能完整发现。
export type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION' | 'DANGER';

export const ALERT_TYPES: AlertType[] = [
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
  'DANGER',
];

interface AlertStyle {
  styleClass: string;
  titleClass: string;
  titleText: string;
  icon: React.ReactNode;
}

const ALERT_STYLES: Record<AlertType, AlertStyle> = {
  NOTE: {
    styleClass: 'border-l-2 border-l-sky-500 bg-sky-500/[0.03] dark:bg-sky-400/[0.02]',
    titleClass: 'text-sky-600 dark:text-sky-400',
    titleText: 'NOTE',
    icon: <Info className="w-3.5 h-3.5 shrink-0" />,
  },
  TIP: {
    styleClass: 'border-l-2 border-l-emerald-500 bg-emerald-500/[0.03] dark:bg-emerald-400/[0.02]',
    titleClass: 'text-emerald-600 dark:text-emerald-400',
    titleText: 'TIP',
    icon: <Lightbulb className="w-3.5 h-3.5 shrink-0" />,
  },
  IMPORTANT: {
    styleClass: 'border-l-2 border-l-indigo-500 bg-indigo-500/[0.03] dark:bg-indigo-400/[0.02]',
    titleClass: 'text-indigo-600 dark:text-indigo-400',
    titleText: 'IMPORTANT',
    icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />,
  },
  WARNING: {
    styleClass: 'border-l-2 border-l-amber-500 bg-amber-500/[0.03] dark:bg-amber-400/[0.02]',
    titleClass: 'text-amber-600 dark:text-amber-400',
    titleText: 'WARNING',
    icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
  },
  CAUTION: {
    styleClass: 'border-l-2 border-l-rose-500 bg-rose-500/[0.03] dark:bg-rose-400/[0.02]',
    titleClass: 'text-rose-600 dark:text-rose-400',
    titleText: 'CAUTION',
    icon: <AlertOctagon className="w-3.5 h-3.5 shrink-0" />,
  },
  DANGER: {
    styleClass: 'border-l-2 border-l-rose-500 bg-rose-500/[0.03] dark:bg-rose-400/[0.02]',
    titleClass: 'text-rose-600 dark:text-rose-400',
    titleText: 'DANGER',
    icon: <AlertOctagon className="w-3.5 h-3.5 shrink-0" />,
  },
};

export interface AlertBlockProps {
  type: AlertType;
  children: React.ReactNode;
}

export function AlertBlock({ type, children }: AlertBlockProps) {
  const { styleClass, titleClass, titleText, icon } = ALERT_STYLES[type];
  return (
    <div className={`pl-4 pr-3 py-2.5 rounded-r-lg my-3 text-sm select-text leading-relaxed ${styleClass}`}>
      <div className={`flex items-center gap-1.5 font-bold text-xs select-none tracking-wider uppercase mb-1.5 ${titleClass}`}>
        {icon}
        <span>{titleText}</span>
      </div>
      <div className="text-[var(--color-text-secondary)] text-[13px] leading-relaxed font-normal">
        {children}
      </div>
    </div>
  );
}