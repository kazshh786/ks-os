import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('VPS deployment treats API, worker and renderer as one health-checked rollback unit', async () => {
  const script = await read('scripts/deploy/deploy-vps.sh');
  for (const service of ['ks-os-api', 'ks-os-site-worker', 'ks-os-sites']) assert.match(script, new RegExp(service));
  assert.match(script, /8091\/ready/);
  assert.match(script, /5001\/health/);
  assert.match(script, /db:migrations:plan/);
  assert.match(script, /APPLY_MIGRATIONS/);
  assert.doesNotMatch(script, /reset --hard|eval /);
});

test('systemd units run as ksdeploy with production environment files and graceful restart policy', async () => {
  const [worker, sites] = await Promise.all([
    read('scripts/deploy/systemd/ks-os-site-worker.service'),
    read('scripts/deploy/systemd/ks-os-sites.service'),
  ]);
  for (const unit of [worker, sites]) {
    assert.match(unit, /User=ksdeploy/);
    assert.match(unit, /EnvironmentFile=\/srv\/ks-os\/\.env/);
    assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /NoNewPrivileges=true/);
  }
  assert.match(worker, /TimeoutStopSec=45/);
  assert.match(sites, /PORT=5001/);
});
