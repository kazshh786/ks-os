import { createHash, randomBytes } from 'node:crypto';
import {
  appointments,
  automationActionRuns,
  checkoutTransactions,
  clients,
  customerBookingActionIdempotency,
  customerBookingChangeHistory,
  customerBookingManagementTokens,
  customerClientLinks,
  emailOutbox,
  formAssignments,
  getDatabase,
  internalNotifications,
  locations,
  services,
  smsOutbox,
  staffPricing,
  staffServiceAssignments,
  stripePaymentAttempts,
  stripeRefunds,
  tenants,
  users,
} from '@ks-os/database';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type {
  CustomerCancellationRequest,
  CustomerRescheduleAvailabilityQuery,
  CustomerRescheduleRequest,
} from '@ks-os/contracts';
import { calculateAvailability } from '../availability/availability.service.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';
import { EmailService } from '../email/email.service.js';
import { OperationsIssueReporter } from '../operations/operations.issue-service.js';
import { SmsService } from '../sms/sms.service.js';
import { env } from '../../config/env.js';
import type { CustomerAuthContext } from './customer-auth.service.js';
import { customerError } from './customer-portal.errors.js';
import {
  evaluateCustomerBookingManagementPolicy,
  policyRestrictionCode,
  type CustomerBookingPaymentContext,
  type CustomerBookingPolicySettings,
} from './customer-booking-management.policy.js';

export type CustomerBookingAccess =
  | { kind: 'CUSTOMER'; customer: CustomerAuthContext; bookingReference: string }
  | { kind: 'GUEST'; token: string };

const appointmentSelection = {
  appointmentId: appointments.id,
  tenantId: appointments.tenantId,
  clientId: appointments.clientId,
  serviceId: appointments.serviceId,
  staffId: appointments.userId,
  resourceId: appointments.resourceId,
  locationId: appointments.locationId,
  bookingReference: appointments.publicReference,
  bookingChannel: appointments.bookingChannel,
  status: appointments.status,
  startTime: appointments.startTime,
  endTime: appointments.endTime,
  quotedAmount: appointments.quotedAmount,
  paymentMode: appointments.paymentMode,
  paymentStatus: appointments.paymentStatus,
  holdExpiresAt: appointments.holdExpiresAt,
  version: appointments.version,
  customerRescheduleCount: appointments.customerRescheduleCount,
  salonName: tenants.name,
  businessSlug: tenants.subdomain,
  timezone: tenants.timezone,
  currency: tenants.currency,
  primaryColor: tenants.primaryColor,
  contactPhone: tenants.operationalPhone,
  replyToEmail: tenants.replyToEmail,
  senderDisplayName: tenants.senderDisplayName,
  customerCancellationEnabled: tenants.customerCancellationEnabled,
  customerReschedulingEnabled: tenants.customerReschedulingEnabled,
  minimumCancellationNoticeMinutes: tenants.minimumCancellationNoticeMinutes,
  minimumRescheduleNoticeMinutes: tenants.minimumRescheduleNoticeMinutes,
  maximumCustomerReschedules: tenants.maximumCustomerReschedules,
  requireCancellationReason: tenants.requireCancellationReason,
  lateCancellationMessage: tenants.lateCancellationMessage,
  depositPolicyMessage: tenants.depositPolicyMessage,
  bookingRescheduleEmailEnabled: tenants.bookingRescheduleEnabled,
  bookingCancellationEmailEnabled: tenants.bookingCancellationEnabled,
  smsEnabled: tenants.smsEnabled,
  smsBookingRescheduleEnabled: tenants.smsBookingRescheduleEnabled,
  smsBookingCancellationEnabled: tenants.smsBookingCancellationEnabled,
  smsAppointmentRemindersEnabled: tenants.smsAppointmentRemindersEnabled,
  smsReminderTiming: tenants.smsReminderTiming,
  serviceName: services.name,
  serviceDuration: services.duration,
  serviceBufferTime: services.bufferTime,
  staffName: users.name,
  staffReference: users.publicReference,
  clientName: clients.name,
  clientEmail: clients.email,
  clientPhone: clients.phoneE164,
  clientPhoneFallback: clients.phone,
  locationName: locations.name,
};

type AccessRow = {
  [K in keyof typeof appointmentSelection]: any;
};

const safeStatus = (status: string) => ({
  PENDING: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  IN_SERVICE: 'In progress',
  AWAITING_PAYMENT: 'Payment due',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed appointment',
} as Record<string, string>)[status] ?? 'Appointment update';

export function hashCustomerBookingManagementToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createCustomerBookingManagementToken() {
  return randomBytes(32).toString('base64url');
}

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const actorScope = (access: CustomerBookingAccess) => hashCustomerBookingManagementToken(
  access.kind === 'CUSTOMER' ? `customer:${access.customer.customerAccountId}` : `guest:${access.token}`,
);

export class CustomerBookingManagementService {
  private readonly email = new EmailService();
  private readonly sms = new SmsService();
  private readonly events = new BusinessEventsService();
  private readonly issues = new OperationsIssueReporter();

