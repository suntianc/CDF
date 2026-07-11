import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Beaker, BookOpen, FileText, MessageSquare, RefreshCw, Search } from 'lucide-react';
import type { KnowledgeEntrySummary, ProjectScene } from '@shared/types';
import { useProjectStore } from '../../stores/projectStore';

type ResearchPanel = 'conversation' | 'papers' | 'writing' | 'experiments';
type PaperViewMode = 'flat' | 'grouped';

interface SceneWorkspaceProps {
  scene: ProjectScene;
  conversation: ReactNode;
}

const researchPanels: Array<{
  id: ResearchPanel;
  labelKey: string;
  icon: typeof MessageSquare;
}> = [
  { id: 'conversation', labelKey: 'sceneWorkspace.conversation', icon: MessageSquare },
  { id: 'papers', labelKey: 'sceneWorkspace.paperLibrary', icon: BookOpen },
  { id: 'writing', labelKey: 'sceneWorkspace.writing', icon: FileText },
  { id: 'experiments', labelKey: 'sceneWorkspace.experiments', icon: Beaker },
];

export function SceneWorkspace({ scene, conversation }: SceneWorkspaceProps) {
  if (scene === 'research') {
    return <ResearchSceneWorkspace conversation={conversation} />;
  }

  return <>{conversation}</>;
}

function ResearchSceneWorkspace({ conversation }: { conversation: ReactNode }) {
  const { t } = useTranslation();
  const [activePanel, setActivePanel] = useState<ResearchPanel>('conversation');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-app)]">
      <header className="main-topbar h-10 shrink-0 justify-between px-3">
        <div role="tablist" aria-label={t('sceneWorkspace.researchTabs')} className="main-topbar-left flex items-center gap-1">
          {researchPanels.map((panel) => {
            const Icon = panel.icon;
            const selected = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActivePanel(panel.id)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${
                  selected
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(panel.labelKey)}
              </button>
            );
          })}
        </div>

      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {activePanel === 'conversation' ? (
          <div role="tabpanel" className="absolute inset-0">
            {conversation}
          </div>
        ) : activePanel === 'papers' ? (
          <PaperLibraryPanel />
        ) : (
          <ResearchEmptyPanel panel={activePanel} />
        )}
      </div>
    </div>
  );
}

interface PaperLibraryItem {
  entry: KnowledgeEntrySummary;
  title: string;
  authors: string[];
  abstract: string;
  source: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  year: string;
  doi: string;
  journalMetrics: JournalMetricsSnapshotView;
  resource: string;
  tags: string[];
}

interface JournalMetricsSnapshotView {
  impactFactor: string;
  casTier: string;
  jcrQuartile: string;
  indexing: string[];
  year: string;
  source: string;
}

