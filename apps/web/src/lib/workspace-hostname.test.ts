import { describe, expect, it } from 'vitest';
import {
  CUSTOM_DOMAIN_BOOKING_IDENTIFIER,
  resolvePublicBookingIdentifierFromHostname,
  resolveWorkspaceSlugFromHostname,
} from './workspace-hostname.js';

describe('resolveWorkspaceSlugFromHostname', () => {
  it('resolves a client workspace from the kasimshah.com wildcard', () => {
    expect(resolveWorkspaceSlugFromHostname('barebeautykieghley.kasimshah.com')).toBe('barebeautykieghley');
  });

  it('normalises ports and trailing dots', () => {
    expect(resolveWorkspaceSlugFromHostname('barebeautykieghley.kasimshah.com:443')).toBe('barebeautykieghley');
    expect(resolveWorkspaceSlugFromHostname('barebeautykieghley.kasimshah.com.')).toBe('barebeautykieghley');
  });

  it('rejects the apex, nested hosts and reserved platform labels', () => {
    expect(resolveWorkspaceSlugFromHostname('kasimshah.com')).toBeNull();
    expect(resolveWorkspaceSlugFromHostname('foo.bar.kasimshah.com')).toBeNull();
    expect(resolveWorkspaceSlugFromHostname('app.kasimshah.com')).toBeNull();
    expect(resolveWorkspaceSlugFromHostname('api.kasimshah.com')).toBeNull();
    expect(resolveWorkspaceSlugFromHostname('www.kasimshah.com')).toBeNull();
  });
});

describe('resolvePublicBookingIdentifierFromHostname', () => {
  it('keeps workspace subdomains on their real tenant slug', () => {
    expect(resolvePublicBookingIdentifierFromHostname('ks-agency.kasimshah.com')).toBe('ks-agency');
  });

  it('uses the internal resolver identifier for client-owned domains', () => {
    expect(resolvePublicBookingIdentifierFromHostname('book.clientbusiness.co.uk')).toBe(CUSTOM_DOMAIN_BOOKING_IDENTIFIER);
    expect(resolvePublicBookingIdentifierFromHostname('clientbusiness.co.uk')).toBe(CUSTOM_DOMAIN_BOOKING_IDENTIFIER);
  });

  it('does not treat KS OS system hosts or local development as custom domains', () => {
    expect(resolvePublicBookingIdentifierFromHostname('booking.kasimshah.com')).toBeNull();
    expect(resolvePublicBookingIdentifierFromHostname('app.kasimshah.com')).toBeNull();
    expect(resolvePublicBookingIdentifierFromHostname('localhost')).toBeNull();
  });
});
