import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFileWithSha256 } from './model-download';

describe('Model Download Manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-model-download-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('falls back to a mirror, reports progress, and verifies sha256', async () => {
    const bytes = Buffer.from('model-bytes');
    const expectedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const urls: string[] = [];
    const progress: Array<{ url: string; loaded: number; total?: number }> = [];

    await downloadFileWithSha256({
      urls: ['https://huggingface.co/model.onnx', 'https://hf-mirror.com/model.onnx'],
      destination: path.join(tempDir, 'model.onnx'),
      expectedSha256,
      onProgress: (event) => progress.push(event),
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).includes('huggingface.co')) {
          return new Response('unavailable', { status: 503 });
        }
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Length': String(bytes.length) },
        });
      },
    });

    expect(urls).toEqual(['https://huggingface.co/model.onnx', 'https://hf-mirror.com/model.onnx']);
    expect(fs.readFileSync(path.join(tempDir, 'model.onnx'))).toEqual(bytes);
    expect(progress).toEqual([
      { url: 'https://hf-mirror.com/model.onnx', loaded: bytes.length, total: bytes.length },
    ]);
  });

  it('streams downloads to disk while reporting incremental progress', async () => {
    const chunks = [Buffer.from('model-'), Buffer.from('bytes')];
    const bytes = Buffer.concat(chunks);
    const expectedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const progress: Array<{ loaded: number; total?: number }> = [];

    await downloadFileWithSha256({
      urls: ['https://huggingface.co/model.onnx'],
      destination: path.join(tempDir, 'model.onnx'),
      expectedSha256,
      onProgress: ({ loaded, total }) => progress.push({ loaded, total }),
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'Content-Length': String(bytes.length) },
      }),
    });

    expect(fs.readFileSync(path.join(tempDir, 'model.onnx'))).toEqual(bytes);
    expect(progress).toEqual([
      { loaded: chunks[0].length, total: bytes.length },
      { loaded: bytes.length, total: bytes.length },
    ]);
  });
});
