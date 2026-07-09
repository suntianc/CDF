# Model selection aggregates text-capable sources

## Status

Accepted

The Conversation Model Selection Surface selects the text reasoning context for a Conversation. It should group and expose text models from both existing LLM Providers and text-capable Connected Accounts, but it must not become an account-management surface or a default route selector for every multimodal capability. Capability tools may consider the selected text context as one routing signal, but image, speech, video, and similar capability route selection stays behind the relevant public tool and Capability Availability model.