  async createGuestToken(tenantId: string, appointmentId: string, expiresAt: Date) {
    return getDatabase().transaction(async (tx) => {
      const [appointment] = await tx.select({ id: appointments.id }).from(appointments).where(and(
        eq(appointments.id, appointmentId),
        eq(appointments.tenantId, tenantId),
      )).for('update').limit(1);
      if (!appointment) throw new Error('CUSTOMER_BOOKING_NOT_FOUND');
      const issuedAt = new Date();
      await tx.update(customerBookingManagementTokens).set({ status: 'REVOKED', revokedAt: issuedAt }).where(and(
        eq(customerBookingManagementTokens.tenantId, tenantId),
        eq(customerBookingManagementTokens.appointmentId, appointmentId),
        eq(customerBookingManagementTokens.status, 'ACTIVE'),
      ));
      const token = createCustomerBookingManagementToken();
      await tx.insert(customerBookingManagementTokens).values({
        tenantId,
        appointmentId,
        tokenHash: hashCustomerBookingManagementToken(token),
        expiresAt,
      });
      return { token, expiresAt };
    });
  }

  async getAppointment(access: CustomerBookingAccess) {
    const row = await this.resolveAccess(access);
    const payment = await this.paymentContext(row.tenantId, row.appointmentId);
    return this.safeAppointment(row, payment);
  }

  async getPolicy(access: CustomerBookingAccess) {
    const row = await this.resolveAccess(access);
    return this.evaluate(row, await this.paymentContext(row.tenantId, row.appointmentId));
  }

