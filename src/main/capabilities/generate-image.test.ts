import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerateImageTool,
  generateImage,
  resolveCodexImageRoute,
  resolveTokenPlanImageRoute,
  writeImageArtifact,
} from './generate-image';

const {
  createOAuthAuthenticatedFetchMock,
  getEntriesMock,
  getOAuthCredentialMock,
  getSecretMock,
  oauthFetchMock,
} = vi.hoisted(() => ({
  createOAuthAuthenticatedFetchMock: vi.fn(),
  getEntriesMock: vi.fn(),
  getOAuthCredentialMock: vi.fn(),
  getSecretMock: vi.fn(),
  oauthFetchMock: vi.fn(),
}));

vi.mock('../ai-subscription-store', () => ({
  getAISubscriptionEntries: getEntriesMock,
}));

vi.mock('../ai-subscription-credentials', () => ({
  getOAuthCredential: getOAuthCredentialMock,
  getSubscriptionSecret: getSecretMock,
}));

vi.mock('../ai-subscription-runtime', () => ({
  CODEX_RESPONSES_API_BASE_URL: 'https://chatgpt.com/backend-api/codex',
  XAI_RESPONSES_API_BASE_URL: 'https://api.x.ai/v1',
  createOAuthAuthenticatedFetch: createOAuthAuthenticatedFetchMock,
}));

