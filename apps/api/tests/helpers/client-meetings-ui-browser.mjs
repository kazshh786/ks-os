import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Production meeting/guest React components, isolated API and SDK fixtures.
// Domain authorization and real LiveKit media are verified by separate suites.
export async function verifyClientMeetingUi() {
  const root = fileURLToPath(new URL('../../../../', import.meta.url)), webRoot = path.join(root, 'apps/web');
  const workerRequire = createRequire(path.join(root, 'apps/site-worker/package.json')), webRequire = createRequire(path.join(webRoot, 'package.json'));
  const { chromium } = workerRequire('playwright'), { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  const artifacts = path.join(root, 'artifacts/client-meetings'); await mkdir(artifacts, { recursive: true });
  const vite = await createServer({ root: webRoot, configFile: path.join(webRoot, 'vite.config.ts'), optimizeDeps: { entries: ['tests/fixtures/client-meetings-ui-entry.tsx'] }, resolve: { alias: [
    { find: 'livekit-client', replacement: path.join(webRoot, 'tests/fixtures/client-meetings-ui-sdk.ts') },
    { find: './meetings.api', replacement: path.join(webRoot, 'tests/fixtures/client-meetings-ui-api.ts') },
    { find: '../../auth/useAuth', replacement: path.join(webRoot, 'tests/fixtures/client-meetings-ui-auth.ts') },
    { find: '../../api/client', replacement: path.join(webRoot, 'tests/fixtures/chat-client.ts') },
  ] }, server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'isolated-client-meetings', configureServer(server) { server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith('/app/meetings') && !request.url?.startsWith('/meet')) return next();
    try { const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client meeting interface verification</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/client-meetings-ui-entry.tsx"></script></body></html>'); response.setHeader('Content-Type', 'text/html'); response.end(html); } catch (error) { next(error); }
  }); } }] });
  let browser, page; const errors = [], evidence = [];
  try {
    await vite.listen(); const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    const capture = async (name, selector = 'main') => {
      if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ path: workerRequire.resolve('axe-core/axe.min.js') });
      const region = page.locator(selector).first(); await region.waitFor();
      const result = await region.evaluate(async element => window.axe.run(element, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      assert.deepEqual(result.violations.map(value => ({ id: value.id, nodes: value.nodes.map(node => node.target) })), [], name + ' accessibility');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), name + ' has no horizontal overflow');
      await page.screenshot({ animations: 'disabled', fullPage: true, path: path.join(artifacts, name + '.png') }); evidence.push(name + ' passed layout and axe checks');
    };
    await page.goto(origin + '/app/meetings'); await page.getByRole('link', { name: 'Your quarterly accounts review', exact: true }).waitFor(); await capture('dashboard-desktop');
    await page.getByRole('link', { name: 'Create meeting', exact: true }).click(); await page.getByLabel('Title', { exact: true }).fill('Autumn accounts review');
    await page.getByLabel('Start date and time').fill('2027-10-31T01:30'); await page.getByLabel('This time occurs twice when the clocks change').selectOption('2027-10-31T01:30:00.000Z'); await page.getByLabel('Customer (optional)').selectOption('customer-one'); await capture('create-meeting-desktop');
    await page.getByRole('button', { name: 'Create meeting', exact: true }).click(); await page.getByRole('heading', { name: 'Autumn accounts review', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Admit', exact: true }).click(); await page.getByText('Alex Taylor has been admitted.').waitFor();
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click(); await page.getByLabel('Invitation link', { exact: true }).waitFor(); await capture('meeting-details-desktop');
    await page.setViewportSize({ width: 390, height: 844 }); await capture('meeting-details-mobile');
    await page.goto(origin + '/meet#invite=isolated-guest-invitation'); await page.getByLabel('Your name', { exact: true }).fill('Alex Taylor'); await capture('guest-landing-mobile');
    assert.equal(new URL(page.url()).hash, '', 'Invitation fragment is removed');
    assert.equal(await page.evaluate(() => window.clientMeetingsFixture.counts().guestJoins), 0, 'No guest media token before admission');
    await page.getByLabel('Preview camera', { exact: true }).check(); await page.getByLabel('Your camera preview', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Request to join', exact: true }).click(); await page.getByRole('heading', { name: 'You are in the waiting room', exact: true }).waitFor(); await capture('guest-waiting-mobile');
    await page.reload(); await page.getByRole('heading', { name: 'You are in the waiting room', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.clientMeetingsFixture.counts().guestJoins), 0, 'Refresh does not bypass admission');
    await page.evaluate(() => window.clientMeetingsFixture.guest('APPROVED', 'SCHEDULED')); await page.getByRole('heading', { name: 'You have been admitted', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Join call', exact: true }).count(), 0, 'Approved guests wait for the host to start');
    await page.evaluate(() => window.clientMeetingsFixture.guest('APPROVED', 'ACTIVE')); await page.getByRole('dialog', { name: 'Video call', exact: true }).getByRole('button', { name: 'Join call', exact: true }).waitFor();
    await capture('guest-prejoin-mobile', '.call-window:visible'); await page.getByRole('button', { name: 'Join call', exact: true }).click(); await page.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'End for everyone', exact: true }).count(), 0, 'Guest has no host controls'); assert.equal(await page.getByRole('button', { name: 'Share screen', exact: true }).count(), 0, 'Guest sharing follows business policy');
    await capture('guest-call-mobile', '.call-window:visible');
    await page.getByRole('button', { name: 'Participants', exact: true }).click(); await page.getByRole('region', { name: 'Call participants', exact: true }).getByText('Alex Taylor (you)', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Call participants', exact: true }).getByRole('button', { name: /Remove/ }).count(), 0, 'Guest participant panel has no moderator controls');
    await capture('guest-participants-mobile', '.call-window:visible'); await page.getByRole('button', { name: 'Participants', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 }); await capture('guest-call-desktop', '.call-window:visible');
    await page.evaluate(() => window.clientMeetingsFixture.guest('CANCELLED')); await page.getByRole('heading', { name: 'This meeting is closed', exact: true }).waitFor(); assert.equal(await page.getByText('Harbour Accounting', { exact: true }).count(), 0, 'Revocation purges private branding');
    await capture('guest-cancelled-desktop');
    assert.deepEqual(errors, [], 'No browser runtime errors'); evidence.push('Create, ambiguous DST choice, existing customer link, host admission, invitation copy fields, fragment cleanup, guest refresh recovery, no token before admission, native guest call, policy controls and revoked-session cleanup');
    await writeFile(path.join(artifacts, 'client-meetings-ui-verification.json'), JSON.stringify({ environment: 'GitHub Chromium production React UI with isolated API/SDK fixtures', evidence, limitations: ['UI fixtures do not prove server authorization or media delivery. Backend and real LiveKit integration suites cover those separately.'] }, null, 2));
  } catch (error) { await page?.screenshot({ animations: 'disabled', fullPage: true, path: path.join(artifacts, 'client-meetings-ui-failure.png') }).catch(() => {}); throw error; }
  finally { await browser?.close(); await vite.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyClientMeetingUi();
