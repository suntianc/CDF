# PDF Skill scripts dispatch through the compiled CDF CLI

PDF Parsing Skill scripts remain shell-executed resources, but they dispatch into a compiled CDF-owned CLI entrypoint instead of reimplementing parser or recovery logic inside each generated script.

The compiled CLI loads the internal `src/main/pdf-parsing-skill.ts` and `src/main/pdf-parse.ts` modules at build time. Packaged Skill scripts are therefore thin argument-forwarding wrappers over the same library code used by tests and Electron internals. This reconciles ADR 0034's "no dedicated Skill script runner" decision with ADR 0039's "real script entrypoints, not rewrites" requirement.

The script path is synchronous. It exposes `baseline-parse`, Marker preparation, recovery-plan refresh, AGENTS.md preference set/clear, recovery application, and recovered-view finalization. It does not expose `status` or `cancel` scripts: the parse job registry lives in the Electron main process, and a separate shell-launched Node process cannot observe or cancel that in-memory registry reliably.

If CDF later needs long-running PDF parse control from Skill scripts, it should add an artifact-backed job state protocol or another durable process boundary first. It should not revive the removed global PDF tools as a compatibility layer.
