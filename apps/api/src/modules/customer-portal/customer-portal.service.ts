import {
  appointments, checkoutTransactions, customerAccounts, customerClientLinks,
  formAssignments, formVersions, getDatabase, services, stripeRefunds, tenants, users,
} from '@ks-os/database';
import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import type {
  CustomerAppointmentsQuery, CustomerFormSubmissionRequest, UpdateCustomerProfileRequest,
} from '@ks-os/contracts';
import { FormsService } from '../forms/forms.service.js';
import type { CustomerAuthContext } from './customer-auth.service.js';
import { customerError } from './customer-portal.errors.js';

const customerStatus = (status: string) => ({
  PENDING: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  IN_SERVICE: 'In progress',
  AWAITING_PAYMENT: 'Payment due',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed appointment',
} as Record<string, string>)[status] || 'Appointment update';

const paymentSource = (method: string, purpose: string) => {
  if (method === 'CARD' && purpose === 'booking_payment') return 'Online payment';
  if (method === 'CASH') return 'Cash recorded by salon';
  if (method === 'SPLIT') return 'Split payment';
  return 'External card-terminal payment';
};

export class CustomerPortalService {
  private readonly formsService = new FormsService();

  private linkJoin(customerAccountId: string, tenantId: any, clientId: any) {
    return and(
      eq(customerClientLinks.customerAccountId, customerAccountId),
      eq(customerClientLinks.status, 'ACTIVE'),
      eq(customerClientLinks.tenantId, tenantId),
      eq(customerClientLinks.clientId, clientId),
    );
  }

  async getSession(customer: CustomerAuthContext) {
    const [profile] = await this.getDatabase().select({
      displayName: customerAccounts.displayName,
      phone: customerAccounts.phoneE164,
    }).from(customerAccounts).where(eq(customerAccounts.id, customer.customerAccountId)).limit(1);
    return {
      authenticated: true,
      customer: {
        displayName: profile?.displayName ?? customer.displayName,
        email: customer.email,
        phone: profile?.phone ?? customer.phone,
      },
      linkedBusinesses: await this.listBusinesses(customer),
    };
  }

  async listBusinesses(customer: CustomerAuthContext) {
    const db = this.getDatabase();
    return db.select({
      businessSlug: tenants.subdomain,
      displayName: tenants.name,
      primaryColor: tenants.primaryColor,
      contactPhone: tenants.operationalPhone,
    }).from(customerClientLinks)
      .innerJoin(tenants, eq(tenants.id, customerClientLinks.tenantId))
      .where(and(
        eq(customerClientLinks.customerAccountId, customer.customerAccountId),
        eq(customerClientLinks.status, 'ACTIVE'),
      ))
      .orderBy(tenants.name).then((rows) => rows.map((row) => ({ ...row, logoUrl: null })));
  }

  async listAppointments(customer: CustomerAuthContext, query: CustomerAppointmentsQuery) {
    const db = this.getDatabase();
    const now = new Date();
    const scope = query.status === 'CANCELLED'
      ? eq(appointments.status, 'CANCELLED')
      : query.status === 'PAST'
        ? and(lt(appointments.startTime, now), ne(appointments.status, 'CANCELLED'), ne(appointments.status, 'BLOCKED'))
        : and(gte(appointments.startTime, now), ne(appointments.status, 'CANCELLED'), ne(appointments.status, 'BLOCKED'));

    const rows = await db.select({
      bookingReference: appointments.publicReference,
      status: appointments.status,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      quotedAmount: appointments.quotedAmount,
      businessSlug: tenants.subdomain,
      salonName: tenants.name,
      timezone: tenants.timezone,
      serviceName: services.name,
      staffName: users.name,
      bookingChannel: appointments.bookingChannel,
      appointmentId: appointments.id,
      appointmentVersion: appointments.version,
    }).from(appointments)
      .innerJoin(customerClientLinks, this.linkJoin(customer.customerAccountId, appointments.tenantId, appointments.clientId))
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
      .leftJoin(users, and(eq(users.id, appointments.userId), eq(users.tenantId, appointments.tenantId)))
      .where(and(scope, query.business ? eq(tenants.subdomain, query.business) : undefined))
      .orderBy(query.status === 'UPCOMING' ? appointments.startTime : desc(appointments.startTime))
      .limit(query.limit);

    const summaries = await this.paymentSummaries(rows.map((row) => row.appointmentId));
    return rows.map((row) => {
      const payment = summaries.get(row.appointmentId) ?? { paidAmount: 0, refundedAmount: 0 };
      return {
        bookingReference: row.bookingReference,
        businessSlug: row.businessSlug,
        salonName: row.salonName,
        serviceName: row.serviceName || 'Service',
        staffName: row.staffName || 'Salon team',
        startTime: row.startTime.toISOString(),
        endTime: row.endTime.toISOString(),
        timezone: row.timezone,
        status: customerStatus(row.status),
        location: row.bookingChannel === 'mobile' ? 'Mobile service' : 'At the salon',
        payment: this.paymentSummary(row.quotedAmount, payment.paidAmount, payment.refundedAmount),
      };
    });
  }

