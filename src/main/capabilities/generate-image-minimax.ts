import { MINIMAX_TOKEN_PLAN_IMAGE_MODELS } from '../../shared/ai-subscriptions';
import {
  buildDisplayMarkdown,
  clampCount,
  readLocalImageAsDataUrl,
  type GenerateImageArtifact,
  type GenerateImageDeps,
  type GenerateImageInput,
  type GenerateImageInputRef,
  type GenerateImageOperation,
  type GenerateImageResult,
  type TokenPlanImageRoute,
} from './generate-image-shared';

const IMAGE_GENERATION_URL = 'https://api.minimaxi.com/v1/image_generation';
const DEFAULT_MODEL = MINIMAX_TOKEN_PLAN_IMAGE_MODELS[0];

/** MiniMax Token Plan → image-01 (text-to-image and subject-reference image-to-image). */
export async function generateMinimaxImage(
  prompt: string,
  input: GenerateImageInput,
  operation: GenerateImageOperation,
  route: TokenPlanImageRoute,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  const inputImages = Array.isArray(input.input_images) ? input.input_images : [];

  let subjectReference: Array<{ type: 'character'; image_file: string }> | undefined;
  if (operation === 'edit') {
    try {
      subjectReference = await buildSubjectReferences(inputImages, deps);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_INPUT',
      };
    }
  }

  const count = clampCount(input.count);
  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    prompt,
    response_format: 'base64',
    n: count,
  };
  if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
  if (typeof input.seed === 'number') body.seed = input.seed;
  if (subjectReference?.length) body.subject_reference = subjectReference;

  const response = await deps.httpPostJson(
    IMAGE_GENERATION_URL,
    {
      Authorization: `Bearer ${route.accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body
  );

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `MiniMax image_generation failed (${response.status})`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const parsed = parseImageResponse(response.body);
  if (!parsed.ok) return parsed;

  const artifacts: GenerateImageArtifact[] = [];
  for (const base64 of parsed.imagesBase64) {
    const bytes = Buffer.from(base64, 'base64');
    const filePath = await deps.writeArtifact(bytes, { extension: 'png' });
    artifacts.push({ path: filePath, mimeType: 'image/png' });
  }

  if (artifacts.length === 0) {
    return {
      ok: false,
      error: 'MiniMax image_generation returned no images',
      code: 'EMPTY_RESULT',
    };
  }

  return {
    ok: true,
    model: DEFAULT_MODEL,
    routeId: 'minimax-token-plan',
    operation,
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

async function buildSubjectReferences(
  inputImages: GenerateImageInputRef[],
  deps: GenerateImageDeps
): Promise<Array<{ type: 'character'; image_file: string }>> {
  const refs: Array<{ type: 'character'; image_file: string }> = [];
  for (const image of inputImages) {
    if (image.kind === 'url') {
      const url = image.url?.trim();
      if (!url) throw new Error('input_images url is empty');
      refs.push({ type: 'character', image_file: url });
      continue;
    }
    const filePath = image.path?.trim();
    if (!filePath) throw new Error('input_images local_file path is empty');
    const reader = deps.readLocalImageAsDataUrl ?? readLocalImageAsDataUrl;
    const dataUrl = await reader(filePath);
    refs.push({ type: 'character', image_file: dataUrl });
  }
  return refs;
}

function parseImageResponse(
  body: unknown
): { ok: true; imagesBase64: string[] } | GenerateImageResult & { ok: false } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid MiniMax image response', code: 'PROVIDER_RESPONSE' };
  }
  const root = body as Record<string, unknown>;
  const baseResp = root.base_resp as Record<string, unknown> | undefined;
  if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
    const msg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'provider error';
    return {
      ok: false,
      error: `MiniMax image_generation error: ${msg}`,
      code: `PROVIDER_${baseResp.status_code}`,
    };
  }

  const data = root.data as Record<string, unknown> | undefined;
  const imagesBase64 = Array.isArray(data?.image_base64)
    ? data.image_base64.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];

  return { ok: true, imagesBase64 };
}
