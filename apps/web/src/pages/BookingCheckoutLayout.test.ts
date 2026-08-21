import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./BookingCheckoutLayout.css', import.meta.url), 'utf8');

describe('mobile booking checkout layout', () => {
  it('keeps the mobile action bar in document flow so it cannot cover form fields', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.booking-checkout-shell \.booking-step-actions \{[\s\S]*?position:\s*static;/);
  });

  it('stacks progress markers and narrow-screen actions instead of forcing horizontal overlap', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?nav\[aria-label='Booking progress'\][\s\S]*?flex-direction:\s*column;/);
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.booking-step-actions \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('lets service title and price reflow on narrow phones', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.booking-service-choice__top \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
