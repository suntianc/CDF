# Default General-purpose Agent is a protected Project Agent

## Status

Accepted

Every Project owns an always-available, protected Agent record with the reserved slug `general-purpose`. It participates in the same Agent settings, delegation, inherited Conversation Approval Mode, durable Delegated Agent Run relations, and single/parallel launch paths as user-created Agents, but cannot be deleted, renamed, or shadowed. By default it inherits the invoking parent Agent's provider and model, while an explicit user configuration may override them; every invocation still receives an isolated model instance. We chose a first-class protected record over a runtime-only virtual target to avoid duplicating identity lookup, configuration, persistence, and foreign-key behavior throughout the delegation runtime.
