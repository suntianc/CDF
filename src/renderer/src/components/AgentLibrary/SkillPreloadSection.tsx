import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Search } from 'lucide-react';
import type { Skill } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface SkillPreloadSectionProps {
  skills: Skill[];
  selectedSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
}

function getSkillDisplayName(skill: { name: string; qualifiedName?: string | null }): string {
  return skill.qualifiedName?.trim() || skill.name;
}

/**
 * Skill preload field group: selected-skill chips plus a searchable dropdown of
 * Global Skill candidates. Owns its dropdown/search state; closing the dropdown
 * always clears the search query.
 */
export function SkillPreloadSection({ skills, selectedSkillIds, onToggleSkill }: SkillPreloadSectionProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpenRaw] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setDropdownOpen = (open: boolean) => {
    setDropdownOpenRaw(open);
    if (!open) setSearchQuery('');
  };

  const candidates = skills.filter(sk => {
    if (sk.scope !== 'global') return false;
    const query = searchQuery.toLowerCase();
    return sk.name.toLowerCase().includes(query)
      || getSkillDisplayName(sk).toLowerCase().includes(query)
      || (sk.sourceLabel || '').toLowerCase().includes(query);
  });

  const getSkillSourceLabel = (skill: { scope: string; sourceLabel?: string | null }) =>
    skill.sourceLabel || (skill.scope === 'project' ? t('agent.skillSourceProject') : t('agent.skillSourceGlobal'));

  return (
    <div className="form-group relative">
      <label className="form-label flex items-center justify-between">
        <span>{t('agent.skillPreloadLabel', { count: selectedSkillIds.length })}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.multiSelectHint')}</span>
      </label>
      <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        {t('agent.skillPreloadDesc')}
      </p>

      <div className="flex flex-wrap gap-1 py-1.5 px-2 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)] rounded-lg min-h-[46px] max-h-[120px] overflow-y-auto mb-2 transition-[background-color,border-color] duration-150">
        {selectedSkillIds.map(id => {
          const sk = skills.find(s => s.id === id);
          const displayName = sk ? getSkillDisplayName(sk) : '';
          return sk ? (
            <span key={id} className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-[var(--color-success-dim)]/40 text-[var(--color-success)] text-[11px] select-none border border-[var(--color-success)]/15 animate-fade-in scale-95 origin-left">
              <span>{displayName}</span>
              <button
                type="button"
                onClick={() => onToggleSkill(id)}
                className="text-[var(--color-success)]/60 hover:text-red-500 transition-colors ml-0.5 cursor-pointer font-bold text-[10px] leading-none"
                title={t('agent.removePreload')}
              >
                ×
              </button>
            </span>
          ) : null;
        })}
        {selectedSkillIds.length === 0 && (
          <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">{t('agent.noSkillsPreloaded')}</span>
        )}
      </div>

      <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-[background-color,border-color,color] duration-150 cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('agent.manageSkillPreload')}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
          className="w-[var(--radix-popover-trigger-width)] max-h-[220px] p-2 select-none flex flex-col gap-1"
        >
          <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-[var(--color-border)]/50 mb-1">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label={t('agent.searchSkillPlaceholder')}
              placeholder={t('agent.searchSkillPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full py-0.5"
            />
          </div>
          <div className="overflow-y-auto max-h-[160px] space-y-0.5 pr-0.5">
            {candidates.map(sk => {
              const displayName = getSkillDisplayName(sk);
              const sourceLabel = getSkillSourceLabel(sk);
              const isBound = selectedSkillIds.includes(sk.id);
              return (
                <button
                  key={sk.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isBound}
                  aria-label={t('agent.skillPreloadCandidateLabel', { name: displayName })}
                  onClick={() => onToggleSkill(sk.id)}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault();
                      onToggleSkill(sk.id);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                    isBound
                      ? 'bg-[var(--color-success-dim)]/20 text-[var(--color-success)] font-medium'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      aria-hidden="true"
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                        isBound
                          ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                          : 'border-[var(--color-border-strong)]'
                      }`}
                    >
                      {isBound && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{displayName}</span>
                  </span>
                  <span className="ml-2 shrink-0 rounded bg-[var(--color-bg-sunken)] px-1 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                    {sourceLabel}
                  </span>
                </button>
              );
            })}
            {candidates.length === 0 && (
              <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noSkillMatch')}</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
