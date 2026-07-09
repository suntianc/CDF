# Image generation uses one public Agent Tool

## Status

Accepted

CDF exposes image generation to Agents as one public `generate_image` tool, while provider-specific calls live behind Capability Adapters. Codex, Grok, Gemini, MiniMax token-plan routes, API-key routes, and future local routes may differ in authorization, model names, parameters, quotas, and response formats, but the Agent-facing task remains "generate an image"; exposing one tool per provider would make provider selection a prompt-level burden and duplicate the same user intent across the Global Agent Tool Surface.

The public tool may accept an optional Capability Route Hint such as `gemini`, `grok`, `codex`, `minimax-token-plan`, `openai-api`, or `auto`, but provider-specific parameters stay out of the first public schema. Runtime routing can reject, ask for clarification, or choose another viable route when the hinted route is unavailable, expired, over quota, unsafe for the task, or inconsistent with the current Conversation model context.

The first implementation issue should not assume the public schema is text-to-image only. A Spike must first compare available wrapper layers and provider capabilities, then decide whether the first `generate_image` schema should cover only text-to-image or also reference images, natural-language editing, masks, or other image operations.