describe('generateImage', () => {
  it('generates a Codex OAuth image through the Responses image_generation tool', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/codex-1.png');
    const codexFetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"aGVsbG8=","output_format":"png","revised_prompt":"a neon cat"}]}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateImage(
      { prompt: 'a neon cat', route_hint: 'codex-oauth' },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'gpt-image-2',
      routeId: 'codex-oauth',
      operation: 'generate',
      artifacts: [{ path: '/tmp/project/artifacts/codex-1.png', mimeType: 'image/png' }],
      displayMarkdown: '![a neon cat](/tmp/project/artifacts/codex-1.png)',
    });
    expect(codexFetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({ method: 'POST' })
    );
    const request = JSON.parse(String(codexFetch.mock.calls[0]?.[1]?.body));
    expect(request).toEqual(expect.objectContaining({
      model: 'gpt-5.4-mini',
      store: false,
      stream: true,
      tool_choice: { type: 'image_generation' },
      tools: [expect.objectContaining({
        type: 'image_generation',
        action: 'generate',
        model: 'gpt-image-2',
      })],
    }));
    expect(request.input[0].content).toEqual([
      { type: 'input_text', text: 'a neon cat' },
    ]);
    expect(writeArtifact).toHaveBeenCalledWith(
      Buffer.from('hello', 'utf8'),
      { extension: 'png' }
    );
  });

  it('generates a Grok OAuth image and persists the temporary result URL', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/grok-1.jpg');
    const downloadArtifact = vi.fn().mockResolvedValue({
      bytes: Buffer.from('jpeg-bytes'),
      mimeType: 'image/jpeg',
    });
    const xaiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        url: 'https://imgen.x.ai/xai-imgen/temporary.jpeg',
        mime_type: 'image/jpeg',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await generateImage(
      {
        prompt: 'a neon cat',
        route_hint: 'xai-oauth',
        aspect_ratio: '16:9',
      },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => null,
        resolveXaiImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: xaiFetch }),
        httpPostJson: vi.fn(),
        downloadArtifact,
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'grok-imagine-image-quality',
      routeId: 'xai-oauth',
      operation: 'generate',
      artifacts: [{ path: '/tmp/project/artifacts/grok-1.jpg', mimeType: 'image/jpeg' }],
      displayMarkdown: '![a neon cat](/tmp/project/artifacts/grok-1.jpg)',
    });
    expect(xaiFetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/images/generations',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(String(xaiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'a neon cat',
      response_format: 'url',
      n: 1,
      aspect_ratio: '16:9',
    });
    expect(downloadArtifact).toHaveBeenCalledWith('https://imgen.x.ai/xai-imgen/temporary.jpeg');
    expect(writeArtifact).toHaveBeenCalledWith(
      Buffer.from('jpeg-bytes'),
      { extension: 'jpg' }
    );
  });

  it('edits an image through Grok OAuth using the shared generate_image interface', async () => {
    const xaiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://imgen.x.ai/xai-imgen/edited.jpeg', mime_type: 'image/jpeg' }],
    }), { status: 200 }));

    const result = await generateImage(
      {
        prompt: 'add a party hat',
        operation: 'edit',
        route_hint: 'xai-oauth',
        input_images: [{ kind: 'url', url: 'https://cdn.example.com/cat.png' }],
      },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => null,
        resolveXaiImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: xaiFetch }),
        httpPostJson: vi.fn(),
        downloadArtifact: vi.fn().mockResolvedValue({
          bytes: Buffer.from('edited-jpeg'),
          mimeType: 'image/jpeg',
        }),
        writeArtifact: vi.fn().mockResolvedValue('/tmp/project/artifacts/grok-edit.jpg'),
      }
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      model: 'grok-imagine-image-quality',
      routeId: 'xai-oauth',
      operation: 'edit',
      artifacts: [{ path: '/tmp/project/artifacts/grok-edit.jpg', mimeType: 'image/jpeg' }],
    }));
    expect(xaiFetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/images/edits',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(String(xaiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'grok-imagine-image-quality',
      prompt: 'add a party hat',
      response_format: 'url',
      n: 1,
      image: {
        type: 'image_url',
        url: 'https://cdn.example.com/cat.png',
      },
    });
  });

  it('surfaces a Codex image policy refusal instead of reporting an empty result', async () => {
    const writeArtifact = vi.fn();
    const codexFetch = vi.fn().mockResolvedValue(new Response([
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","status":"failed"}}',
      'data: {"type":"response.output_item.done","item":{"type":"message","status":"completed","content":[{"type":"output_text","text":"Sorry, I can’t help create sexualized or intimate imagery."}]}}',
      'data: {"type":"response.completed","response":{"status":"completed","error":null,"output":[]}}',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const result = await generateImage(
      { prompt: 'an intimate portrait', route_hint: 'codex-oauth' },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Codex image_generation failed: Sorry, I can’t help create sexualized or intimate imagery.',
      code: 'PROVIDER_RESPONSE',
    });
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  it('keeps EMPTY_RESULT for a Codex response without an image or failure signal', async () => {
    const codexFetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.completed","response":{"status":"completed","error":null,"output":[]}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateImage(
      { prompt: 'a quiet landscape', route_hint: 'codex-oauth' },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Codex image_generation returned no images',
      code: 'EMPTY_RESULT',
    });
  });

  it('edits an image through Codex OAuth and returns a local artifact', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/codex-edit.png');
    const codexFetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZWRpdGVk","output_format":"png"}]}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateImage(
      {
        prompt: 'replace the background with a quiet library',
        operation: 'edit',
        route_hint: 'codex-oauth',
        input_images: [{ kind: 'url', url: 'https://cdn.example.com/portrait.png' }],
      },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'gpt-image-2',
      routeId: 'codex-oauth',
      operation: 'edit',
      artifacts: [{ path: '/tmp/project/artifacts/codex-edit.png', mimeType: 'image/png' }],
      displayMarkdown: '![replace the background with a quiet library](/tmp/project/artifacts/codex-edit.png)',
    });
    const request = JSON.parse(String(codexFetch.mock.calls[0]?.[1]?.body));
    expect(request.tools).toEqual([
      expect.objectContaining({
        type: 'image_generation',
        action: 'edit',
        model: 'gpt-image-2',
      }),
    ]);
    expect(request.input[0].content).toEqual([
      { type: 'input_text', text: 'replace the background with a quiet library' },
      { type: 'input_image', image_url: 'https://cdn.example.com/portrait.png' },
    ]);
    expect(writeArtifact).toHaveBeenCalledWith(
      Buffer.from('edited', 'utf8'),
      { extension: 'png' }
    );
  });

  it('converts a local image to a data URL before Codex OAuth editing', async () => {
    const readLocalImageAsDataUrl = vi.fn().mockResolvedValue('data:image/png;base64,c291cmNl');
    const codexFetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZWRpdGVk","output_format":"png"}]}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateImage(
      {
        prompt: 'make the sky warmer',
        operation: 'edit',
        route_hint: 'codex-oauth',
        input_images: [{ kind: 'local_file', path: '/tmp/source.png' }],
      },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn().mockResolvedValue('/tmp/edited.png'),
        readLocalImageAsDataUrl,
      }
    );

    expect(result.ok).toBe(true);
    expect(readLocalImageAsDataUrl).toHaveBeenCalledWith('/tmp/source.png');
    const request = JSON.parse(String(codexFetch.mock.calls[0]?.[1]?.body));
    expect(request.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,c291cmNl',
    });
  });

  it('falls back to Codex OAuth in auto mode when MiniMax is unavailable', async () => {
    const codexFetch = vi.fn().mockResolvedValue(new Response(
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"aGVsbG8=","output_format":"png"}]}}\n\n',
      { status: 200 }
    ));
    const result = await generateImage(
      { prompt: 'a cat' },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn().mockResolvedValue('/tmp/codex.png'),
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routeId).toBe('codex-oauth');
  });

  it('does not call Codex when its image generation switch is disabled', async () => {
    const codexFetch = vi.fn();
    const result = await generateImage(
      { prompt: 'a cat', route_hint: 'codex-oauth' },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: false, editEnabled: true, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_DISABLED');
    expect(codexFetch).not.toHaveBeenCalled();
  });

  it('does not call Codex when its image editing switch is disabled', async () => {
    const codexFetch = vi.fn();
    const result = await generateImage(
      {
        prompt: 'make the sky warmer',
        operation: 'edit',
        route_hint: 'codex-oauth',
        input_images: [{ kind: 'url', url: 'https://cdn.example.com/source.png' }],
      },
      {
        resolveTokenPlanImageRoute: () => null,
        resolveCodexImageRoute: () => ({ generateEnabled: true, editEnabled: false, fetch: codexFetch }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Codex OAuth image editing is disabled',
      code: 'CAPABILITY_DISABLED',
    });
    expect(codexFetch).not.toHaveBeenCalled();
  });

  it('creates a local image artifact when MiniMax Token Plan image route is available', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/gen-1.png');
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { image_base64: ['aGVsbG8='] }, // "hello" base64
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    const result = await generateImage(
      { prompt: 'a cat sitting on a windowsill' },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: true,
          editEnabled: true,
        }),
        httpPostJson,
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'image-01',
      routeId: 'minimax-token-plan',
      operation: 'generate',
      artifacts: [{ path: '/tmp/project/artifacts/gen-1.png', mimeType: 'image/png' }],
      displayMarkdown: '![a cat sitting on a windowsill](/tmp/project/artifacts/gen-1.png)',
    });

    expect(httpPostJson).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/image_generation',
      expect.objectContaining({
        Authorization: 'Bearer sk-token-plan',
        'Content-Type': 'application/json',
      }),
      expect.objectContaining({
        model: 'image-01',
        prompt: 'a cat sitting on a windowsill',
        response_format: 'base64',
        n: 1,
      })
    );

    expect(writeArtifact).toHaveBeenCalledWith(
      Buffer.from('hello', 'utf8'),
      expect.objectContaining({ extension: 'png' })
    );
  });

  it('fails recoverably when MiniMax Token Plan is not connected', async () => {
    const result = await generateImage(
      { prompt: 'a cat' },
      {
        resolveTokenPlanImageRoute: () => null,
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROUTE_UNAVAILABLE');
    expect(result.error).toMatch(/not connected/i);
  });

  it('fails when image.generate capability is disabled on the Token Plan route', async () => {
    const httpPostJson = vi.fn();
    const result = await generateImage(
      { prompt: 'a cat' },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: false,
          editEnabled: true,
        }),
        httpPostJson,
        writeArtifact: vi.fn(),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_DISABLED');
    expect(httpPostJson).not.toHaveBeenCalled();
  });

  it('edits from a subject reference URL via MiniMax image-to-image fields', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/edit-1.png');
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { image_base64: ['aGVsbG8='] },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    const result = await generateImage(
      {
        prompt: 'same person looking out a library window',
        input_images: [{ kind: 'url', url: 'https://cdn.example.com/ref.jpg' }],
      },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: true,
          editEnabled: true,
        }),
        httpPostJson,
        writeArtifact,
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.displayMarkdown).toContain('/tmp/project/artifacts/edit-1.png');
    expect(httpPostJson).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/image_generation',
      expect.objectContaining({ Authorization: 'Bearer sk-token-plan' }),
      expect.objectContaining({
        model: 'image-01',
        prompt: 'same person looking out a library window',
        response_format: 'base64',
        subject_reference: [
          {
            type: 'character',
            image_file: 'https://cdn.example.com/ref.jpg',
          },
        ],
      })
    );
  });

  it('loads a local reference image as a data URL for image-to-image', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/edit-2.png');
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { image_base64: ['aGVsbG8='] },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });
    const readLocalImageAsDataUrl = vi.fn().mockResolvedValue('data:image/png;base64,abc123');

    const result = await generateImage(
      {
        prompt: 'portrait in watercolor style',
        operation: 'edit',
        input_images: [{ kind: 'local_file', path: '/tmp/ref.png' }],
      },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: true,
          editEnabled: true,
        }),
        httpPostJson,
        writeArtifact,
        readLocalImageAsDataUrl,
      }
    );

    expect(result.ok).toBe(true);
    expect(readLocalImageAsDataUrl).toHaveBeenCalledWith('/tmp/ref.png');
    expect(httpPostJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        subject_reference: [
          { type: 'character', image_file: 'data:image/png;base64,abc123' },
        ],
      })
    );
  });

  it('fails image-to-image when image.edit is disabled', async () => {
    const httpPostJson = vi.fn();
    const result = await generateImage(
      {
        prompt: 'edit me',
        input_images: [{ kind: 'url', url: 'https://cdn.example.com/ref.jpg' }],
      },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: true,
          editEnabled: false,
        }),
        httpPostJson,
        writeArtifact: vi.fn(),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_DISABLED');
    expect(result.error).toMatch(/edit/i);
    expect(httpPostJson).not.toHaveBeenCalled();
  });

  it('surfaces MiniMax provider status errors without writing artifacts', async () => {
    const writeArtifact = vi.fn();
    const result = await generateImage(
      { prompt: 'a cat' },
      {
        resolveTokenPlanImageRoute: () => ({
          accessToken: 'sk-token-plan',
          generateEnabled: true,
          editEnabled: true,
        }),
        httpPostJson: vi.fn().mockResolvedValue({
          status: 200,
          body: {
            base_resp: { status_code: 1004, status_msg: 'login fail' },
          },
        }),
        writeArtifact,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROVIDER_1004');
    expect(result.error).toMatch(/login fail/i);
    expect(writeArtifact).not.toHaveBeenCalled();
  });
});

