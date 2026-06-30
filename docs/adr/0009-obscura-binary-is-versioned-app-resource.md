# Obscura binary is a versioned app resource

CDF will bundle fixed-version Obscura platform binaries under application resources instead of downloading the latest release during build or runtime. This preserves the local-first distribution model, keeps `pnpm run build` reproducible without network access, and lets the runtime resolve the correct Obscura executable from `process.platform` and `process.arch`.
