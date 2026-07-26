import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  contentTypeForPath,
  createCdfFileResponse,
  isPathWithinRoots,
  parseRangeHeader,
  resolveCdfFilePath,
} from './cdf-file-protocol';

// Build a cdf-file URL the way the renderer does: cdf-file:// + absolute path.
function cdfUrl(absPath: string): string {
  return pathToFileURL(absPath).toString().replace(/^file:\/\//, 'cdf-file://');
}

describe('resolveCdfFilePath', () => {
  it('restores an absolute path from the three-slash form (host empty)', () => {
    expect(resolveCdfFilePath('cdf-file:///private/tmp/x/a.mp4')).toBe('/private/tmp/x/a.mp4');
  });

  it('restores an absolute path when the standard scheme folds the first segment into host', () => {
    // Electron normalizes cdf-file:///private/... to host=private under standard:true.
    expect(resolveCdfFilePath('cdf-file://private/tmp/x/a.mp4')).toBe('/private/tmp/x/a.mp4');
  });

  it('decodes percent-encoded path segments (spaces, unicode)', () => {
    expect(resolveCdfFilePath('cdf-file:///Users/s/My%20Video.mp4')).toBe('/Users/s/My Video.mp4');
  });

  it('removes only the URL slash before a Windows drive path', () => {
    expect(resolveCdfFilePath('cdf-file:///C:/Users/s/My%20Video.mp4')).toBe('C:/Users/s/My Video.mp4');
  });
});

describe('isPathWithinRoots', () => {
  // Regression (#204 回归): under standard:true Chromium folds the first path
  // segment into the URL host and lowercases it, so every macOS request arrives
  // as /users/... while allowedRoots hold /Users/.... On a case-insensitive
  // filesystem both address the same file, so containment must not be
  // case-sensitive — otherwise every historical image/audio 403s.
  it('accepts a host-casefolded path on a case-insensitive filesystem', () => {
    expect(isPathWithinRoots(
      '/users/suntc/Library/Application Support/cdf/default-project/.cdf/artifacts/images/a.png',
      ['/Users/suntc/Library/Application Support/cdf'],
      true,
    )).toBe(true);
  });

  it('still rejects casing differences in case-sensitive mode', () => {
    expect(isPathWithinRoots(
      '/users/suntc/Library/Application Support/cdf/a.png',
      ['/Users/suntc/Library/Application Support/cdf'],
      false,
    )).toBe(false);
  });

  it('still rejects escapes and unrelated roots regardless of casing mode', () => {
    expect(isPathWithinRoots('/Users/suntc/other/a.png', ['/Users/suntc/Library'], true)).toBe(false);
    expect(isPathWithinRoots('/Users/suntc/Library/../.ssh/id_rsa', ['/Users/suntc/Library'], true)).toBe(false);
    expect(isPathWithinRoots('/Users/suntc/LibraryEvil/a.png', ['/Users/suntc/Library'], true)).toBe(false);
  });

  it('defaults to case-insensitive containment on macOS/Windows', () => {
    const expected = process.platform === 'darwin' || process.platform === 'win32';
    expect(isPathWithinRoots('/users/x/a.png', ['/Users/x'])).toBe(expected);
  });
});

describe('parseRangeHeader', () => {
  it('returns null when there is no Range header', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader(undefined, 1000)).toBeNull();
  });

  it('parses the open-ended bytes=0- Chromium opens media with as a full 206 range', () => {
    // Chromium's first media request is "bytes=0-"; answering it as 206 with
    // Content-Range/Accept-Ranges is what advertises seekability to the pipeline.
    expect(parseRangeHeader('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('parses a bounded range inclusively', () => {
    expect(parseRangeHeader('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
  });

  it('parses an open upper bound to the last byte', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range from the end of the file', () => {
    expect(parseRangeHeader('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });

  it('clamps an over-long end to the last byte', () => {
    expect(parseRangeHeader('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('flags a start beyond EOF as invalid (416)', () => {
    expect(parseRangeHeader('bytes=1000-1100', 1000)).toBe('invalid');
  });
});

describe('contentTypeForPath', () => {
  it('maps common media extensions', () => {
    expect(contentTypeForPath('/a/b.mp4')).toBe('video/mp4');
    expect(contentTypeForPath('/a/b.MP3')).toBe('audio/mpeg');
    expect(contentTypeForPath('/a/b.wav')).toBe('audio/wav');
    expect(contentTypeForPath('/a/b.png')).toBe('image/png');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeForPath('/a/b.xyz')).toBe('application/octet-stream');
  });
});

describe('createCdfFileResponse', () => {
  let tempDir: string;
  let mediaPath: string;
  const CONTENT = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'); // 36 bytes

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-media-'));
    mediaPath = path.join(tempDir, 'clip.mp4');
    fs.writeFileSync(mediaPath, CONTENT);
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('serves the whole file as 200 with Accept-Ranges and a correct Content-Length', async () => {
    const res = await createCdfFileResponse({ url: cdfUrl(mediaPath), rangeHeader: null, allowedRoots: [tempDir] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe(String(CONTENT.length));

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(CONTENT)).toBe(true);
  });

  it('serves a bounded Range as 206 with an inclusive Content-Range and matching bytes', async () => {
    const res = await createCdfFileResponse({ url: cdfUrl(mediaPath), rangeHeader: 'bytes=10-19', allowedRoots: [tempDir] });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 10-19/${CONTENT.length}`);
    expect(res.headers.get('Content-Length')).toBe('10');

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(10);
    expect(body.equals(CONTENT.subarray(10, 20))).toBe(true);
  });

  it('serves a suffix Range (the tail Chromium reads for moov-at-end mp4s)', async () => {
    const res = await createCdfFileResponse({ url: cdfUrl(mediaPath), rangeHeader: 'bytes=-6', allowedRoots: [tempDir] });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 30-35/${CONTENT.length}`);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(CONTENT.subarray(30, 36))).toBe(true);
  });

  it('returns 416 for a range past the end of the file', async () => {
    const res = await createCdfFileResponse({
      url: cdfUrl(mediaPath),
      rangeHeader: `bytes=${CONTENT.length}-${CONTENT.length + 10}`,
      allowedRoots: [tempDir],
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${CONTENT.length}`);
  });

  it('returns 404 for a missing file', async () => {
    const res = await createCdfFileResponse({
      url: cdfUrl(path.join(tempDir, 'missing.mp4')),
      rangeHeader: null,
      allowedRoots: [tempDir],
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a directory', async () => {
    const res = await createCdfFileResponse({ url: cdfUrl(tempDir), rangeHeader: null, allowedRoots: [tempDir] });
    expect(res.status).toBe(404);
  });

  it('returns 403 for a file outside the allowed roots', async () => {
    const res = await createCdfFileResponse({ url: cdfUrl(mediaPath), rangeHeader: null, allowedRoots: ['/some/other/root'] });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a traversal escape out of an allowed root', async () => {
    const escape = path.join(tempDir, '..', '..', 'etc', 'passwd');
    const res = await createCdfFileResponse({ url: cdfUrl(escape), rangeHeader: null, allowedRoots: [tempDir] });
    expect(res.status).toBe(403);
  });

  // Regression (#204 回归): simulate Chromium's host casefolding — the URL path
  // casing differs from the allowedRoots casing, but the case-insensitive macOS
  // filesystem still resolves the same file. Must serve 200, not 403.
  it.runIf(process.platform === 'darwin')(
    'serves a file whose URL casing differs from the allowed root casing (Chromium host folding)',
    async () => {
      const casedDir = path.join(tempDir, 'MediaRoot');
      fs.mkdirSync(casedDir);
      const casedPath = path.join(casedDir, 'clip.mp4');
      fs.writeFileSync(casedPath, CONTENT);

      const foldedUrl = cdfUrl(casedPath).replace('MediaRoot', 'mediaroot');
      const res = await createCdfFileResponse({ url: foldedUrl, rangeHeader: null, allowedRoots: [casedDir] });

      expect(res.status).toBe(200);
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.equals(CONTENT)).toBe(true);
    },
  );
});
