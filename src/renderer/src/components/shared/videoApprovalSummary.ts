import type { VideoGenerationMode } from '@shared/capability-jobs';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface VideoApprovalSummary {
  route: string;
  mode: VideoGenerationMode;
  duration: number;
  resolution: string;
  inputSummary: string;
  nonCancellationWarning: string;
}

export function projectVideoApprovalSummary(
  value: unknown,
  t: Translate,
): VideoApprovalSummary {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode: VideoGenerationMode = input.mode === 'first-frame' ? 'first-frame' : 'text';
  const route = typeof input.route_hint === 'string' ? input.route_hint : 'auto';
  const duration = typeof input.duration === 'number' ? input.duration : 6;
  const resolution = typeof input.resolution === 'string'
    ? input.resolution
    : route === 'minimax-token-plan'
      ? '768P'
      : route === 'xai-oauth' || mode === 'first-frame'
        ? '480p'
        : t('taskPanel.providerDefaultResolution');
  return {
    route,
    mode,
    duration,
    resolution,
    inputSummary: summarizeInput(input, mode, t),
    nonCancellationWarning: t('taskPanel.nonCancellationWarning'),
  };
}

function summarizeInput(
  input: Record<string, unknown>,
  mode: VideoGenerationMode,
  t: Translate,
): string {
  if (mode === 'text') return t('taskPanel.videoInputText');
  const images = Array.isArray(input.images) ? input.images : [];
  const image = images[0] && typeof images[0] === 'object' && !Array.isArray(images[0])
    ? images[0] as Record<string, unknown>
    : {};
  const source = typeof image.source === 'string' ? image.source : '';
  try {
    const url = new URL(source);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return t('taskPanel.videoInputFirstFrameRemote', { host: url.host });
    }
  } catch {
    // Local paths are summarized by basename below.
  }
  const basename = source.split(/[\\/]/).filter(Boolean).pop();
  return basename
    ? t('taskPanel.videoInputFirstFrameLocal', { file: basename })
    : t('taskPanel.videoInputFirstFrame');
}
