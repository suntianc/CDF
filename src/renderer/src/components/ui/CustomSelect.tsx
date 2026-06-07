import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect({ value, onChange, options, placeholder, className = '', disabled = false }: CustomSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.pleaseSelect', '请选择...');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-dim)] rounded-lg text-xs text-[var(--color-text-primary)] outline-none transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : resolvedPlaceholder}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute left-0 mt-1 w-full max-h-[220px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg rounded-lg z-50 p-1 animate-fade-in select-none">
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                opt.value === value
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] font-medium'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />}
            </div>
          ))}
          {options.length === 0 && (
            <div className="text-center py-3 text-xs text-[var(--color-text-muted)] italic">{t('common.noOptions', '没有可用选项')}</div>
          )}
        </div>
      )}
    </div>
  );
}
