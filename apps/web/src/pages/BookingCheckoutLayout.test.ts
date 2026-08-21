import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./BookingCheckoutLayout.css', import.meta.url), 'utf8');

describe('mobile booking checkout layout', () => {
  it('anchors the mobile action bar to the bottom of the viewport without removing it from layout flow', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.booking-checkout-shell \.booking-workspace \{[\s\S]*?min-height:\s*100dvh;/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.booking-checkout-shell \.booking-step-content \{[\s\S]*?flex-direction:\s*column;/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.booking-checkout-shell \.booking-step-actions \{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;[\s\S]*?margin-top:\s*auto;/);
  });

  it('stacks progress markers and narrow-screen actions instead of forcing horizontal overlap', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?nav\[aria-label='Booking progress'\][\s\S]*?flex-direction:\s*column;/);
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.booking-step-actions \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('keeps safe-area padding on the bottom-docked mobile action bar', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.booking-step-actions \{[\s\S]*?safe-area-inset-bottom/);
  });

  it('lets service title and price reflow on narrow phones', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.booking-service-choice__top \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
