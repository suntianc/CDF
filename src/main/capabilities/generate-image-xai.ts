import { XAI_RESPONSES_API_BASE_URL } from '../ai-subscription-runtime';
import {
  buildInputImageUrls,
  buildDisplayMarkdown,
  clampCount,
  providerErrorMessage,
  type GenerateImageArtifact,
  type GenerateImageDeps,
  type GenerateImageInput,
  type GenerateImageOperation,
  type GenerateImageResult,
  type XaiImageRoute,
} from './generate-image-shared';

const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';

/** xAI Grok OAuth → Grok Imagine text-to-image and image editing. */
export async function generateXaiImage(
  prompt: string,
  input: GenerateImageInput,
  operation: GenerateImageOperation,
  route: XaiImageRoute,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  let inputImageUrls: string[] = [];
  if (operation === 'edit') {
    try {
      inputImageUrls = await buildInputImageUrls(input.input_images ?? [], deps);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_INPUT',
      };
    }
  }

  let response: Response;
  try {
    const body: Record<string, unknown> = {
      model: XAI_IMAGE_MODEL,
      prompt,
      response_format: 'url',
      n: clampCount(input.count),
    };
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (operation === 'edit') {
      const imageReferences = inputImageUrls.map((url) => ({ type: 'image_url', url }));
      if (imageReferences.length === 1) body.image = imageReferences[0];
      else body.images = imageReferences;
    }
    const endpoint = operation === 'edit' ? 'edits' : 'generations';
    response = await route.fetch(`${XAI_RESPONSES_API_BASE_URL}/images/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'PROVIDER_REQUEST_ERROR',
    };
  }

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `xAI image_generation failed (${response.status}): ${providerErrorMessage(raw)}`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Invalid xAI image response', code: 'PROVIDER_RESPONSE' };
  }
  const urls = Array.isArray(body.data)
    ? body.data.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const url = (item as Record<string, unknown>).url;
      return typeof url === 'string' && url.trim() ? [url.trim()] : [];
    })
    : [];
  if (urls.length === 0) {
    return { ok: false, error: 'xAI image_generation returned no images', code: 'EMPTY_RESULT' };
  }

  const downloadArtifact = deps.downloadArtifact ?? downloadRemoteArtifact;
  const artifacts: GenerateImageArtifact[] = [];
  try {
    for (const url of urls) {
      const downloaded = await downloadArtifact(url);
      const extension = imageExtension(downloaded.mimeType, url);
      const filePath = await deps.writeArtifact(downloaded.bytes, { extension });
      artifacts.push({ path: filePath, mimeType: downloaded.mimeType });
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'ARTIFACT_DOWNLOAD_ERROR',
    };
  }

  return {
    ok: true,
    model: XAI_IMAGE_MODEL,
    routeId: 'xai-oauth',
    operation,
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

export async function downloadRemoteArtifact(
  url: string
): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated image (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('Downloaded generated image is empty');
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  return { bytes, mimeType };
}

function imageExtension(mimeType: string, url: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (/\.png(?:$|[?#])/i.test(url)) return 'png';
  if (/\.webp(?:$|[?#])/i.test(url)) return 'webp';
  return 'jpg';
}