function PaperLibraryPanel() {
  const { t } = useTranslation();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const [entries, setEntries] = useState<KnowledgeEntrySummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedJournal, setSelectedJournal] = useState<string | null>(null);
  const [selectedCasTier, setSelectedCasTier] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PaperViewMode>('flat');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(() => {
    if (!currentProjectId) {
      setEntries([]);
      return Promise.resolve();
    }

    setLoading(true);
    setError(null);
    return window.electronAPI.knowledge
      .list(currentProjectId, { sortBy: 'timestamp', sortOrder: 'desc' })
      .then((items) => {
        setEntries(items);
      })
      .catch((err: unknown) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [currentProjectId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const papers = useMemo(() => entries.map(toPaperLibraryItem).filter((item): item is PaperLibraryItem => item !== null), [entries]);
  const allTags = useMemo(() => Array.from(new Set(papers.flatMap((paper) => paper.tags))).sort((a, b) => a.localeCompare(b)), [papers]);
  const allJournals = useMemo(() => Array.from(new Set(papers.map((paper) => paper.journal).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [papers]);
  const allCasTiers = useMemo(() => Array.from(new Set(papers.map((paper) => paper.journalMetrics.casTier).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [papers]);
  const filteredPapers = useMemo(
    () => papers.filter((paper) => (
      matchesPaperKeyword(paper, keyword)
      && (!selectedTag || paper.tags.includes(selectedTag))
      && (!selectedJournal || paper.journal === selectedJournal)
      && (!selectedCasTier || paper.journalMetrics.casTier === selectedCasTier)
    )),
    [keyword, papers, selectedCasTier, selectedJournal, selectedTag],
  );
  const groupedPapers = useMemo(() => groupPapersByTag(filteredPapers, t('sceneWorkspace.untaggedGroup')), [filteredPapers, t]);

  return (
    <div role="tabpanel" className="h-full overflow-auto bg-[var(--color-bg-app)] px-5 py-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('sceneWorkspace.paperLibrary')}</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {t('sceneWorkspace.paperCount', { count: filteredPapers.length })}
            </div>
          </div>
          <div className="flex min-w-[260px] flex-1 flex-wrap justify-end gap-2">
            <label className="relative min-w-[240px] flex-1 sm:max-w-[340px]">
              <span className="sr-only">{t('sceneWorkspace.paperSearchLabel')}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t('sceneWorkspace.paperSearchPlaceholder')}
                className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-sunken)] pl-8 pr-2 text-xs text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadEntries()}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('sceneWorkspace.refreshPapers')}
            </button>
          </div>
        </div>

        <div className="inline-flex w-fit rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0.5">
          {(['flat', 'grouped'] as PaperViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-[5px] px-2.5 py-1 text-[11px] transition-colors ${
                viewMode === mode
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              {t(mode === 'flat' ? 'sceneWorkspace.flatView' : 'sceneWorkspace.groupByTagView')}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <PaperFilterChips
            items={allTags}
            selected={selectedTag}
            ariaLabel={t('sceneWorkspace.paperTagFilters')}
            getButtonLabel={(tag) => t('sceneWorkspace.paperTagFilterLabel', { tag })}
            onToggle={(tag) => setSelectedTag(selectedTag === tag ? null : tag)}
          />
          <PaperFilterChips
            items={allJournals}
            selected={selectedJournal}
            ariaLabel={t('sceneWorkspace.paperJournalFilters')}
            getButtonLabel={(journal) => t('sceneWorkspace.paperJournalFilterLabel', { journal })}
            onToggle={(journal) => setSelectedJournal(selectedJournal === journal ? null : journal)}
          />
          <PaperFilterChips
            items={allCasTiers}
            selected={selectedCasTier}
            ariaLabel={t('sceneWorkspace.paperCasTierFilters')}
            getButtonLabel={(tier) => t('sceneWorkspace.paperCasTierFilterLabel', { tier })}
            onToggle={(tier) => setSelectedCasTier(selectedCasTier === tier ? null : tier)}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {t('sceneWorkspace.paperLoadError', { message: error })}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {t('sceneWorkspace.paperLoading')}
          </div>
        ) : null}

        {!loading && filteredPapers.length === 0 ? <PaperLibraryEmptyState /> : null}

        {viewMode === 'flat' ? (
          <div className="flex flex-col gap-2">
            {filteredPapers.map((paper) => <PaperCard key={paper.entry.relativePath} paper={paper} projectId={currentProjectId} />)}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groupedPapers.map((group) => (
              <section key={group.tag} className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">{group.tag}</h2>
                {group.papers.map((paper) => (
                  <PaperCard key={`${group.tag}:${paper.entry.relativePath}`} paper={paper} projectId={currentProjectId} />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PaperCard({ paper, projectId }: { paper: PaperLibraryItem; projectId: string | null }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const canExpand = paper.abstract.length > 0;
  const bibliographicParts = getBibliographicParts(paper, t);
  const metrics = getMetricBadges(paper, t);
  const toggleExpanded = () => {
    if (canExpand) {
      setExpanded((value) => !value);
    }
  };
  const openPdf = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (projectId && paper.resource) {
      void window.electronAPI.papers.openPdf(projectId, paper.resource);
    }
  };

  return (
    <article
      role={canExpand ? 'button' : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-label={canExpand ? paper.title : undefined}
      aria-expanded={canExpand ? expanded : undefined}
      onClick={toggleExpanded}
      onKeyDown={(event) => {
        if (!canExpand) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleExpanded();
        }
      }}
      className={`rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 ${
        canExpand ? 'cursor-pointer outline-none transition-colors hover:border-[var(--color-border-strong)] focus:border-[var(--color-border-strong)]' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col items-start">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{paper.title}</h3>
            {paper.authors.length > 0 ? (
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">{paper.authors.join(', ')}</div>
            ) : null}
            {bibliographicParts.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
                {bibliographicParts.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </div>
            ) : null}
            {metrics.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {metrics.map((metric) => (
                  <span
                    key={metric}
                    className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
                  >
                    {metric}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {paper.resource ? (
            <button
              type="button"
              onClick={openPdf}
              className="mt-2 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            >
              {t('sceneWorkspace.openPdf')}
            </button>
          ) : null}
        </div>
        {paper.source ? (
          <div className="max-w-[240px] truncate text-xs text-[var(--color-text-muted)]" title={paper.source}>
            {paper.source}
          </div>
        ) : null}
      </div>

      {paper.abstract ? (
        <p className={`mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)] ${expanded ? '' : 'line-clamp-3'}`}>
          {paper.abstract}
        </p>
      ) : null}

      {(paper.entry.invalidFrontmatter || paper.entry.warnings.length > 0) ? (
        <div className="mt-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-bg-surface)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--color-warning)]">
          {paper.entry.invalidFrontmatter ? <div>{t('sceneWorkspace.invalidFrontmatter')}</div> : null}
          {paper.entry.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {paper.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {paper.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PaperFilterChips({
  items,
  selected,
  ariaLabel,
  getButtonLabel,
  onToggle,
}: {
  items: string[];
  selected: string | null;
  ariaLabel: string;
  getButtonLabel: (item: string) => string;
  onToggle: (item: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const isSelected = selected === item;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={isSelected}
            aria-label={getButtonLabel(item)}
            onClick={() => onToggle(item)}
            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
              isSelected
                ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function PaperLibraryEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-5 py-4 text-center">
      <div className="text-sm font-medium text-[var(--color-text-primary)]">
        {t('sceneWorkspace.papersEmptyTitle')}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
        {t('sceneWorkspace.papersEmptyDescription')}
      </div>
    </div>
  );
}

function toPaperLibraryItem(entry: KnowledgeEntrySummary): PaperLibraryItem | null {
  if (entry.frontmatter.type !== 'Paper') {
    return null;
  }

  return {
    entry,
    title: readString(entry.frontmatter.title) || entry.title || entry.relativePath,
    authors: readStringArray(entry.frontmatter.authors),
    abstract: readString(entry.frontmatter.description),
    source: readString(entry.frontmatter.source),
    journal: readString(entry.frontmatter.journal),
    volume: readStringOrNumber(entry.frontmatter.volume),
    issue: readStringOrNumber(entry.frontmatter.issue),
    pages: readStringOrNumber(entry.frontmatter.pages),
    year: readStringOrNumber(entry.frontmatter.year),
    doi: readString(entry.frontmatter.doi),
    journalMetrics: readJournalMetrics(entry.frontmatter.journalMetrics),
    resource: readString(entry.frontmatter.resource),
    tags: entry.tags,
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringOrNumber(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function readJournalMetrics(value: unknown): JournalMetricsSnapshotView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyJournalMetrics();
  }
  const record = value as Record<string, unknown>;
  return {
    impactFactor: readStringOrNumber(record.impactFactor),
    casTier: readString(record.casTier),
    jcrQuartile: readString(record.jcrQuartile),
    indexing: readStringArray(record.indexing),
    year: readStringOrNumber(record.year),
    source: readString(record.source),
  };
}

function emptyJournalMetrics(): JournalMetricsSnapshotView {
  return {
    impactFactor: '',
    casTier: '',
    jcrQuartile: '',
    indexing: [],
    year: '',
    source: '',
  };
}

function getBibliographicParts(paper: PaperLibraryItem, t: TFunction): string[] {
  const volumeIssue = paper.volume && paper.issue
    ? t('sceneWorkspace.paperVolumeIssue', { volume: paper.volume, issue: paper.issue })
    : paper.volume
      ? t('sceneWorkspace.paperVolume', { volume: paper.volume })
      : paper.issue
        ? t('sceneWorkspace.paperIssue', { issue: paper.issue })
        : '';
  return [
    paper.journal,
    paper.year,
    volumeIssue,
    paper.pages ? t('sceneWorkspace.paperPages', { pages: paper.pages }) : '',
    paper.doi ? t('sceneWorkspace.paperDoi', { doi: paper.doi }) : '',
  ].filter(Boolean);
}

function metricSuffix(metrics: JournalMetricsSnapshotView): string {
  if (metrics.year && metrics.source) return ` (${metrics.year}, ${metrics.source})`;
  if (metrics.year) return ` (${metrics.year})`;
  if (metrics.source) return ` (${metrics.source})`;
  return '';
}

function getMetricBadges(paper: PaperLibraryItem, t: TFunction): string[] {
  const metrics = paper.journalMetrics;
  const suffix = metricSuffix(metrics);
  const yearOnlySuffix = metrics.year ? ` (${metrics.year})` : suffix;
  return [
    metrics.impactFactor ? t('sceneWorkspace.paperImpactFactor', { value: metrics.impactFactor, suffix }) : '',
    metrics.casTier ? t('sceneWorkspace.paperCasTier', { value: metrics.casTier, suffix: yearOnlySuffix }) : '',
    metrics.jcrQuartile ? t('sceneWorkspace.paperJcrQuartile', { value: metrics.jcrQuartile, suffix: yearOnlySuffix }) : '',
    metrics.indexing.length > 0 ? t('sceneWorkspace.paperIndexing', { value: metrics.indexing.join(', '), suffix: yearOnlySuffix }) : '',
  ].filter(Boolean);
}

function matchesPaperKeyword(paper: PaperLibraryItem, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [
    paper.title,
    paper.abstract,
    paper.source,
    paper.journal,
    paper.doi,
    ...paper.authors,
    ...paper.tags,
  ].some((value) => value.toLowerCase().includes(needle));
}

function groupPapersByTag(papers: PaperLibraryItem[], untaggedLabel: string): Array<{ tag: string; papers: PaperLibraryItem[] }> {
  const groups = new Map<string, PaperLibraryItem[]>();
  const untagged: PaperLibraryItem[] = [];

  papers.forEach((paper) => {
    if (paper.tags.length === 0) {
      untagged.push(paper);
      return;
    }
    paper.tags.forEach((tag) => {
      groups.set(tag, [...(groups.get(tag) ?? []), paper]);
    });
  });

  const grouped = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, groupPapers]) => ({ tag, papers: groupPapers }));

  if (untagged.length > 0) {
    grouped.push({ tag: untaggedLabel, papers: untagged });
  }

  return grouped;
}

function ResearchEmptyPanel({ panel }: { panel: Exclude<ResearchPanel, 'conversation'> }) {
  const { t } = useTranslation();
  return (
    <div
      role="tabpanel"
      className="flex h-full items-center justify-center bg-[var(--color-bg-app)] px-6"
    >
      <div className="max-w-[360px] rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-5 py-4 text-center">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">
          {t(`sceneWorkspace.${panel}EmptyTitle`)}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t(`sceneWorkspace.${panel}EmptyDescription`)}
        </div>
      </div>
    </div>
  );
}
