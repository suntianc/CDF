import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';

const MAX_FIRST_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_FIRST_FRAME_DIMENSION = 65_535;

export interface VideoInputImageReference {
  role: 'first-frame';
  source: string;
}

export interface VideoInputSnapshot {
  role: 'first-frame';
  path: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  aspectRatio: string;
  sha256: string;
}

export interface VideoInputSnapshotDeps {
  loadInputSource?: (
    source: string,
    projectPath: string
  ) => Promise<{ bytes: Buffer; mimeType?: string }>;
  fetchInput?: typeof fetch;
  decodeInputImage?: (bytes: Buffer) => Promise<{ width: number; height: number }>;
}

export async function decodeVideoInputImage(
  bytes: Buffer
): Promise<{ width: number; height: number }> {
  const image = await loadImage(bytes);
  return { width: image.width, height: image.height };
}

export async function freezeVideoInputSnapshot(
  jobId: string,
  projectPath: string,
  source: string,
  deps: VideoInputSnapshotDeps,
): Promise<VideoInputSnapshot> {
  const loaded = await loadFirstFrameSource(source, projectPath, deps);
  const metadata = await inspectFirstFrameImage(loaded.bytes, deps.decodeInputImage);
  const dir = videoInputSnapshotDir(projectPath, jobId);
  await fs.mkdir(dir, { recursive: true });
  const extension = metadata.mimeType === 'image/png'
    ? 'png'
    : metadata.mimeType === 'image/webp'
      ? 'webp'
      : 'jpg';
  const target = path.join(dir, `first-frame.${extension}`);
  const temporary = `${target}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(temporary, loaded.bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    role: 'first-frame',
    path: target,
    ...metadata,
    sizeBytes: loaded.bytes.length,
    sha256: crypto.createHash('sha256').update(loaded.bytes).digest('hex'),
  };
}

export function videoInputSnapshotDir(projectPath: string, jobId: string): string {
  return path.join(projectPath, '.cdf', 'capability-jobs', jobId, 'inputs');
}

async function loadFirstFrameSource(
  source: string,
  projectPath: string,
  deps: VideoInputSnapshotDeps,
): Promise<{ bytes: Buffer; mimeType?: string }> {
  if (deps.loadInputSource) return deps.loadInputSource(source, projectPath);
  let parsed: URL | null = null;
  if (!path.isAbsolute(source)) {
    try { parsed = new URL(source); } catch { parsed = null; }
  }
  if (parsed) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('First-frame URL must use http or https');
    }
    if (isObviouslyPrivateHostname(parsed.hostname)) {
      throw new Error('First-frame URL must resolve to a public network address');
    }
    const response = await (deps.fetchInput ?? fetch)(parsed);
    if (!response.ok) throw new Error(`Failed to download first-frame image (${response.status})`);
    return {
      bytes: await readResponseBodyWithLimit(response, MAX_FIRST_FRAME_BYTES),
      mimeType: response.headers.get('content-type')?.split(';')[0]?.trim(),
    };
  }
  const filePath = path.isAbsolute(source) ? source : path.resolve(projectPath, source);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('First-frame local source must be a file');
  if (stat.size > MAX_FIRST_FRAME_BYTES) throw new Error('First-frame image must not exceed 20 MiB');
  return { bytes: await fs.readFile(filePath) };
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('First-frame image must not exceed 20 MiB');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('First-frame image must not exceed 20 MiB');
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

async function inspectFirstFrameImage(
  bytes: Buffer,
  decode?: (bytes: Buffer) => Promise<{ width: number; height: number }>
): Promise<{
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  aspectRatio: string;
}> {
  if (bytes.length === 0) throw new Error('First-frame image is empty');
  if (bytes.length > MAX_FIRST_FRAME_BYTES) {
    throw new Error('First-frame image must not exceed 20 MiB');
  }
  const parsed = pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
  if (!parsed) throw new Error('First-frame image must be a valid JPG, JPEG, PNG, or WebP');
  let dimensions = parsed;
  if (decode) {
    try {
      dimensions = { ...parsed, ...await decode(bytes) };
    } catch {
      throw new Error('First-frame image must be a valid JPG, JPEG, PNG, or WebP');
    }
  }
  const { mimeType, width, height } = dimensions;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > MAX_FIRST_FRAME_DIMENSION
    || height > MAX_FIRST_FRAME_DIMENSION
  ) {
    throw new Error(`First-frame dimensions must be between 1 and ${MAX_FIRST_FRAME_DIMENSION} pixels`);
  }
  return { mimeType, width, height, aspectRatio: reduceAspectRatio(width, height) };
}

function isObviouslyPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true;
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function pngDimensions(bytes: Buffer) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return {
    mimeType: 'image/png' as const,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3
      || marker === 0xc5 || marker === 0xc6 || marker === 0xc7
      || marker === 0xc9 || marker === 0xca || marker === 0xcb
      || marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      if (length < 7) return null;
      return {
        mimeType: 'image/jpeg' as const,
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer) {
  if (
    bytes.length < 30
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      mimeType: 'image/webp' as const,
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      mimeType: 'image/webp' as const,
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (
    chunk === 'VP8 '
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return {
      mimeType: 'image/webp' as const,
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function reduceAspectRatio(width: number, height: number): string {
  let a = width;
  let b = height;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return `${width / a}:${height / a}`;
}
