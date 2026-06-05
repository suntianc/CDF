import type { FC } from 'react';
import { Settings2 } from 'lucide-react';

// Static SVG brand icons from @lobehub/icons-static-svg (peer-dep-free).
// Replaces the heavyweight @lobehub/icons (which transitively pulled antd@6
// + @lobehub/ui). All SVGs use fill="currentColor" so they inherit the
// parent's text color and stay theme-aware (light/dark).
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
import zhipuSvg from '@lobehub/icons-static-svg/icons/zhipu.svg?raw';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg?raw';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
import xiaomimimoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';

const ICON_MAP: Record<string, string> = {
  openai: openaiSvg,
  anthropic: anthropicSvg,
  ollama: ollamaSvg,
  deepseek: deepseekSvg,
  zhipu: zhipuSvg,
  'glm-overseas': zhipuSvg,
  minimax: minimaxSvg,
  'minimax-overseas': minimaxSvg,
  moonshot: moonshotSvg,
  qwen: qwenSvg,
  xiaomimimo: xiaomimimoSvg,
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
  const svg = ICON_MAP[provider];
  if (!svg) {
    // Fallback for 'custom' and any future unknown provider_type
    return <Settings2 size={size} className={className} aria-label={provider} />;
  }
  // fontSize: the imported SVGs use width/height="1em" so they scale with the
  // container's font size. Setting fontSize={size} on a 32x32 box yields a
  // 32px icon centered in the box.
  return (
    <span
      className={`inline-flex items-center justify-center leading-none ${shape === 'circle' ? 'rounded-full overflow-hidden' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: size }}
      aria-label={provider}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
