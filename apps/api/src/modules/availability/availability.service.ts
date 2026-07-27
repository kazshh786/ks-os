import { getDatabase } from '@ks-os/database';
import { 
  tenants, 
  services, 
  bookingChannelSchedules, 
  appointments, 
  staffPricing,
  staffServiceAssignments,
  staffTimeOff,
  staffLocations,
  resources,
  serviceResources,
  users
} from '@ks-os/database';
import { eq, and, gt, gte, lt, ne, notInArray } from 'drizzle-orm';
import { AvailabilityQuery, AvailabilityResult, AvailabilitySlot } from '@ks-os/contracts';
import { parseLocalTimeToUtc } from './availability.utils.js';

export type AvailabilityCalculationOptions = {
  excludeAppointmentId?: string;
  locationId?: string | null;
  resourceId?: string | null;
  database?: any;
};

export async function calculateAvailability(
  input: AvailabilityQuery,
  options: AvailabilityCalculationOptions = {},
): Promise<AvailabilityResult> {
  const db = options.database ?? getDatabase();
  const { tenantId, serviceId, staffId, date, bookingChannel } = input;

  // 1. Fetch tenant and service
  const [tenant] = await db.select({
    id: tenants.id,
    timezone: tenants.timezone,
    currency: tenants.currency
  }).from(tenants).where(eq(tenants.id, tenantId!)).limit(1);

  if (!tenant) throw new Error('Tenant not found');

  const [service] = await db.select({
    id: services.id,
    duration: services.duration,
    bufferTime: services.bufferTime,
    price: services.price,
    discount: services.discount
  }).from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId!), eq(services.isActive, true)))
    .limit(1);

  if (!service) throw new Error('Service not found');

  // 2. Compute the date boundaries in UTC for the target day in local timezone
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayStartUtc = parseLocalTimeToUtc(date, '00:00', tenant.timezone);
  
  const nextCalendarDate = new Date(`${date}T12:00:00Z`);
  nextCalendarDate.setUTCDate(nextCalendarDate.getUTCDate() + 1);
  const dayEndUtc = parseLocalTimeToUtc(nextCalendarDate.toISOString().slice(0, 10), '00:00', tenant.timezone);

  // 3. Query schedules, joining users to get staff name
  let schedulesQuery = db.select({
    userId: bookingChannelSchedules.userId,
    startTime: bookingChannelSchedules.startTime,
    endTime: bookingChannelSchedules.endTime,
    userName: users.name,
    accountStatus: users.accountStatus,
    bookingEnabled: users.bookingEnabled,
    serviceEligible: staffServiceAssignments.id
  })
  .from(bookingChannelSchedules)
  .leftJoin(users, eq(bookingChannelSchedules.userId, users.id))
  .leftJoin(staffServiceAssignments, and(eq(staffServiceAssignments.staffUserId, bookingChannelSchedules.userId),eq(staffServiceAssignments.serviceId,serviceId),eq(staffServiceAssignments.tenantId,tenantId!),eq(staffServiceAssignments.isActive,true)))
  .where(
    and(
      eq(bookingChannelSchedules.tenantId, tenantId!),
      eq(bookingChannelSchedules.bookingChannel, bookingChannel),
      eq(bookingChannelSchedules.dayOfWeek, dayOfWeek)
    )
  );

  const rawSchedules = await schedulesQuery;
  const locationStaff = options.locationId
    ? new Set((await db.select({ staffUserId: staffLocations.staffUserId }).from(staffLocations).where(and(
        eq(staffLocations.tenantId, tenantId!),
        eq(staffLocations.locationId, options.locationId),
      ))).map((row: { staffUserId: string }) => row.staffUserId))
    : null;
  const schedules = rawSchedules.filter((s: any) => {
    if (s.accountStatus !== 'ACTIVE' || !s.bookingEnabled || !s.serviceEligible) return false;
    if (staffId && staffId !== 'any' && s.userId !== staffId) return false;
    if (locationStaff && (!s.userId || !locationStaff.has(s.userId))) return false;
    return true;
  });

  if (options.resourceId) {
    const [resource] = await db.select({ id: resources.id }).from(resources)
      .innerJoin(serviceResources, and(
        eq(serviceResources.resourceId, resources.id),
        eq(serviceResources.serviceId, serviceId),
      ))
      .where(and(
        eq(resources.id, options.resourceId),
        eq(resources.tenantId, tenantId!),
        eq(resources.isActive, true),
        options.locationId ? eq(resources.locationId, options.locationId) : undefined,
      )).limit(1);
    if (!resource) return { date, timezone: tenant.timezone, currency: tenant.currency, bookingChannel, slots: [] };
  }

  // 4. Query active appointments for this day
  const activeAppointments = await db.select({
    id: appointments.id,
    userId: appointments.userId,
    resourceId: appointments.resourceId,
    startTime: appointments.startTime,
    endTime: appointments.endTime,
    existingBufferTime: services.bufferTime,
    status: appointments.status,
    paymentStatus: appointments.paymentStatus,
    holdExpiresAt: appointments.holdExpiresAt
  })
  .from(appointments)
  .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
  .where(
    and(
      eq(appointments.tenantId, tenantId!),
      lt(appointments.startTime, dayEndUtc),
      gt(appointments.endTime, dayStartUtc),
      notInArray(appointments.status, ['CANCELLED', 'NO_SHOW']),
      options.excludeAppointmentId ? ne(appointments.id, options.excludeAppointmentId) : undefined,
    )
  );
  const approvedTimeOff=await db.select({staffUserId:staffTimeOff.staffUserId,startsAt:staffTimeOff.startsAt,endsAt:staffTimeOff.endsAt}).from(staffTimeOff).where(and(eq(staffTimeOff.tenantId,tenantId!),eq(staffTimeOff.status,'APPROVED'),lt(staffTimeOff.startsAt,dayEndUtc),gte(staffTimeOff.endsAt,dayStartUtc)));

  // 5. Query staff pricing overrides (scoped to tenant and active staff)
  const pricingOverrides = await db.select({
    userId: staffPricing.userId,
    customPriceInCents: staffPricing.customPriceInCents,
    customDurationMinutes: staffPricing.customDurationMinutes
  })
  .from(staffPricing)
  .innerJoin(users, eq(users.id, staffPricing.userId))
  .where(and(
    eq(staffPricing.serviceId, serviceId),
    eq(users.tenantId, tenantId!),
    eq(users.accountStatus, 'ACTIVE')
  ));

  const now = Date.now();
  const slots: AvailabilitySlot[] = [];

  // 6. Calculate available slots
  for (const schedule of schedules) {
    if (!schedule.userId) continue;

    const override = pricingOverrides.find((p: any) => p.userId === schedule.userId);
    const duration = override?.customDurationMinutes || service.duration;
    const buffer = service.bufferTime || 0;
    const totalDurationWithBuffer = duration + buffer;
    
    const rawPrice = override?.customPriceInCents ?? service.price;
    const price = Math.max(0, rawPrice - (service.discount || 0));

    // Time calculations
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    for (let min = startMinutes; min + totalDurationWithBuffer <= endMinutes; min += 30) {
      const h = Math.floor(min / 60).toString().padStart(2, '0');
      const m = (min % 60).toString().padStart(2, '0');
      const timeStr = `${h}:${m}`;

      const slotStart = parseLocalTimeToUtc(date, timeStr, tenant.timezone);
      const slotEnd = new Date(slotStart.getTime() + totalDurationWithBuffer * 60000);

      // Skip past slots (buffer 5 mins)
      if (slotStart.getTime() < now + 5 * 60000) continue;

      const overlaps = activeAppointments.some((appt: any) => {
        if (appt.userId !== schedule.userId && (!options.resourceId || appt.resourceId !== options.resourceId)) return false;
        
        // Exclude expired PENDING holds
        if (
          appt.status === 'PENDING' && 
          appt.paymentStatus === 'PENDING' && 
          appt.holdExpiresAt && 
          appt.holdExpiresAt.getTime() < now
        ) {
          return false;
        }

        const existingEndWithBuffer = new Date(appt.endTime.getTime() + (appt.existingBufferTime ?? 0) * 60_000);
        return slotStart < existingEndWithBuffer && slotEnd > appt.startTime;
      });

      const onLeave=approvedTimeOff.some((leave: any)=>leave.staffUserId===schedule.userId&&slotStart<leave.endsAt&&slotEnd>leave.startsAt);

      if (!overlaps && !onLeave) {
        slots.push({
          start: slotStart.toISOString(),
          end: new Date(slotStart.getTime() + duration * 60000).toISOString(),
          staffId: schedule.userId,
          staffName: schedule.userName || 'Team member',
          price,
          duration
        });
      }
    }
  }

  // Deterministic sorting
  slots.sort((a, b) => a.start.localeCompare(b.start));

  return {
    date,
    timezone: tenant.timezone,
    currency: tenant.currency,
    bookingChannel,
    slots
  };
}