  async availability(access: CustomerBookingAccess, query: CustomerRescheduleAvailabilityQuery) {
    const row = await this.resolveAccess(access);
    const policy = this.evaluate(row, await this.paymentContext(row.tenantId, row.appointmentId));
    if (!policy.canReschedule) this.throwRestriction('RESCHEDULE', row);
    if (!row.serviceId) throw customerError(422, 'CUSTOMER_BOOKING_NOT_MANAGEABLE', 'This booking cannot be rescheduled online.');

    const result = await calculateAvailability({
      tenantId: row.tenantId,
      serviceId: row.serviceId,
      staffId: 'any',
      date: query.date,
      bookingChannel: row.bookingChannel,
    }, {
      excludeAppointmentId: row.appointmentId,
      locationId: row.locationId,
      resourceId: row.resourceId,
    });
    const bookedDuration = Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000);
    const eligible = result.slots.filter((slot) => slot.price === row.quotedAmount && slot.duration === bookedDuration);
    const staffIds = [...new Set(eligible.map((slot) => slot.staffId))];
    const staffRows = staffIds.length
      ? await getDatabase().select({ id: users.id, publicReference: users.publicReference }).from(users)
          .where(and(eq(users.tenantId, row.tenantId), inArray(users.id, staffIds)))
      : [];
    const references = new Map(staffRows.map((staff) => [staff.id, staff.publicReference]));
    const slots = eligible.flatMap((slot) => {
      const staffReference = references.get(slot.staffId);
      return staffReference ? [{
        startTime: slot.start,
        endTime: slot.end,
        staffReference,
        staffName: slot.staffName,
        isCurrentStaff: slot.staffId === row.staffId,
      }] : [];
    }).sort((left, right) => Number(right.isCurrentStaff) - Number(left.isCurrentStaff) || left.startTime.localeCompare(right.startTime));
    return { date: result.date, timezone: result.timezone, slots };
  }

  async reschedule(access: CustomerBookingAccess, input: CustomerRescheduleRequest) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const initial = await this.resolveAccess(access, tx);
      await tx.select({ id: appointments.id }).from(appointments)
        .where(and(eq(appointments.id, initial.appointmentId), eq(appointments.tenantId, initial.tenantId)))
        .for('update').limit(1);
      const row = await this.resolveAccess(access, tx);
      const requestHash = fingerprint({
        expectedAppointmentVersion: input.expectedAppointmentVersion,
        newStartTime: input.newStartTime,
        staffReference: input.staffReference ?? row.staffReference,
      });
      const replay = await this.replay(tx, row, access, 'RESCHEDULE', input.idempotencyKey, requestHash);
      if (replay) return replay;

      this.throwRestriction('RESCHEDULE', row);
      this.assertVersion(row, input.expectedAppointmentVersion);
      if (!row.serviceId) throw customerError(422, 'CUSTOMER_BOOKING_NOT_MANAGEABLE', 'This booking cannot be rescheduled online.');

      const requestedStaff = input.staffReference
        ? await this.resolveEligibleStaff(tx, row, input.staffReference)
        : { id: row.staffId, publicReference: row.staffReference, name: row.staffName };
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${row.tenantId}:${requestedStaff.id}`}, 0))`);
      if (row.resourceId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${row.tenantId}:resource:${row.resourceId}`}, 0))`);
      }

      const newStart = new Date(input.newStartTime);
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(newStart);
      const availability = await calculateAvailability({
        tenantId: row.tenantId,
        serviceId: row.serviceId,
        staffId: requestedStaff.id,
        date,
        bookingChannel: row.bookingChannel,
      }, {
        excludeAppointmentId: row.appointmentId,
        locationId: row.locationId,
        resourceId: row.resourceId,
        database: tx,
      });
      const bookedDuration = Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000);
      const slot = availability.slots.find((candidate) => candidate.staffId === requestedStaff.id && candidate.start === newStart.toISOString());
      if (slot && (slot.price !== row.quotedAmount || slot.duration !== bookedDuration)) {
        throw customerError(422, 'CUSTOMER_BOOKING_PRICE_CHANGE_NOT_SUPPORTED', 'This team member has different pricing or timing. Please contact the salon.');
      }
      if (!slot) throw customerError(409, 'CUSTOMER_BOOKING_SLOT_UNAVAILABLE', 'That time is no longer available. Please choose another slot.');

      const newEnd = new Date(slot.end);
      const [updated] = await tx.update(appointments).set({
        userId: requestedStaff.id,
        startTime: newStart,
        endTime: newEnd,
        customerRescheduleCount: sql`${appointments.customerRescheduleCount} + 1`,
        version: sql`${appointments.version} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(appointments.id, row.appointmentId),
        eq(appointments.tenantId, row.tenantId),
        eq(appointments.version, Number(input.expectedAppointmentVersion)),
        inArray(appointments.status, ['PENDING', 'CONFIRMED']),
      )).returning({ version: appointments.version, status: appointments.status });
      if (!updated) throw customerError(409, 'CUSTOMER_BOOKING_STATE_CHANGED', 'This booking was updated. Refresh it before trying again.');

      const [change] = await tx.insert(customerBookingChangeHistory).values({
        tenantId: row.tenantId,
        appointmentId: row.appointmentId,
        changeType: 'RESCHEDULED',
        source: 'CUSTOMER',
        previousStartTime: row.startTime,
        previousEndTime: row.endTime,
        newStartTime: newStart,
        newEndTime: newEnd,
        previousStaffUserId: row.staffId,
        newStaffUserId: requestedStaff.id,
      }).returning({ id: customerBookingChangeHistory.id });

      await this.cancelAppointmentReminders(tx, row.tenantId, row.appointmentId);
      await this.rescheduleFormReminders(tx, row, newStart);
      await this.cancelFutureAutomation(tx, row.tenantId, row.appointmentId);
      await this.events.emit({
        id: stableEventId('BOOKING_RESCHEDULED', row.appointmentId, change.id),
        tenantId: row.tenantId,
        type: 'BOOKING_RESCHEDULED',
        occurredAt: new Date().toISOString(),
        sourceType: 'appointment',
        sourceId: row.appointmentId,
        payload: {
          tenantId: row.tenantId,
          appointmentId: row.appointmentId,
          bookingReference: row.bookingReference,
          changeSource: 'CUSTOMER',
          previousTime: row.startTime.toISOString(),
          newTime: newStart.toISOString(),
          occurredAt: new Date().toISOString(),
        },
      }, tx);
      await this.enqueueRescheduledNotifications(tx, row, requestedStaff.name, newStart, change.id, access);
      await tx.insert(internalNotifications).values({
        tenantId: row.tenantId,
        recipientRole: 'owner',
        type: 'BOOKING_RESCHEDULED',
        title: 'Customer rescheduled a booking',
        message: `${row.serviceName || 'Service'} moved to ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.timezone }).format(newStart)}.`,
        sourceType: 'appointment',
        sourceId: row.appointmentId,
      });

      const nextRow = { ...row, staffId: requestedStaff.id, staffName: requestedStaff.name, startTime: newStart, endTime: newEnd, version: updated.version, customerRescheduleCount: row.customerRescheduleCount + 1 };
      const payment = await this.paymentContext(row.tenantId, row.appointmentId, tx);
      const response = {
        appointment: this.mutationAppointment(nextRow),
        previousStartTime: row.startTime.toISOString(),
        policy: this.evaluate(nextRow, payment),
      };
      await this.remember(tx, row, access, 'RESCHEDULE', input.idempotencyKey, requestHash, response);
      return response;
    });
  }

  async cancel(access: CustomerBookingAccess, input: CustomerCancellationRequest) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const initial = await this.resolveAccess(access, tx);
      await tx.select({ id: appointments.id }).from(appointments)
        .where(and(eq(appointments.id, initial.appointmentId), eq(appointments.tenantId, initial.tenantId)))
        .for('update').limit(1);
      const row = await this.resolveAccess(access, tx);
      const requestHash = fingerprint({
        expectedAppointmentVersion: input.expectedAppointmentVersion,
        reasonCode: input.reasonCode ?? null,
        reasonText: input.reasonText ?? null,
      });
      const replay = await this.replay(tx, row, access, 'CANCEL', input.idempotencyKey, requestHash);
      if (replay) return replay;

      if (row.status === 'CANCELLED') throw customerError(409, 'CUSTOMER_BOOKING_ALREADY_CANCELLED', 'This appointment is already cancelled.');
      this.throwRestriction('CANCEL', row);
      this.assertVersion(row, input.expectedAppointmentVersion);
      if (row.requireCancellationReason && !input.reasonCode) {
        throw customerError(422, 'CUSTOMER_BOOKING_CANCELLATION_REASON_REQUIRED', 'Please select a cancellation reason.');
      }

      const cancelledAt = new Date();
      const payment = await this.paymentContext(row.tenantId, row.appointmentId, tx);
      const policy = this.evaluate(row, payment);
      const [updated] = await tx.update(appointments).set({
        status: 'CANCELLED',
        cancellationSource: 'CUSTOMER',
        cancellationReasonCode: input.reasonCode ?? null,
        cancellationReasonText: input.reasonText ?? null,
        cancelledAt,
        version: sql`${appointments.version} + 1`,
        updatedAt: cancelledAt,
      }).where(and(
        eq(appointments.id, row.appointmentId),
        eq(appointments.tenantId, row.tenantId),
        eq(appointments.version, Number(input.expectedAppointmentVersion)),
        inArray(appointments.status, ['PENDING', 'CONFIRMED']),
      )).returning({ version: appointments.version, status: appointments.status });
      if (!updated) throw customerError(409, 'CUSTOMER_BOOKING_STATE_CHANGED', 'This booking was updated. Refresh it before trying again.');

      const [change] = await tx.insert(customerBookingChangeHistory).values({
        tenantId: row.tenantId,
        appointmentId: row.appointmentId,
        changeType: 'CANCELLED',
        source: 'CUSTOMER',
        previousStartTime: row.startTime,
        previousEndTime: row.endTime,
        previousStaffUserId: row.staffId,
        reasonCode: input.reasonCode ?? null,
      }).returning({ id: customerBookingChangeHistory.id });

      await this.cancelAppointmentReminders(tx, row.tenantId, row.appointmentId);
      await this.cancelFutureAutomation(tx, row.tenantId, row.appointmentId);
      await this.cancelPendingFormReminders(tx, row.tenantId, row.appointmentId);
      await tx.update(formAssignments).set({ status: 'CANCELLED', cancelledAt, updatedAt: cancelledAt }).where(and(
        eq(formAssignments.tenantId, row.tenantId),
        eq(formAssignments.appointmentId, row.appointmentId),
        inArray(formAssignments.status, ['PENDING', 'OPENED']),
      ));
      await tx.update(smsOutbox).set({ status: 'CANCELLED' }).where(and(
        eq(smsOutbox.tenantId, row.tenantId),
        eq(smsOutbox.appointmentId, row.appointmentId),
        inArray(smsOutbox.status, ['PENDING', 'PROCESSING']),
      ));
      await tx.update(stripePaymentAttempts).set({ status: 'CANCELLED', updatedAt: cancelledAt }).where(and(
        eq(stripePaymentAttempts.tenantId, row.tenantId),
        eq(stripePaymentAttempts.appointmentId, row.appointmentId),
        inArray(stripePaymentAttempts.status, ['CREATING', 'OPEN', 'PENDING']),
      ));
      await this.events.emit({
        id: stableEventId('BOOKING_CANCELLED', row.appointmentId, change.id),
        tenantId: row.tenantId,
        type: 'BOOKING_CANCELLED',
        occurredAt: cancelledAt.toISOString(),
        sourceType: 'appointment',
        sourceId: row.appointmentId,
        payload: {
          tenantId: row.tenantId,
          appointmentId: row.appointmentId,
          bookingReference: row.bookingReference,
          changeSource: 'CUSTOMER',
          previousTime: row.startTime.toISOString(),
          occurredAt: cancelledAt.toISOString(),
        },
      }, tx);
      await tx.insert(internalNotifications).values({
        tenantId: row.tenantId,
        recipientRole: 'owner',
        type: 'BOOKING_CANCELLED',
        title: 'Customer cancelled a booking',
        message: `${row.serviceName || 'Service'} on ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.timezone }).format(row.startTime)} was cancelled.`,
        sourceType: 'appointment',
        sourceId: row.appointmentId,
      });
      if (payment.refundableOnlineAmount > 0) {
        await this.issues.report({
          tenantId: row.tenantId,
          category: 'REFUND',
          issueType: 'CUSTOMER_CANCELLATION_REFUND_REVIEW',
          severity: 'WARNING',
          title: 'Customer cancellation requires refund review',
          message: 'A customer cancelled an appointment with an online payment. No automatic refund was issued.',
          sourceType: 'APPOINTMENT',
          sourceId: row.appointmentId,
          deduplicationKey: `CUSTOMER_CANCELLATION_REFUND_REVIEW:${row.appointmentId}`,
          relatedAppointmentId: row.appointmentId,
          metadata: {
            appointmentReference: row.bookingReference,
            transactionReferences: payment.onlineTransactionReferences,
            amountPaid: payment.refundableOnlineAmount,
            currency: row.currency,
            cancellationTime: cancelledAt.toISOString(),
            policyContext: policy.paymentImpact.type,
          },
        }, tx);
      }
      await this.enqueueCancellationNotifications(tx, row, cancelledAt, policy.paymentImpact.message, change.id, access);

      const nextRow = { ...row, status: 'CANCELLED', version: updated.version };
      const response = {
        appointment: this.mutationAppointment(nextRow),
        cancelledAt: cancelledAt.toISOString(),
        paymentImpact: policy.paymentImpact,
      };
      await this.remember(tx, row, access, 'CANCEL', input.idempotencyKey, requestHash, response);
      return response;
    });
  }

  private async resolveAccess(access: CustomerBookingAccess, database: any = getDatabase()): Promise<AccessRow> {
    const base = () => database.select(appointmentSelection).from(appointments)
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
      .leftJoin(users, and(eq(users.id, appointments.userId), eq(users.tenantId, appointments.tenantId)))
      .leftJoin(clients, and(eq(clients.id, appointments.clientId), eq(clients.tenantId, appointments.tenantId)))
      .leftJoin(locations, and(eq(locations.id, appointments.locationId), eq(locations.tenantId, appointments.tenantId)));
    let row: AccessRow | undefined;
    if (access.kind === 'CUSTOMER') {
      [row] = await base().innerJoin(customerClientLinks, and(
        eq(customerClientLinks.customerAccountId, access.customer.customerAccountId),
        eq(customerClientLinks.status, 'ACTIVE'),
        eq(customerClientLinks.tenantId, appointments.tenantId),
        eq(customerClientLinks.clientId, appointments.clientId),
      )).where(and(eq(appointments.publicReference, access.bookingReference), ne(appointments.status, 'BLOCKED'))).limit(1);
    } else {
      const tokenHash = hashCustomerBookingManagementToken(access.token);
      [row] = await base().innerJoin(customerBookingManagementTokens, and(
        eq(customerBookingManagementTokens.appointmentId, appointments.id),
        eq(customerBookingManagementTokens.tenantId, appointments.tenantId),
      )).where(and(
        eq(customerBookingManagementTokens.tokenHash, tokenHash),
        eq(customerBookingManagementTokens.status, 'ACTIVE'),
        gt(customerBookingManagementTokens.expiresAt, new Date()),
        ne(appointments.status, 'BLOCKED'),
      )).limit(1);
      if (row) await database.update(customerBookingManagementTokens).set({ lastUsedAt: new Date() })
        .where(eq(customerBookingManagementTokens.tokenHash, tokenHash));
    }
    if (!row) throw customerError(404, 'CUSTOMER_BOOKING_NOT_FOUND', 'This booking is unavailable.');
    return row;
  }

  private settings(row: AccessRow): CustomerBookingPolicySettings {
    return {
      customerCancellationEnabled: row.customerCancellationEnabled,
      customerReschedulingEnabled: row.customerReschedulingEnabled,
      minimumCancellationNoticeMinutes: row.minimumCancellationNoticeMinutes,
      minimumRescheduleNoticeMinutes: row.minimumRescheduleNoticeMinutes,
      maximumCustomerReschedules: row.maximumCustomerReschedules,
      requireCancellationReason: row.requireCancellationReason,
      lateCancellationMessage: row.lateCancellationMessage,
      depositPolicyMessage: row.depositPolicyMessage,
    };
  }

  private evaluate(row: AccessRow, payment: CustomerBookingPaymentContext) {
    return evaluateCustomerBookingManagementPolicy({
      appointment: { status: row.status, startTime: row.startTime, customerRescheduleCount: row.customerRescheduleCount },
      settings: this.settings(row),
      payment,
    });
  }

  private throwRestriction(action: 'CANCEL' | 'RESCHEDULE', row: AccessRow) {
    const code = policyRestrictionCode(action, {
      status: row.status,
      startTime: row.startTime,
      customerRescheduleCount: row.customerRescheduleCount,
    }, this.settings(row));
    if (!code) return;
    const status = code === 'CUSTOMER_BOOKING_NOT_MANAGEABLE' ? 409 : 422;
    throw customerError(status, code, 'This booking cannot be changed online. Please contact the salon.');
  }

  private assertVersion(row: AccessRow, expected: string) {
    if (String(row.version) !== expected) {
      throw customerError(409, 'CUSTOMER_BOOKING_STATE_CHANGED', 'This booking was updated. Refresh it before trying again.');
    }
  }

  private async paymentContext(tenantId: string, appointmentId: string, database: any = getDatabase()) {
    const transactions = await database.select({
      id: checkoutTransactions.id,
      amount: checkoutTransactions.totalAmount,
      method: checkoutTransactions.paymentMethod,
      purpose: checkoutTransactions.purpose,
      status: checkoutTransactions.paymentStatus,
    }).from(checkoutTransactions).where(and(
      eq(checkoutTransactions.tenantId, tenantId),
      eq(checkoutTransactions.appointmentId, appointmentId),
      inArray(checkoutTransactions.paymentStatus, ['SUCCEEDED', 'REFUNDED']),
    ));
    const transactionIds = transactions.map((transaction: { id: string }) => transaction.id);
    const refunds = transactionIds.length ? await database.select({
      transactionId: stripeRefunds.checkoutTransactionId,
      amount: stripeRefunds.amount,
      status: stripeRefunds.status,
    }).from(stripeRefunds).where(and(
      inArray(stripeRefunds.checkoutTransactionId, transactionIds),
      inArray(stripeRefunds.status, ['SUCCEEDED', 'COMPLETED']),
    )) : [];
    const refundedByTransaction = new Map<string, number>();
    for (const refund of refunds) refundedByTransaction.set(refund.transactionId, (refundedByTransaction.get(refund.transactionId) ?? 0) + refund.amount);
    let paidAmount = 0;
    let refundableOnlineAmount = 0;
    let hasOnlinePayment = false;
    let hasDirectPayment = false;
    const onlineTransactionReferences: string[] = [];
    for (const transaction of transactions) {
      const remaining = Math.max(transaction.amount - (refundedByTransaction.get(transaction.id) ?? 0), 0);
      paidAmount += remaining;
      if (transaction.method === 'CARD' && transaction.purpose === 'booking_payment') {
        hasOnlinePayment ||= remaining > 0;
        refundableOnlineAmount += remaining;
        if (remaining > 0) onlineTransactionReferences.push(transaction.id);
      } else {
        hasDirectPayment ||= remaining > 0;
      }
    }
    return { paidAmount, hasOnlinePayment, hasDirectPayment, refundableOnlineAmount, onlineTransactionReferences };
  }

  private async resolveEligibleStaff(tx: any, row: AccessRow, staffReference: string) {
    const [staff] = await tx.select({
      id: users.id,
      publicReference: users.publicReference,
      name: users.name,
      customPrice: staffPricing.customPriceInCents,
      customDuration: staffPricing.customDurationMinutes,
    }).from(users)
      .innerJoin(staffServiceAssignments, and(
        eq(staffServiceAssignments.staffUserId, users.id),
        eq(staffServiceAssignments.serviceId, row.serviceId),
        eq(staffServiceAssignments.tenantId, row.tenantId),
        eq(staffServiceAssignments.isActive, true),
      ))
      .leftJoin(staffPricing, and(eq(staffPricing.userId, users.id), eq(staffPricing.serviceId, row.serviceId)))
      .where(and(
        eq(users.publicReference, staffReference),
        eq(users.tenantId, row.tenantId),
        eq(users.accountStatus, 'ACTIVE'),
        eq(users.bookingEnabled, true),
      )).limit(1);
    if (!staff) throw customerError(422, 'CUSTOMER_BOOKING_STAFF_NOT_ELIGIBLE', 'That team member is unavailable for this service.');
    const duration = staff.customDuration ?? row.serviceDuration;
    const price = staff.customPrice ?? row.quotedAmount;
    const bookedDuration = Math.round((row.endTime.getTime() - row.startTime.getTime()) / 60_000);
    if (duration !== bookedDuration || price !== row.quotedAmount) {
      throw customerError(422, 'CUSTOMER_BOOKING_PRICE_CHANGE_NOT_SUPPORTED', 'This team member has different pricing or timing. Please contact the salon.');
    }
    return staff;
  }

  private async replay(tx: any, row: AccessRow, access: CustomerBookingAccess, action: string, key: string, requestHash: string) {
    const [existing] = await tx.select().from(customerBookingActionIdempotency).where(and(
      eq(customerBookingActionIdempotency.actorScopeHash, actorScope(access)),
      eq(customerBookingActionIdempotency.appointmentId, row.appointmentId),
      eq(customerBookingActionIdempotency.action, action),
      eq(customerBookingActionIdempotency.idempotencyKey, key),
    )).limit(1);
    if (!existing) return null;
    if (existing.requestFingerprint !== requestHash) {
      throw customerError(409, 'CUSTOMER_BOOKING_IDEMPOTENCY_CONFLICT', 'This request key was already used for a different change.');
    }
    return existing.responseJson;
  }

  private async remember(tx: any, row: AccessRow, access: CustomerBookingAccess, action: string, key: string, requestHash: string, response: unknown) {
    await tx.insert(customerBookingActionIdempotency).values({
      tenantId: row.tenantId,
      appointmentId: row.appointmentId,
      action,
      actorScopeHash: actorScope(access),
      idempotencyKey: key,
      requestFingerprint: requestHash,
      responseJson: response,
    });
  }

  private async cancelAppointmentReminders(tx: any, tenantId: string, appointmentId: string) {
    await tx.update(emailOutbox).set({ status: 'CANCELLED' }).where(and(
      eq(emailOutbox.tenantId, tenantId),
      eq(emailOutbox.relatedEntityType, 'appointment'),
      eq(emailOutbox.relatedEntityId, appointmentId),
      eq(emailOutbox.templateKey, 'appointment-reminder'),
      inArray(emailOutbox.status, ['PENDING', 'DELAYED', 'PROCESSING']),
    ));
    await this.sms.cancelAppointmentReminders(tenantId, appointmentId, tx);
  }

  private async cancelFutureAutomation(tx: any, tenantId: string, appointmentId: string) {
    await tx.update(automationActionRuns).set({ status: 'CANCELLED' }).where(and(
      eq(automationActionRuns.tenantId, tenantId),
      inArray(automationActionRuns.status, ['PENDING', 'SCHEDULED']),
      sql`${automationActionRuns.automationRunId} IN (
        SELECT id FROM automation_runs WHERE tenant_id = ${tenantId}::uuid AND source_id = ${appointmentId}::uuid
      )`,
    ));
  }

  private async rescheduleFormReminders(tx: any, row: AccessRow, newStart: Date) {
    await tx.execute(sql`
      UPDATE sms_outbox
      SET scheduled_for = ${newStart}::timestamptz - (${row.startTime}::timestamptz - scheduled_for),
          next_attempt_at = ${newStart}::timestamptz - (${row.startTime}::timestamptz - scheduled_for)
      WHERE tenant_id = ${row.tenantId}::uuid AND appointment_id = ${row.appointmentId}::uuid
        AND template_key = 'form-reminder' AND status IN ('PENDING','PROCESSING')
    `);
    await tx.execute(sql`
      UPDATE email_outbox e
      SET scheduled_for = ${newStart}::timestamptz - (${row.startTime}::timestamptz - e.scheduled_for),
          next_attempt_at = ${newStart}::timestamptz - (${row.startTime}::timestamptz - e.scheduled_for)
      FROM form_assignments f
      WHERE f.id = e.related_entity_id AND f.tenant_id = ${row.tenantId}::uuid
        AND f.appointment_id = ${row.appointmentId}::uuid AND e.template_key = 'form-reminder'
        AND e.status IN ('PENDING','DELAYED','PROCESSING')
    `);
  }

  private async cancelPendingFormReminders(tx: any, tenantId: string, appointmentId: string) {
    await tx.execute(sql`
      UPDATE email_outbox e
      SET status = 'CANCELLED'
      FROM form_assignments f
      WHERE f.id = e.related_entity_id AND f.tenant_id = ${tenantId}::uuid
        AND f.appointment_id = ${appointmentId}::uuid AND e.template_key = 'form-reminder'
        AND e.status IN ('PENDING','DELAYED','PROCESSING')
    `);
  }

  private managementUrl(access: CustomerBookingAccess, bookingReference: string) {
    const origin = env.PUBLIC_APP_ORIGIN || env.FRONTEND_ORIGIN;
    if (!origin) return undefined;
    const path = access.kind === 'GUEST'
      ? `/manage/${encodeURIComponent(access.token)}`
      : `/customer/appointments/${bookingReference}`;
    return `${origin}${path}`;
  }

  private async enqueueRescheduledNotifications(tx: any, row: AccessRow, staffName: string, newStart: Date, changeId: string, access: CustomerBookingAccess) {
    const local = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.timezone }).format(newStart);
    const oldLocal = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.timezone }).format(row.startTime);
    const managementUrl = this.managementUrl(access, row.bookingReference);
    if (row.bookingRescheduleEmailEnabled && row.clientEmail) {
      await this.email.enqueueEmail({
        tenantId: row.tenantId,
        recipientEmail: row.clientEmail,
        recipientName: row.clientName,
        replyToEmail: row.replyToEmail ?? undefined,
        templateKey: 'booking-rescheduled',
        templateDataJson: {
          tenantName: row.senderDisplayName || row.salonName,
          tenantPrimaryColor: row.primaryColor,
          customerName: row.clientName || 'there',
          bookingReference: row.bookingReference,
          serviceName: row.serviceName || 'Service',
          oldDateTime: oldLocal,
          newDateTime: local,
          staffName,
          location: row.locationName || (row.bookingChannel === 'mobile' ? 'Mobile service' : 'At the salon'),
          managementUrl,
        },
        idempotencyKey: `customer-reschedule-email:${changeId}`,
        relatedEntityType: 'appointment',
        relatedEntityId: row.appointmentId,
      }, tx);
    }
    const phone = row.clientPhone || row.clientPhoneFallback;
      if (row.smsEnabled && row.smsBookingRescheduleEnabled && phone) {
      await this.sms.enqueue({
        tenantId: row.tenantId,
        clientId: row.clientId,
        appointmentId: row.appointmentId,
        recipientPhone: phone,
        templateKey: 'booking-rescheduled',
        templateData: { appointmentDateTime: local, secureUrl: managementUrl },
        idempotencyKey: `customer-reschedule-sms:${changeId}`,
      }, tx);
      if (row.smsAppointmentRemindersEnabled) {
        const hours = row.smsReminderTiming === '24_and_48_hours_before' ? [48, 24]
          : row.smsReminderTiming === 'none' ? [] : [row.smsReminderTiming.startsWith('48') ? 48 : 24];
        for (const hoursBefore of hours) {
          const scheduledFor = new Date(newStart.getTime() - hoursBefore * 3_600_000);
          if (scheduledFor > new Date()) await this.sms.enqueue({
            tenantId: row.tenantId,
            clientId: row.clientId,
            appointmentId: row.appointmentId,
            recipientPhone: phone,
            templateKey: 'appointment-reminder',
            templateData: { appointmentDateTime: local, secureUrl: managementUrl },
            idempotencyKey: `customer-reminder-sms:${changeId}:${hoursBefore}`,
            scheduledFor,
            validUntil: newStart,
          }, tx);
        }
      }
      if (row.bookingRescheduleEmailEnabled && row.clientEmail) {
        const hours = row.smsReminderTiming === '24_and_48_hours_before' ? [48, 24] : row.smsReminderTiming === 'none' ? [] : [row.smsReminderTiming.startsWith('48') ? 48 : 24];
        for (const hoursBefore of hours) {
          const scheduledFor = new Date(newStart.getTime() - hoursBefore * 3_600_000);
          if (scheduledFor > new Date()) await this.email.enqueueEmail({
            tenantId: row.tenantId,
            recipientEmail: row.clientEmail,
            recipientName: row.clientName,
            replyToEmail: row.replyToEmail ?? undefined,
            templateKey: 'appointment-reminder',
            templateDataJson: { tenantName: row.senderDisplayName || row.salonName, tenantPrimaryColor: row.primaryColor, customerName: row.clientName || 'there', bookingDate: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: row.timezone }).format(newStart), bookingTime: new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: row.timezone }).format(newStart), serviceName: row.serviceName || 'your appointment', managementUrl },
            idempotencyKey: `customer-reminder-email:${changeId}:${hoursBefore}`,
            relatedEntityType: 'appointment',
            relatedEntityId: row.appointmentId,
            scheduledFor,
          }, tx);
        }
      }
    }
  }

  private async enqueueCancellationNotifications(tx: any, row: AccessRow, cancelledAt: Date, paymentImpact: string, changeId: string, access: CustomerBookingAccess) {
    const local = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.timezone }).format(row.startTime);
    const managementUrl = this.managementUrl(access, row.bookingReference);
    if (row.bookingCancellationEmailEnabled && row.clientEmail) {
      await this.email.enqueueEmail({
        tenantId: row.tenantId,
        recipientEmail: row.clientEmail,
        recipientName: row.clientName,
        replyToEmail: row.replyToEmail ?? undefined,
        templateKey: 'booking-cancelled',
        templateDataJson: {
          tenantName: row.senderDisplayName || row.salonName,
          tenantPrimaryColor: row.primaryColor,
          customerName: row.clientName || 'there',
          bookingReference: row.bookingReference,
          serviceName: row.serviceName || 'Service',
          cancelledDateTime: local,
          paymentImpact,
          contactPhone: row.contactPhone,
          managementUrl,
          cancellationRecordedAt: cancelledAt.toISOString(),
        },
        idempotencyKey: `customer-cancel-email:${changeId}`,
        relatedEntityType: 'appointment',
        relatedEntityId: row.appointmentId,
      }, tx);
    }
    const phone = row.clientPhone || row.clientPhoneFallback;
    if (row.smsEnabled && row.smsBookingCancellationEnabled && phone) await this.sms.enqueue({
      tenantId: row.tenantId,
      clientId: row.clientId,
      appointmentId: row.appointmentId,
      recipientPhone: phone,
      templateKey: 'booking-cancelled',
      templateData: { appointmentDateTime: local, paymentImpact, contactPhone: row.contactPhone, secureUrl: managementUrl },
      idempotencyKey: `customer-cancel-sms:${changeId}`,
    }, tx);
  }

  private mutationAppointment(row: AccessRow) {
    return {
      bookingReference: row.bookingReference,
      appointmentVersion: String(row.version),
      status: safeStatus(row.status),
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      staffName: row.staffName || 'Salon team',
    };
  }

  private safeAppointment(row: AccessRow, payment: CustomerBookingPaymentContext) {
    return {
      ...this.mutationAppointment(row),
      salon: {
        displayName: row.salonName,
        businessSlug: row.businessSlug,
        contactPhone: row.contactPhone,
        primaryColor: row.primaryColor,
      },
      serviceName: row.serviceName || 'Service',
      timezone: row.timezone,
      location: row.locationName || (row.bookingChannel === 'mobile' ? 'Mobile service' : 'At the salon'),
      payment: {
        quotedAmount: row.quotedAmount,
        paidAmount: payment.paidAmount,
        currency: row.currency,
        status: row.paymentStatus,
      },
      policy: this.evaluate(row, payment),
      requireCancellationReason: row.requireCancellationReason,
    };
  }
}
