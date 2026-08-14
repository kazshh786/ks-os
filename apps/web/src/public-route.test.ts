import { describe, expect, it } from 'vitest';
import { isPublicSitePath, normalisePublicPath } from './public-route';

describe('public site route classification', () => {
  it.each(['/', '/about', '/about/', '/packages', '/packages/', '/services', '/services/', '/services/booking-and-crm'])(
    'loads %s through the single public site entry',
    path => {
      expect(isPublicSitePath(path)).toBe(true);
    },
  );

  it.each(['/login', '/dashboard', '/customer/login', '/api/health'])('keeps %s in the application entry', path => {
    expect(isPublicSitePath(path)).toBe(false);
  });

  it('normalises trailing slashes without changing the root path', () => {
    expect(normalisePublicPath('/packages///')).toBe('/packages');
    expect(normalisePublicPath('/')).toBe('/');
  });
});
