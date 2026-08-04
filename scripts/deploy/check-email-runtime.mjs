#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const emailModulePath = path.resolve(process.cwd(), 'packages/email/dist/index.js');
const probeData = {
  tenantName: 'KS OS',
  tenantPrimaryColor: '#0f172a',
  staffName: 'Deployment check',
  message: 'Email renderer runtime check.',
};

async function renderProbe(cacheKey = 'initial') {
  const moduleUrl = `${pathToFileURL(emailModulePath).href}?runtime-check=${encodeURIComponent(cacheKey)}`;
  const { renderEmail } = await import(moduleUrl);
  const rendered = await renderEmail('staff-operational-notification', probeData);
  if (!rendered.html.includes(probeData.message) || !rendered.text.includes(probeData.message)) {
    throw new Error('EMAIL_RENDERER_OUTPUT_INVALID');
  }
}

try {
  await renderProbe();
  console.log('✓ Email renderer runtime dependency check passed');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const dependencyFailure = /Cannot find package ['\"]react-dom['\"]|ERR_MODULE_NOT_FOUND/i.test(message);
  if (!dependencyFailure) throw error;

  console.warn('Email renderer dependency tree is incomplete; forcing a frozen pnpm reinstall.');
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--force'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  execFileSync('pnpm', ['--filter', '@ks-os/email', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  await renderProbe(`repaired-${Date.now()}`);
  console.log('✓ Email renderer dependency tree repaired and verified');
}
