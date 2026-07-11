import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function CustomSelect({ id, value, onChange, options, placeholder, className = '', buttonClassName = '', ariaLabel, disabled = false }: CustomSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.pleaseSelect', '请选择...');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const selectedOption = options.find(opt => opt.value === value);

  const openMenu = () => {
    const selectedIndex = options.findIndex(opt => opt.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(index => (index + direction + options.length) % options.length);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!isOpen) openMenu();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      onChange(options[activeIndex].value);
      setIsOpen(false);
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${id ?? 'custom-select'}-listbox` : undefined}
        aria-activedescendant={isOpen ? `${id ?? 'custom-select'}-option-${activeIndex}` : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between px-3 py-2 bg-[var(--color-bg-app)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-dim)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-app)] rounded-[var(--radius-sm)] text-xs text-[var(--color-text-primary)] outline-none transition-[background-color,border-color,color,box-shadow] duration-150 ${
          disabled ? 'cursor-not-allowed border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]' : 'cursor-pointer'
        } ${buttonClassName}`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : resolvedPlaceholder}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div
          id={`${id ?? 'custom-select'}-listbox`}
          role="listbox"
          className="absolute left-0 mt-1 w-full max-h-[220px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[0_8px_24px_rgba(30,20,10,0.10)] rounded-[var(--radius-md)] z-[var(--z-dropdown)] p-1 animate-fade-in select-none"
        >
          {options.map((opt, index) => (
            <div
              id={`${id ?? 'custom-select'}-option-${index}`}
              ref={element => { optionRefs.current[index] = element; }}
              role="option"
              aria-selected={opt.value === value}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              data-active={index === activeIndex}
              className={`flex items-center justify-between px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                opt.value === value
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] font-medium'
                  : index === activeIndex
                    ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
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
