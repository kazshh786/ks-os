import assert from 'node:assert/strict';
import test from 'node:test';
import type { SitesRuntimeConfig } from '../src/lib/config.js';
import {
  BARE_BEAUTY_HOSTNAME,
  isBareBeautyRequest,
  renderBareBeautyPath,
  serviceSlug,
  type BareBeautyLiveData,
} from '../src/lib/bare-beauty.js';

const config: SitesRuntimeConfig = {
  nodeEnv: 'test',
  fallbackDomain: 'kasimshah.com',
  publicBookingOrigin: 'https://app.kasimshah.com',
  noIndexHostnames: [],
  trustedProxy: false,
  releaseVersion: 'test',
};

const data: BareBeautyLiveData = {
  services: [
    {
      id: 'service-1',
      publicReference: '48378d4b-d9e9-4429-a8ca-42e75635638b',
      name: 'Full Halal Brows',
      description: 'Live treatment description',
      durationMinutes: 90,
      pricePence: 3000,
      category: 'Brows',
      sortOrder: 1,
    },
    {
      id: 'service-2',
      publicReference: '219312bf-8504-4275-a7f8-80bb00d9a093',
      name: 'Halal Brows & Korean Lash Lift',
      description: 'Live package description',
      durationMinutes: 130,
      pricePence: 5500,
      category: 'Package',
      sortOrder: 2,
    },
  ],
  openingHours: [
    { dayOfWeek: 0, startTime: '09:30:00', endTime: '20:00:00' },
    { dayOfWeek: 2, startTime: '17:00:00', endTime: '19:30:00' },
    { dayOfWeek: 4, startTime: '17:00:00', endTime: '19:30:00' },
  ],
  cancellationPolicy: 'A £10 deposit is required.\n24 hours notice applies.',
  consentAcknowledgement: 'I confirm that I consent to the booked treatment.',
};

test('Bare Beauty host is isolated to the requested hostname', () => {
  assert.equal(isBareBeautyRequest(new Request(`https://${BARE_BEAUTY_HOSTNAME}/`, { headers: { host: BARE_BEAUTY_HOSTNAME } }), config), true);
  assert.equal(isBareBeautyRequest(new Request('https://another.kasimshah.com/', { headers: { host: 'another.kasimshah.com' } }), config), false);
});

test('home renders live service data, live hours and booking-only CTAs', async () => {
  const response = renderBareBeautyPath({ data, config, pathname: '/' });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Full Halal Brows/);
  assert.match(html, /£30/);
  assert.match(html, /Tuesday<\/span><strong>5pm – 7:30pm/);
  assert.match(html, /https:\/\/app\.kasimshah\.com\/book\/barebeautykeighley/);
  const ctaHrefs = [...html.matchAll(/class="btn[^"]*"[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(ctaHrefs.length > 0);
  assert.ok(ctaHrefs.every(href => href === 'https://app.kasimshah.com/book/barebeautykeighley'));
});

test('service detail page keeps live price, duration and description', async () => {
  const service = data.services[0];
  assert.equal(serviceSlug(service), 'halal-brows');
  const response = renderBareBeautyPath({ data, config, pathname: '/services/halal-brows' });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Live treatment description/);
  assert.match(html, /1 hr 30 min/);
  assert.match(html, /£30/);
  assert.match(html, /Patch test required/);
});

test('terms and consent pages render the current backend legal copy', async () => {
  const terms = await renderBareBeautyPath({ data, config, pathname: '/terms-and-conditions' }).text();
  const consent = await renderBareBeautyPath({ data, config, pathname: '/consent' }).text();
  assert.match(terms, /A £10 deposit is required/);
  assert.match(terms, /24 hours notice applies/);
  assert.match(consent, /I confirm that I consent to the booked treatment/);
});

test('live text is HTML escaped', async () => {
  const unsafe: BareBeautyLiveData = {
    ...data,
    services: [{ ...data.services[0], name: '<script>alert(1)</script>' }],
  };
  const response = renderBareBeautyPath({ data: unsafe, config, pathname: '/services' });
  const html = await response.text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
