import { describe, expect, it } from 'vitest';
import {
  bookingStatusDisplay,
  calendarRange,
  localDayKey,
  localTime,
  moveCalendarAnchor,
} from './booking-display';

describe('booking calendar display helpers', () => {
  const anchor = new Date('2026-07-22T12:00:00.000Z');

  it('uses Monday through Friday for work-week view', () => {
    const range = calendarRange(anchor, 'work-week');
    expect(range.from.getDay()).toBe(1);
    expect(range.to.getDay()).toBe(5);
  });

  it('pads the month to complete calendar weeks', () => {
    const range = calendarRange(anchor, 'month');
    expect(range.from.getDay()).toBe(1);
    expect(range.to.getDay()).toBe(0);
    expect(range.from.getTime()).toBeLessThan(new Date('2026-07-01T12:00:00.000Z').getTime());
    expect(range.to.getTime()).toBeGreaterThan(new Date('2026-07-31T12:00:00.000Z').getTime());
  });

  it('moves calendar anchors in view-sized increments', () => {
    expect(moveCalendarAnchor(anchor, 'day', 1).getDate()).toBe(23);
    expect(moveCalendarAnchor(anchor, 'week', -1).getDate()).toBe(15);
    expect(moveCalendarAnchor(anchor, 'month', 1).getMonth()).toBe(7);
  });

  it('provides text and symbols so status is not colour-only', () => {
    expect(bookingStatusDisplay.NO_SHOW.label).toBe('No-show');
    expect(bookingStatusDisplay.NO_SHOW.symbol).toBeTruthy();
    expect(bookingStatusDisplay.AWAITING_PAYMENT.label).toBe('Awaiting payment');
  });

  it('formats booking date and time in the business timezone', () => {
    expect(localDayKey('2026-07-22T23:30:00.000Z', 'Europe/London')).toBe('2026-07-23');
    expect(localTime('2026-07-22T09:30:00.000Z', 'Europe/London')).toBe('10:30');
  });
});