describe('resolveTokenPlanImageRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntriesMock.mockReturnValue([]);
    getOAuthCredentialMock.mockReturnValue(undefined);
    getSecretMock.mockReturnValue(undefined);
    createOAuthAuthenticatedFetchMock.mockReturnValue(oauthFetchMock);
  });

  it('returns an enabled route when Token Plan is connected with image.generate on and a vaulted key', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([
      {
        id: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        status: 'connected',
        usageSummaries: [],
        capabilities: [
          {
            capabilityId: 'image.generate',
            label: 'Image generation',
            enabled: true,
            switchDisabled: false,
            availability: 'available',
          },
        ],
      },
    ]);

    expect(resolveTokenPlanImageRoute()).toEqual({
      accessToken: 'sk-sub',
      generateEnabled: true,
      editEnabled: true,
    });
  });

  it('returns null when the subscription is not connected', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([
      {
        id: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        status: 'logged_out',
        usageSummaries: [],
        capabilities: [
          {
            capabilityId: 'image.generate',
            label: 'Image generation',
            enabled: true,
            switchDisabled: true,
            availability: 'declared',
          },
        ],
      },
    ]);

    expect(resolveTokenPlanImageRoute()).toBeNull();
  });

  it('returns generateEnabled:false when image.generate is switched off', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([
      {
        id: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        status: 'connected',
        usageSummaries: [],
        capabilities: [
          {
            capabilityId: 'image.generate',
            label: 'Image generation',
            enabled: false,
            switchDisabled: false,
            availability: 'disabled',
          },
          {
            capabilityId: 'image.edit',
            label: 'Image editing',
            enabled: true,
            switchDisabled: false,
            availability: 'available',
          },
        ],
      },
    ]);

    expect(resolveTokenPlanImageRoute()).toEqual({
      accessToken: 'sk-sub',
      generateEnabled: false,
      editEnabled: true,
    });
  });
});

