import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./BookingMobileRefinement.css', import.meta.url), 'utf8');

describe('mobile booking refinement', () => {
  it('removes duplicate mobile header and summary chrome', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.booking-workspace-header,[\s\S]*?\.booking-summary-column \{[\s\S]*?display:\s*none;/);
  });

  it('uses progress as the sticky mobile header', () => {
    expect(css).toMatch(/nav\[aria-label='Booking progress'\] \{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
  });

  it('keeps the mobile action area fixed to the viewport bottom', () => {
    expect(css).toMatch(/\.booking-step-actions \{[\s\S]*?position:\s*fixed !important;[\s\S]*?bottom:\s*0 !important;[\s\S]*?safe-area-inset-bottom/);
    expect(css).toMatch(/\.booking-step-column \{[\s\S]*?padding-bottom:[^;]*safe-area-inset-bottom/);
  });

  it('turns review details into glanceable cards on mobile', () => {
    expect(css).toMatch(/\.booking-step-content > dl \{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.booking-step-content > dl > div \{[\s\S]*?border-radius:\s*1rem;/);
    expect(css).toMatch(/\.booking-step-content > dl > div:last-child \{[\s\S]*?background:\s*var\(--booking-primary-soft\);/);
  });
});
