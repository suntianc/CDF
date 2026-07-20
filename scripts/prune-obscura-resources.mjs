import fs from 'node:fs';
import path from 'node:path';

// builder-util Arch enum: ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
]);

function archName(arch) {
  if (typeof arch === 'string') return arch;
  return ARCH_NAMES.get(arch) ?? String(arch);
}

function obscuraResourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const productName = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources', 'obscura');
  }
  return path.join(context.appOutDir, 'resources', 'obscura');
}

function bundledPlatformDir(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  return null;
}

export default async function pruneObscuraResources(context) {
  const obscuraDir = obscuraResourcesDir(context);
  if (!fs.existsSync(obscuraDir)) return;

  const targetDir = bundledPlatformDir(context.electronPlatformName, archName(context.arch));
  for (const entry of fs.readdirSync(obscuraDir)) {
    if (entry === 'VERSION.md' || entry === targetDir) continue;
    fs.rmSync(path.join(obscuraDir, entry), { recursive: true, force: true });
  }
}