describe('resolveCodexImageRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntriesMock.mockReturnValue([]);
    getOAuthCredentialMock.mockReturnValue(undefined);
    createOAuthAuthenticatedFetchMock.mockReturnValue(oauthFetchMock);
  });

  it('returns independent generate and edit states for a connected OAuth account', () => {
    getOAuthCredentialMock.mockReturnValue({
      kind: 'oauth',
      accessToken: 'codex-access',
      obtainedAt: 1,
    });
    getEntriesMock.mockReturnValue([
      {
        id: 'codex-oauth',
        displayName: 'Codex OAuth',
        status: 'connected',
        usageSummaries: [],
        capabilities: [
          {
            capabilityId: 'image.generate',
            label: 'Image generation',
            enabled: true,
            switchDisabled: false,
            availability: 'available',
          },
          {
            capabilityId: 'image.edit',
            label: 'Image editing',
            enabled: false,
            switchDisabled: false,
            availability: 'disabled',
          },
        ],
      },
    ]);

    expect(resolveCodexImageRoute()).toEqual({
      generateEnabled: true,
      editEnabled: false,
      fetch: oauthFetchMock,
    });
    expect(createOAuthAuthenticatedFetchMock).toHaveBeenCalledWith('codex-oauth');
  });
});

describe('writeImageArtifact', () => {
  let tempProject: string;

  beforeEach(() => {
    tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-gen-image-'));
  });

  afterEach(() => {
    fs.rmSync(tempProject, { recursive: true, force: true });
  });

  it('writes image bytes under the project .cdf/artifacts/images directory', async () => {
    const filePath = await writeImageArtifact(tempProject, Buffer.from('png-bytes'), {
      extension: 'png',
    });

    expect(filePath.startsWith(path.join(tempProject, '.cdf', 'artifacts', 'images'))).toBe(true);
    expect(path.extname(filePath)).toBe('.png');
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from('png-bytes'));
  });
});

describe('createGenerateImageTool', () => {
  it('exposes a generate_image agent tool with markdown display and edit instructions', () => {
    const imageTool = createGenerateImageTool('/tmp/project');
    expect(imageTool.name).toBe('generate_image');
    expect(imageTool.description).toMatch(/!\[alt\]\(path-or-url\)/);
    expect(imageTool.description).toMatch(/must (include|embed|show|display)/i);
    expect(imageTool.description).toMatch(/input_images|image-to-image|edit/i);
    expect(imageTool.description).toContain(
      'Image generation and editing can use connected MiniMax Token Plan (image-01), Codex OAuth (gpt-image-2), ' +
      'or xAI Grok OAuth (Grok Imagine).'
    );
  });
});
