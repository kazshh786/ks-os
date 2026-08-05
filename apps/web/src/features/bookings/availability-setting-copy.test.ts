import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('availability setting placement', () => {
  it('keeps the past-closing option in the availability modal and out of customer policies', () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const availability = readFileSync(`${directory}/CalendarAvailabilityDialog.tsx`, 'utf8');
    const customerPolicies = readFileSync(`${directory}/../../pages/settings/CustomerBookingManagementSettings.tsx`, 'utf8');

    expect(availability).toContain('Allow appointments to finish after closing time');
    expect(customerPolicies).not.toContain('Allow appointments to finish after closing time');
  });
});
