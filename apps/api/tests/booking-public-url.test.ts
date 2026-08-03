import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingPublicUrl } from '../src/modules/bookings/booking-page.utils.js';

test('production booking links use the workspace hostname', () => {
  const previous = process.env.PUBLIC_WORKSPACE_DOMAIN;
  delete process.env.PUBLIC_WORKSPACE_DOMAIN;
  try {
    assert.equal(
      bookingPublicUrl('https://app.kasimshah.com', 'barebeautykieghley'),
      'https://barebeautykieghley.kasimshah.com/book',
    );
    assert.equal(
      bookingPublicUrl('https://app.kasimshah.com', 'barebeautykieghley', true),
      'https://barebeautykieghley.kasimshah.com/book?preview=1',
    );
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_WORKSPACE_DOMAIN;
    else process.env.PUBLIC_WORKSPACE_DOMAIN = previous;
  }
});

test('local development retains the legacy path-based address', () => {
  const previous = process.env.PUBLIC_WORKSPACE_DOMAIN;
  delete process.env.PUBLIC_WORKSPACE_DOMAIN;
  try {
    assert.equal(
      bookingPublicUrl('http://localhost:3000', 'barebeautykieghley'),
      'http://localhost:3000/book/barebeautykieghley',
    );
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_WORKSPACE_DOMAIN;
    else process.env.PUBLIC_WORKSPACE_DOMAIN = previous;
  }
});
