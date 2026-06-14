import { useTheme } from '@/hooks/useTheme';
import { useI18nStore } from '@/stores/i18nStore';
import { useTranslation } from 'react-i18next';
import { Sliders, Globe, Palette, Info } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

export function SystemSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { currentLanguage, setLanguage } = useI18nStore();

  const languageOptions = [
    { value: 'zh-CN', label: t('sidebar.language.zh-CN', '简体中文') },
    { value: 'en-US', label: t('sidebar.language.en-US', 'English') }
  ];

  const themeOptions = [
    { value: 'light', label: t('theme.light', '浅色模式') },
    { value: 'dark', label: t('theme.dark', '深色模式') },
    { value: 'system', label: t('theme.system', '跟随系统') }
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden animate-fade-up">
      {/* Topbar */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* Settings Content Container */}
      <div className="settings-content !pt-3 max-w-2xl space-y-6 px-6">
        {/* Header Title */}
        <div className="flex flex-col gap-1 shrink-0 pb-4 border-b border-[var(--color-border)]/30">
          <h1 className="text-lg font-bold text-[var(--color-text-primary)] flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-[var(--color-accent)]" />
            <span>{t('sidebar.settings.system', '系统设置')}</span>
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {t('sidebar.settings.systemDesc', '配置系统的语言、主题外观及其他全局性参数')}
          </p>
        </div>

        {/* Long form container */}
        <div className="space-y-6">
          {/* Row 1: Language Settings */}
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

          {/* Row 2: Theme Settings */}
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

          {/* Row 3: Future settings placeholder */}
          <div className="flex items-start gap-3 py-3 opacity-70">
            <div className="p-2 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] mt-0.5">
              <Info className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
                {t('settings.more.title', '更多高级设置')}
              </span>
              <span className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                {t('settings.more.placeholderDesc', '后续更新中，这里将逐步添加：全局快捷键配置、网络代理设置、日志保存级别、本地缓存数据一键导出与清理等通用面板选项。')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SystemSettings;
