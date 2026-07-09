# AI Subscription Settings IA Spike

Date: 2026-07-07

Issue: [#95](https://github.com/suntianc/CDF/issues/95)

Parent: [#27](https://github.com/suntianc/CDF/issues/27)

Depends on: [#93](https://github.com/suntianc/CDF/issues/93), [#94](https://github.com/suntianc/CDF/issues/94)

## Question

CDF needs to present subscription-backed AI capabilities without mixing three different concerns:

- API-key/base-URL model access through `LLMProvider`.
- Subscription or product-account capability access through AI subscriptions.
- Runtime capability routing behind provider-neutral Agent Tools.

This spike defines the first settings IA and product/domain model for AI subscriptions.

## Recommendation

Add a Settings tab named `AI 订阅`.

This tab is the user-facing surface for subscription-backed or account-backed AI capability entrypoints. It is not a generic provider page, not an API-key model settings page, and not a standalone Capability Availability dashboard.

First-version subscription entrypoints:

- `MiniMax Token Plan`
- `Codex OAuth`
- `xAI OAuth`
- `Antigravity OAuth`

Each entrypoint supports one logged-in account in the first version. Do not implement multi-account routing, round-robin, or default capability-source selection. CLIProxyAPI should be used as implementation evidence for OAuth/device-code flows, status polling, refresh timing, usage metadata, and health/error state, but not as evidence that CDF should inherit multi-account routing complexity.

## Settings IA

| Surface | Owns | Does not own |
| --- | --- | --- |
| `LLM Providers` | API key, base URL, text models, default text model, context limit, API-backed capability status for that provider | OAuth/product login, subscription aggregation |
| `AI 订阅` | Subscription/product account login, period usage summary, subscription capability switches | API key/base URL setup, default text model, default capability-source policy |
| `Tools and MCP` | Local tools, MCP servers, built-in tool enablement, local/MCP-backed capability status | Subscription login, LLM provider model setup |
| `Research Config` | Research-specific configuration such as paper-search | General capability aggregation |
| `System Settings` | App/system preferences | Provider or subscription route decisions |

There is no standalone top-level `Capability Availability` settings page in the first version. Capability availability is shown inside the surface that owns the authorization source.

## AI Subscription Card UI

The `AI 订阅` tab shows four fixed expandable cards, one for each first-version entrypoint.

Collapsed card:

- subscription name,
- period usage summaries when available, especially weekly quota and five-hour quota,
- login action when the entrypoint is not connected.

Collapsed card must not show:

- OAuth/device-code/token-plan category labels,
- provider endpoint names,
- adapter names,
- model IDs,
- low-level route IDs.

Expanded card:

- user-facing capability switch list only,
- one switch per capability,
- switches disabled until the entrypoint is connected,
- expected capabilities may be previewed before login.

Example expanded capability labels:

- image generation,
- image editing,
- speech generation,
- video generation,
- code agent,
- web search.

Each capability is enabled by default when CDF declares or discovers it for the connected subscription entrypoint. Users can manually turn off individual capabilities.

## Login Flow

Login starts from the corresponding AI Subscription card and writes status back to that card.

First-version flow expectations:

- `MiniMax Token Plan`: accept a subscription key or start a CLI-backed login/status flow.
- `Codex OAuth`: start OAuth or device-code login from the card, then poll for completion.
- `xAI OAuth`: start OAuth from the card, then poll for completion.
- `Antigravity OAuth`: start OAuth from the card, then poll for completion.

The AI Subscription tab should keep login actions local to the card. It should not redirect users to `LLM Providers` or to a separate account-management page.

## Product Domain Model

Use `Connected Account` as the internal domain boundary for account/subscription authorization, but use `AI 订阅` as the user-facing settings tab label.

Product-level shapes:

```ts
type AISubscriptionEntryId =
  | "minimax-token-plan"
  | "codex-oauth"
  | "xai-oauth"
  | "antigravity-oauth";

type AISubscriptionConnectionStatus =
  | "logged_out"
  | "connecting"
  | "connected"
  | "expired"
  | "unavailable";

interface AISubscriptionEntry {
  id: AISubscriptionEntryId;
  displayName: string;
  status: AISubscriptionConnectionStatus;
  usageSummaries: AISubscriptionUsageSummary[];
  capabilities: AISubscriptionCapability[];
}

interface AISubscriptionUsageSummary {
  period: "five_hour" | "weekly" | "monthly" | "other";
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  resetsAt?: number;
  unavailableReason?: string;
}

interface AISubscriptionCapability {
  capabilityId: CapabilityId;
  label: string;
  enabled: boolean;
  switchDisabled: boolean;
  availability: "declared" | "available" | "disabled" | "unknown" | "unavailable";
}
```

The internal auth record can still store technical metadata from CPA-like flows:

- account identity,
- provider,
- refresh timing,
- last error,
- disabled/unavailable flags,
- recent usage,
- provider metadata,
- OAuth/session status.

Those fields are not default card content. They are for status checks, diagnostics, and runtime route availability.

## Capability Aggregation Rules

Use stable capability IDs from #94, such as:

- `image.generate`
- `image.edit`
- `speech.synthesize`
- `video.generate`
- `video.edit`
- `music.generate`
- `search.web`
- `code.agent`
- `quota.status`
- `account.auth`

Rules:

1. `AI 订阅` entries produce subscription-backed Capability Profiles.
2. Enabled subscription capabilities become candidate Capability Connections for runtime tools.
3. Turning off a capability switch disables only that subscription entrypoint's route for that capability.
4. Turning off a capability switch does not remove, rename, or reshape provider-neutral public Agent Tools.
5. API-backed capabilities remain owned by their `LLMProvider` source, even when the same capability can also be provided by an AI subscription.
6. Local and MCP-backed capabilities remain owned by `Tools and MCP`.
7. First-version route enablement is app-wide; project-level policy remains out of scope.

Example:

- `generate_image` stays one public Agent Tool.
- If `MiniMax Token Plan` image generation is switched off, that route cannot satisfy `generate_image`.
- `generate_image` may still be usable through another enabled subscription route or API-backed route.

## Runtime Boundary

This spike only defines settings IA and source-owned capability enablement.

Out of scope:

- fallback strategy between subscription routes,
- fallback strategy between subscription and API-backed routes,
- cost optimization,
- round-robin,
- user-level default route selection for each capability,
- project-level route policy.

Those decisions belong to Agent/runtime routing, not to the `AI 订阅` settings surface.

The only runtime rule from this spike is that disabled subscription capability routes are excluded from candidate routes.

## Conversation Model Selection

ADR-0049 still applies: the Conversation Model Selection Surface selects the text reasoning context for the Conversation.

The model selector may group text-capable sources from both `LLM Providers` and text-capable subscription/account routes, but it must not become:

- an AI subscription login surface,
- a default image/speech/video route selector,
- a capability switch surface.

## Child Issues

1. Add the `AI 订阅` Settings tab with four fixed expandable cards.
2. Add card-level login/status shell for `MiniMax Token Plan`, `Codex OAuth`, `xAI OAuth`, and `Antigravity OAuth`.
3. Implement MiniMax Token Plan connection and quota summary normalization.
4. Implement Codex OAuth/device-code login start, polling, refresh/status, and quota summary where available.
5. Implement xAI OAuth login start, polling, refresh/status, and quota summary where available.
6. Implement Antigravity OAuth login start, polling, refresh/status, and quota summary where available.
7. Add subscription capability profiles and default-enabled capability switches.
8. Feed enabled/disabled subscription capability routes into the runtime capability resolver.
9. Add LLM Provider detail affordances for API-backed capabilities without moving them into `AI 订阅`.
10. Keep model selection grouped by text-capable sources without turning it into capability routing settings.

## ADR And Glossary Updates

Captured decisions:

- [ADR-0050](../adr/0050-capability-availability-lives-with-source-settings.md): capability availability lives with source settings; `AI 订阅` is the first-version subscription UI.
- [CONTEXT.md](../../CONTEXT.md): added `AI Subscription Surface` and clarified `Connected Account`, `LLM Provider`, and `Capability Availability Surface`.

Relevant prior decisions:

- [ADR-0048](../adr/0048-image-generation-uses-one-public-agent-tool.md): image generation uses one public Agent Tool.
- [ADR-0049](../adr/0049-model-selection-aggregates-text-capable-sources.md): model selection aggregates text-capable sources.

## Source Inputs

- [#94 subscription capability boundaries](./subscription-capability-boundaries.md)
- [#93 image capability adapter](./image-capability-adapter.md)
- `/Users/suntc/deployment/CPA/CLIProxyAPI` local implementation reference for OAuth/device-code/status polling patterns.
