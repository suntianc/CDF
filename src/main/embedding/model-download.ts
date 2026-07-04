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

  const bytes = Buffer.from(await response.arrayBuffer());
  options.onProgress?.({
    url,
    loaded: bytes.length,
    total: parseContentLength(response.headers.get('Content-Length')),
  });

  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== options.expectedSha256) {
    throw new Error(`Model download hash mismatch from ${url}.`);
  }

  fs.mkdirSync(path.dirname(options.destination), { recursive: true });
  const tempPath = `${options.destination}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, bytes);
    fs.renameSync(tempPath, options.destination);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
