# Subscription Capability Boundaries Spike

Date: 2026-07-07

Issue: [#94](https://github.com/suntianc/CDF/issues/94)

## Question

CDF needs to separate API-based model access from product or subscription-based account access before it aggregates capabilities such as image generation, speech, video, search, and coding tools.

This spike answers:

- Which capabilities are exposed by MiniMax Token Plan, OpenAI/ChatGPT/Codex, Google Gemini/Google AI subscriptions, xAI/SuperGrok, and Kimi Code?
- Which capabilities are available through API credentials, product login, CLI auth, or subscription account state?
- Which boundaries are machine-verifiable enough to drive a CDF Capability Profile?

## Recommendation

Model subscription and API access as separate route types. A product subscription is not the same thing as an API provider, even when both come from the same vendor.

Use these first-class route types:

- `llm_provider`: API key, base URL, local runtime, and model list for text reasoning.
- `connected_account`: browser/OAuth/device login for a product account.
- `token_plan`: subscription key or CLI-authenticated account with quota/status commands.
- `local_runtime`: local tools or local model runtimes that can expose capabilities.

For the first implementation, use a conservative Capability Profile:

- `declared`: CDF knows the vendor route can support a capability from official docs.
- `available`: CDF has a live credential/session and can call a status, quota, model, or health check.
- `disabled`: user disabled this specific route.
- `unknown`: CDF has a documented possibility but no reliable live check.

Do not infer that a ChatGPT, SuperGrok, Google AI, or Kimi subscription automatically creates an API route. Keep product-account routes separate until there is an official, reliable integration surface.

## Local Implementation Reference: CLIProxyAPI

After this spike was first completed, the local project at `/Users/suntc/deployment/CPA/CLIProxyAPI` was reviewed as an implementation reference. It is a Go proxy server for OpenAI/Gemini/Claude/Codex/Grok-compatible CLI access, and its README states support for OAuth-backed Codex, Claude Code, Grok Build, multiple accounts, round-robin load balancing, and OpenAI-compatible image/video endpoints.

Important evidence from the codebase:

- `sdk/cliproxy/auth/types.go` defines one runtime `Auth` record per credential with provider, label, status, disabled/unavailable flags, quota, per-model state, provider-specific attributes, metadata, and recent request counters.
- `sdk/auth/interfaces.go`, `sdk/auth/manager.go`, and `sdk/auth/refresh_registry.go` define a provider-neutral authenticator contract: `Provider()`, `Login(...)`, and `RefreshLead()`.
- `internal/cmd/auth_manager.go` registers built-in authenticators for Codex, Claude, Antigravity, Kimi, and xAI.
- `sdk/auth/codex.go` and `sdk/auth/codex_device.go` implement both Codex browser PKCE and device-code flows, then store the result as the same auth record shape.
- `sdk/auth/kimi.go` implements Kimi device flow; `sdk/auth/xai.go` and `sdk/auth/antigravity.go` implement loopback OAuth flows.
- `internal/api/server.go` exposes management routes such as `/v0/management/codex-auth-url`, `/xai-auth-url`, `/kimi-auth-url`, `/auth-files`, `/auth-files/status`, and `/get-auth-status`.
- `internal/api/handlers/management/auth_files.go` uses a stateful OAuth-session store, callback files, auth file listing, per-account disablement, email/project/account metadata, and recent request counters.
- `sdk/api/handlers/openai/openai_images_handlers.go`, `openai_videos_handlers.go`, and `internal/runtime/executor/codex_openai_images.go` show a concrete adapter pattern for normalizing Codex and xAI image/video routes behind OpenAI-style endpoints.
- MiniMax does not have a built-in authenticator in this project. The only MiniMax-like evidence found is an OpenAI-compatible config test using `https://token-plan-cn.xiaomimimo.com/v1`, so MiniMax still needs CDF-specific token-plan handling if CDF wants first-class subscription support.

Implications for CDF:

- The CDF `Connected Account` model should allow both browser loopback OAuth and device-code login.
- `Connected Account` records should not be just token blobs. They need status, disabled state, identity, source, refresh timing, last error, recent usage, and provider-specific metadata.
- The `Capability Availability Surface` can borrow CPA's split between account listing, per-account disablement, auth-status polling, and model/capability routing.
- CPA validates the route-based model: Codex, Kimi, xAI, Antigravity, AIStudio, Vertex, and OpenAI-compatible API keys are different route classes even when they can be exposed through one compatible endpoint.
- CPA should be treated as implementation evidence, not a direct product decision. It is a proxy for coding tools and compatible APIs; CDF still needs user-visible capability semantics and artifact management.

## Capability IDs

Use stable capability identifiers instead of provider-specific feature names:

- `text.chat`
- `text.reasoning`
- `text.vision`
- `audio.input`
- `video.input`
- `image.generate`
- `image.edit`
- `video.generate`
- `video.edit`
- `speech.synthesize`
- `speech.transcribe`
- `speech.realtime`
- `music.generate`
- `search.web`
- `search.social`
- `code.agent`
- `code.execute`
- `quota.status`
- `account.auth`

These are Capability Profile declarations, not tool schemas. Public tools such as `generate_image` should stay provider-neutral and use adapters behind the route.

## Matrix

| Provider / plan | Access route | Text reasoning | Extra capabilities | Live boundary signal | CDF classification |
| --- | --- | --- | --- | --- | --- |
| MiniMax API | API key | MiniMax chat models, Anthropic-compatible examples for some models | Speech, video, image, music, file management, official MCP multimodal tools | API key health, model/API call success | `llm_provider` plus capability routes |
| MiniMax Token Plan | Subscription Key / MiniMax CLI auth | Subscription access to MiniMax models | Image, speech, music, video, web search through official CLI/MCP surfaces | `mmx auth status`, `mmx quota`, CLI output | Strong first `token_plan` target |
| OpenAI API | API key | API models for text, image input, tool use | Image generation/editing, audio, video through API families | `/models`, API call success, org verification failures | `llm_provider` plus capability routes |
| ChatGPT subscription | Browser product login | ChatGPT product access | Product-level image creation, agents, deep research, Codex usage by plan | Product UI/account state only; no general API entitlement signal | `connected_account`, not API provider |
| Codex ChatGPT sign-in | Browser/device login | Codex local/cloud coding agent | Codex image generation/editing via built-in imagegen path, counted against Codex usage | Codex auth/session and usage commands | `connected_account` for Codex-specific routes |
| Google Gemini API | API key | Gemini API text generation with multimodal inputs | Gemini image generation/editing, video generation/editing, TTS | API key call success, model docs/list | `llm_provider` plus capability routes |
| AIStudio / Antigravity style route | WebSocket/runtime auth or loopback OAuth, depending on client | Gemini-family coding and agent models | Model-specific image/search/tool capabilities where exposed by client route | Runtime connection, project ID, model registry, request success | `connected_account` or `local_runtime`, not generic Gemini API |
| Google AI Pro/Ultra | Google product subscription | Gemini app access by plan | Product-level Veo, Deep Research, Agent Mode, image/video access by plan | Product account only; no general API entitlement signal in researched docs | `connected_account`, capabilities mostly `unknown` |
| xAI API | API key | Grok chat/code models | Imagine image/video generation/editing, voice API, web/X search, code tools | API key call success, model/tool docs | `llm_provider` plus capability routes |
| xAI OAuth / Grok Build style route | Loopback OAuth | Grok Build and xAI account-backed models | CPA demonstrates xAI image/video compatible routing through account-backed executors | OAuth token refresh, request success, model registry | `connected_account` with xAI-specific capability routes |
| SuperGrok | xAI product subscription | Grok product access by plan | Higher limits, Expert, image/video generation, connectors | Product account only; no general API entitlement signal in researched docs | `connected_account`, capabilities mostly `unknown` |
| Kimi Open Platform | API key | Kimi API text/code models with multimodal input support | Vision/video understanding; no official evidence for generation media | API key call success | `llm_provider` |
| Kimi Code | OAuth/client login or Kimi Code API key | Coding agent and `kimi-for-coding` model | Code reading, file editing, command execution; multimodal input depends on model | `/usage`, console API keys, client login | `connected_account` or `llm_provider` for coding/text only |

## Provider Findings

### MiniMax

MiniMax has the cleanest boundary for CDF's first subscription capability integration.

Official docs distinguish regular API keys from Token Plan Subscription Keys. Token Plan seats expose a Subscription Key and are not interchangeable with pay-as-you-go API keys. The plan covers language, speech, video, music, and image capabilities, and the CLI exposes auth and quota commands. MiniMax also documents official MCP servers for TTS, voice cloning, image generation, and video generation.

CDF implication:

- Treat MiniMax API as a normal `llm_provider` plus capability routes.
- Treat MiniMax Token Plan as `token_plan` with live status and quota checks.
- Prefer MiniMax as the first provider for `Capability Availability Surface`, because the status boundary can be tested without scraping a product UI.

Sources:

- https://platform.minimax.io/docs/token-plan/intro
- https://platform.minimax.io/docs/token-plan/quickstart
- https://platform.minimax.io/docs/token-plan/minimax-cli
- https://platform.minimax.io/docs/token-plan/migration
- https://platform.minimax.io/docs/api-reference/api-overview
- https://platform.minimax.io/docs/guides/mcp-guide
- https://platform.minimax.io/docs/api-reference/text-chat-anthropic

### OpenAI, ChatGPT, and Codex

OpenAI has two separate surfaces:

- OpenAI API credentials for API models and multimodal generation APIs.
- ChatGPT/Codex product login for subscription-backed product usage.

OpenAI API supports text reasoning, image generation/editing, audio, and video APIs. Some image generation access can require organization verification. ChatGPT pricing pages describe subscription product capabilities such as image creation, agents, and Codex usage, but that is not the same boundary as API entitlement.

Codex supports ChatGPT sign-in and API-key auth. ChatGPT sign-in gives subscription-backed Codex usage, while API-key auth uses API billing and lacks cloud-product features. Codex docs/manual content also describe built-in image generation/editing through its imagegen path, counted against Codex usage.

CDF implication:

- Keep `OpenAI API` under `LLM Provider` and capability routes.
- Model `ChatGPT account` as `Connected Account`.
- Model `Codex account/session` as a Connected Account for `code.agent` and Codex-specific imagegen routes only.
- Do not treat a ChatGPT Plus/Pro login as an OpenAI API key.

Sources:

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/guides/audio
- https://developers.openai.com/api/docs/guides/video-generation
- https://developers.openai.com/codex/auth
- https://developers.openai.com/codex/pricing
- https://developers.openai.com/codex/models
- https://chatgpt.com/pricing/

### Google Gemini and Google AI Plans

Gemini also has separate API and product-plan surfaces.

Gemini API supports text generation with multimodal inputs. Official docs also describe Gemini image generation/editing, video generation/editing through Gemini Omni preview, and speech generation. Google AI Pro/Ultra subscriptions are consumer product plans with Gemini app features such as Deep Research, larger context, Veo access, and Agent Mode depending on plan.

This spike did not find an official, product-plan entitlement API suitable for CDF to use as a reliable Capability Profile source.

CDF implication:

- Treat Gemini API key as `LLM Provider` plus capability routes.
- Treat Google AI Pro/Ultra as `Connected Account` only if CDF later integrates product login.
- Product subscription capabilities should remain `unknown` or `declared` until there is a reliable live check.

Sources:

- https://ai.google.dev/gemini-api/docs/text-generation
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/omni
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://ai.google.dev/gemini-api/docs/models
- https://gemini.google/subscriptions/

### xAI and SuperGrok

xAI's API docs expose clear API-key capability families:

- Grok chat/code models.
- Imagine image and video generation/editing API.
- Voice API for realtime, speech-to-text, and text-to-speech.
- Built-in web search, X search, code interpreter, and collection search tools.

SuperGrok pricing describes product subscription capabilities such as higher limits, Expert, image and video generation, connectors, and Grok Build CLI. That is a product subscription boundary, not an API-key boundary.

CDF implication:

- Treat xAI API as `LLM Provider` plus capability routes.
- Treat xAI OAuth or Grok Build style integrations as `Connected Account` routes when a stable client protocol is available.
- Treat SuperGrok product subscription as `Connected Account` only until its automation boundary is separately verified.
- Do not route `generate_image` through SuperGrok product login until an official integration surface is confirmed.

Sources:

- https://docs.x.ai/developers/models
- https://docs.x.ai/developers/model-capabilities/imagine
- https://docs.x.ai/developers/tools/overview
- https://docs.x.ai/developers/pricing
- https://x.ai/pricing

### Kimi Code and Kimi Open Platform

Kimi has two distinct surfaces:

- Kimi Open Platform API, with OpenAI-compatible API access to Kimi models.
- Kimi Code membership, with CLI/VS Code clients, OAuth login, coding-agent features, and API keys for third-party coding tools.

Kimi Code docs describe membership quotas, concurrent request limits, `/usage`, official clients, API keys, and `kimi-for-coding`. Kimi Open Platform docs describe text/code models with image/video input support. This spike did not find official evidence that Kimi currently provides image generation, video generation, speech generation, or music generation capabilities.

CDF implication:

- Treat Kimi Open Platform as `LLM Provider`.
- Treat Kimi Code as a Connected Account or coding-specific API provider. CPA demonstrates Kimi device-flow login as a practical implementation route.
- Declare `code.agent`, `text.chat`, `text.reasoning`, and multimodal input capabilities where supported.
- Do not declare `image.generate`, `video.generate`, or `speech.synthesize` for Kimi from current evidence.

Sources:

- https://www.kimi.com/code/docs/en/
- https://www.kimi.com/code/docs/en/kimi-code/faq.html
- https://platform.kimi.ai/docs/overview

## Aggregation Rules For #95

The settings UI should not ask users to manually check provider capabilities. CDF should derive them from route type and live status where possible.

Recommended rules:

1. `LLM Provider` owns API/base URL/local-runtime text model configuration.
2. `Connected Account` owns login/logout/account identity/session health.
3. `Capability Availability` owns route status, quota, test action, and per-route disablement.
4. Capability routes are app-wide in the first version.
5. The main conversation model selector may show text-capable routes from both `LLM Provider` and text-capable `Connected Account`, grouped by source.
6. Multimodal tools should not be selected by the main model dropdown. They should resolve through capability routing, optional user route hints, and route availability.
7. Product subscription capabilities without a live check should be marked `declared` or `unknown`, not `available`.
8. A `Connected Account` route may become `available` when CDF owns a stable client integration, such as loopback OAuth, device-code auth, CLI status, WebSocket session, or a local sidecar management API.

## Suggested Route Confidence

| Provider route | First implementation confidence | Reason |
| --- | --- | --- |
| MiniMax Token Plan | High | Dedicated Subscription Key, CLI auth/status/quota, official multimodal MCP surfaces |
| OpenAI API | High | Stable API credentials and official multimodal API docs |
| Gemini API | High | Stable API credentials and official multimodal API docs |
| xAI API | Medium-high | Clear API docs for chat, Imagine, voice, and tools |
| Kimi Code | Medium | Clear coding/account quota boundary, but media generation is not in evidence |
| ChatGPT subscription | Medium-low | Useful product account, but not a general API route |
| Codex ChatGPT sign-in | Medium | Useful for Codex-specific coding and imagegen flows, not a general provider route |
| Google AI Pro/Ultra | Low for automation | Product capabilities documented, but no reliable entitlement API found |
| SuperGrok | Low for automation | Product capabilities documented, but no reliable entitlement API found |

SuperGrok Heavy, where exposed as a higher product tier, should use the same route class as SuperGrok. Its effect should be modeled as plan/limit metadata, not as a different provider boundary, unless official docs expose a unique integration surface.

## Result And Async Shape

Capability routing should assume non-text outputs are artifact-producing jobs, even when a provider can return a result synchronously.

| Capability family | Expected CDF result shape | Notes |
| --- | --- | --- |
| `image.generate` / `image.edit` | One or more image artifacts with prompt, route, model, size/aspect metadata, and provider result IDs where available | Some APIs return inline/base64 data, some return URLs or files. Normalize to local artifacts. |
| `video.generate` / `video.edit` | Long-running media job with progress/status, then local video artifact | Treat as async by default. Provider APIs and CLIs may require polling or output-file discovery. |
| `speech.synthesize` | Audio artifact or stream saved as an artifact | Preserve voice, format, sample rate, model, and route metadata. |
| `speech.transcribe` | Text transcript plus optional timing metadata | This can return normal text but should still preserve source media and route metadata. |
| `speech.realtime` | Session route, not a simple Agent tool call | Needs a separate runtime contract from one-shot tools. |
| `music.generate` | Long-running media job with audio artifact output | Treat like video: async-capable, quota-sensitive, and artifact-first. |
| `search.web` / `search.social` | Structured citations or snippets | Should remain a tool result, not a generated media artifact. |
| `code.agent` | Workspace operation transcript, file diffs, commands, and final text | Requires workspace permissions and should not be collapsed into text model selection. |

Provider-specific observations:

- MiniMax CLI writes generated media to local output paths in documented flows, which fits CDF's artifact model well.
- OpenAI, Gemini, and xAI APIs can expose image/video/audio through API responses, download URLs, or job-like flows depending on capability family. CDF should hide that behind adapters.
- Kimi Code is primarily text/code/workspace output from current evidence, not generated media.

## Safety, Privacy, Cost, And Terms Boundaries

CDF should surface the following route constraints before exposing a capability to Agents:

- External route: any API, product account, or CLI route that sends prompts, files, images, audio, video, repository contents, or workspace context outside the machine.
- Costed route: any route billed through API usage, product quota, subscription usage, tool calls, or generation credits.
- Quota-limited route: any route with rate limits, daily generation limits, plan seats, concurrent request limits, or shared subscription quotas.
- Verification-gated route: any route that may fail because of organization verification, region restrictions, product-plan eligibility, or unsupported account tier.
- Workspace-mutating route: coding agents that can edit files or run commands.
- Product-account route: consumer or IDE product login where automation may be limited by product terms or absent public APIs.

Do not scrape consumer product UIs for entitlement discovery. If a provider does not publish a stable API, CLI, SDK, or documented local session contract, CDF should mark the capability as `declared` or `unknown` and require explicit user action before using it.

## Open Questions

- Should CDF implement MiniMax Token Plan first as the reference `token_plan` route?
- Should Codex imagegen be exposed as a CDF capability route, or should CDF only use it inside Codex-managed workflows?
- Should product subscriptions without official entitlement APIs appear in UI as "Connect account" candidates, or stay hidden until an integration exists?
- Should route health checks be synchronous user actions first, then background refresh later?

## Issue Outcome

#94 establishes that capability aggregation must be route-based, not provider-name-based.

The next design step is #95:

- Define how `Capability Profile` records are merged from `LLM Provider`, `Connected Account`, `token_plan`, and `local_runtime` sources.
- Define the settings layout for Connected Accounts, LLM Providers, and Capability Availability.
- Keep public Agent tools provider-neutral.
