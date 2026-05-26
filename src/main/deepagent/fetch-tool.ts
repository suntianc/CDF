import { BrowserWindow, session } from 'electron';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { tool } from '@langchain/core/tools';

const turndownService = new TurndownService();

// 动态生成 User-Agent
function getDefaultUserAgent(): string {
  const platform = process.platform;
  const arch = process.arch;
  const chromeVersion = '124.0.0.0';

  if (platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  } else if (platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  } else {
    return `Mozilla/5.0 (X11; Linux ${arch}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
}

// 延迟初始化 session，只有在 Electron 环境中才创建
let fetchSession: Electron.Session | null = null;
let isRequestFilterRegistered = false;

function getFetchSession(): Electron.Session | null {
  // 检测是否在 Electron 主进程中
  if (typeof session === 'undefined' || !session.defaultSession) {
    return null;
  }
  if (!fetchSession) {
    fetchSession = session.fromPartition('agent_fetch_mem');
  }
  return fetchSession;
}

function registerRequestFilter(sess: Electron.Session) {
  if (isRequestFilterRegistered) return;
  sess.webRequest.onBeforeRequest((details, callback) => {
    const blockTypes = ['stylesheet', 'font', 'image', 'media'];
    if (blockTypes.includes(details.resourceType)) {
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
  isRequestFilterRegistered = true;
}

interface FetchInput {
  url: string;
  timeout?: number;
}

const EXECUTE_JAVASCRIPT_TIMEOUT = 5000;

async function fetchPageAsMarkdown(url: string, timeout: number = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sess = getFetchSession();

    let ghostWindow: BrowserWindow | null = null;
    try {
      ghostWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          session: sess || undefined,
          images: false,
          webSecurity: true,
          javascript: true,
        },
      });
    } catch (e) {
      reject(new Error(`创建窗口失败: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }

    if (sess) {
      registerRequestFilter(sess);
    }

    ghostWindow.webContents.setUserAgent(getDefaultUserAgent());

    let isFinished = false;
    let timer: NodeJS.Timeout | null = null;

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (ghostWindow && !ghostWindow.isDestroyed()) {
        ghostWindow.webContents.removeAllListeners();
        ghostWindow.destroy();
      }
      ghostWindow = null;
    }

    const finalize = (result: string | Error, isSuccess: boolean) => {
      if (isFinished) return;
      isFinished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (isSuccess) {
        resolve(result as string);
      } else {
        reject(result);
      }
      cleanup();
    };

    async function resolveWithContent() {
      if (isFinished || !ghostWindow) return;

      try {
        // 关键修复：为 executeJavaScript 增加超时控制，防止窗口永久挂起
        const html = await Promise.race([
          ghostWindow.webContents.executeJavaScript(
            'document.documentElement.outerHTML'
          ),
          new Promise<string>((_, rej) =>
            setTimeout(() => rej(new Error('executeJavaScript timeout')), EXECUTE_JAVASCRIPT_TIMEOUT)
          ),
        ]);

        const doc = new JSDOM(html as string, { url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (!article || !article.content) {
          finalize('⚠️ 抓取成功，但未能从该页面提取到有效的高价值核心正文。', true);
          return;
        }

        const markdown = turndownService.turndown(article.content);
        const title = article.title || '无标题';
        const result = `# ${title}\n\n${markdown}`;

        finalize(result, true);
      } catch (error) {
        finalize(
          new Error(`解析网页文本失败: ${error instanceof Error ? error.message : String(error)}`),
          false
        );
      }
    }

    timer = setTimeout(() => {
      if (!isFinished) {
        console.warn(`[Agent Fetch] 页面加载超时，触发降级策略：直接解析当前已有内容。URL: ${url}`);
        resolveWithContent();
      }
    }, timeout);

    ghostWindow.webContents.on('did-finish-load', () => {
      resolveWithContent();
    });

    ghostWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return;
      if (!isFinished) {
        finalize(new Error(`网络请求失败: ${errorDescription} (错误码: ${errorCode})`), false);
      }
    });

    ghostWindow.loadURL(url).catch((err) => {
      if (!isFinished) {
        finalize(new Error(`无法初始化 URL 加载: ${err?.message || err}`), false);
      }
    });
  });
}

const FETCH_SCHEMA = {
  type: 'object' as const,
  properties: {
    url: {
      type: 'string',
      description: 'The URL of the webpage to fetch and convert to markdown',
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 12000)',
      default: 12000,
    },
  },
  required: ['url'],
  additionalProperties: false,
};

export function createFetchTool() {
  return tool(
    async (input: FetchInput) => {
      try {
        const markdown = await fetchPageAsMarkdown(input.url, input.timeout ?? 12000);
        return markdown;
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          url: input.url,
        });
      }
    },
    {
      name: 'fetch',
      description: 'Fetch a webpage and convert it to markdown. Use this to read the content of a web page when you have a URL. Returns the page title and content in markdown format.',
      schema: FETCH_SCHEMA,
    }
  );
}
