import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Production portal and messaging components against the real disposable DB/HTTP/WebSocket engine. */
export async function verifyCustomerCollaborationBrowser({ apiOrigin, relationshipId, conversationId, customerToken, staffToken }) {
  assert.equal(new URL(apiOrigin).hostname, '127.0.0.1');
  const root = fileURLToPath(new URL('../../../../', import.meta.url)), webRoot = path.join(root, 'apps/web');
  const workerRequire = createRequire(path.join(root, 'apps/site-worker/package.json')), webRequire = createRequire(path.join(webRoot, 'package.json'));
  const { chromium } = workerRequire('playwright'), { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  const artifacts = path.join(root, 'artifacts/customer-collaboration'); await mkdir(artifacts, { recursive: true });
  const vite = await createServer({ root: webRoot, configFile: path.join(webRoot, 'vite.config.ts'), optimizeDeps: { entries: ['tests/fixtures/customer-collaboration-entry.tsx'] }, resolve: { alias: [
    { find: '../../api/client', replacement: path.join(webRoot, 'tests/fixtures/chat-client.ts') },
    { find: '../../lib/supabase', replacement: path.join(webRoot, 'tests/fixtures/customer-collaboration-auth.ts') },
  ] }, server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': { target: apiOrigin, changeOrigin: true, ws: true } } }, plugins: [{ name: 'customer-portal-browser-fixture', configureServer(server) { server.middlewares.use(async (request, response, next) => {
    if (!request.url?.startsWith('/customer/')) return next();
    try { const html = await server.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client collaboration verification</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/customer-collaboration-entry.tsx"></script></body></html>'); response.setHeader('Content-Type', 'text/html'); response.end(html); } catch (error) { next(error); }
  }); } }] });
  let browser, page; const errors = [], forbidden = [], evidence = [];
  const staffPost = async (suffix, body) => { const response = await fetch(apiOrigin + '/api/v1/communications/conversations/' + conversationId + suffix, { method: 'POST', headers: { authorization: 'Bearer ' + staffToken, 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.ok(response.ok, 'Staff fixture request ' + suffix + ': ' + response.status); return response.json(); };
  try {
    await vite.listen(); const origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
    browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { authorization: 'Bearer ' + customerToken } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/customer/')) forbidden.push(url.pathname); return url.hostname === '127.0.0.1' ? route.continue() : route.abort(); });
    page = await context.newPage(); page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
    const capture = async (name, selector = '.client-portal') => {
      if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ path: workerRequire.resolve('axe-core/axe.min.js') });
      const result = await page.locator(selector).first().evaluate(async element => window.axe.run(element, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      assert.deepEqual(result.violations.map(value => ({ id: value.id, nodes: value.nodes.map(node => node.target) })), [], name + ' accessibility');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' no horizontal overflow');
      await page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true, animations: 'disabled' }); evidence.push(name + ' layout and accessibility');
    };
    const portal = origin + '/customer/collaboration/' + relationshipId;
    await page.goto(portal + '/messages/' + conversationId); const composer = page.getByRole('combobox', { name: /^Message / }); await composer.waitFor();
    const incoming = 'Browser staff update ' + Date.now(); await staffPost('/messages', { body: incoming, clientMessageId: crypto.randomUUID(), mentions: [] }); await page.getByRole('region', { name: 'Channel messages', exact: true }).getByText(incoming, { exact: true }).waitFor();
    const outgoing = 'Customer browser reply ' + Date.now(); await composer.fill(outgoing); await composer.press('Enter'); await page.getByRole('region', { name: 'Channel messages', exact: true }).getByText(outgoing, { exact: true }).waitFor();
    const persisted = await fetch(apiOrigin + '/api/v1/communications/conversations/' + conversationId + '/messages', { headers: { authorization: 'Bearer ' + staffToken } }); const messages = await persisted.json(); assert.ok(messages.data.some(value => value.body === outgoing && value.senderId === relationshipId), 'Customer message persisted with the relationship principal and is visible to staff');
    const article = page.getByRole('article').filter({ hasText: incoming }); await article.hover(); await article.getByRole('button', { name: 'Add reaction', exact: true }).click(); await article.getByRole('button', { name: 'React 👍', exact: true }).click(); await article.getByRole('button', { name: /👍, / }).waitFor();
    await article.getByRole('button', { name: 'Reply in thread', exact: true }).click(); await page.getByRole('combobox', { name: 'Reply to thread' }).fill('Customer threaded response'); await page.getByRole('combobox', { name: 'Reply to thread' }).press('Enter'); await page.getByRole('region', { name: 'Thread replies' }).getByText('Customer threaded response', { exact: true }).waitFor(); await capture('client-thread-desktop'); await page.getByRole('button', { name: 'Close thread' }).click();
    await capture('client-messages-desktop'); await page.reload(); await page.getByRole('region', { name: 'Channel messages', exact: true }).getByText(outgoing, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Search messages', exact: true }).click(); const search = page.getByRole('dialog', { name: 'Search messages', exact: true }); await search.getByLabel('Search text', { exact: true }).fill('Browser staff update'); await search.getByRole('combobox', { name: /^Conversation/ }).selectOption(conversationId); await search.getByRole('button', { name: 'Search', exact: true }).click(); await search.locator('.chat-search-results li').first().waitFor(); await capture('client-search-desktop', '.chat-modal'); await search.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('link', { name: 'Files', exact: true }).click(); await page.getByRole('combobox', { name: /^Conversation/ }).selectOption(conversationId); await page.getByRole('heading', { name: 'Shared files', exact: true }).last().waitFor(); await capture('client-files-desktop');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).first().click()]); assert.equal(download.suggestedFilename(), 'document.txt', 'Customer downloads only the authorised shared file through authenticated content API');
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('link', { name: 'Messages', exact: true }).click(); await page.getByRole('link', { name: /./ }).filter({ has: page.locator('strong') }).first().waitFor(); await capture('client-conversations-mobile');
    await page.goto(portal + '/messages/' + conversationId); await page.getByRole('combobox', { name: /^Message / }).waitFor(); await capture('client-messages-mobile');
    await page.getByRole('link', { name: 'Account', exact: true }).click(); await page.getByRole('heading', { name: 'Your account' }).waitFor(); await capture('client-account-mobile');
    for (const label of ['Pipeline', 'Reports', 'Staff directory', 'Settings', 'Clients', 'Bookings']) assert.equal(await page.getByRole('link', { name: label, exact: true }).count(), 0, 'No staff navigation: ' + label);
    assert.deepEqual(forbidden, [], 'Customer UI made no internal or public-guest API calls'); assert.deepEqual(errors, [], 'No browser runtime errors');
    evidence.push('Real staff-to-customer WebSocket delivery, customer-to-staff persisted message, thread, reaction, refresh history, scoped files and customer navigation');
    await writeFile(path.join(artifacts, 'customer-collaboration-browser-verification.json'), JSON.stringify({ environment: 'GitHub Chromium production React UI with real disposable PostgreSQL/HTTP/WebSocket messaging', evidence }, null, 2));
  } catch (error) { await page?.screenshot({ path: path.join(artifacts, 'customer-collaboration-browser-failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {}); throw error; }
  finally { await browser?.close(); await vite.close(); }
}
