import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'out', 'main');
const outFile = path.join(outDir, 'paper-search-cli.cjs');
const outPackageFile = path.join(outDir, 'paper-search-cli.package.json');
const packageJsonPath = require.resolve('paper-search-cli/package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const packageDir = path.dirname(packageJsonPath);
const binEntry = packageJson.bin?.['paper-search'];

if (typeof binEntry !== 'string' || binEntry.length === 0) {
  throw new Error('paper-search-cli package does not expose a paper-search bin entry.');
}

const entry = path.join(packageDir, binEntry);
const esbuildBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild',
);

fs.mkdirSync(outDir, { recursive: true });
execFileSync(esbuildBin, [
  entry,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${outFile}`,
  '--external:readline/promises',
], {
  cwd: rootDir,
  stdio: 'inherit',
});

const bundled = fs.readFileSync(outFile, 'utf-8');
const patched = bundled.replace(
  'var import_meta = {};',
  'var import_meta = { url: require("url").pathToFileURL(__filename).href };',
);
if (patched === bundled) {
  throw new Error('paper-search-cli bundle did not contain the expected import_meta placeholder.');
}
fs.writeFileSync(outFile, patched, 'utf-8');
fs.copyFileSync(packageJsonPath, outPackageFile);

console.log(`Built ${path.relative(rootDir, outFile)} from paper-search-cli@${packageJson.version}`);
