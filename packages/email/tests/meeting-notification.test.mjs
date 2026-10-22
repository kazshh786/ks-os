import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmail } from '../dist/index.js';

const data = { tenantName: 'North Clinic', meetingTitle: '<Consultation>', hostName: '<Host>', scheduleLabel: '15 January 2030, 10:00 – 11:00 (Europe/London)', expiresLabel: '16 January 2030', invitationUrl: 'https://meeting.business.co.uk/meet#invite=opaque-test', tenantPrimaryColor: '#fff200' };

test('meeting invitation renders accessible escaped business content and plain text', async () => {
  const output = await renderEmail('meeting-notification', data);
  assert.match(output.html, /<title>You are invited to a meeting<\/title>/);
  assert.match(output.html, /lang="en"/);
  assert.match(output.html, /dir="ltr"/);
  assert.match(output.html, /Open meeting invitation/);
  assert.doesNotMatch(output.html, /<Consultation>|<Host>/);
  assert.match(output.text, /waiting room/);
  assert.match(output.text, /Europe\/London/);
  assert.match(output.text, /KS OS/);
});

test('cancellation omits invitation URLs even if accidentally supplied', async () => {
  const output = await renderEmail('meeting-notification', { ...data, kind: 'cancelled' });
  assert.match(output.text, /cancelled/i);
  assert.doesNotMatch(output.text + output.html, /opaque-test|Open meeting invitation/);
});

test('meeting email rejects SVG and unsafe logos while retaining tenant name', async () => {
  for (const businessLogoUrl of ['javascript:alert(1)', 'https://assets.business.co.uk/logo.svg', 'data:image/svg+xml,unsafe']) {
    const output = await renderEmail('meeting-notification', { ...data, businessLogoUrl });
    assert.doesNotMatch(output.html, /logo\.svg|javascript:|data:image/);
    assert.match(output.text, /North Clinic/);
  }
});
