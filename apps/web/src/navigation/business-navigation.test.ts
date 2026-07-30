import { describe, expect, it } from 'vitest';
import { businessNavigation } from './business-navigation.js';

describe('business navigation', () => {
  it('keeps walk-in creation in the calendar and policies in the booking page', () => {
    const items = businessNavigation.flatMap(group => group.items);
    expect(items.map(item => item.label)).not.toContain('Walk-in Desk');
    expect(items.map(item => item.label)).not.toContain('Booking Policies');
    expect(items.find(item => item.id === 'booking-page')?.activePrefixes).toContain('/app/settings/booking/customer-management');
  });
});
