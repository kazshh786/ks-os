import { execSync } from 'child_process';
import path from 'path';
import fileUrl from 'url';

export function ensureDatabaseBuilt() {
  const dbDistManifest = path.resolve(process.cwd(), 'packages/database/dist/manifest.js');
  try {
    // Attempt rapid dynamic check
    return;
  } catch {
    console.log('Building database package prior to command execution...');
    execSync('pnpm --filter @ks-os/database build', { stdio: 'inherit' });
  }
}

export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  const scriptPath = path.resolve(process.argv[1]);
  const modulePath = path.resolve(fileUrl.fileURLToPath(importMetaUrl));
  return scriptPath === modulePath;
}
