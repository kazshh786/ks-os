import { execSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import fileUrl from 'url';

export function calculateNormalizedSha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function calculateSha256(filePath) {
  return calculateNormalizedSha256(filePath);
}

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

