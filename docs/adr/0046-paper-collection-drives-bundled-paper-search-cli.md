# 0046. Paper collection drives a bundled paper-search CLI

## Status

Accepted

## Context

Issue #72 closes the loop from paper discovery to a complete Paper Entry.
The original design built the execution layer inside CDF: Skill-taught
Crossref/OpenAlex calls for bibliographic enrichment, a new
`journal_metrics` Agent Tool wrapping the easyScholar open API (plus
settings UI and i18n), and `bash` + `curl` for PDF download.

Then we found [paper-search-cli](https://github.com/dr-dumpling/paper-search-cli)
(MIT, Node >= 18, CLI-only, JSON output): one tool covering metadata
search across 20+ scholarly sources, journal metrics through the same
easyScholar key (impact factor, 5-year IF, JCR quartile, CAS tier,
warning flags), and multi-tier open-access PDF discovery with
`download --save-path`. It is exactly the execution layer we were about
to hand-build, with wider coverage.

Risks: a young project (single maintainer, ~100 stars) becomes a
supply-chain dependency; it talks to many external services; it ships an
explicitly opt-in Sci-Hub fallback that CDF must never enable.

## Decision

Adopt paper-search-cli as the execution engine behind the Paper
Collection Skill, replacing the planned `journal_metrics` Agent Tool,
Skill-taught registry calls, and curl-based PDF download.

- **Invocation**: the Skill teaches the Agent to drive the CLI through
  shell (ADR 0038/0040 pattern: domain workflows live behind Skills, not
  new global tools).
- **Distribution**: bundled with CDF and version-pinned — built into a
  single-file JS with esbuild and materialized into the skill directory,
  reusing the ADR 0040 infrastructure. Feasibility of the esbuild bundle
  is verified as the first implementation step; if it fails, fall back to
  a bundled-by-download install.
- **Configuration**: Paper Search CLI research credentials and source
  identity fields are managed in CDF Research Config. The main process
  syncs those supported CLI config keys into the CLI's own 0600 config
  file at save time (the equivalent of `paper-search setup` /
  `paper-search config`). Runtime and network options are intentionally
  not managed by this UI. Values are never injected into the Agent's
  shell environment per call and never appear in generated Skill files.
- **Compliance**: CDF never enables the Sci-Hub fallback and the Skill
  never instructs enabling it. PDF acquisition stays on native,
  open-access, and institutionally licensed routes.

## Consequences

- #72 sheds its largest chunk of new code (metrics tool + settings
  plumbing for it) and gains wider source coverage than the hand-built
  plan; the data-model work (knowledge_create extension, `papers/<slug>`
  layout, dedup, validation, snapshot semantics) is unchanged.
- CDF takes a pinned dependency on a young third-party project. Version
  bumps require review; if the project dies, the fallback is to revive
  the original hand-built plan behind the same Skill boundary — the
  Skill's strategy text is the stable interface, so the engine is
  swappable.
- Journal metrics quality and rate limits are governed by the user's own
  easyScholar account (free or paid); CDF handles absence, not billing.
- The CLI's other sources (Web of Science, Scopus keys, etc.) become
  available for free if users configure them, without CDF code changes.

## Phase 2: Skill split and cache

The Phase 0 Skill still coupled discovery, metrics enrichment, PDF
download, and Paper Entry creation in one Agent workflow. Phase 2 splits
that workflow into two built-in Skills:

- **Paper Search Skill**: search only. It runs candidate discovery,
  deduplicates journal metric lookups by normalized journal name,
  presents candidates, writes the cross-Skill cache, and stops for user
  selection. It does not run the CLI download subcommand and does not
  create Paper Entries.
- **Paper Collection Skill**: import only. Mode A consumes selected
  cached candidates and downloads only open-access PDFs. Mode B accepts a
  user-provided authorized PDF already placed under
  `.cdf/knowledge/papers/`, validates it with the existing Paper resource
  path rules, reconciles metadata from the cache when possible, and
  creates the Paper Entry.

The cross-Skill cache lives in the deepagents StateBackend virtual file
system under `/paper-collection-cache/`:

```json
{
  "latest": "/paper-collection-cache/latest.json",
  "index": "/paper-collection-cache/index.json",
  "archive": "/paper-collection-cache/archive/<searchedAt>.json",
  "latestPayload": {
    "searchedAt": "2026-07-05T10:00:00Z",
    "consumedAt": "2026-07-05T10:15:00Z",
    "query": "agentic retrieval",
    "source": "arxiv",
    "candidates": [],
    "journalMetricsByJournal": {}
  }
}
```

`latest.json` carries the most recent search payload. `index.json` is the
history list with `fresh`, `consumed`, and `archived` statuses plus an
optional `archivePath`. A consumed latest payload is archived after 30
minutes so a new search does not silently erase an older import context,
while short interruptions still keep the active latest payload in place.

Mode B exists for paid or otherwise non-open PDFs: CDF must not bypass
publisher access controls, but it can help the user import a PDF they
obtained through institutional authorization. The existing Sci-Hub
prohibition remains unchanged.

If the split breaks the Phase 0 workflow in practice, the rollback path
is to collapse the two Skill texts back into one Paper Collection Skill
while keeping the same bundled CLI, `knowledge_create` contract, and
Paper Entry schema. The cache module can remain as an internal helper
until the split is restored.
