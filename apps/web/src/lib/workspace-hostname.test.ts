import { describe, expect, it } from 'vitest';
import { resolveWorkspaceSlugFromHostname } from './workspace-hostname.js';

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
