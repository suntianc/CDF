import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Microscope,
  RefreshCw,
  Save,
} from 'lucide-react';
import type {
  PaperSearchConfigEntry,
  PaperSearchConfigKey,
  PaperSearchConfigSettings,
} from '@shared/types';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface PaperSearchConfigMeta {
  key: PaperSearchConfigKey;
  group: 'recommended' | 'journal' | 'biomedical' | 'publisher';
  inputMode: 'secret' | 'email' | 'text' | 'number' | 'select';
  options?: string[];
  entryUrl?: string;
}

const PAPER_SEARCH_CONFIG_META: PaperSearchConfigMeta[] = [
  { key: 'SEMANTIC_SCHOLAR_API_KEY', group: 'recommended', inputMode: 'secret', entryUrl: 'https://www.semanticscholar.org/product/api' },
  { key: 'UNPAYWALL_EMAIL', group: 'recommended', inputMode: 'email', entryUrl: 'https://unpaywall.org/products/api' },
  { key: 'CROSSREF_MAILTO', group: 'recommended', inputMode: 'email', entryUrl: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/' },
  { key: 'CORE_API_KEY', group: 'recommended', inputMode: 'secret', entryUrl: 'https://core.ac.uk/services/api' },
  { key: 'EASYSCHOLAR_KEY', group: 'journal', inputMode: 'secret', entryUrl: 'https://www.easyscholar.cc/console/user/open' },
  { key: 'PUBMED_API_KEY', group: 'biomedical', inputMode: 'secret', entryUrl: 'https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/' },
  { key: 'WOS_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://developer.clarivate.com/apis' },
  { key: 'IEEE_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://developer.ieee.org/docs/read/Searching_the_IEEE_Xplore_Metadata_API' },
  { key: 'ELSEVIER_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://dev.elsevier.com/apikey/manage' },
  { key: 'SPRINGER_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://dev.springernature.com/' },
  { key: 'SPRINGER_OPENACCESS_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://dev.springernature.com/' },
  { key: 'WILEY_TDM_TOKEN', group: 'publisher', inputMode: 'secret', entryUrl: 'https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining' },
  { key: 'OPENAIRE_API_KEY', group: 'publisher', inputMode: 'secret', entryUrl: 'https://develop.openaire.eu/' },
];

const GROUPS: PaperSearchConfigMeta['group'][] = ['recommended', 'journal', 'biomedical', 'publisher'];

export function ResearchSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PaperSearchConfigSettings | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<PaperSearchConfigKey, string>>>({});
  const [visible, setVisible] = useState<Partial<Record<PaperSearchConfigKey, boolean>>>({});
  const [savingKey, setSavingKey] = useState<PaperSearchConfigKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const entriesByKey = useMemo(() => {
    const entries = settings?.entries ?? [];
    return new Map(entries.map((entry) => [entry.key, entry]));
  }, [settings]);

  const getConfigName = (key: PaperSearchConfigKey): string =>
    t(`settings.research.nameByKey.${key}`);

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const next = await window.electronAPI.paperSearch.getSettings();
      setSettings(next);
    } catch (error) {
      console.error('Failed to load Paper Search CLI settings:', error);
      showToast(t('settings.research.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (key: PaperSearchConfigKey) => {
    const hasDraft = Object.prototype.hasOwnProperty.call(drafts, key);
    const value = (hasDraft ? drafts[key] ?? '' : entriesByKey.get(key)?.value ?? '').trim();
    const name = getConfigName(key);
    if (!value) {
      showToast(t('settings.research.valueRequired', { name }), 'error');
      return;
    }

    setSavingKey(key);
    try {
      const next = await window.electronAPI.paperSearch.saveConfigValue(key, value);
      setSettings(next);
      setDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[key];
        return nextDrafts;
      });
      setVisible((current) => ({ ...current, [key]: false }));
      showToast(t('settings.research.saveSuccess', { name }), 'success');
    } catch (error) {
      console.error('Failed to save Paper Search CLI config:', error);
      showToast(t('settings.research.saveFailed', { name }), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleOpenEntry = async (url: string) => {
    try {
      await window.electronAPI.shell.openExternalUrl(url);
    } catch (error) {
      console.error('Failed to open research config entry:', error);
      showToast(t('settings.research.openEntryFailed'), 'error');
    }
  };

  const renderInput = (meta: PaperSearchConfigMeta, entry?: PaperSearchConfigEntry) => {
    const isSecret = meta.inputMode === 'secret';
    const isVisible = visible[meta.key] ?? false;
    const hasDraft = Object.prototype.hasOwnProperty.call(drafts, meta.key);
    const value = hasDraft ? drafts[meta.key] ?? '' : entry?.value ?? '';
    const placeholder = t(`settings.research.placeholder.${meta.inputMode}`);

    if (meta.inputMode === 'select') {
      return (
        <select
          aria-label={t('settings.research.inputLabel', { name: getConfigName(meta.key) })}
          value={value}
          onChange={(event) => setDrafts((current) => ({ ...current, [meta.key]: event.target.value }))}
          className="w-full h-8 bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none rounded-md px-2 text-xs text-[var(--color-text-primary)]"
        >
          <option value="">{placeholder}</option>
          {meta.options?.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }

    const inputType = meta.inputMode === 'number'
      ? 'number'
      : isSecret && !isVisible
        ? 'password'
        : meta.inputMode === 'email'
          ? 'email'
          : 'text';

    return (
      <div className="relative">
        <input
          aria-label={t('settings.research.inputLabel', { name: getConfigName(meta.key) })}
          type={inputType}
          inputMode={meta.inputMode === 'number' ? 'numeric' : meta.inputMode === 'email' ? 'email' : 'text'}
          value={value}
          onChange={(event) => setDrafts((current) => ({ ...current, [meta.key]: event.target.value }))}
          placeholder={placeholder}
          className={`w-full h-8 bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 outline-none rounded-md py-1.5 pl-2 ${isSecret ? 'pr-8' : 'pr-2'} text-xs font-mono text-[var(--color-text-primary)]`}
        />
        {isSecret && (
          <button
            type="button"
            aria-label={isVisible ? t('settings.research.hideSecret') : t('settings.research.showSecret')}
            onClick={() => setVisible((current) => ({ ...current, [meta.key]: !isVisible }))}
            className="absolute right-2 top-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      <div className="absolute top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg border pointer-events-auto ${
              toast.type === 'success'
                ? 'bg-[var(--color-success-dim)] border-[var(--color-success)]/20 text-[var(--color-success)]'
                : toast.type === 'error'
                  ? 'bg-[var(--color-danger-dim)] border-[var(--color-danger)]/20 text-[var(--color-danger)]'
                  : 'bg-[var(--color-bg-active)] border-[var(--color-border)]/40 text-[var(--color-text-primary)]'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <div className="main-topbar shrink-0 h-9 border-b-0" />

      <div className="settings-content !pt-3 flex-1 overflow-y-auto flex flex-col">
        <div className="max-w-[1200px] w-full flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-accent)] mt-0.5">
                <Microscope className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                  {t('settings.research.title')}
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed max-w-3xl">
                  {t('settings.research.desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadSettings}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {t('settings.research.refresh')}
            </button>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs w-fit">
            <span className="text-[var(--color-text-muted)]">{t('settings.research.configuredCount')}</span>
            <span className="ml-2 font-semibold text-[var(--color-text-primary)]">
              {settings ? `${settings.configuredCount}/${settings.totalCount}` : t('settings.tool.loading')}
            </span>
          </div>

          {loading && !settings ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)] mt-12">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
              <span className="text-xs">{t('settings.tool.loading')}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-5 pb-8">
              {GROUPS.map((group) => (
                <section key={group} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                      {t(`settings.research.group.${group}`)}
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {PAPER_SEARCH_CONFIG_META
                      .filter((meta) => meta.group === group)
                      .map((meta) => {
                        const entry = entriesByKey.get(meta.key);
                        const isSaving = savingKey === meta.key;
                        const entryUrl = meta.entryUrl;
                        return (
                          <div
                            key={meta.key}
                            data-testid={`paper-search-config-${meta.key}`}
                            className="grid grid-cols-1 xl:grid-cols-[minmax(220px,300px)_minmax(240px,1fr)_auto] gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3"
                          >
                            <div className="min-w-0 flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                                  {getConfigName(meta.key)}
                                </span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  entry?.configured
                                    ? 'text-[var(--color-success)] border-[var(--color-success)]/30 bg-[var(--color-success-dim)]'
                                    : 'text-[var(--color-text-muted)] border-[var(--color-border)] bg-[var(--color-bg-sunken)]'
                                }`}>
                                  {entry?.configured ? t('settings.research.configured') : t('settings.research.notConfigured')}
                                </span>
                              </div>
                              <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
                                {t(`settings.research.descByKey.${meta.key}`)}
                              </p>
                            </div>

                            <div className="min-w-0 flex flex-col gap-2">
                              <label className="sr-only">
                                {t('settings.research.inputLabel', { name: getConfigName(meta.key) })}
                              </label>
                              {renderInput(meta, entry)}
                            </div>

                            <div className="flex xl:flex-col items-center xl:items-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleSave(meta.key)}
                                disabled={isSaving}
                                className="inline-flex items-center justify-center gap-1.5 min-w-20 h-8 px-3 rounded-md bg-[var(--color-accent)] text-white text-xs font-semibold disabled:opacity-50"
                              >
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                {t('common.save')}
                              </button>
                              {entryUrl && (
                                <a
                                  href={entryUrl}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    void handleOpenEntry(entryUrl);
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {t('settings.research.entry')}
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
