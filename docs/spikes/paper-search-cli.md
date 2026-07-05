# Paper Search CLI Bundling Spike

This report captures issue #74 for the Paper Collection Skill execution
engine. The goal was to verify whether `paper-search-cli` can be
version-pinned, bundled with esbuild, materialized into an isolated
directory, and run without a local `node_modules` tree.

## Conclusion

`paper-search-cli@0.3.4` is feasible as a bundled CDF runtime with one
small packaging condition:

- build the CLI entry with esbuild as CommonJS;
- mark `readline/promises` external because esbuild does not resolve that
  Node built-in automatically in this dependency graph;
- postprocess esbuild's CommonJS output so the generated `import_meta.url`
  points at `pathToFileURL(__filename).href`;
- materialize a minimal adjacent `package.json` from the package so the
  CLI's `--version` path can read `../package.json`.

ESM output was tested and rejected for this dependency set because bundled
CommonJS dependencies such as `dotenv` hit dynamic `require("fs")` at
runtime.

No ADR 0046 fallback update is needed: the esbuild single-file route is
workable.

## Package

- npm package: `paper-search-cli`
- tested version: `0.3.4`
- license: MIT
- bin: `paper-search -> dist/cli.js`
- package size on disk before bundling: about 2.5 MB
- bundle size: 15,048,858 bytes (about 14.4 MB)
- native modules observed: none
- primary runtime dependencies: `axios`, `cheerio`, `dotenv`,
  `https-proxy-agent`, `socks-proxy-agent`, `lru-cache`, `pdf-parse`,
  `xml2js`, `zod`

## Build Evidence

Experiment directory:

```bash
/tmp/cdf-paper-search-cli-spike.8cdG1u
```

Install:

```bash
pnpm add paper-search-cli@0.3.4 esbuild@0.25.12
```

Working bundle command:

```bash
pnpm exec esbuild node_modules/paper-search-cli/dist/cli.js \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile=bundle/paper-search.cjs \
  --external:readline/promises
```

Required postprocess:

```bash
perl -0pi -e 's/var import_meta = \{\};/var import_meta = { url: require("url").pathToFileURL(__filename).href };/g' bundle/paper-search.cjs
```

Materialization shape:

```text
materialized/
  package.json
  bin/
    paper-search.cjs
```

`package.json` is needed because the CLI reads `../package.json` for
`--version`.

## Command Evidence

Version:

```bash
node materialized/bin/paper-search.cjs --version
# 0.3.4
```

Search:

```bash
node materialized/bin/paper-search.cjs search "1706.03762" --platform arxiv --max-results 1 --pretty
```

Result: `ok: true`, `Found 1 papers`, paper id `1706.03762v7`, title
`Attention Is All You Need`, source `arxiv`, year `2017`, PDF URL
`https://arxiv.org/pdf/1706.03762v7`.

Download:

```bash
node materialized/bin/paper-search.cjs download 1706.03762 --platform arxiv --save-path materialized/downloads --pretty
```

Result: `ok: true`, downloaded
`materialized/downloads/1706.03762.pdf`.

Downloaded PDF verification:

```bash
file materialized/downloads/1706.03762.pdf
# PDF document, version 1.5

shasum -a 256 materialized/downloads/1706.03762.pdf
# bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697
```

Journal metrics without key:

```bash
node materialized/bin/paper-search.cjs journal-metrics "Nature" --pretty
```

Result: failed with a structured missing-config diagnostic:
`EasyScholar API key not configured. Set EASYSCHOLAR_KEY with
paper-search setup EASYSCHOLAR_KEY.`

Journal metrics with a user-provided key in the CLI config file:

```bash
node out/main/paper-search-cli.cjs config get EASYSCHOLAR_KEY --pretty
node out/main/paper-search-cli.cjs journal-metrics "Nature" --pretty
```

Result on 2026-07-05: config returned `configured: true` with
`source: user_config`; the metrics query returned `ok: true`,
`Found journal metrics for 1/1 journal(s)`, `source: easyScholar`,
impact factor `56.1`, five-year impact factor `56.7`, JCR quartile
`Q1`, and CAS zone `1`.

## Notes For Implementation

- CDF packaging should not use ESM output for this package.
- The production build script should own the postprocess step instead of
  editing bundled output by hand.
- The Skill must keep Sci-Hub disabled even though `paper-search doctor`
  and status output list a Sci-Hub capability. CDF should call only the
  native, open-access, or institutionally authorized routes.
- `paper-search search "attention is all you need" --platform arxiv`
  returned zero results in both the original CLI and bundled CLI, while
  searching by arXiv id returned the expected paper. This is query behavior,
  not a bundling regression.
