import fs from 'node:fs';
import path from 'node:path';

/**
 * `cdf-file` 自定义协议：把渲染进程里的本地绝对路径安全地喂给 <img>/<audio>/<video>。
 *
 * 历史实现用 `net.fetch(file://…)` 整体返回，导致媒体流对 Chromium 不可寻址
 * （`video.seekable.end()` 恒为 0）：大文件重播、以及 moov 在尾部的 mp4 首次播放都会
 * 失败（见 electron#38749）。修复需要两件事同时成立：
 *   1. scheme 注册为 `standard: true`（否则范围请求会 PIPELINE_ERROR_READ）；
 *   2. handler 自行实现 HTTP Range，返回 206 + Content-Range，从磁盘流式读取。
 * 参考 Joplin 的实现。
 */

export const CDF_FILE_SCHEME = 'cdf-file';

// standard:true 是启用媒体寻址机制的关键；它同时改变 URL 语义，故路径解析走 resolveCdfFilePath。
export const cdfFileSchemePrivileges = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  bypassCSP: true,
} as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

export function contentTypeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * 把 `cdf-file://…` URL 还原成绝对文件路径。
 *
 * standard scheme 下 Electron 会把 `cdf-file:///abs/path` 规整成 host=第一段路径
 * （`cdf-file://abs/…`），所以要把 host 与 pathname 重新拼回；三斜杠形式则 host 为空。
 * 两种形式都还原出同一绝对路径。
 */
export function resolveCdfFilePath(url: string): string {
  const parsed = new URL(url);
  const raw = parsed.host ? `/${parsed.host}${parsed.pathname}` : parsed.pathname;
  let filePath = decodeURIComponent(raw);
  if (/^\/[A-Za-z]:\//.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return filePath;
}

export type ParsedRange = { start: number; end: number };

/**
 * 解析 HTTP Range 头。支持 `bytes=start-end`、`bytes=start-`、`bytes=-suffix`。
 * 返回 null 表示无范围（应整体返回 200），'invalid' 表示越界（应回 416）。
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  size: number
): ParsedRange | null | 'invalid' {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end =
    match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), size - 1) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size || start < 0) {
    return 'invalid';
  }
  return { start, end };
}

/**
 * 容错的 Node → Web 流适配器。绕开 nodejs#54205：`Readable.toWeb` 会重复关闭 controller
 * 并在背压下丢数据，进而触发 Chromium 媒体解复用的读取错误。
 */
export function nodeStreamToWeb(stream: fs.ReadStream): ReadableStream<Uint8Array> {
  stream.pause();
  let closed = false;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stream.on('data', (chunk: Buffer | string) => {
          if (closed) return;
          controller.enqueue(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
          );
          if ((controller.desiredSize ?? 0) <= 0) stream.pause();
        });
        stream.on('error', (error) => {
          if (!closed) controller.error(error);
        });
        stream.on('end', () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
      },
      pull() {
        if (!closed) stream.resume();
      },
      cancel() {
        if (!closed) {
          closed = true;
          stream.close();
        }
      },
    },
    { highWaterMark: (stream as unknown as { readableHighWaterMark: number }).readableHighWaterMark }
  );
}

export interface CdfFileRequest {
  url: string;
  rangeHeader?: string | null;
  /**
   * 允许被读取的根目录白名单（已注册项目根 + 应用数据目录）。协议对渲染进程开放
   * 且 bypassCSP，若不校验，任何渲染层注入都能 `fetch('cdf-file:///~/.ssh/id_rsa')`
   * 读全盘。解析后的绝对路径必须落在其中之一，否则返回 403。
   */
  allowedRoots: string[];
}

interface CanonicalPath {
  path: string;
  exists: boolean;
}

/**
 * 把路径解析成文件系统认可的真实路径。目标不存在时，从最近的已有父目录继续解析，
 * 这样既能让允许根内的缺失文件返回 404，也不会把 `..` 或父目录软链接误判为允许路径。
 */
async function resolveCanonicalPath(filePath: string): Promise<CanonicalPath | null> {
  let current = path.resolve(filePath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const canonicalParent = await fs.promises.realpath(current);
      return {
        path: path.join(canonicalParent, ...missingSegments),
        exists: missingSegments.length === 0,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;

      const parent = path.dirname(current);
      if (parent === current) return null;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * `realpath` 已经按当前卷和目录的真实大小写返回路径，因此这里只做逐段精确比较。
 * Windows 盘符本身不区分大小写，但启用 per-directory case sensitivity 的目录段必须区分。
 */
function isCanonicalPathWithinRoot(target: string, root: string): boolean {
  const normalizedTarget = path.resolve(target);
  const normalizedRoot = path.resolve(root);
  const targetRoot = path.parse(normalizedTarget).root;
  const allowedRoot = path.parse(normalizedRoot).root;
  const sameVolume =
    process.platform === 'win32'
      ? targetRoot.toLowerCase() === allowedRoot.toLowerCase()
      : targetRoot === allowedRoot;
  if (!sameVolume) return false;

  const targetSegments = normalizedTarget.slice(targetRoot.length).split(path.sep).filter(Boolean);
  const rootSegments = normalizedRoot.slice(allowedRoot.length).split(path.sep).filter(Boolean);
  return (
    rootSegments.length <= targetSegments.length
    && rootSegments.every((segment, index) => segment === targetSegments[index])
  );
}

/**
 * 根据请求构造响应：命中 Range 返回 206（含 Content-Range），否则整体 200；
 * 两者都带 Accept-Ranges/Content-Length 以启用寻址。文件不存在返回 404，范围越界返回 416，
 * 越出白名单根返回 403。
 */
export async function createCdfFileResponse(request: CdfFileRequest): Promise<Response> {
  const filePath = resolveCdfFilePath(request.url);
  const canonicalTarget = await resolveCanonicalPath(filePath);
  if (!canonicalTarget) {
    return new Response('File not found', { status: 404 });
  }

  const canonicalRoots = (
    await Promise.all(
      request.allowedRoots
        .filter(Boolean)
        .map(async (root) => (await resolveCanonicalPath(root))?.path ?? null)
    )
  ).filter((root): root is string => root !== null);
  if (!canonicalRoots.some((root) => isCanonicalPathWithinRoot(canonicalTarget.path, root))) {
    return new Response('Forbidden', { status: 403 });
  }
  if (!canonicalTarget.exists) {
    return new Response('File not found', { status: 404 });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(canonicalTarget.path);
  } catch {
    return new Response('File not found', { status: 404 });
  }
  if (!stat.isFile()) {
    return new Response('File not found', { status: 404 });
  }

  const contentType = contentTypeForPath(filePath);
  const range = parseRangeHeader(request.rangeHeader, stat.size);

  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${stat.size}` },
    });
  }

  if (range) {
    const stream = fs.createReadStream(canonicalTarget.path, { start: range.start, end: range.end });
    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      },
    });
  }

  const stream = fs.createReadStream(canonicalTarget.path);
  return new Response(nodeStreamToWeb(stream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size),
    },
  });
}
