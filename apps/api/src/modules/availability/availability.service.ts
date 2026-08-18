import { getDatabase } from '@ks-os/database';
import {
  tenants,
  services,
  bookingChannelSchedules,
  bookingScheduleOverrides,
  appointments,
  staffServiceAssignments,
  staffTimeOff,
  staffLocations,
  resources,
  serviceResources,
  users,
} from '@ks-os/database';
import { eq, and, gt, gte, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { AvailabilityQuery, AvailabilityResult, AvailabilitySlot } from '@ks-os/contracts';
import { parseLocalTimeToUtc } from './availability.utils.js';
import { canOfferSlotWithinSchedule, resolveEffectiveAvailabilityWindows } from './availability-schedule.js';
import { normaliseSelectedServiceIds } from '../bookings/service-selection.js';

export type AvailabilityCalculationOptions = {
  excludeAppointmentId?: string;
  locationId?: string | null;
  resourceId?: string | null;
  database?: any;
};

type StaffPricingRow = {
  staffUserId: string;
  priceOverride: number;
};

export async function calculateAvailability(
  input: AvailabilityQuery,
  options: AvailabilityCalculationOptions = {},
): Promise<AvailabilityResult> {
  const db = options.database ?? getDatabase();
  const { tenantId, serviceId, serviceIds: requestedServiceIds, staffId, date, bookingChannel } = input;
  const selectedServiceIds = normaliseSelectedServiceIds(serviceId, requestedServiceIds);

  const [tenant] = await db.select({
    id: tenants.id,
    timezone: tenants.timezone,
    currency: tenants.currency,
    allowAppointmentsPastClosingTime: sql<boolean>`coalesce(${tenants}.allow_appointments_past_closing_time, false)`,
  }).from(tenants).where(eq(tenants.id, tenantId!)).limit(1);
  if (!tenant) throw new Error('Tenant not found');

  const serviceRows = await db.select({
    id: services.id,
    duration: services.duration,
    bufferTime: services.bufferTime,
    price: services.price,
    discount: services.discount,
  }).from(services)
    .where(and(inArray(services.id, selectedServiceIds), eq(services.tenantId, tenantId!), eq(services.isActive, true)));
  const servicesById = new Map(serviceRows.map((service: typeof serviceRows[number]) => [service.id, service]));
  const selectedServices = selectedServiceIds
    .map(selectedId => servicesById.get(selectedId))
    .filter((service): service is typeof serviceRows[number] => Boolean(service));
  if (selectedServices.length !== selectedServiceIds.length) throw new Error('Service not found');
  const primaryService = selectedServices[0]!;

  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayStartUtc = parseLocalTimeToUtc(date, '00:00', tenant.timezone);
  const nextCalendarDate = new Date(`${date}T12:00:00Z`);
  nextCalendarDate.setUTCDate(nextCalendarDate.getUTCDate() + 1);
  const dayEndUtc = parseLocalTimeToUtc(nextCalendarDate.toISOString().slice(0, 10), '00:00', tenant.timezone);

  const eligibleAssignmentRows = await db.select({
    userId: users.id,
    userName: users.name,
    serviceId: staffServiceAssignments.serviceId,
  }).from(users)
    .innerJoin(staffServiceAssignments, and(
      eq(staffServiceAssignments.staffUserId, users.id),
      inArray(staffServiceAssignments.serviceId, selectedServiceIds),
      eq(staffServiceAssignments.tenantId, tenantId!),
      eq(staffServiceAssignments.isActive, true),
    ))
    .where(and(
      eq(users.tenantId, tenantId!),
      eq(users.accountStatus, 'ACTIVE'),
      eq(users.bookingEnabled, true),
    ));
  const eligibleByStaff = new Map<string, { userId: string; userName: string; serviceIds: Set<string> }>();
  for (const row of eligibleAssignmentRows) {
    const member = eligibleByStaff.get(row.userId) || { userId: row.userId, userName: row.userName, serviceIds: new Set<string>() };
    member.serviceIds.add(row.serviceId);
    eligibleByStaff.set(row.userId, member);
  }
  const eligibleMembers = [...eligibleByStaff.values()]
    .filter(member => member.serviceIds.size === selectedServiceIds.length)
    .map(({ userId, userName }) => ({ userId, userName }));

  const locationStaffRows = options.locationId
    ? await db.select({ staffUserId: staffLocations.staffUserId }).from(staffLocations).where(and(
      eq(staffLocations.tenantId, tenantId!),
      eq(staffLocations.locationId, options.locationId),
    ))
    : [];
  const locationStaff = locationStaffRows.length
    ? new Set(locationStaffRows.map((row: { staffUserId: string }) => row.staffUserId))
    : null;

  const members = eligibleMembers.filter((member: { userId: string }) => {
    if (staffId && staffId !== 'any' && member.userId !== staffId) return false;
    if (locationStaff && !locationStaff.has(member.userId)) return false;
    return true;
  });

  const [weeklyRows, overrideRows] = await Promise.all([
    db.select({
      userId: bookingChannelSchedules.userId,
      startTime: bookingChannelSchedules.startTime,
      endTime: bookingChannelSchedules.endTime,
    }).from(bookingChannelSchedules).where(and(
      eq(bookingChannelSchedules.tenantId, tenantId!),
      eq(bookingChannelSchedules.bookingChannel, bookingChannel),
      eq(bookingChannelSchedules.dayOfWeek, dayOfWeek),
    )),
    db.select({
      userId: bookingScheduleOverrides.userId,
      enabled: bookingScheduleOverrides.enabled,
      startTime: bookingScheduleOverrides.startTime,
      endTime: bookingScheduleOverrides.endTime,
    }).from(bookingScheduleOverrides).where(and(
      eq(bookingScheduleOverrides.tenantId, tenantId!),
      eq(bookingScheduleOverrides.bookingChannel, bookingChannel),
      eq(bookingScheduleOverrides.overrideDate, date),
    )),
  ]);

  const schedules = resolveEffectiveAvailabilityWindows(
    members,
    weeklyRows.map((row: any) => ({ ...row, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) })),
    overrideRows
      .filter((row: any) => !row.enabled || (row.startTime && row.endTime))
      .map((row: any) => ({
        userId: row.userId,
        enabled: row.enabled,
        startTime: row.startTime?.slice(0, 5) || '00:00',
        endTime: row.endTime?.slice(0, 5) || '00:00',
      })),
  );

  if (options.resourceId) {
    const [resource] = await db.select({ id: resources.id }).from(resources)
      .innerJoin(serviceResources, and(
        eq(serviceResources.resourceId, resources.id),
        eq(serviceResources.serviceId, primaryService.id),
      ))
      .where(and(
        eq(resources.id, options.resourceId),
        eq(resources.tenantId, tenantId!),
        eq(resources.isActive, true),
        options.locationId ? eq(resources.locationId, options.locationId) : undefined,
      )).limit(1);
    if (!resource) return { date, timezone: tenant.timezone, currency: tenant.currency, bookingChannel, slots: [] };
  }

  const activeAppointments = await db.select({
    id: appointments.id,
    userId: appointments.userId,
    resourceId: appointments.resourceId,
    startTime: appointments.startTime,
    endTime: appointments.endTime,
    existingBufferTime: services.bufferTime,
    status: appointments.status,
    paymentStatus: appointments.paymentStatus,
    holdExpiresAt: appointments.holdExpiresAt,
  }).from(appointments)
    .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
    .where(and(
      eq(appointments.tenantId, tenantId!),
      lt(appointments.startTime, dayEndUtc),
      gt(appointments.endTime, dayStartUtc),
      notInArray(appointments.status, ['CANCELLED', 'NO_SHOW']),
      options.excludeAppointmentId ? ne(appointments.id, options.excludeAppointmentId) : undefined,
    ));

  const approvedTimeOff = await db.select({
    staffUserId: staffTimeOff.staffUserId,
    startsAt: staffTimeOff.startsAt,
    endsAt: staffTimeOff.endsAt,
  }).from(staffTimeOff).where(and(
    eq(staffTimeOff.tenantId, tenantId!),
    eq(staffTimeOff.status, 'APPROVED'),
    lt(staffTimeOff.startsAt, dayEndUtc),
    gte(staffTimeOff.endsAt, dayStartUtc),
  ));

  const pricingResult = await db.execute(sql<StaffPricingRow>`
    select staff_user_id as "staffUserId", price_override as "priceOverride"
    from staff_pricing
    where tenant_id = ${tenantId!}::uuid
      and service_id = ${primaryService.id}::uuid
  `);
  const pricingOverrides = (Array.isArray(pricingResult) ? pricingResult : pricingResult.rows) as StaffPricingRow[];

  const now = Date.now();
  const slots: AvailabilitySlot[] = [];

  for (const schedule of schedules) {
    const pricingOverride = pricingOverrides.find(item => item.staffUserId === schedule.userId);
    const duration = selectedServices.reduce((total, selected) => total + selected.duration, 0);
    const buffer = selectedServices.reduce((total, selected) => total + (selected.bufferTime || 0), 0);
    const totalDurationWithBuffer = duration + buffer;
    const primaryPrice = Math.max(0, (pricingOverride?.priceOverride ?? primaryService.price) - (primaryService.discount || 0));
    const additionalPrice = selectedServices.slice(1)
      .reduce((total, selected) => total + Math.max(0, selected.price - (selected.discount || 0)), 0);
    const price = primaryPrice + additionalPrice;

    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    for (
      let minute = startMinutes;
      canOfferSlotWithinSchedule({
        startMinute: minute,
        totalDurationMinutes: totalDurationWithBuffer,
        scheduleEndMinute: endMinutes,
        allowAppointmentsPastClosingTime: tenant.allowAppointmentsPastClosingTime,
      });
      minute += 30
    ) {
      const hour = Math.floor(minute / 60).toString().padStart(2, '0');
      const minutePart = (minute % 60).toString().padStart(2, '0');
      const slotStart = parseLocalTimeToUtc(date, `${hour}:${minutePart}`, tenant.timezone);
      const slotEnd = new Date(slotStart.getTime() + totalDurationWithBuffer * 60_000);
      if (slotStart.getTime() < now + 5 * 60_000) continue;

      const overlaps = activeAppointments.some((appointment: any) => {
        if (appointment.userId !== schedule.userId && (!options.resourceId || appointment.resourceId !== options.resourceId)) return false;
        if (
          appointment.status === 'PENDING'
          && appointment.paymentStatus === 'PENDING'
          && appointment.holdExpiresAt
          && appointment.holdExpiresAt.getTime() < now
        ) return false;
        const existingEndWithBuffer = new Date(appointment.endTime.getTime() + (appointment.existingBufferTime ?? 0) * 60_000);
        return slotStart < existingEndWithBuffer && slotEnd > appointment.startTime;
      });

      const onLeave = approvedTimeOff.some((leave: any) => leave.staffUserId === schedule.userId && slotStart < leave.endsAt && slotEnd > leave.startsAt);
      if (!overlaps && !onLeave) {
        slots.push({
          start: slotStart.toISOString(),
          end: new Date(slotStart.getTime() + duration * 60_000).toISOString(),
          staffId: schedule.userId,
          staffName: schedule.userName || 'Team member',
          price,
          duration,
        });
      }
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  return {
    date,
    timezone: tenant.timezone,
    currency: tenant.currency,
    bookingChannel,
    slots,
  };
}
