# Image Capability Adapter Spike

Date: 2026-07-07

Issue: [#93](https://github.com/suntianc/CDF/issues/93)

Parent: [#27](https://github.com/suntianc/CDF/issues/27)

## Question

CDF needs one Agent-facing image capability that can route to different account and API surfaces: OpenAI API, Codex account/session, Gemini API/account route, xAI/Grok, MiniMax API, MiniMax Token Plan, and future OpenAI-compatible providers.

The core design question is whether CDF should adopt an existing wrapper as the public abstraction, or keep a small internal adapter boundary and use wrappers only inside specific adapters.

## Recommendation

Keep one public Agent Tool named `generate_image`, backed by an internal `ImageCapabilityAdapter` interface.

The first public schema should not be text-to-image only. It should support:

- text-to-image generation,
- natural-language image editing with one or more input images,
- optional mask input for routes that support masks,
- common render controls such as aspect ratio, size, quality, count, seed, background, and output format,
- a provider-neutral `route_hint`.

Do not expose one public tool per provider. Do not make Vercel AI SDK, LangChain, OpenAI Responses, or CLIProxyAPI's OpenAI-compatible endpoint shape the CDF public contract.

Use direct provider APIs or provider SDKs inside adapters where they are simpler. Vercel AI SDK can be useful for some API-key image models, but it should be an implementation detail because CDF still needs route resolution, connected-account boundaries, local artifact normalization, quota/status handling, and future async job handling.

Codex account image generation should be an explicit experimental route, disabled from first default routing until CDF has a product-safe route decision. OpenAI API image generation should be the first OpenAI route.

MiniMax API and MiniMax Token Plan should be separate routes. Implement MiniMax API as a normal direct API adapter. Treat MiniMax Token Plan as a CLI/MCP-backed token-plan adapter with `mmx auth status` and `mmx quota` as availability signals.

## Wrapper Findings

| Route | Evidence | Recommendation |
| --- | --- | --- |
| Vercel AI SDK `generateImage` | Supports image models, text prompt or prompt objects with images/mask, `n`, `size`, `aspectRatio`, `seed`, `providerOptions`, abort/retry, and generated files with base64/bytes/media type. | Useful optional helper inside adapters. Not the public contract because `providerOptions` is unbounded and it does not model CDF route selection, connected accounts, artifacts, or token-plan CLI routes. |
| LangChain OpenAI tools | CDF already depends on LangChain. Current LangChain OpenAI image support binds OpenAI built-in `image_generation` tools to `ChatOpenAI`, with text generation, editing, partial images, and multi-turn editing semantics. | Useful only for an OpenAI Responses-style adapter. Not a cross-provider image abstraction. |
| OpenAI direct API | OpenAI exposes Image API generation/edit endpoints and Responses API image-generation tool flow. Responses adds conversational and multi-turn editing but also mixes mainline model token usage with image costs. | Implement an `openai-api` adapter directly first. Consider a separate Responses-tool adapter only when CDF wants conversational image editing semantics. |
| Codex imagegen | Codex docs describe built-in image generation/editing using `gpt-image-2`, counted against general Codex usage, and recommend `OPENAI_API_KEY` for larger batches. Local CLIProxyAPI proves a Codex image executor can exist. | Keep as `codex` connected-account route, experimental and off by default. Do not assume subscription usage is product-safe for CDF's default image tool. |
| Gemini API | Gemini image docs describe native image generation/editing through Gemini image models with text, images, or both; REST and SDK examples return base64 image data. | Implement a direct `gemini` API adapter. Keep masks route-private unless Google exposes a stable mask input for the selected route. |
| xAI/Grok Imagine | xAI Imagine supports image generation/editing, multi-image editing, and async video flows. Docs show both native xAI SDK and OpenAI-compatible image endpoints. | Implement direct `xai`/`grok` adapter. Preserve async job concepts for later video support. |
| MiniMax API | MiniMax documents text-to-image and image-to-image via `/v1/image_generation`, `response_format` of `url` or `base64`, `n`, `seed`, `aspect_ratio`, and 24-hour URL expiry. | Implement direct `minimax-api` adapter. Prefer base64 where possible; otherwise immediately ingest remote URLs into local artifacts. |
| MiniMax Token Plan CLI/MCP | Official MiniMax CLI provides multimodal commands, auth status, quota, and output files. Official MCP exists but docs recommend CLI for simpler setup. | Separate `minimax-token-plan` adapter. First version can parse CLI output and capture generated files into CDF artifacts. |
| CLIProxyAPI local reference | Implements OpenAI-style `/v1/images/generations` and `/v1/images/edits`, image-only model gating, Codex Responses-tool routing, xAI request translation, multipart and mask handling, streaming partial images, and normalized `b64_json`/data-url output. | Treat as implementation evidence for adapter boundaries and tests, not as CDF product semantics. |

## Provider Capability Shape

This matrix is for adapter planning, not a hard-coded product truth. Final availability still comes from route status, provider docs, and request-time validation.

| Route hint | Generate | Edit with references | Mask | Count | Progress / partials | Async job relevance |
| --- | --- | --- | --- | --- | --- | --- |
| `openai-api` | Yes | Yes | Model/API dependent | Yes | Responses-tool path can stream partials | Low for image, useful for future video |
| `codex` | Yes | Yes | Evidence in CLIProxyAPI | Evidence in CLIProxyAPI | Evidence in Codex/Responses stream path | Low for image |
| `gemini` | Yes | Yes | Not in reviewed docs as a neutral field | Route dependent | Not part of first route contract | Low for image |
| `grok` / `xai` | Yes | Yes, including multi-image edits | Not in reviewed docs as a neutral field | Up to provider limit | Adapter dependent | High for xAI video later |
| `minimax-api` | Yes | Yes, image-to-image | Not in reviewed docs | 1-9 in current API docs | Not part of first route contract | Medium for future video |
| `minimax-token-plan` | Yes through CLI | CLI capability needs command-level verification | Unknown | CLI dependent | CLI dependent | High for video/speech/music |
| `openai-compatible:*` | Only when configured as image-capable | Depends on provider | Depends on provider | Depends on provider | Depends on provider | Depends on provider |

## Public Tool Schema

Keep the schema small and provider-neutral. A route can reject unsupported fields with a precise diagnostic and, when `route_hint` is `auto`, the resolver can choose another available route.

```ts
type GenerateImageOperation = "generate" | "edit";

type GenerateImageRouteHint =
  | "auto"
  | "openai-api"
  | "codex"
  | "gemini"
  | "grok"
  | "xai"
  | "minimax-api"
  | "minimax-token-plan"
  | `openai-compatible:${string}`
  | `route:${string}`;

type GenerateImageInputRef =
  | {
      kind: "artifact";
      artifact_id: string;
      role?: "reference" | "source" | "style" | "mask";
    }
  | {
      kind: "local_file";
      path: string;
      role?: "reference" | "source" | "style" | "mask";
    };

interface GenerateImageToolInput {
  operation?: GenerateImageOperation;
  prompt: string;
  route_hint?: GenerateImageRouteHint;
  input_images?: GenerateImageInputRef[];
  mask?: GenerateImageInputRef;
  aspect_ratio?: string;
  size?: "auto" | `${number}x${number}`;
  quality?: "auto" | "low" | "medium" | "high";
  count?: number;
  seed?: number;
  background?: "auto" | "transparent" | "opaque";
  output_format?: "png" | "jpeg" | "webp";
}
```

Rules:

- `operation` defaults to `edit` when `input_images` or `mask` is present, otherwise `generate`.
- `route_hint` is advisory. `route:${id}` is the escape hatch for multiple accounts/API keys without exposing provider-specific parameters.
- `input_images` should start with CDF artifacts and local files. Internal adapters may convert to bytes, data URLs, provider file IDs, or remote URLs.
- `mask` is accepted in the public schema because OpenAI-style and CPA-proven routes need it, but adapters must reject it when unsupported.
- `aspect_ratio` and `size` are both allowed, but an adapter must define precedence. Prefer `aspect_ratio` for provider APIs that expose it natively.
- Do not include `provider_options`, `negative_prompt`, `style`, model-specific fidelity fields, or provider-specific moderation settings in the first public schema.

## Internal Adapter Boundary

```ts
interface ImageCapabilityRoute {
  id: string;
  provider: "openai" | "codex" | "google" | "xai" | "minimax" | "openai-compatible";
  routeType: "llm_provider" | "connected_account" | "token_plan" | "local_runtime";
  adapterId: string;
  authRef: string;
  model?: string;
  status: "available" | "declared" | "disabled" | "unknown" | "unavailable";
  capabilities: ImageCapabilityFlags;
  priority: number;
}

interface ImageCapabilityFlags {
  generate: boolean;
  edit: boolean;
  masks: boolean;
  multipleInputs: boolean;
  transparentBackground: boolean;
  partialProgress: boolean;
  remoteUrlOutput: boolean;
  asyncJob: boolean;
}

interface NormalizedImageRequest {
  operation: GenerateImageOperation;
  prompt: string;
  inputImages: NormalizedImageRef[];
  mask?: NormalizedImageRef;
  render: {
    aspectRatio?: string;
    size?: "auto" | `${number}x${number}`;
    quality?: "auto" | "low" | "medium" | "high";
    count: number;
    seed?: number;
    background?: "auto" | "transparent" | "opaque";
    outputFormat?: "png" | "jpeg" | "webp";
  };
  source: {
    conversationId: string;
    messageId: string;
    toolCallId: string;
  };
}

interface ImageCapabilityAdapter {
  id: string;
  validate(route: ImageCapabilityRoute, request: NormalizedImageRequest): ImageValidationResult;
  invoke(
    context: ImageCapabilityContext,
    route: ImageCapabilityRoute,
    request: NormalizedImageRequest
  ): AsyncIterable<ImageCapabilityEvent>;
}
```

Expected first adapters:

- `OpenAIImageApiAdapter`
- `OpenAIResponsesImageToolAdapter` only if needed after direct OpenAI API
- `GeminiImageAdapter`
- `XAIImagineAdapter`
- `MiniMaxImageApiAdapter`
- `MiniMaxCliTokenPlanAdapter`
- `OpenAICompatibleImageAdapter`
- `CodexImagegenAdapter` as experimental

## Output Normalization Contract

Every final output must become a CDF local artifact.

```ts
interface ImageArtifactRecord {
  id: string;
  kind: "image";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  localPath: string;
  width?: number;
  height?: number;
  source: {
    capability: "image.generate" | "image.edit";
    routeId: string;
    routeHint?: string;
    adapterId: string;
    provider: string;
    model?: string;
    providerRequestId?: string;
  };
  prompt: {
    original: string;
    revised?: string;
  };
  generation: {
    seed?: number;
    quality?: string;
    size?: string;
    aspectRatio?: string;
    outputFormat?: string;
    background?: string;
  };
  providerMetadata?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  moderation?: Record<string, unknown>;
  warnings?: string[];
}
```

Normalization rules:

- Base64 and data URLs are decoded to files immediately.
- Remote URLs are downloaded immediately when network access and provider terms allow it. If a provider URL expires, record the expiry and still store the local copy as the durable artifact.
- Provider file IDs can be stored as provenance, but they are not a durable CDF result by themselves.
- Streaming partial images are preview events. Persist final images by default. Persist partials only behind a debug/development flag unless a workflow explicitly asks for them.
- Store provider metadata, usage, moderation, revised prompt, and request IDs where available, but do not expose provider-specific metadata as required public fields.

## Route Hint Mapping

| Hint | Resolver behavior |
| --- | --- |
| `auto` or missing | Choose an available route that supports the requested operation and fields. Respect disabled routes, user default route, quota/status, and route confidence. |
| `openai-api` | Use OpenAI API credentials and the direct Image API adapter first. Use Responses-tool adapter only when explicitly selected by route config. |
| `codex` | Use Codex connected-account route only when enabled. Reject with a clear diagnostic if unavailable or disabled. |
| `gemini` | Use Gemini API or a future Google connected-account route with image capability. |
| `grok` / `xai` | Use xAI/Grok Imagine adapter. Prefer API-key route unless a connected-account route is explicitly configured and available. |
| `minimax-api` | Use MiniMax API key route. |
| `minimax-token-plan` | Use MiniMax CLI/token-plan route after `mmx auth status` and quota checks pass. |
| `openai-compatible:${id}` | Use configured OpenAI-compatible provider only if the selected model/route declares image capability. |
| `route:${id}` | Use the exact CDF route when it is available and supports the request. This is how multiple accounts or multiple API keys are selected without changing the tool schema. |

## Test Strategy

Use mocked provider calls only. Do not require real API keys in unit tests.

Test groups:

- public schema validation and defaulting,
- route hint parsing and `route:${id}` resolution,
- route resolver behavior for multiple accounts, disabled routes, unavailable quota, and unsupported fields,
- adapter request translation fixtures for OpenAI, Gemini, xAI, MiniMax API, MiniMax CLI, and OpenAI-compatible routes,
- output normalization from base64, data URL, remote URL, and provider file ID,
- partial-image event handling and final artifact persistence,
- provider diagnostics for unsupported masks, unsupported counts, conflicting `size`/`aspect_ratio`, expired sessions, and quota failures,
- regression fixtures inspired by CLIProxyAPI: image-only model gating, multipart edit inputs, masks, xAI request translation, and streaming partial/final image events.

## Child Issues After This Spike

1. Define shared image capability types and artifact normalization contracts.
2. Implement image route registry and resolver, including `route:${id}` hints and multiple-account selection.
3. Implement OpenAI direct Image API adapter with mocked request/response tests.
4. Implement Gemini, xAI/Grok, and MiniMax API adapters with mocked request/response tests.
5. Implement MiniMax Token Plan CLI adapter with auth/quota checks and generated-file ingestion.
6. Add Settings UI for image-capable routes under Capability Availability, not under generic LLM Provider config.
7. Add the Agent-facing `generate_image` tool and artifact-first result rendering.
8. Evaluate Codex connected-account imagegen as an experimental route after product/auth review.
9. Add OpenAI-compatible custom-provider image route support using explicit model capability flags.

## Sources

Official/current docs reviewed:

- https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image
- https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- https://docs.langchain.com/oss/javascript/integrations/tools/openai
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/codex/app/features
- https://developers.openai.com/codex/cli/features
- https://developers.openai.com/codex/ide/features
- https://developers.openai.com/codex/auth
- https://ai.google.dev/gemini-api/docs/image-generation
- https://docs.x.ai/developers/model-capabilities/imagine
- https://platform.minimax.io/docs/guides/image-generation
- https://platform.minimax.io/docs/api-reference/image-generation-t2i
- https://platform.minimax.io/docs/api-reference/image-generation-i2i
- https://platform.minimax.io/docs/token-plan/minimax-cli
- https://platform.minimax.io/docs/guides/mcp-guide

Local implementation evidence:

- `/Users/suntc/deployment/CPA/CLIProxyAPI/sdk/api/handlers/openai/openai_images_handlers.go`
- `/Users/suntc/deployment/CPA/CLIProxyAPI/internal/runtime/executor/codex_openai_images.go`
- `/Users/suntc/deployment/CPA/CLIProxyAPI/sdk/api/handlers/openai/openai_videos_handlers.go`
- `/Users/suntc/deployment/CPA/CLIProxyAPI/internal/registry/model_definitions.go`
- `/Users/suntc/deployment/CPA/CLIProxyAPI/sdk/api/handlers/handlers.go`
- `/Users/suntc/deployment/CPA/CLIProxyAPI/config.example.yaml`
