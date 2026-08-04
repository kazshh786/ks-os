import { describe, expect, it } from 'vitest';
import { additionalCosts, packages, stackComparison } from './public-site-data';

describe('public package content', () => {
  it.each([
    ['essential', '4 professionally designed branded social-media posts per month'],
    ['growth', '8 professionally designed branded social-media posts per month'],
    ['scale', '12 professionally designed branded social-media posts per month'],
  ])('includes the correct monthly social allowance for %s', (packageId, allowance) => {
    const packageDefinition = packages.find(item => item.id === packageId);
    expect(packageDefinition?.monthlyIncludes).toContain(allowance);
  });

  it('keeps printing separate while including print-ready design work', () => {
    expect(additionalCosts).toContain('Business card or leaflet printing');
    expect(packages[0]?.launchIncludes).toContain('Print-ready artwork files');
  });

  it('shows printing and social content in the real-cost comparison', () => {
    expect(stackComparison.some(([feature]) => feature === 'Business card and leaflet printing')).toBe(true);
    expect(stackComparison.some(([feature]) => feature === 'Branded social-media content')).toBe(true);
  });
});