  async getAppointment(customer: CustomerAuthContext, bookingReference: string) {
    const db = this.getDatabase();
    const [row] = await db.select({
      bookingReference: appointments.publicReference,
      status: appointments.status,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      quotedAmount: appointments.quotedAmount,
      salonName: tenants.name,
      businessSlug: tenants.subdomain,
      timezone: tenants.timezone,
      contactPhone: tenants.operationalPhone,
      serviceName: services.name,
      staffName: users.name,
      bookingChannel: appointments.bookingChannel,
      appointmentId: appointments.id,
      appointmentVersion: appointments.version,
    }).from(appointments)
      .innerJoin(customerClientLinks, this.linkJoin(customer.customerAccountId, appointments.tenantId, appointments.clientId))
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .leftJoin(services, and(eq(services.id, appointments.serviceId), eq(services.tenantId, appointments.tenantId)))
      .leftJoin(users, and(eq(users.id, appointments.userId), eq(users.tenantId, appointments.tenantId)))
      .where(and(eq(appointments.publicReference, bookingReference), ne(appointments.status, 'BLOCKED')))
      .limit(1);
    if (!row) throw customerError(404, 'CUSTOMER_APPOINTMENT_NOT_FOUND', 'Appointment not found.');

    const payment = (await this.paymentSummaries([row.appointmentId])).get(row.appointmentId) ?? { paidAmount: 0, refundedAmount: 0 };
    const forms = await this.listForms(customer, bookingReference);
    return {
      bookingReference: row.bookingReference,
      appointmentVersion: String(row.appointmentVersion),
      salon: { displayName: row.salonName, businessSlug: row.businessSlug, contactPhone: row.contactPhone },
      serviceName: row.serviceName || 'Service',
      staffName: row.staffName || 'Salon team',
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      timezone: row.timezone,
      status: customerStatus(row.status),
      location: row.bookingChannel === 'mobile' ? 'Mobile service' : 'At the salon',
      payment: this.paymentSummary(row.quotedAmount, payment.paidAmount, payment.refundedAmount),
      forms,
    };
  }

  async listForms(customer: CustomerAuthContext, bookingReference?: string) {
    const db = this.getDatabase();
    const rows = await db.select({
      assignmentReference: formAssignments.publicReference,
      status: formAssignments.status,
      expiresAt: formAssignments.expiresAt,
      submittedAt: formAssignments.submittedAt,
      formTitle: formVersions.titleSnapshot,
      version: formVersions.versionNumber,
      bookingReference: appointments.publicReference,
      businessSlug: tenants.subdomain,
      salonName: tenants.name,
    }).from(formAssignments)
      .innerJoin(customerClientLinks, this.linkJoin(customer.customerAccountId, formAssignments.tenantId, formAssignments.clientId))
      .innerJoin(formVersions, and(eq(formVersions.id, formAssignments.formVersionId), eq(formVersions.tenantId, formAssignments.tenantId)))
      .innerJoin(tenants, eq(tenants.id, formAssignments.tenantId))
      .leftJoin(appointments, and(eq(appointments.id, formAssignments.appointmentId), eq(appointments.tenantId, formAssignments.tenantId)))
      .where(bookingReference ? eq(appointments.publicReference, bookingReference) : undefined)
      .orderBy(desc(formAssignments.createdAt));
    return rows.map((row) => ({
      assignmentReference: row.assignmentReference,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      title: row.formTitle,
      version: row.version,
      bookingReference: row.bookingReference,
      businessSlug: row.businessSlug,
      salonName: row.salonName,
    }));
  }

