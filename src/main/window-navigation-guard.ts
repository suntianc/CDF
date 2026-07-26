import { shell, type BrowserWindow } from 'electron';

/**
 * 把窗口限制在自身的应用内容里。任何把顶层 frame 导航到别处、或 window.open 新窗口的尝试
 * 都会被拦截；http(s) 目标改交给系统浏览器打开。
 *
 * 没有这层拦截时，PDF 内嵌链接或被注入的渲染层可以把携带 preload 桥（以及 cdf-file/fs
 * 能力面）的窗口导航到远程页面，把本地文件读写面暴露给远端。
 */

const INTERNAL_PROTOCOLS = new Set(['file:', 'cdf-file:', 'devtools:', 'about:']);

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isInternalNavigation(target: string, allowedOrigin: string | null): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (INTERNAL_PROTOCOLS.has(url.protocol)) return true;
  if (allowedOrigin && url.origin === allowedOrigin) return true;
  return false;
}

export interface HardenWindowNavigationDeps {
  openExternal: (url: string) => void;
}

export function hardenWindowNavigation(
  window: BrowserWindow,
  options: { allowedUrl?: string; deps?: HardenWindowNavigationDeps } = {}
): void {
  const openExternal = options.deps?.openExternal ?? ((url: string) => void shell.openExternal(url));
  const allowedOrigin = options.allowedUrl ? safeOrigin(options.allowedUrl) : null;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url, allowedOrigin)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      openExternal(url);
    }
  });
}
