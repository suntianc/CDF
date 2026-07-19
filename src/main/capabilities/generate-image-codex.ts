import { CODEX_RESPONSES_API_BASE_URL } from '../ai-subscription-runtime';
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
  type CodexImageRoute,
} from './generate-image-shared';

const CODEX_IMAGE_MAIN_MODEL = 'gpt-5.4-mini';
const CODEX_IMAGE_TOOL_MODEL = 'gpt-image-2';

/** Codex OAuth → Responses image_generation + gpt-image-2 (text-to-image and image editing). */
export async function generateCodexImage(
  prompt: string,
  input: GenerateImageInput,
  route: CodexImageRoute,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  let inputImageUrls: string[] = [];
  if (input.operation === 'edit' || (input.input_images?.length ?? 0) > 0) {
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
  const count = clampCount(input.count);
  const artifacts: GenerateImageArtifact[] = [];

  for (let index = 0; index < count; index += 1) {
    let response: Response;
    try {
      response = await route.fetch(
        `${CODEX_RESPONSES_API_BASE_URL}/responses`,
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildCodexImageRequest(
            prompt,
            input.operation ?? (inputImageUrls.length > 0 ? 'edit' : 'generate'),
            inputImageUrls,
            input.aspect_ratio
          )),
        }
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'PROVIDER_REQUEST_ERROR',
      };
    }

    const parsed = await parseCodexImageResponse(response);
    if (!parsed.ok) return parsed;
    for (const image of parsed.images) {
      const bytes = Buffer.from(stripDataUrlPrefix(image.base64), 'base64');
      const output = normalizeCodexOutputFormat(image.outputFormat);
      const filePath = await deps.writeArtifact(bytes, { extension: output.extension });
      artifacts.push({ path: filePath, mimeType: output.mimeType });
    }
  }

  if (artifacts.length === 0) {
    return {
      ok: false,
      error: 'Codex image_generation returned no images',
      code: 'EMPTY_RESULT',
    };
  }

  return {
    ok: true,
    model: CODEX_IMAGE_TOOL_MODEL,
    routeId: 'codex-oauth',
    operation: input.operation ?? (inputImageUrls.length > 0 ? 'edit' : 'generate'),
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

function buildCodexImageRequest(
  prompt: string,
  operation: GenerateImageOperation,
  inputImageUrls: string[],
  aspectRatio?: string
): Record<string, unknown> {
  const imageTool: Record<string, unknown> = {
    type: 'image_generation',
    action: operation,
    model: CODEX_IMAGE_TOOL_MODEL,
    output_format: 'png',
  };
  const size = codexSizeForAspectRatio(aspectRatio);
  if (size) imageTool.size = size;

  const content: Array<Record<string, string>> = [{ type: 'input_text', text: prompt }];
  for (const imageUrl of inputImageUrls) {
    content.push({ type: 'input_image', image_url: imageUrl });
  }

  return {
    instructions: 'Create the requested image with the image generation tool.',
    stream: true,
    reasoning: { effort: 'medium', summary: 'auto' },
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    model: CODEX_IMAGE_MAIN_MODEL,
    store: false,
    tool_choice: { type: 'image_generation' },
    input: [
      {
        type: 'message',
        role: 'user',
        content,
      },
    ],
    tools: [imageTool],
  };
}

function codexSizeForAspectRatio(aspectRatio?: string): string | undefined {
  const sizes: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1536x864',
    '4:3': '1536x1152',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '3:4': '1152x1536',
    '9:16': '864x1536',
    '21:9': '1792x768',
  };
  return aspectRatio ? sizes[aspectRatio] : undefined;
}

interface CodexImagePayload {
  base64: string;
  outputFormat?: string;
}

async function parseCodexImageResponse(
  response: Response
): Promise<{ ok: true; images: CodexImagePayload[] } | GenerateImageResult & { ok: false }> {
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `Codex image_generation failed (${response.status}): ${providerErrorMessage(raw)}`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const payloads = parseCodexPayloads(raw);
  const images: CodexImagePayload[] = [];
  const seen = new Set<string>();
  let providerError: string | undefined;
  let imageGenerationFailed = false;
  let providerMessage: string | undefined;

  const collectOutput = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const output = item as Record<string, unknown>;
      if (output.type === 'message' && Array.isArray(output.content)) {
        for (const content of output.content) {
          if (!content || typeof content !== 'object') continue;
          const part = content as Record<string, unknown>;
          const message = part.type === 'output_text' && typeof part.text === 'string'
            ? part.text
            : part.type === 'refusal' && typeof part.refusal === 'string'
              ? part.refusal
              : undefined;
          if (message?.trim() && !providerMessage) providerMessage = message.trim().slice(0, 500);
        }
        continue;
      }
      if (output.type !== 'image_generation_call') continue;
      if (output.status === 'failed') imageGenerationFailed = true;
      if (typeof output.result !== 'string') continue;
      const base64 = output.result.trim();
      if (!base64 || seen.has(base64)) continue;
      seen.add(base64);
      images.push({
        base64,
        outputFormat: typeof output.output_format === 'string' ? output.output_format : undefined,
      });
    }
  };

  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const event = payload as Record<string, unknown>;
    if (event.type === 'response.output_item.done') collectOutput([event.item]);
    if (event.type === 'response.completed') {
      const completed = event.response as Record<string, unknown> | undefined;
      collectOutput(completed?.output);
    }
    collectOutput(event.output);
    if (event.type === 'response.failed' || event.type === 'error') {
      providerError = providerErrorMessage(JSON.stringify(event));
    }
  }

  if (images.length > 0) return { ok: true, images };
  if (imageGenerationFailed && !providerError) {
    providerError = providerMessage
      ? `Codex image_generation failed: ${providerMessage}`
      : 'Codex image_generation failed';
  }
  return {
    ok: false,
    error: providerError || 'Codex image_generation returned no images',
    code: providerError ? 'PROVIDER_RESPONSE' : 'EMPTY_RESULT',
  };
}

function parseCodexPayloads(raw: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore malformed keepalive/event lines and continue to the terminal payload.
    }
  }
  if (payloads.length > 0) return payloads;
  try {
    return [JSON.parse(raw)];
  } catch {
    return [];
  }
}

function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

function normalizeCodexOutputFormat(value?: string): { extension: string; mimeType: string } {
  switch (value?.trim().toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    case 'webp':
      return { extension: 'webp', mimeType: 'image/webp' };
    default:
      return { extension: 'png', mimeType: 'image/png' };
  }
}
