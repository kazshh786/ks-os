import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RESERVED_BOOKING_SLUGS, verifiedBookingPublicUrl } from '../src/modules/bookings/booking-page.utils.js';

test('verified custom domains produce clean HTTPS booking URLs', () => {
  assert.equal(verifiedBookingPublicUrl('book.clientbusiness.co.uk'), 'https://book.clientbusiness.co.uk/book');
  assert.equal(verifiedBookingPublicUrl('CLIENTBUSINESS.CO.UK', true), 'https://clientbusiness.co.uk/book?preview=1');
  assert.equal(verifiedBookingPublicUrl('clientbusiness.co.uk:8443'), null);
  assert.equal(verifiedBookingPublicUrl('localhost'), null);
  assert.equal(verifiedBookingPublicUrl('clientbusiness.co.uk.evil.example'), 'https://clientbusiness.co.uk.evil.example/book');
  assert.equal(RESERVED_BOOKING_SLUGS.has('custom-domain'), true);
});

test('booking responses prefer a custom URL only after verification', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/bookings/booking-page.service.ts'), 'utf8');
  assert.match(source, /page\.customDomainStatus === 'VERIFIED' && page\.customDomain/);
  assert.match(source, /verifiedBookingPublicUrl\(page\.customDomain\)/);
  assert.match(source, /publicUrl: verifiedPublicUrl \|\| bookingPublicUrl/);
  assert.match(source, /eq\(bookingPages\.customDomainStatus, 'VERIFIED'\)/);
  assert.match(source, /eq\(tenants\.lifecycleStatus, 'ACTIVE'\)/);
});

test('CORS authorisation reads active verified booking domains and preserves the forwarded host', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/plugins/security.ts'), 'utf8');
  assert.match(source, /lower\(\$\{bookingPages\.customDomain\}\)/);
  assert.match(source, /eq\(bookingPages\.customDomainStatus, 'VERIFIED'\)/);
  assert.match(source, /normaliseForwardedHostname\(request\.headers\['x-forwarded-host'\]\)/);
  assert.match(source, /request\.headers\.host = forwarded/);
});

test('custom-domain booking and payment pages use the hostname resolver', () => {
  const wizard = fs.readFileSync(path.resolve(process.cwd(), '../web/src/pages/BookingWizardPage.tsx'), 'utf8');
  const notFound = fs.readFileSync(path.resolve(process.cwd(), '../web/src/pages/NotFoundPage.tsx'), 'utf8');
  const success = fs.readFileSync(path.resolve(process.cwd(), '../web/src/pages/book/PaymentSuccess.tsx'), 'utf8');
  const cancel = fs.readFileSync(path.resolve(process.cwd(), '../web/src/pages/book/PaymentCancel.tsx'), 'utf8');

  assert.match(wizard, /currentPublicBookingIdentifier/);
  assert.match(notFound, /path === '\/book\/payment\/success'/);
  assert.match(notFound, /path === '\/book\/payment\/cancel'/);
  assert.match(success, /currentPublicBookingIdentifier/);
  assert.match(success, /bookings\/\$\{encodeURIComponent\(reference\)\}\/payment-status/);
  assert.match(cancel, /currentPublicBookingIdentifier/);
  assert.match(cancel, /bookings\/\$\{encodeURIComponent\(reference\)\}\/payment-session/);
});

test('Stripe returns paid bookings to the verified domain and keeps fallback tenant paths', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/integrations/stripe/stripe.service.ts'), 'utf8');
  assert.match(source, /page\?\.customDomainStatus !== 'VERIFIED'/);
  assert.match(source, /const bookingPath = customOrigin \? '\/book' : `\/book\/\$\{tenant\.subdomain\}`/);
  assert.match(source, /\$\{origin\}\$\{bookingPath\}\/payment\/success/);
  assert.match(source, /\$\{origin\}\$\{bookingPath\}\/payment\/cancel/);
});
