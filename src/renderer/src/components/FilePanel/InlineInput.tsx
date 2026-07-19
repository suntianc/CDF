import { useEffect, useRef, useState } from 'react';
import { File, Folder } from 'lucide-react';

interface InlineInputProps {
  depth: number;
  icon: 'file' | 'folder';
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InlineInput({ depth, icon, defaultValue = '', onSubmit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFinishedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (defaultValue) {
      const dotIdx = defaultValue.lastIndexOf('.');
      el.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
    }
  }, [defaultValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const trimmed = value.trim();
      if (trimmed && trimmed !== defaultValue) {
        isFinishedRef.current = true;
        onSubmit(trimmed);
      } else {
        isFinishedRef.current = true;
        onCancel();
      }
    } else if (e.key === 'Escape') {
      isFinishedRef.current = true;
      onCancel();
    }
  };

  const handleBlur = () => {
    if (isFinishedRef.current) return;
    isFinishedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== defaultValue) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1 py-[2px] pr-2"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <span className="w-4 h-4 shrink-0" />
      <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-muted)]">
        {icon === 'folder' ? <Folder className="w-3.5 h-3.5" /> : <File className="w-3.5 h-3.5" />}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex-1 min-w-0 text-[12px] bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)] border border-[var(--color-accent)] rounded px-1 py-0 outline-none"
      />
    </div>
  );
}