  async getForm(customer: CustomerAuthContext, assignmentReference: string) {
    const db = this.getDatabase();
    const [row] = await db.select({
      assignmentId: formAssignments.id,
      tenantId: formAssignments.tenantId,
      status: formAssignments.status,
      expiresAt: formAssignments.expiresAt,
      title: formVersions.titleSnapshot,
      description: formVersions.descriptionSnapshot,
      schema: formVersions.schemaJson,
      acknowledgementText: formVersions.acknowledgementText,
      salonName: tenants.name,
      primaryColor: tenants.primaryColor,
      secondaryColor: tenants.secondaryColor,
      accentColor: tenants.accentColor,
    }).from(formAssignments)
      .innerJoin(customerClientLinks, this.linkJoin(customer.customerAccountId, formAssignments.tenantId, formAssignments.clientId))
      .innerJoin(formVersions, and(eq(formVersions.id, formAssignments.formVersionId), eq(formVersions.tenantId, formAssignments.tenantId)))
      .innerJoin(tenants, eq(tenants.id, formAssignments.tenantId))
      .where(eq(formAssignments.publicReference, assignmentReference)).limit(1);
    if (!row) throw customerError(404, 'CUSTOMER_FORM_NOT_FOUND', 'Form not found.');
    if (row.status === 'CANCELLED' || row.status === 'EXPIRED' || row.expiresAt <= new Date()) {
      throw customerError(410, 'CUSTOMER_FORM_NOT_FOUND', 'This form is unavailable.');
    }
    if (row.status === 'PENDING') {
      await db.update(formAssignments).set({ status: 'OPENED', openedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(formAssignments.id, row.assignmentId), eq(formAssignments.tenantId, row.tenantId)));
    }
    return {
      salon: { name: row.salonName, primaryColor: row.primaryColor, secondaryColor: row.secondaryColor, accentColor: row.accentColor },
      form: { title: row.title, description: row.description, schema: row.schema, acknowledgementText: row.acknowledgementText },
      expiresAt: row.expiresAt.toISOString(),
      completed: row.status === 'SUBMITTED',
    };
  }

  async submitForm(customer: CustomerAuthContext, assignmentReference: string, input: CustomerFormSubmissionRequest) {
    return this.formsService.submitCustomerPortal(customer.customerAccountId, assignmentReference, input);
  }

  async listPayments(customer: CustomerAuthContext) {
    const db = this.getDatabase();
    const rows = await db.select({
      appointmentId: appointments.id,
      bookingReference: appointments.publicReference,
      salonName: tenants.name,
      createdAt: checkoutTransactions.createdAt,
      totalAmount: checkoutTransactions.totalAmount,
      paymentStatus: checkoutTransactions.paymentStatus,
      paymentMethod: checkoutTransactions.paymentMethod,
      purpose: checkoutTransactions.purpose,
      transactionId: checkoutTransactions.id,
      currency: tenants.currency,
    }).from(checkoutTransactions)
      .innerJoin(appointments, and(eq(appointments.id, checkoutTransactions.appointmentId), eq(appointments.tenantId, checkoutTransactions.tenantId)))
      .innerJoin(customerClientLinks, this.linkJoin(customer.customerAccountId, appointments.tenantId, appointments.clientId))
      .innerJoin(tenants, eq(tenants.id, appointments.tenantId))
      .orderBy(desc(checkoutTransactions.createdAt));
    const refunds = await this.refundsByTransaction(rows.map((row) => row.transactionId));
    return rows.map((row) => {
      const refundedAmount = refunds.get(row.transactionId) ?? 0;
      return {
        bookingReference: row.bookingReference,
        salonName: row.salonName,
        date: row.createdAt.toISOString(),
        grossAmount: row.totalAmount,
        refundedAmount,
        netPaid: Math.max(row.totalAmount - refundedAmount, 0),
        currency: row.currency,
        paymentStatus: row.paymentStatus === 'SUCCEEDED' ? (refundedAmount ? 'Partially refunded' : 'Paid') : row.paymentStatus === 'REFUNDED' ? 'Refunded' : row.paymentStatus === 'FAILED' ? 'Failed' : 'Pending',
        paymentSource: paymentSource(row.paymentMethod, row.purpose),
      };
    });
  }

