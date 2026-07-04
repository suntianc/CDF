import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ModelDownloadProgress {
  url: string;
  loaded: number;
  total?: number;
}

export interface ModelDownloadRequest {
  urls: string[];
  destination: string;
  expectedSha256: string;
  fetch?: FetchLike;
  onProgress?: (event: ModelDownloadProgress) => void;
}

export async function downloadFileWithSha256(options: ModelDownloadRequest): Promise<void> {
  if (options.urls.length === 0) {
    throw new Error('Model download requires at least one URL.');
  }
  let lastError: unknown;
  for (const url of options.urls) {
    try {
      await downloadOne(url, options);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadOne(url: string, options: ModelDownloadRequest): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Model download failed from ${url}: HTTP ${response.status}`);
  }

  fs.mkdirSync(path.dirname(options.destination), { recursive: true });
  const tempPath = `${options.destination}.tmp-${process.pid}`;
  const hash = crypto.createHash('sha256');
  const total = parseContentLength(response.headers.get('Content-Length'));
  let loaded = 0;
  try {
    const file = fs.createWriteStream(tempPath);
    try {
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          loaded += chunk.length;
          hash.update(chunk);
          await writeChunk(file, chunk);
          options.onProgress?.({ url, loaded, total });
        }
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        loaded = bytes.length;
        hash.update(bytes);
        await writeChunk(file, bytes);
        options.onProgress?.({ url, loaded, total });
      }
    } finally {
      await closeWriteStream(file);
    }

    const actualSha256 = hash.digest('hex');
    if (actualSha256 !== options.expectedSha256) {
      throw new Error(`Model download hash mismatch from ${url}.`);
    }
    fs.renameSync(tempPath, options.destination);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function writeChunk(file: fs.WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    file.write(chunk, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeWriteStream(file: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      file.off('finish', onFinish);
      reject(error);
    };
    const onFinish = () => {
      file.off('error', onError);
      resolve();
    };
    file.once('error', onError);
    file.once('finish', onFinish);
    file.end();
  });
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
