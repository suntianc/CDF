import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(
  projectRoot,
  'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);
const destination = resolve(
  projectRoot,
  'src/renderer/public/excalidraw-assets/fonts',
);

await access(source);
await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
