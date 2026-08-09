import { readFile } from 'node:fs/promises';
import { buildSiteComponentImplementationAudit } from '../../packages/site-generation/dist/index.js';

const designLibraryCss = await readFile(new URL('../../apps/sites/public/design-library.css', import.meta.url), 'utf8');
const report = buildSiteComponentImplementationAudit({ designLibraryCss });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.invalidRegistryCapabilityCount > 0) process.exitCode = 1;
