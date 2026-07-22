import { describe, it, expect } from 'vitest';
import { 
  canCreateBooking, 
  canCancelBooking, 
  canRescheduleBooking, 
  canUpdateBookingStatus,
  BookingAuthContext,
  BookingResource
} from '../booking.policies.js';

describe('Booking Policies', () => {
  const ownerAuth: BookingAuthContext = { authUserId: 'user-owner', tenantId: 'tenant-1', role: 'owner' };
  const staffAuth: BookingAuthContext = { authUserId: 'user-staff', tenantId: 'tenant-1', role: 'staff' };
  const otherStaffAuth: BookingAuthContext = { authUserId: 'user-staff-2', tenantId: 'tenant-1', role: 'staff' };
  const otherTenantAuth: BookingAuthContext = { authUserId: 'user-owner-2', tenantId: 'tenant-2', role: 'owner' };

  describe('canCreateBooking', () => {
    it('allows owner to create booking', () => {
      expect(canCreateBooking(ownerAuth)).toBe(true);
    });

    it('allows staff to create booking', () => {
      expect(canCreateBooking(staffAuth)).toBe(true);
    });
  });

  describe('canCancelBooking', () => {
    const booking: BookingResource = { tenantId: 'tenant-1', staffId: 'user-staff', status: 'PENDING' };

    it('allows owner to cancel any tenant booking', () => {
      expect(canCancelBooking(ownerAuth, booking)).toBe(true);
    });

    it('prevents owner from cancelling another tenant booking', () => {
      expect(canCancelBooking(otherTenantAuth, booking)).toBe(false);
    });

    it('allows assigned staff to cancel', () => {
      expect(canCancelBooking(staffAuth, booking)).toBe(true);
    });

    it('prevents unassigned staff from cancelling', () => {
      expect(canCancelBooking(otherStaffAuth, booking)).toBe(false);
    });

    it('prevents cancellation if already cancelled or completed', () => {
      expect(canCancelBooking(ownerAuth, { ...booking, status: 'CANCELLED' })).toBe(false);
      expect(canCancelBooking(ownerAuth, { ...booking, status: 'COMPLETED' })).toBe(false);
    });
  });

  describe('canRescheduleBooking', () => {
    const booking: BookingResource = { tenantId: 'tenant-1', staffId: 'user-staff', status: 'PENDING' };

    it('allows owner to reschedule any tenant booking', () => {
      expect(canRescheduleBooking(ownerAuth, booking)).toBe(true);
    });

    it('allows assigned staff to reschedule', () => {
      expect(canRescheduleBooking(staffAuth, booking)).toBe(true);
    });

    it('prevents unassigned staff from rescheduling', () => {
      expect(canRescheduleBooking(otherStaffAuth, booking)).toBe(false);
    });

    it('prevents rescheduling if cancelled, completed, or no-show', () => {
      expect(canRescheduleBooking(ownerAuth, { ...booking, status: 'CANCELLED' })).toBe(false);
      expect(canRescheduleBooking(ownerAuth, { ...booking, status: 'COMPLETED' })).toBe(false);
      expect(canRescheduleBooking(ownerAuth, { ...booking, status: 'NO_SHOW' })).toBe(false);
    });
  });

  describe('canUpdateBookingStatus', () => {
    const booking: BookingResource = { tenantId: 'tenant-1', staffId: 'user-staff', status: 'PENDING' };

    it('allows owner to perform valid transitions', () => {
      expect(canUpdateBookingStatus(ownerAuth, booking, 'CONFIRMED')).toBe(true);
    });

    it('prevents owner from performing invalid transitions', () => {
      expect(canUpdateBookingStatus(ownerAuth, booking, 'CHECKED_IN')).toBe(false); // PENDING -> CHECKED_IN is invalid
    });

    it('allows assigned staff to perform valid transitions', () => {
      expect(canUpdateBookingStatus(staffAuth, booking, 'CONFIRMED')).toBe(true);
    });

    it('prevents unassigned staff from updating status', () => {
      expect(canUpdateBookingStatus(otherStaffAuth, booking, 'CONFIRMED')).toBe(false);
    });

    it('prevents reopening cancelled or completed bookings', () => {
      expect(canUpdateBookingStatus(ownerAuth, { ...booking, status: 'CANCELLED' }, 'CONFIRMED')).toBe(false);
      expect(canUpdateBookingStatus(ownerAuth, { ...booking, status: 'COMPLETED' }, 'CONFIRMED')).toBe(false);
    });

    it('allows valid state flow: PENDING -> CONFIRMED -> CHECKED_IN -> IN_SERVICE -> AWAITING_PAYMENT -> COMPLETED', () => {
      let b = { ...booking, status: 'PENDING' };
      expect(canUpdateBookingStatus(ownerAuth, b, 'CONFIRMED')).toBe(true);
      
      b.status = 'CONFIRMED';
      expect(canUpdateBookingStatus(ownerAuth, b, 'CHECKED_IN')).toBe(true);
      expect(canUpdateBookingStatus(ownerAuth, b, 'NO_SHOW')).toBe(true); // CONFIRMED -> NO_SHOW is valid
      
      b.status = 'CHECKED_IN';
      expect(canUpdateBookingStatus(ownerAuth, b, 'IN_SERVICE')).toBe(true);
      
      b.status = 'IN_SERVICE';
      expect(canUpdateBookingStatus(ownerAuth, b, 'AWAITING_PAYMENT')).toBe(true);
      expect(canUpdateBookingStatus(ownerAuth, b, 'COMPLETED')).toBe(true); // IN_SERVICE -> COMPLETED is valid

      b.status = 'AWAITING_PAYMENT';
      expect(canUpdateBookingStatus(ownerAuth, b, 'COMPLETED')).toBe(true);
    });
  });
});
