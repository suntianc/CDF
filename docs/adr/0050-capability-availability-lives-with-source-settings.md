# Capability availability lives with source settings

## Status

Accepted

CDF will not add a standalone top-level Capability Availability settings page in the first version. Capability status, quota, tests, and route-level enablement are shown inside the owning source surface: API-backed routes live under LLM Providers, subscription/account-backed routes live under the user-facing AI Subscription tab, and local/MCP routes live under Tools and MCP. Runtime capability routing can still aggregate all viable routes behind provider-neutral Agent Tools, but settings IA stays anchored to the authorization source so API model access and subscription capability aggregation do not collapse into one overloaded page.

AI Subscription entries are organized by product account or subscription entrypoint, not by vendor. For example, `ChatGPT / Codex`, `MiniMax Token Plan`, `SuperGrok`, `Google AI Pro / Ultra`, and `Kimi Code` are separate subscription surfaces even when the same vendor also exposes API-key LLM Providers.

Each product account or subscription entrypoint supports one signed-in account in the first version. CDF should reference CLIProxyAPI for OAuth, device-code login, account status polling, refresh timing, and health/error metadata, but it should not inherit CPA's multi-account routing or round-robin selection behavior until real user demand appears.

The first AI Subscription implementation covers four entrypoints: `MiniMax Token Plan`, `Codex OAuth`, `xAI OAuth`, and `Antigravity OAuth`. Other subscription products may remain design candidates until their login and capability boundaries are separately verified.

The Settings tab label is `AI 订阅`. Each entry is an expandable card. The collapsed card shows only the subscription name and period usage summaries, such as weekly quota and five-hour quota when the subscription route can report them. Authentication type, technical route kind, login details, and detailed health are hidden from the default card surface.

Expanded subscription cards show the subscription's user-facing capability switch list, such as image generation, image editing, speech generation, video generation, code agent, and web search. Each capability has its own enablement switch for that subscription entrypoint. Provider tool names, endpoint names, adapter names, model IDs, and low-level auth categories are hidden from the default UI and may appear only in diagnostics or advanced details.

The four first-version subscription entrypoints are always visible as cards, even before login. A logged-out card shows the subscription name and login action instead of quota. Its expanded capability list can preview expected capabilities, but capability switches remain disabled until the account or token-plan route is connected.

Login starts from the corresponding AI Subscription card and writes status back to that card. MiniMax Token Plan may accept a subscription key or start a CLI-backed login flow; Codex OAuth, xAI OAuth, and Antigravity OAuth start their OAuth or device-code flow from the card and poll for completion. These login actions do not redirect users to LLM Providers or to a separate account-management page.

Capability switches disable only that subscription entrypoint's route for the selected capability. They do not remove or reshape the provider-neutral public Agent Tool. For example, disabling image generation on `MiniMax Token Plan` prevents that route from satisfying `generate_image`, but `generate_image` remains available if another enabled route can handle it.

Subscription capabilities are enabled by default when CDF declares or discovers them for the connected subscription entrypoint. Users can manually turn off individual capabilities from the expanded card.

The AI Subscription tab does not provide first-version global defaults such as "default image generation subscription" or "default video generation subscription." It manages login, quota display, and per-subscription capability enablement only. Provider-neutral tools resolve among enabled routes at runtime, with explicit route hints reserved for tool calls or later advanced settings.

Runtime fallback between subscription routes or between subscription and API-backed routes is out of scope for this settings IA decision. That behavior belongs to Agent/runtime routing, not to the AI Subscription surface.
