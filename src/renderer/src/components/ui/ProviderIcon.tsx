import type { CSSProperties, FC } from 'react';
import { Settings2 } from 'lucide-react';

// Static SVG brand icons from @lobehub/icons-static-svg (peer-dep-free).
// Replaces the heavyweight @lobehub/icons (which transitively pulled antd@6
// + @lobehub/ui). All mono SVGs use fill="currentColor" so they inherit the
// container's text color; the shim sets per-provider brand colors from the
// lobehub/lobe-icons `src/<Brand>/style.ts` COLOR_PRIMARY definitions.
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import deepseekColorSvg from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw';
import zhipuColorSvg from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw';
import minimaxColorSvg from '@lobehub/icons-static-svg/icons/minimax-color.svg?raw';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import qwenColorSvg from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw';
import xiaomimimoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';

// Brand colors from lobehub/lobe-icons src/<Brand>/style.ts COLOR_PRIMARY.
// Used for providers that have no -color.svg variant in the static-svg pkg.
const BRAND_COLORS: Record<string, string> = {
  openai: '#000000',
  anthropic: '#141413',
  ollama: '#000000',
  moonshot: '#16191E',
  xiaomimimo: '#000000',
};

// Mono SVGs (inherits currentColor).
const MONO_SVG: Record<string, string> = {
  openai: openaiSvg,
  anthropic: anthropicSvg,
  ollama: ollamaSvg,
  moonshot: moonshotSvg,
  xiaomimimo: xiaomimimoSvg,
};

// Pre-baked color SVGs (have explicit brand colors/gradients).
const COLOR_SVG: Record<string, string> = {
  deepseek: deepseekColorSvg,
  zhipu: zhipuColorSvg,
  minimax: minimaxColorSvg,
  'glm-overseas': zhipuColorSvg,
  'minimax-overseas': minimaxColorSvg,
  qwen: qwenColorSvg,
};

interface Props {
  provider: string;
  size?: number;
  shape?: 'square' | 'circle';
  className?: string;
}

export const ProviderIcon: FC<Props> = ({
  provider,
  size = 32,
  shape = 'circle',
  className = '',
}) => {
  const colorSvg = COLOR_SVG[provider];
  const monoSvg = MONO_SVG[provider];
  const brandColor = BRAND_COLORS[provider];

  if (!colorSvg && !monoSvg) {
    return <Settings2 size={size} className={className} aria-label={provider} />;
  }

  // Color SVGs are self-styled; mono SVGs need the parent text color to match
  // the brand. fontSize={size} makes the 1em-sized SVG paths render at `size`px.
  // backgroundColor: pure white — keeps the brand color readable in both
  // light and dark themes (the parent container was inheriting theme tints).
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: size,
    lineHeight: 0,
    color: brandColor,
    backgroundColor: '#ffffff',
  };

  return (
    <span
      className={`inline-flex items-center justify-center leading-none ${shape === 'circle' ? 'rounded-full overflow-hidden' : ''} ${className}`}
      style={style}
      aria-label={provider}
      dangerouslySetInnerHTML={{ __html: colorSvg ?? monoSvg }}
    />
  );
};
