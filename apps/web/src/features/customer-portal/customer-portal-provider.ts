import type {
  CustomerBookingManagementPolicy,
  CustomerCancellationRequest,
  CustomerCancellationResponse,
  CustomerFormSubmissionRequest,
  CustomerRescheduleAvailabilityResponse,
  CustomerRescheduleRequest,
  CustomerRescheduleResponse,
  UpdateCustomerProfileRequest,
} from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client.js';

export interface CustomerPortalProvider {
  getSession(): Promise<any>;
  listBusinesses(): Promise<any[]>;
  listAppointments(query?: Record<string, string>): Promise<any[]>;
  getAppointment(bookingReference: string): Promise<any>;
  getManagementPolicy(bookingReference: string): Promise<CustomerBookingManagementPolicy>;
  getRescheduleAvailability(bookingReference: string, date: string): Promise<CustomerRescheduleAvailabilityResponse>;
  reschedule(bookingReference: string, input: CustomerRescheduleRequest): Promise<CustomerRescheduleResponse>;
  cancel(bookingReference: string, input: CustomerCancellationRequest): Promise<CustomerCancellationResponse>;
  getGuestAppointment(token: string): Promise<any>;
  getGuestRescheduleAvailability(token: string, date: string): Promise<CustomerRescheduleAvailabilityResponse>;
  rescheduleGuest(token: string, input: CustomerRescheduleRequest): Promise<CustomerRescheduleResponse>;
  cancelGuest(token: string, input: CustomerCancellationRequest): Promise<CustomerCancellationResponse>;
  listForms(): Promise<any[]>;
  getForm(assignmentReference: string): Promise<any>;
  submitForm(assignmentReference: string, input: CustomerFormSubmissionRequest): Promise<any>;
  listPayments(): Promise<any[]>;
  listReviewInvitations(): Promise<any[]>;
  getProfile(): Promise<any>;
  updateProfile(input: UpdateCustomerProfileRequest): Promise<any>;
}

export class ApiCustomerPortalProvider implements CustomerPortalProvider {
  private async request(path: string, init?: RequestInit) {
    const response = await fetchWithAuth(`/api/v1/customer${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.code || 'CUSTOMER_PORTAL_UNAVAILABLE');
    return body.data;
  }

  getSession() { return this.request('/session'); }
  listBusinesses() { return this.request('/businesses'); }
  listAppointments(query: Record<string, string> = {}) { return this.request(`/appointments?${new URLSearchParams(query)}`); }
  getAppointment(bookingReference: string) { return this.request(`/appointments/${bookingReference}`); }
  getManagementPolicy(bookingReference: string) { return this.request(`/appointments/${bookingReference}/policy`); }
  getRescheduleAvailability(bookingReference: string, date: string) { return this.request(`/appointments/${bookingReference}/reschedule-availability?${new URLSearchParams({ date })}`); }
  reschedule(bookingReference: string, input: CustomerRescheduleRequest) { return this.request(`/appointments/${bookingReference}/reschedule`, { method: 'POST', body: JSON.stringify(input) }); }
  cancel(bookingReference: string, input: CustomerCancellationRequest) { return this.request(`/appointments/${bookingReference}/cancel`, { method: 'POST', body: JSON.stringify(input) }); }
  getGuestAppointment(token: string) { return this.request(`/manage/${encodeURIComponent(token)}`); }
  getGuestRescheduleAvailability(token: string, date: string) { return this.request(`/manage/${encodeURIComponent(token)}/reschedule-availability?${new URLSearchParams({ date })}`); }
  rescheduleGuest(token: string, input: CustomerRescheduleRequest) { return this.request(`/manage/${encodeURIComponent(token)}/reschedule`, { method: 'POST', body: JSON.stringify(input) }); }
  cancelGuest(token: string, input: CustomerCancellationRequest) { return this.request(`/manage/${encodeURIComponent(token)}/cancel`, { method: 'POST', body: JSON.stringify(input) }); }
  listForms() { return this.request('/forms'); }
  getForm(assignmentReference: string) { return this.request(`/forms/${assignmentReference}`); }
  submitForm(assignmentReference: string, input: CustomerFormSubmissionRequest) { return this.request(`/forms/${assignmentReference}/submissions`, { method: 'POST', body: JSON.stringify(input) }); }
  listPayments() { return this.request('/payments'); }
  listReviewInvitations() { return this.request('/review-invitations'); }
  getProfile() { return this.request('/profile'); }
  updateProfile(input: UpdateCustomerProfileRequest) { return this.request('/profile', { method: 'PATCH', body: JSON.stringify(input) }); }
}

export const customerPortalProvider = new ApiCustomerPortalProvider();
