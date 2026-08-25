import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BARE_BEAUTY_LEGACY_HOSTNAME,
  BARE_BEAUTY_PRIMARY_HOSTNAME,
  maybeHandleBareBeautyProductionDomain,
} from '../src/lib/bare-beauty-domain.js';

test('Bare Beauty production domain remaps to the legacy renderer host and rewrites canonical output', async () => {
  const request = new Request(`https://${BARE_BEAUTY_PRIMARY_HOSTNAME}/services/halal-brows`, {
    headers: { host: BARE_BEAUTY_PRIMARY_HOSTNAME },
  });

  const response = await maybeHandleBareBeautyProductionDomain(request, async remappedRequest => {
    assert.equal(new URL(remappedRequest.url).hostname, BARE_BEAUTY_LEGACY_HOSTNAME);
    assert.equal(remappedRequest.headers.get('host'), BARE_BEAUTY_LEGACY_HOSTNAME);
    assert.equal(remappedRequest.headers.get('x-forwarded-host'), BARE_BEAUTY_LEGACY_HOSTNAME);
    return new Response(`<link rel="canonical" href="https://${BARE_BEAUTY_LEGACY_HOSTNAME}/services/halal-brows">`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(BARE_BEAUTY_PRIMARY_HOSTNAME.replaceAll('.', '\\.')));
  assert.doesNotMatch(html, new RegExp(BARE_BEAUTY_LEGACY_HOSTNAME.replaceAll('.', '\\.')));
});

test('www Bare Beauty hostname redirects permanently to the apex domain', async () => {
  const response = await maybeHandleBareBeautyProductionDomain(
    new Request(`https://www.${BARE_BEAUTY_PRIMARY_HOSTNAME}/packages?from=www`, {
      headers: { host: `www.${BARE_BEAUTY_PRIMARY_HOSTNAME}` },
    }),
    async () => {
      throw new Error('handler must not run for www redirect');
    },
  );

  assert.ok(response);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), `https://${BARE_BEAUTY_PRIMARY_HOSTNAME}/packages?from=www`);
});

test('unrelated hostnames are ignored', async () => {
  let handled = false;
  const response = await maybeHandleBareBeautyProductionDomain(
    new Request('https://kasimshah.com/', { headers: { host: 'kasimshah.com' } }),
    async () => {
      handled = true;
      return new Response('unexpected');
    },
  );
  assert.equal(response, null);
  assert.equal(handled, false);
});
