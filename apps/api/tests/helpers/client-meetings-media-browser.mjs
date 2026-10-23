import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Six real browsers, three room grants and two independent organisation fixtures. */
export async function verifyClientMeetingMedia({ cases, provider, reconcile, removeGuest, revokeInvitation, freshGuestJoin, end, artifactDirectory = 'client-meetings', accessLabel = 'Invitation' }) {
  assert.equal(cases.length, 3);
  assert.equal(new Set(cases.map(item => item.tenantId)).size, 2);
  assert.equal(cases[0].tenantId, cases[1].tenantId);
  assert.notEqual(cases[0].tenantId, cases[2].tenantId);
  assert.equal(new Set(cases.map(item => item.room)).size, 3);
  for (const item of cases) for (const connection of [item.host, item.guest]) {
    assert.equal(connection.url, 'ws://127.0.0.1:7880');
    assert.equal(JSON.parse(Buffer.from(connection.token.split('.')[1], 'base64url')).video.room, item.room);
  }
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const webRoot = path.join(root, 'apps/web');
  const workerRequire = createRequire(path.join(root, 'apps/site-worker/package.json'));
  const webRequire = createRequire(path.join(webRoot, 'package.json'));
  const { chromium } = workerRequire('playwright');
  const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  assert.ok(['client-meetings', 'customer-collaboration-media'].includes(artifactDirectory));
  const artifacts = path.join(root, 'artifacts', artifactDirectory);
  await mkdir(artifacts, { recursive: true });
  const vite = await createServer({
    root: webRoot, configFile: false,
    optimizeDeps: { entries: ['tests/fixtures/meeting-media-entry.mjs'] },
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [{ name: 'isolated-client-meetings', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/client-media-test')) return next();
        try {
          const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>KSOS multi-tenant media verification</title></head><body><h1>KSOS multi-tenant media verification</h1><p id="status" role="status">disconnected</p><button id="share">Share test screen</button><p id="share-result" role="status"></p><div id="media"></div><script type="module" src="/tests/fixtures/meeting-media-entry.mjs"></script></body></html>');
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }],
  });
  let browser;
  const pages = [];
  const evidence = [];
  const summary = {
    environment: 'GitHub runner, loopback self-hosted LiveKit, six Chromium browsers with synthetic devices',
    organisationCount: 2, simultaneousRoomCount: 3, evidence,
    limitations: ['Does not verify production DNS, TLS, NAT, TURN, VPS capacity or physical devices.', 'Chromium testing does not establish Safari, iOS or Android compatibility.', 'Self-hosted participant removal does not cryptographically revoke already issued JWTs. Fresh token refusal and reconciliation are tested separately.'],
  };
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--enable-usermedia-screen-capturing', '--autoplay-policy=no-user-gesture-required'] });
    for (const item of cases) {
      item.pages = [];
      for (const connection of [item.host, item.guest]) {
        const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1000, height: 760 } });
        const page = await context.newPage();
        page.setDefaultTimeout(30000); pages.push(page); item.pages.push(page);
        await page.goto(`${origin}/client-media-test`);
        await page.waitForFunction(() => Boolean(window.media));
        assert.equal(await page.evaluate(data => window.media.connect(data), connection), connection.identity);
        await page.evaluate(() => window.media.publish());
      }
    }
    for (const item of cases) {
      for (let index = 0; index < 2; index++) {
        const peer = index === 0 ? item.guest.identity : item.host.identity;
        const page = item.pages[index];
        await page.waitForFunction(async peer => {
          const tracks = await window.media.received();
          return tracks.some(track => track.identity === peer && track.kind === 'audio' && track.bytesReceived > 0 && track.packetsReceived > 0)
            && tracks.some(track => track.identity === peer && track.source === 'camera' && track.framesDecoded > 0);
        }, peer, { timeout: 60000 });
        assert.deepEqual(await page.evaluate(() => window.media.participants()), [peer], 'No participant from another meeting may be visible');
      }
      assert.deepEqual((await provider.participants(item.room)).map(value => value.identity).sort(), [item.host.identity, item.guest.identity].sort());
    }
    await reconcile();
    evidence.push('Three simultaneous rooms across two organisations received actual audio RTP and decoded video in both directions');
    evidence.push('Every browser and provider room contained only its own host and guest, including two rooms owned by the same organisation');

    // The first meeting forbids guest screen sharing; the second explicitly permits it.
    await cases[0].pages[1].getByRole('button', { name: 'Share test screen' }).click();
    await cases[0].pages[1].getByText(/^Screen sharing failed:/).waitFor();
    assert.equal((await cases[0].pages[0].evaluate(() => window.media.received())).some(track => track.source === 'screen_share'), false);
    await cases[1].pages[1].getByRole('button', { name: 'Share test screen' }).click();
    await cases[1].pages[1].getByText('Screen sharing', { exact: true }).waitFor();
    await cases[1].pages[0].waitForFunction(async () => (await window.media.received()).some(track => track.source === 'screen_share' && track.framesDecoded > 0), undefined, { timeout: 45000 });
    for (const item of [cases[0], cases[2]]) for (const page of item.pages) assert.equal((await page.evaluate(() => window.media.received())).some(track => track.source === 'screen_share'), false);
    await cases[1].pages[0].screenshot({ path: path.join(artifacts, 'isolated-guest-screen-share.png') });
    await cases[1].pages[1].evaluate(() => window.media.stopScreen());
    evidence.push('Server-issued guest permissions blocked disallowed screen sharing, and an authorised screen share stayed inside its own room');

    await removeGuest(cases[0]);
    await cases[0].pages[1].waitForFunction(() => window.media.state() === 'disconnected');
    await cases[0].pages[0].waitForFunction(() => window.media.participants().length === 0);
    await assert.rejects(freshGuestJoin(cases[0]));
    for (const item of [cases[1], cases[2]]) for (const page of item.pages) assert.equal(await page.evaluate(() => window.media.state()), 'connected');
    evidence.push('Host removal disconnected the intended guest and denied fresh credentials without affecting either other room');

    await revokeInvitation(cases[1]);
    await cases[1].pages[1].waitForFunction(() => window.media.state() === 'disconnected');
    await assert.rejects(freshGuestJoin(cases[1]));
    for (const page of cases[2].pages) assert.equal(await page.evaluate(() => window.media.state()), 'connected');
    evidence.push(`${accessLabel} revocation removed its admitted guest while the other organisation remained connected`);

    await end(cases[0]);
    await cases[0].pages[0].waitForFunction(() => window.media.state() === 'disconnected');
    assert.equal(await cases[1].pages[0].evaluate(() => window.media.state()), 'connected');
    for (const page of cases[2].pages) assert.equal(await page.evaluate(() => window.media.state()), 'connected');
    const rooms = await provider.rooms();
    assert.ok(!rooms.some(room => room.name === cases[0].room));
    for (const item of [cases[1], cases[2]]) assert.ok(rooms.some(room => room.name === item.room));
    evidence.push('Ending one meeting deleted only its room and preserved both another meeting in the same organisation and the other organisation');
    await writeFile(path.join(artifacts, 'multi-tenant-media-verification.json'), JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    for (let n = 0; n < pages.length; n++) await pages[n].screenshot({ path: path.join(artifacts, `media-failure-${n}.png`) }).catch(() => {});
    await writeFile(path.join(artifacts, 'multi-tenant-media-verification.json'), JSON.stringify({ ...summary, failed: true }, null, 2));
    throw error;
  } finally {
    for (const item of cases) await end(item).catch(() => {});
    await browser?.close(); await vite.close();
  }
}
