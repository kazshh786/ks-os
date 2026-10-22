import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Real Chromium -> self-hosted LiveKit -> Chromium media, with KSOS-issued credentials. */
export async function verifyMeetingMedia({ meetings, owner, member, conversationId }) {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const webRoot = path.join(root, 'apps/web');
  const workerRequire = createRequire(path.join(root, 'apps/site-worker/package.json'));
  const webRequire = createRequire(path.join(webRoot, 'package.json'));
  const { chromium } = workerRequire('playwright');
  const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  const artifacts = path.join(root, 'artifacts/meetings');
  await mkdir(artifacts, { recursive: true });
  const vite = await createServer({
    root: webRoot,
    configFile: false,
    optimizeDeps: { entries: ['tests/fixtures/meeting-media-entry.mjs'] },
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [{ name: 'isolated-livekit-test', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/media-test')) return next();
        try {
          const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>KSOS isolated media verification</title></head><body><h1>KSOS isolated media verification</h1><p id="status" role="status">disconnected</p><button id="share">Share test screen</button><p id="share-result" role="status"></p><div id="media"></div><script type="module" src="/tests/fixtures/meeting-media-entry.mjs"></script></body></html>');
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }],
  });
  let browser, meeting;
  const pages = [];
  const summary = { environment: 'isolated GitHub runner, loopback LiveKit, Chromium synthetic devices', evidence: [] };
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = await chromium.launch({
      headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--enable-usermedia-screen-capturing', '--autoplay-policy=no-user-gesture-required'],
    });
    const firstContext = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } });
    const secondContext = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } });
    const first = await firstContext.newPage(), second = await secondContext.newPage();
    pages.push(first, second);
    first.setDefaultTimeout(30000); second.setDefaultTimeout(30000);
    let signalSocket, signalConnections = 0;
    // Transparent pass-through to the real LiveKit server, used once to cut signalling.
    await first.routeWebSocket(/\/rtc\?/, socket => { socket.connectToServer(); signalSocket = socket; signalConnections++; });
    await Promise.all([first.goto(`${origin}/media-test`), second.goto(`${origin}/media-test`)]);
    await Promise.all([first.waitForFunction(() => Boolean(window.media)), second.waitForFunction(() => Boolean(window.media))]);
    meeting = await meetings.create(owner, conversationId, { type: 'VIDEO', requestId: crypto.randomUUID() });
    const firstJoin = await meetings.join(owner, meeting.id, crypto.randomUUID());
    const secondJoin = await meetings.join(member, meeting.id, crypto.randomUUID());
    assert.equal(await first.evaluate(data => window.media.connect(data), firstJoin), firstJoin.identity);
    assert.equal(await second.evaluate(data => window.media.connect(data), secondJoin), secondJoin.identity);
    await first.waitForFunction(identity => window.media.participants().includes(identity), secondJoin.identity);
    await second.waitForFunction(identity => window.media.participants().includes(identity), firstJoin.identity);
    summary.evidence.push('Two authenticated KSOS users connected with distinct server-issued identities');

    await Promise.all([first.evaluate(() => window.media.publish()), second.evaluate(() => window.media.publish())]);
    for (const page of [first, second]) await page.waitForFunction(async () => {
      const received = await window.media.received();
      return received.some(track => track.kind === 'audio' && track.bytesReceived > 0 && track.packetsReceived > 0)
        && received.some(track => track.source === 'camera' && track.framesDecoded > 0 && track.bytesReceived > 0);
    }, undefined, { timeout: 45000 });
    summary.evidence.push('Both directions received actual audio RTP and decoded camera video frames');
    await meetings.reconcile();
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    assert.equal(await first.evaluate(() => window.media.microphone(false)), false);
    assert.equal(await first.evaluate(() => window.media.microphone(true)), true);
    assert.equal(await first.evaluate(() => window.media.camera(false)), false);
    assert.equal(await first.evaluate(() => window.media.camera(true)), true);
    summary.evidence.push('Microphone and camera toggled through the official client');

    await first.getByRole('button', { name: 'Share test screen' }).click();
    await first.getByText('Screen sharing', { exact: true }).waitFor();
    await second.waitForFunction(async () => (await window.media.received()).some(track => track.source === 'screen_share' && track.framesDecoded > 0), undefined, { timeout: 45000 });
    await second.screenshot({ path: path.join(artifacts, 'livekit-screen-share.png') });
    await first.evaluate(() => window.media.stopScreen());
    await second.waitForFunction(async () => !(await window.media.received()).some(track => track.source === 'screen_share'));
    summary.evidence.push('Native Chromium screen capture published, decoded by the other user and stopped');

    assert.ok(signalSocket, 'The real signal connection was observed');
    const initialConnections = signalConnections;
    await signalSocket.close({ code: 1011, reason: 'Isolated test connection interruption' });
    await first.waitForFunction(() => window.media.events.includes('signal-reconnecting') || window.media.events.includes('reconnecting'), undefined, { timeout: 30000 });
    await first.waitForFunction(() => window.media.events.includes('reconnected') && window.media.state() === 'connected', undefined, { timeout: 45000 });
    assert.ok(signalConnections > initialConnections, 'LiveKit created a new real signal connection');
    await second.waitForFunction(identity => window.media.participants().filter(value => value === identity).length === 1, firstJoin.identity);
    summary.evidence.push('LiveKit recovered a deliberately interrupted real signalling connection without duplicate participant identity');

    const invalid = await secondContext.newPage();
    await invalid.goto(`${origin}/media-test`); await invalid.waitForFunction(() => Boolean(window.media));
    assert.equal(await invalid.evaluate(async data => {
      try { await window.media.connect(data); return false; } catch { return true; }
    }, { url: firstJoin.url, token: firstJoin.token.slice(0, -16) + 'invalidsignature' }), true);
    await invalid.close();
    summary.evidence.push('The actual LiveKit server rejected an invalidly signed token');

    await second.evaluate(() => window.media.disconnect());
    await meetings.leave(member, meeting.id, secondJoin.sessionId);
    await first.waitForFunction(() => window.media.participants().length === 0);
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ACTIVE');
    summary.evidence.push('One user left without terminating the other participant');
    const rejoin = await meetings.join(member, meeting.id, crypto.randomUUID());
    await second.evaluate(data => window.media.connect(data), rejoin);
    await first.waitForFunction(identity => window.media.participants().includes(identity), rejoin.identity);
    await meetings.end(owner, meeting.id);
    await Promise.all([first.waitForFunction(() => window.media.state() === 'disconnected'), second.waitForFunction(() => window.media.state() === 'disconnected')]);
    assert.equal((await meetings.get(owner, meeting.id)).status, 'ENDED');
    await assert.rejects(meetings.join(member, meeting.id, crypto.randomUUID()));
    summary.evidence.push('Authorized KSOS end action deleted the actual room and disconnected both browsers');
    assert.ok(JSON.parse(Buffer.from(rejoin.token.split('.')[1], 'base64url').toString()).exp > Date.now() / 1000, 'Replay must exercise an unexpired token');
    assert.equal(await second.evaluate(async data => {
      try { await window.media.connect(data); return false; } catch { return true; }
    }, rejoin), true);
    summary.evidence.push('An unexpired previously issued token could not recreate the ended room with auto_create disabled');
    summary.limitations = ['Loopback does not validate production TLS, firewall, NAT, TURN or VPS capacity.', 'Synthetic Chromium devices do not validate physical microphones, cameras, Safari, iOS or Android.'];
    await writeFile(path.join(artifacts, 'media-verification.json'), JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    for (let n = 0; n < pages.length; n++) await pages[n].screenshot({ path: path.join(artifacts, `media-failure-${n}.png`) }).catch(() => {});
    await writeFile(path.join(artifacts, 'media-verification.json'), JSON.stringify({ ...summary, failed: true }, null, 2));
    throw error;
  } finally {
    if (meeting) await meetings.end(owner, meeting.id).catch(() => {});
    await browser?.close();
    await vite.close();
  }
}
