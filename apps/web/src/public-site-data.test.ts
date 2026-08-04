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

  it('uses single top-end prices instead of ranges', () => {
    const pricedRows = stackComparison.filter(([, separatePrice]) => separatePrice);
    expect(pricedRows.every(([, separatePrice]) => !separatePrice.includes('–'))).toBe(true);
    expect(stackComparison).toContainEqual(['Website design and build', '£3,000+ one-off', 'Included in the Growth launch package']);
    expect(stackComparison).toContainEqual(['8 branded social-media posts', '£500+/mo', 'Included in Growth']);
  });

  it('ends with a monthly total beside the Growth monthly price', () => {
    expect(stackComparison.at(-1)).toEqual([
      'Total monthly cost',
      '£2,625+/mo before printing, usage and extra licences',
      'KS OS Growth: £197/mo',
    ]);
  });
});