  async getProfile(customer: CustomerAuthContext) {
    const [profile] = await this.getDatabase().select({
      displayName: customerAccounts.displayName,
      phone: customerAccounts.phoneE164,
    }).from(customerAccounts).where(eq(customerAccounts.id, customer.customerAccountId)).limit(1);
    return { email: customer.email, displayName: profile?.displayName ?? customer.displayName, phone: profile?.phone ?? customer.phone, linkedBusinesses: await this.listBusinesses(customer) };
  }

  async updateProfile(customer: CustomerAuthContext, input: UpdateCustomerProfileRequest) {
    const nextPhone = input.phone === null ? null : input.phone?.trim();
    if (nextPhone && !/^\+[1-9]\d{6,14}$/.test(nextPhone)) {
      throw customerError(400, 'CUSTOMER_PROFILE_UPDATE_FAILED', 'Enter a phone number in international format.');
    }
    const [profile] = await this.getDatabase().update(customerAccounts).set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.phone !== undefined ? { phoneE164: nextPhone } : {}),
      updatedAt: new Date(),
    }).where(eq(customerAccounts.id, customer.customerAccountId)).returning({
      displayName: customerAccounts.displayName,
      phone: customerAccounts.phoneE164,
    });
    if (!profile) throw customerError(400, 'CUSTOMER_PROFILE_UPDATE_FAILED', 'Profile update failed.');
    // Customer profile changes intentionally do not overwrite tenant CRM records.
    return { email: customer.email, displayName: profile.displayName, phone: profile.phone };
  }

  private getDatabase() {
    return getDatabase();
  }

  private async paymentSummaries(appointmentIds: string[]) {
    const summaries = new Map<string, { paidAmount: number; refundedAmount: number }>();
    if (!appointmentIds.length) return summaries;
    const db = this.getDatabase();
    const transactions = await db.select({
      id: checkoutTransactions.id,
      appointmentId: checkoutTransactions.appointmentId,
      totalAmount: checkoutTransactions.totalAmount,
      status: checkoutTransactions.paymentStatus,
    }).from(checkoutTransactions).where(inArray(checkoutTransactions.appointmentId, appointmentIds));
    const refunds = await this.refundsByTransaction(transactions.map((transaction) => transaction.id));
    for (const transaction of transactions) {
      if (!['SUCCEEDED', 'REFUNDED'].includes(transaction.status)) continue;
      const existing = summaries.get(transaction.appointmentId) ?? { paidAmount: 0, refundedAmount: 0 };
      const refundedAmount = refunds.get(transaction.id) ?? 0;
      existing.refundedAmount += refundedAmount;
      existing.paidAmount += Math.max(transaction.totalAmount - refundedAmount, 0);
      summaries.set(transaction.appointmentId, existing);
    }
    return summaries;
  }

  private async refundsByTransaction(transactionIds: string[]) {
    const totals = new Map<string, number>();
    if (!transactionIds.length) return totals;
    const refunds = await this.getDatabase().select({
      transactionId: stripeRefunds.checkoutTransactionId,
      amount: stripeRefunds.amount,
      status: stripeRefunds.status,
    }).from(stripeRefunds).where(inArray(stripeRefunds.checkoutTransactionId, transactionIds));
    for (const refund of refunds) {
      if (refund.status === 'SUCCEEDED') totals.set(refund.transactionId, (totals.get(refund.transactionId) ?? 0) + refund.amount);
    }
    return totals;
  }

  private paymentSummary(quotedAmount: number, paidAmount: number, refundedAmount: number) {
    return {
      quotedAmount,
      paidAmount,
      refundedAmount,
      outstandingAmount: Math.max(quotedAmount - paidAmount, 0),
      status: quotedAmount <= 0 ? 'No payment required' : paidAmount >= quotedAmount ? 'Paid' : paidAmount > 0 ? 'Partially paid' : 'Payment due',
    };
  }
}
