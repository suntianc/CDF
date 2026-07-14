import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useI18nStore } from '@/stores/i18nStore';
import { useTranslation } from 'react-i18next';
import { Globe, HardDrive, Palette, RefreshCw, Save } from 'lucide-react';
import type { ConversationWorkingStateStorageStatus } from '@shared/conversation-working-state';
import { CustomSelect } from '../ui/CustomSelect';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function SystemSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { currentLanguage, setLanguage } = useI18nStore();
  const [autoSave, setAutoSave] = useState(false);
  const [storageStatus, setStorageStatus] = useState<ConversationWorkingStateStorageStatus | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [showStorageSkeleton, setShowStorageSkeleton] = useState(false);
  const [storageLoadFailed, setStorageLoadFailed] = useState(false);

  useEffect(() => {
    window.electronAPI.store.get('autoSave').then((v: unknown) => {
      if (typeof v === 'boolean') setAutoSave(v);
    });
  }, []);

  const refreshStorageStatus = useCallback(async () => {
    setStorageLoading(true);
    setStorageLoadFailed(false);
    try {
      setStorageStatus(await window.electronAPI.workingState.getStorageStatus());
    } catch {
      setStorageLoadFailed(true);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStorageStatus();
  }, [refreshStorageStatus]);

  useEffect(() => {
    if (!storageLoading || storageStatus) {
      setShowStorageSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowStorageSkeleton(true), 300);
    return () => window.clearTimeout(timer);
  }, [storageLoading, storageStatus]);

  const handleAutoSaveToggle = (checked: boolean) => {
    setAutoSave(checked);
    window.electronAPI.store.set('autoSave', checked);
  };

  const languageOptions = [
    { value: 'zh-CN', label: t('sidebar.language.zh-CN', '简体中文') },
    { value: 'en-US', label: t('sidebar.language.en-US', 'English') }
  ];

  const themeOptions = [
    { value: 'light', label: t('theme.light', '浅色模式') },
    { value: 'dark', label: t('theme.dark', '深色模式') },
    { value: 'system', label: t('theme.system', '跟随系统') }
  ];

  const storageStatusText = (() => {
    if (storageLoadFailed) {
      return t('settings.workingState.unavailable', '无法获取存储状态');
    }
    if (!storageStatus) return '—';
    if (storageStatus.blockedReason) {
      return t(`settings.workingState.blocked.${storageStatus.blockedReason}`, '正在使用中');
    }
    if (storageStatus.phase === 'failed') {
      return t(
        `settings.workingState.failure.${storageStatus.failureReason ?? 'COMPACTION_FAILED'}`,
        '存储状态异常'
      );
    }
    return t(`settings.workingState.phase.${storageStatus.phase}`, '正常');
  })();

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden animate-fade-up">
      <header className="main-topbar shrink-0 h-10 flex items-center justify-between">
        <div className="main-topbar-left">
          <span className="text-xs text-[var(--color-text-muted)] font-normal">
            {t('sidebar.settings.systemDesc', '配置系统的语言、主题外观及其他全局性参数')}
          </span>
        </div>
      </header>

      <div className="settings-content !pt-3 max-w-2xl space-y-6 px-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between py-3 border-b border-[var(--color-border)]/20">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] mt-0.5">
                <Globe className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('sidebar.language.label', '界面语言')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('sidebar.language.desc', '切换系统的界面语言（中文 / English）')}
                </span>
              </div>
            </div>
            <div className="w-48">
              <CustomSelect
                value={currentLanguage}
                onChange={(val) => setLanguage(val as 'zh-CN' | 'en-US')}
                options={languageOptions}
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-[var(--color-border)]/20">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] mt-0.5">
                <Palette className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('theme.label', '外观主题')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('theme.desc', '切换系统的显示主题（浅色 / 深色 / 跟随系统）')}
                </span>
              </div>
            </div>
            <div className="w-48">
              <CustomSelect
                value={theme}
                onChange={(val) => setTheme(val as 'light' | 'dark' | 'system')}
                options={themeOptions}
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-[var(--color-border)]/20">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] mt-0.5">
                <Save className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('settings.autoSave.label', '文件自动保存')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('settings.autoSave.desc', '编辑文件后自动保存更改，无需手动按 Cmd/Ctrl+S')}
                </span>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={autoSave}
              aria-label={t('settings.autoSave.label', '文件自动保存')}
              onClick={() => handleAutoSaveToggle(!autoSave)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                autoSave ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ${
                  autoSave ? 'translate-x-4 ml-0.5' : 'translate-x-0 ml-0.5'
                }`}
              />
            </button>
          </div>

          <section
            role="group"
            aria-label={t('settings.workingState.title', '会话存储')}
            className="flex items-start gap-3 py-3"
          >
            <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] mt-0.5">
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('settings.workingState.title', '会话存储')}
                </span>
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('settings.workingState.refresh', '刷新存储状态')}
                        disabled={storageLoading}
                        onClick={() => void refreshStorageStatus()}
                        className="group flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-app)] disabled:opacity-40 disabled:cursor-default"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] group-hover:text-[var(--color-text-primary)] group-hover:bg-[var(--color-bg-hover)] group-active:bg-[var(--color-bg-active)] transition-colors duration-150">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('settings.workingState.refresh', '刷新存储状态')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {(!storageLoading || storageStatus) && (
                <p className={`mt-0.5 text-xs ${
                  storageLoadFailed || storageStatus?.phase === 'failed'
                    ? 'text-[var(--color-danger)]'
                    : 'text-[var(--color-text-muted)]'
                }`}>
                  {storageStatusText}
                </p>
              )}

              {storageLoading && (
                <span
                  role="status"
                  aria-label={t('settings.workingState.loading', '正在加载存储状态')}
                  className="sr-only"
                />
              )}

              {showStorageSkeleton && (
                <div className="grid grid-cols-2 gap-4 mt-3" aria-hidden="true">
                  <span className="h-8 rounded-[var(--radius-sm)] bg-[var(--color-bg-hover)]" />
                  <span className="h-8 rounded-[var(--radius-sm)] bg-[var(--color-bg-hover)]" />
                </div>
              )}

              {(!storageLoading || storageStatus) && (
                <dl className="grid grid-cols-2 gap-4 mt-3">
                  <div className="min-w-0">
                    <dt className="text-[11px] text-[var(--color-text-muted)]">
                      {t('settings.workingState.currentUsage', '当前占用')}
                    </dt>
                    <dd className="mt-1 text-xs font-medium text-[var(--color-text-primary)] tabular-nums">
                      {storageStatus ? formatBytes(storageStatus.physicalBytes) : '—'}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-[var(--color-text-muted)]">
                      {t('settings.workingState.estimatedReclaimable', '预计可释放')}
                    </dt>
                    <dd className="mt-1 text-xs font-medium text-[var(--color-text-primary)] tabular-nums">
                      {storageStatus ? formatBytes(storageStatus.estimatedReclaimableBytes) : '—'}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SystemSettings;
