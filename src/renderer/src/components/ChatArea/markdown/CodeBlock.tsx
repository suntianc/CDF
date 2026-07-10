import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export interface CodeBlockProps {
  lang: string;
  code: string;
}

export function CodeBlock({ lang, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="border border-[var(--color-border)]/50 rounded-lg overflow-hidden font-mono text-xs bg-[var(--color-bg-sidebar)]">
      <div className="flex justify-between items-center px-4 py-1.5 bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] border-b border-[var(--color-border)] select-none">
        <span className="uppercase text-xs font-bold text-[var(--color-text-secondary)] tracking-wider">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`transition-all duration-200 text-xs font-medium px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 active:scale-90 ${
            copied
              ? 'text-[var(--color-success)] bg-[var(--color-success-dim)]/20'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[var(--color-success)] animate-pop-in" />
              <span className="animate-pop-in">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[var(--color-text-primary)] select-text" style={{ background: 'transparent', margin: 0 }}>
        <code style={{ background: 'transparent', padding: 0, borderRadius: 0 }}>{code}</code>
      </pre>
    </div>
  );
}