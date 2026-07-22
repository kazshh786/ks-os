export interface BookingAuthContext {
  authUserId: string;
  tenantId: string;
  role: 'owner' | 'staff';
}

export interface BookingResource {
  tenantId: string;
  staffId: string | null;
  status: string;
}

export function canCreateBooking(auth: BookingAuthContext): boolean {
  return auth.role === 'owner' || auth.role === 'staff';
}

export function canCancelBooking(auth: BookingAuthContext, booking: BookingResource): boolean {
  if (auth.tenantId !== booking.tenantId) return false;
  if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') return false;

  if (auth.role === 'owner') return true;
  
  if (auth.role === 'staff') {
    return booking.staffId === auth.authUserId;
  }
  
  return false;
}

export function canRescheduleBooking(auth: BookingAuthContext, booking: BookingResource): boolean {
  if (auth.tenantId !== booking.tenantId) return false;
  if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.status === 'NO_SHOW') return false;

  if (auth.role === 'owner') return true;

  if (auth.role === 'staff') {
    return booking.staffId === auth.authUserId;
  }

  return false;
}

export function canUpdateBookingStatus(auth: BookingAuthContext, booking: BookingResource, nextStatus: string): boolean {
  if (auth.tenantId !== booking.tenantId) return false;
  
  // Cannot reopen terminal states during this phase
  if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.status === 'NO_SHOW') {
    return false;
  }

  // Validate allowed transitions based on user prompt
  const allowedTransitions: Record<string, string[]> = {
    'PENDING': ['CONFIRMED', 'CANCELLED'],
    'CONFIRMED': ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
    'CHECKED_IN': ['IN_SERVICE', 'CANCELLED'],
    'IN_SERVICE': ['AWAITING_PAYMENT', 'COMPLETED'],
    'AWAITING_PAYMENT': ['COMPLETED']
  };

  const validNext = allowedTransitions[booking.status] || [];
  if (!validNext.includes(nextStatus)) {
    return false;
  }

  if (auth.role === 'owner') return true;

  if (auth.role === 'staff') {
    return booking.staffId === auth.authUserId;
  }

  return false;
}
