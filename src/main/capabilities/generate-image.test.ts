import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerateImageTool,
  generateImage,
  resolveTokenPlanImageRoute,
  writeImageArtifact,
} from './generate-image';

const { getEntriesMock, getSecretMock } = vi.hoisted(() => ({
  getEntriesMock: vi.fn(),
  getSecretMock: vi.fn(),
}));

vi.mock('../ai-subscription-store', () => ({
  getAISubscriptionEntries: getEntriesMock,
}));

vi.mock('../ai-subscription-credentials', () => ({
  getSubscriptionSecret: getSecretMock,
}));

describe('generateImage', () => {
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
    getSecretMock.mockReturnValue(undefined);
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
  });
});
