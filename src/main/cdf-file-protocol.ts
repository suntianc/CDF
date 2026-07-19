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
}

/**
 * 根据请求构造响应：命中 Range 返回 206（含 Content-Range），否则整体 200；
 * 两者都带 Accept-Ranges/Content-Length 以启用寻址。文件不存在返回 404，范围越界返回 416。
 */
export async function createCdfFileResponse(request: CdfFileRequest): Promise<Response> {
  const filePath = resolveCdfFilePath(request.url);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
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
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
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

  const stream = fs.createReadStream(filePath);
  return new Response(nodeStreamToWeb(stream), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size),
    },
  });
}
