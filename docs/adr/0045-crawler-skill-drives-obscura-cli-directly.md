# 0045. Crawling splits between the Obscura tool and a Crawler Skill

## Status

Accepted

## Context

Issue #29 adds a general-purpose Crawler Skill. CDF already exposes an
`obscura_browse` Agent Tool (issue #23) that wraps a single, stateless
Obscura call: one URL in, one rendered page out. Today it only surfaces
`obscura fetch` with `--dump markdown|text|html`, plus `selector`,
`waitUntil`, `stealth`, `userAgent`, `proxy`, `timeoutMs`.

Real crawling needs more: link discovery (`fetch --dump links`), cookie
and asset inspection (`--dump cookies|assets|original`), batch fetching
(`scrape` with concurrency), and page scripting (`--eval`). All of it
already exists in the bundled Obscura CLI.

The issue frames the Skill as the strategy layer and the tool as the
execution engine. An earlier draft of this ADR had the Skill bypass the
tool and shell out to the Obscura CLI directly, so the full CLI surface
was reachable without growing the tool. That contradicted the issue's own
"tool is the engine" framing: the strategy layer would have had to
re-implement execution by hand, parse shell stdout, and hand-assemble
command lines (error-prone, an injection surface, cross-platform path
handling).

The real dividing line is **atomic operation vs. workflow**, not
tool-vs-Skill wholesale:

- Atomic, single-call, one-structured-result operations (fetch a page's
  content, its links, its cookies, its assets) benefit from a typed tool:
  JSON return, `validateWebUrl` SSRF/protocol checks, unified
  exitCode/stderr handling.
- Multi-step, strategy-bearing orchestration (pagination loops,
  "define a field schema then extract row by row", batch URL lists,
  anti-scraping escalation) is a *playbook*, not a parameter set, and is
  what a Skill is for. Mirroring Obscura's entire surface into a tool
  schema (scrape concurrency, `--eval`, sessions) is an endless arms race.

## Decision

Split crawling across two layers instead of choosing one.

1. **Extend the `obscura_browse` tool** to cover Obscura `fetch`'s atomic
   read operations — add `links`, `cookies`, `assets`, and `original` to
   the existing `markdown|text|html` dump formats — returning structured
   results with the tool's existing validation and error handling.
2. **The Crawler Skill orchestrates the extended tool.** It is a pure
   `SKILL.md` with no wrapper scripts and no shell/CLI invocation; it
   carries strategy and instructions only and calls the tool for every
   fetch/extract. It is discovered through normal progressive disclosure
   (`name` + `description`) and injects no managed block into the project
   `AGENTS.md`.
3. **Out of scope for #29:** `scrape` batch concurrency, `--eval` page
   scripting, and stateful sessions (login-walled or click-only content).
   Neither the tool nor the Skill covers these yet; they are explicit
   non-capabilities left to a later issue.

## Consequences

- The issue's "tool is the engine, Skill is the strategy" framing holds:
  the Agent gets structured results from the tool and applies strategy in
  the Skill, without hand-assembling command lines or parsing stdout.
- This walks back the earlier "pure Skill shells out to the CLI" draft. It
  costs a schema/code change to `obscura_browse`, and it modestly grows
  the Global Agent Tool Surface — in tension with ADR 0038/0044's lean
  toward Skills over tools. Accepted because the added surface is atomic
  read operations (especially `links`, the foundation of pagination and
  discovery) that genuinely want structured returns.
- Crawling capability is bounded by the tool's read operations plus the
  Skill's orchestration. URL-pattern pagination and Agent-driven loops are
  in; batch/eval/session are out until a later capability lands.
- Default posture in the Skill is compliance-first: `stealth` on by
  default for fingerprint consistency, but respect `robots.txt`, low
  concurrency, and request pacing by default. Ignoring robots, high
  concurrency, or working around access controls requires the user to have
  legitimate access to the target and to say so explicitly.
