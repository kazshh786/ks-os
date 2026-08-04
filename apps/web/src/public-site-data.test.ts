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

  it('groups the dense comparison into readable sections', () => {
    expect(stackComparison).toContainEqual(['Website and online presence', '', '']);
    expect(stackComparison).toContainEqual(['Customer operations', '', '']);
    expect(stackComparison).toContainEqual(['Growth and reputation', '', '']);
    expect(stackComparison).toContainEqual(['Creative and ongoing support', '', '']);
  });

  it('shows printing, Growth social content and a final first-year total', () => {
    expect(stackComparison.some(([feature]) => feature === 'Business card and leaflet printing')).toBe(true);
    expect(stackComparison.some(([feature]) => feature === '8 branded social-media posts')).toBe(true);
    expect(stackComparison.at(-1)).toEqual([
      'Typical first-year total',
      '£6,985–£34,900+ before printing and usage',
      'Growth: £2,661 in year one — £297 launch + £197/mo',
    ]);
  });
});
