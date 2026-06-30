import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchTool } from './fetch-tool';

describe('createFetchTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches static HTML over HTTP and converts readable content to markdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => `
        <!doctype html>
        <html>
          <head><title>Example Domain</title></head>
          <body>
            <article>
              <h1>Example Domain</h1>
              <p>This domain is for use in illustrative examples.</p>
            </article>
          </body>
        </html>
      `,
    })));
    const fetchTool = createFetchTool();

    const result = String(await (fetchTool as any).invoke({ url: 'https://example.com' }));

    expect(result).toContain('# Example Domain');
    expect(result).toContain('This domain is for use in illustrative examples.');
  });
});
