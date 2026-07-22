import { fetchWithAuth } from '../api/client.js';
import { DataProvider } from './data-provider.js';
import { 
  BusinessTenant, 
  Service, 
  Staff, 
  ClientProfile, 
  Product, 
  Booking, 
  OutboxEvent, 
  AutomationEvent 
} from './types.js';
import { 
  AvailabilityQuery, 
  AvailabilityResult, 
  CreateBookingRequest, 
  CreateBookingResponse, 
  BookingStatusResponse,
  StaffCreateBookingRequest, 
  RescheduleBookingRequest,
  CheckoutCandidate,
  CheckoutPreviewRequest,
  CheckoutPreviewResponse,
  CheckoutRequest,
  CheckoutResponse,
  Product as ContractsProduct,
  PaymentHistoryQuery,
  PaymentHistoryItem,
  PaymentDetailResponse,
  CreateRefundRequest,
  CreateRefundResponse,
  StripeBalance,
  PayoutListQuery,
  PayoutListItem,
  PayoutDetailResponse,
  DisputeListQuery,
  DisputeListItem,
  DisputeDetailResponse,
  CommunicationsSettingsResponse,
  UpdateCommunicationsSettingsRequest,
  EmailHistoryQuery,
  EmailHistoryItem,
  DashboardOverviewQuery,
  DashboardOverviewResponse
  ,AppointmentsReportQuery, AppointmentsReportResponse, ClientsReportQuery, ClientsReportResponse,
  ServicesReportQuery, ServicesReportResponse, StaffReportQuery, StaffReportResponse,
  ProductsReportQuery, ProductsReportResponse, StockReportQuery, StockReportResponse,
  PaymentsReportQuery, PaymentsReportResponse, RefundsReportQuery, RefundsReportResponse,
  FormsReportQuery, FormsReportResponse, CommunicationsReportQuery, CommunicationsReportResponse,
  AdvancedAnalyticsQuery, AdvancedAnalyticsResponse, CreateReportExport, CreateReportSchedule, UpdateReportSchedule
} from '@ks-os/contracts';
/**
 * PRODUCTION API DATA PROVIDER
 * 
 * In later phases, this provider will query the Fastify backend server.
 * Currently returns mock data/throws stubs to facilitate bootstrap verification.
 */
export class ApiDataProvider implements DataProvider {
  private async reputationRequest(path: string, init?: RequestInit) {
    const response = await fetchWithAuth('/api/v1/reputation' + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || body?.error?.code || body?.error || 'Reputation operation failed.');
    return body?.data;
  }
  getReputationOverview(){return this.reputationRequest('/overview');}
  listReviewConnections(){return this.reputationRequest('/connections');}
  listReviewLocations(){return this.reputationRequest('/locations');}
  configureGoogleReviewLink(input:any){return this.reputationRequest('/connections/google/link',{method:'POST',body:JSON.stringify(input)});}
  configureTrustpilot(input:any){return this.reputationRequest('/connections/trustpilot',{method:'POST',body:JSON.stringify(input)});}
  testReviewConnection(id:string){return this.reputationRequest(`/connections/${id}/test`,{method:'POST'});}
  async deleteReviewConnection(id:string){await this.reputationRequest(`/connections/${id}`,{method:'DELETE'});}
  startGoogleReviewOauth(){return this.reputationRequest('/connections/google/oauth/start',{method:'POST'});}
  listReviewInvitationRules(){return this.reputationRequest('/invitation-rules');}
  createReviewInvitationRule(input:any){return this.reputationRequest('/invitation-rules',{method:'POST',body:JSON.stringify(input)});}
  updateReviewInvitationRule(id:string,input:any){return this.reputationRequest(`/invitation-rules/${id}`,{method:'PATCH',body:JSON.stringify(input)});}
  reviewInvitationRuleCommand(id:string,command:'pause'|'resume'){return this.reputationRequest(`/invitation-rules/${id}/${command}`,{method:'POST'});}
  listReviewInvitations(query:Record<string,string>={}){return this.reputationRequest('/invitations?'+new URLSearchParams(query));}
  listExternalReviews(query:Record<string,string>={}){return this.reputationRequest('/reviews?'+new URLSearchParams(query));}
  syncExternalReviews(){return this.reputationRequest('/sync',{method:'POST'});}
  async saveExternalReviewReply(id:string,reply:string){await this.reputationRequest(`/reviews/${id}/reply`,{method:'POST',body:JSON.stringify({reply})});}
  async deleteExternalReviewReply(id:string){await this.reputationRequest(`/reviews/${id}/reply`,{method:'DELETE'});}
  private async reportingRequest(path:string,init?:RequestInit){const response=await fetchWithAuth(path,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.message||body.error?.code||'Report operation failed.');}if(response.status===204)return undefined;return(await response.json()).data;}
  createReportExport(input:CreateReportExport){return this.reportingRequest('/api/v1/report-exports',{method:'POST',body:JSON.stringify(input)});}
  listReportExports(){return this.reportingRequest('/api/v1/report-exports');}
  downloadReportExport(id:string){return this.reportingRequest(`/api/v1/report-exports/${id}/download`,{method:'POST'});}
  cancelReportExport(id:string){return this.reportingRequest(`/api/v1/report-exports/${id}/cancel`,{method:'POST'});}
  listReportSchedules(){return this.reportingRequest('/api/v1/report-schedules');}
  createReportSchedule(input:CreateReportSchedule){return this.reportingRequest('/api/v1/report-schedules',{method:'POST',body:JSON.stringify(input)});}
  updateReportSchedule(id:string,input:UpdateReportSchedule){return this.reportingRequest(`/api/v1/report-schedules/${id}`,{method:'PATCH',body:JSON.stringify(input)});}
  reportScheduleCommand(id:string,command:'pause'|'resume'|'delete'){return this.reportingRequest(`/api/v1/report-schedules/${id}${command==='delete'?'':`/${command}`}`,{method:command==='delete'?'DELETE':'POST'});}
  getReportScheduleRuns(id:string){return this.reportingRequest(`/api/v1/report-schedules/${id}/runs`);}
  async getAdvancedAnalytics(query:AdvancedAnalyticsQuery):Promise<AdvancedAnalyticsResponse>{const params=new URLSearchParams();for(const[key,value]of Object.entries(query))if(value!==undefined)params.set(key,String(value));return this.reportingRequest(`/api/v1/analytics/advanced/overview?${params}`);}
  private async reportRequest<T>(path:string,query:Record<string,unknown>):Promise<T>{
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const response=await fetchWithAuth(`${path}?${params}`);const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error?.message||'The report is unavailable.');return body.data as T;
  }
  getAppointmentsReport(query:AppointmentsReportQuery){return this.reportRequest<AppointmentsReportResponse>('/api/v1/reports/appointments',query);}
  getClientsReport(query:ClientsReportQuery){return this.reportRequest<ClientsReportResponse>('/api/v1/reports/clients',query);}
  getServicesReport(query:ServicesReportQuery){return this.reportRequest<ServicesReportResponse>('/api/v1/reports/services',query);}
  getStaffReport(query:StaffReportQuery){return this.reportRequest<StaffReportResponse>('/api/v1/reports/staff',query);}
  getProductsReport(query:ProductsReportQuery){return this.reportRequest<ProductsReportResponse>('/api/v1/reports/products',query);}
  getStockReport(query:StockReportQuery){return this.reportRequest<StockReportResponse>('/api/v1/reports/stock',query);}
  getPaymentsReport(query:PaymentsReportQuery){return this.reportRequest<PaymentsReportResponse>('/api/v1/reports/payments',query);}
  getRefundsReport(query:RefundsReportQuery){return this.reportRequest<RefundsReportResponse>('/api/v1/reports/refunds',query);}
  getFormsReport(query:FormsReportQuery){return this.reportRequest<FormsReportResponse>('/api/v1/reports/forms',query);}
  getCommunicationsReport(query:CommunicationsReportQuery){return this.reportRequest<CommunicationsReportResponse>('/api/v1/reports/communications',query);}
  async getDashboardOverview(query:DashboardOverviewQuery):Promise<DashboardOverviewResponse>{
    const params=new URLSearchParams({preset:query.preset});if(query.from)params.set('from',query.from);if(query.to)params.set('to',query.to);
    const response=await fetchWithAuth(`/api/v1/dashboard/overview?${params}`);const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error?.message||'Dashboard analytics are unavailable.');return body.data;
  }
  async getTenants(): Promise<BusinessTenant[]> {
    throw new Error('API Method not implemented: getTenants');
  }
  async saveTenants(tenants: BusinessTenant[]): Promise<void> {
    throw new Error('API Method not implemented: saveTenants');
  }

  async getServices(tenantId: string): Promise<Service[]> {
    const res = await fetchWithAuth('/api/v1/services');
    if (!res.ok) throw new Error('Failed to fetch services');
    const { data } = await res.json();
    return data.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price / 100,
      durationMin: s.duration,
      category: 'General'
    }));
  }
  async saveServices(tenantId: string, services: Service[]): Promise<void> {
    throw new Error('API Method not implemented: saveServices');
  }

  async getStaff(tenantId: string): Promise<Staff[]> {
    const res = await fetchWithAuth('/api/v1/staff');
    if (!res.ok) throw new Error('Failed to fetch staff');
    const { data } = await res.json();
    return data.map((s: any) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=random`,
      rating: 5.0,
      servicesHandled: [],
      schedules: []
    }));
  }
  async saveStaff(tenantId: string, staffList: Staff[]): Promise<void> {
    throw new Error('API Method not implemented: saveStaff');
  }

  /** @deprecated */
  async getClients(tenantId: string): Promise<ClientProfile[]> {
    throw new Error('API Method not implemented: getClients');
  }
  /** @deprecated */
  async saveClients(tenantId: string, clientList: ClientProfile[]): Promise<void> {
    throw new Error('API Method not implemented: saveClients');
  }

  async searchClients(query: any): Promise<any> {
    const params = new URLSearchParams(query as Record<string, string>).toString();
    const res = await fetchWithAuth(`/api/v1/clients?${params}`);
    if (!res.ok) throw new Error('Failed to search clients');
    const { data, meta } = await res.json();
    return { data, meta };
  }

  async getClient(clientId: string): Promise<any> {
    const res = await fetchWithAuth(`/api/v1/clients/${clientId}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('CLIENT_NOT_FOUND');
      throw new Error('Failed to fetch client details');
    }
    const { data } = await res.json();
    return data;
  }

  async getProducts(tenantId: string): Promise<Product[]> {
    throw new Error('API Method not implemented: getProducts');
  }
  async saveProducts(tenantId: string, productList: Product[]): Promise<void> {
    throw new Error('API Method not implemented: saveProducts');
  }

  async getBookings(): Promise<Booking[]> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const res = await fetchWithAuth(`/api/v1/bookings?from=${thirtyDaysAgo}&to=${thirtyDaysFuture}&limit=500`);
    if (!res.ok) throw new Error('Failed to fetch bookings');
    const { data } = await res.json();
    
    return data.map((b: any) => ({
      id: b.id,
      tenantId: 'current',
      reference: b.id.substring(0, 8),
      clientName: b.clientName,
      clientEmail: '',
      clientPhone: '',
      visitType: 'Shop',
      serviceId: b.serviceName, 
      staffId: b.staffName, 
      date: b.startTime.split('T')[0],
      startTime: new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      endTime: new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      duration: 60,
      price: 0,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
      status: (['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(b.status) ? 
        b.status.charAt(0) + b.status.slice(1).toLowerCase().replace('_', '') : 'Confirmed') as any,
      createdAt: b.startTime
    }));
  }

  /** @deprecated */
  async saveBookings(bookings: Booking[]): Promise<void> {
    throw new Error('saveBookings() is explicitly unsupported in live mode. Use granular methods.');
  }

  // Public Booking Methods
  async getPublicCatalog(subdomain: string): Promise<any> {
    const res = await fetch(`/api/v1/public/${subdomain}/catalog`);
    if (!res.ok) throw new Error('Failed to load catalog');
    return res.json();
  }

  async getPublicAvailability(subdomain: string, input: AvailabilityQuery): Promise<AvailabilityResult> {
    const params = new URLSearchParams(input as any).toString();
    const res = await fetch(`/api/v1/public/${subdomain}/availability?${params}`);
    if (!res.ok) throw new Error('Failed to load availability');
    return res.json();
  }

  async getPublicBookingStatus(subdomain: string, reference: string): Promise<BookingStatusResponse> {
    const res = await fetch(`/api/v1/public/${subdomain}/bookings/${reference}`);
    if (!res.ok) throw new Error('Failed to fetch booking status');
    return res.json();
  }

  async createPublicBooking(subdomain: string, input: CreateBookingRequest): Promise<CreateBookingResponse> {
    const res = await fetch(`/api/v1/public/${subdomain}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) throw new Error('SLOT_UNAVAILABLE');
      if (res.status === 402) throw new Error('PAYMENTS_NOT_AVAILABLE');
      throw new Error(data.error?.message || 'Failed to create public booking');
    }
    return data;
  }

  // Staff Booking Methods
  async createStaffBooking(input: StaffCreateBookingRequest): Promise<any> {
    const res = await fetchWithAuth('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) throw new Error('SLOT_UNAVAILABLE');
      throw new Error(data.error?.message || 'Failed to create staff booking');
    }
    return data;
  }

  async updateBookingStatus(bookingId: string, status: string): Promise<void> {
    const res = await fetchWithAuth(`/api/v1/bookings/${bookingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update status');
  }

  async rescheduleBooking(bookingId: string, input: RescheduleBookingRequest): Promise<void> {
    const res = await fetchWithAuth(`/api/v1/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      if (res.status === 409) throw new Error('SLOT_UNAVAILABLE');
      throw new Error('Failed to reschedule');
    }
  }

  async cancelBooking(bookingId: string): Promise<void> {
    const res = await fetchWithAuth(`/api/v1/bookings/${bookingId}/cancel`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to cancel booking');
  }

  async getEvents(): Promise<OutboxEvent[]> {
    throw new Error('API Method not implemented: getEvents');
  }
  async saveEvents(events: OutboxEvent[]): Promise<void> {
    throw new Error('API Method not implemented: saveEvents');
  }

  async triggerEvent(bookingId: string, clientName: string, eventType: AutomationEvent, payloadObj: any): Promise<void> {
    throw new Error('API Method not implemented: triggerEvent');
  }

  private async formsRequest(path: string, init?: RequestInit) { const response=await fetchWithAuth(path,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}}); if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.code||'FORM_REQUEST_FAILED');} if(response.status===204)return undefined; const body=await response.json();return body.data; }
  listForms(){return this.formsRequest('/api/v1/forms');}
  getForm(formId:string){return this.formsRequest(`/api/v1/forms/${formId}`);}
  createForm(input:any){return this.formsRequest('/api/v1/forms',{method:'POST',body:JSON.stringify(input)});}
  updateForm(formId:string,input:any){return this.formsRequest(`/api/v1/forms/${formId}`,{method:'PATCH',body:JSON.stringify(input)});}
  publishForm(formId:string){return this.formsRequest(`/api/v1/forms/${formId}/publish`,{method:'POST'});}
  archiveForm(formId:string){return this.formsRequest(`/api/v1/forms/${formId}/archive`,{method:'POST'});}
  listFormVersions(formId:string){return this.formsRequest(`/api/v1/forms/${formId}/versions`);}
  getFormVersion(formId:string,versionId:string){return this.formsRequest(`/api/v1/forms/${formId}/versions/${versionId}`);}
  createFormAssignment(input:any){return this.formsRequest('/api/v1/form-assignments',{method:'POST',body:JSON.stringify(input)});}
  listFormAssignments(query:Record<string,string>={}){return this.formsRequest(`/api/v1/form-assignments?${new URLSearchParams(query)}`);}
  cancelFormAssignment(id:string){return this.formsRequest(`/api/v1/form-assignments/${id}/cancel`,{method:'POST'});}
  regenerateFormLink(id:string){return this.formsRequest(`/api/v1/form-assignments/${id}/regenerate-link`,{method:'POST'});}
  listFormSubmissions(query:Record<string,string>={}){return this.formsRequest(`/api/v1/form-submissions?${new URLSearchParams(query)}`);}
  getFormSubmission(id:string){return this.formsRequest(`/api/v1/form-submissions/${id}`);}
  private async teamRequest(path:string,init?:RequestInit){const response=await fetchWithAuth(path,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.code||'TEAM_REQUEST_FAILED');}if(response.status===204)return;return(await response.json()).data;}
  listTeam(){return this.teamRequest('/api/v1/team');}
  getTeamMember(id:string){return this.teamRequest(`/api/v1/team/${id}`);}
  createTeamInvitation(input:{email:string;name:string}){return this.teamRequest('/api/v1/team/invitations',{method:'POST',body:JSON.stringify(input)});}
  resendTeamInvitation(id:string){return this.teamRequest(`/api/v1/team/invitations/${id}/resend`,{method:'POST'});}
  cancelTeamInvitation(id:string){return this.teamRequest(`/api/v1/team/invitations/${id}/cancel`,{method:'POST'});}
  updateTeamMember(id:string,input:any){return this.teamRequest(`/api/v1/team/${id}`,{method:'PATCH',body:JSON.stringify(input)});}
  updateTeamMemberServices(id:string,serviceIds:string[]){return this.teamRequest(`/api/v1/team/${id}/services`,{method:'PUT',body:JSON.stringify({serviceIds})});}
  updateTeamMemberSchedule(id:string,schedule:any[]){return this.teamRequest(`/api/v1/team/${id}/schedule`,{method:'PUT',body:JSON.stringify({schedule})});}
  updateTeamMemberBookingChannels(id:string,input:any){return this.teamRequest(`/api/v1/team/${id}/booking-channel-schedule`,{method:'PUT',body:JSON.stringify(input)});}
  previewTeamLifecycle(id:string,action:string){return this.teamRequest(`/api/v1/team/${id}/lifecycle/${action}/preview`);}
  applyTeamLifecycle(id:string,action:string){return this.teamRequest(`/api/v1/team/${id}/lifecycle`,{method:'POST',body:JSON.stringify({action,confirmed:true})});}
  async getConsentTemplates():Promise<any[]>{throw new Error('Deprecated consent prototype is disabled in live mode.');}
  async saveConsentTemplates():Promise<void>{throw new Error('Deprecated consent prototype is disabled in live mode.');}
  async getConsentSubmissions():Promise<any[]>{throw new Error('Deprecated consent prototype is disabled in live mode.');}
  async saveConsentSubmissions():Promise<void>{throw new Error('Deprecated consent prototype is disabled in live mode.');}

  // POS Methods
  async getCheckoutAppointments(): Promise<{ data: CheckoutCandidate[] }> {
    const response = await fetchWithAuth('/api/v1/pos/appointments');
    if (!response.ok) throw new Error('Failed to fetch checkout candidates');
    return response.json();
  }

  async searchProducts(query?: string): Promise<{ data: ContractsProduct[] }> {
    const response = await fetchWithAuth('/api/v1/products');
    if (!response.ok) throw new Error('Failed to fetch products');
    return response.json();
  }

  async previewCheckout(payload: CheckoutPreviewRequest): Promise<CheckoutPreviewResponse> {
    const response = await fetchWithAuth('/api/v1/pos/checkout/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error?.message || 'Failed to preview checkout');
    }
    return response.json();
  }

  async completeCheckout(payload: CheckoutRequest): Promise<CheckoutResponse> {
    const response = await fetchWithAuth('/api/v1/pos/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error?.message || 'Failed to process checkout');
    }
    return response.json();
  }

  // Stripe Connect Methods
  async getStripeConnection(): Promise<any> {
    const res = await fetchWithAuth('/api/v1/stripe/connection');
    if (!res.ok) throw new Error('Failed to get Stripe connection');
    return res.json();
  }

  async connectStripe(): Promise<any> {
    const res = await fetchWithAuth('/api/v1/stripe/connect', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to connect Stripe');
    return res.json();
  }

  async generateOnboardingLink(): Promise<any> {
    const res = await fetchWithAuth('/api/v1/stripe/onboarding-link', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to generate onboarding link');
    return res.json();
  }

  async syncStripe(): Promise<any> {
    const res = await fetchWithAuth('/api/v1/stripe/sync', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to sync Stripe');
    return res.json();
  }

  // Payment History & Refunds
  async getPaymentHistory(query: PaymentHistoryQuery): Promise<{ data: PaymentHistoryItem[], nextCursor?: string }> {
    const params = new URLSearchParams(query as any).toString();
    const response = await fetchWithAuth(`/api/v1/payments?${params}`);
    if (!response.ok) throw new Error('Failed to fetch payment history');
    return response.json();
  }

  async getPaymentDetail(transactionId: string): Promise<PaymentDetailResponse> {
    const response = await fetchWithAuth(`/api/v1/payments/${transactionId}`);
    if (!response.ok) throw new Error('Failed to fetch payment details');
    return response.json();
  }

  async createRefund(transactionId: string, request: CreateRefundRequest): Promise<CreateRefundResponse> {
    const response = await fetchWithAuth(`/api/v1/payments/${transactionId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error?.message || 'Failed to process refund');
    }
    return response.json();
  }

  // Finance Methods
  async getStripeBalance(): Promise<StripeBalance> {
    const res = await fetchWithAuth('/api/v1/finance/balance');
    if (!res.ok) throw new Error('Failed to fetch stripe balance');
    return res.json();
  }

  async getPayouts(query: PayoutListQuery): Promise<{ data: PayoutListItem[], nextCursor?: string }> {
    const params = new URLSearchParams(query as any).toString();
    const res = await fetchWithAuth(`/api/v1/finance/payouts?${params}`);
    if (!res.ok) throw new Error('Failed to fetch payouts');
    return res.json();
  }

  async getPayoutDetail(id: string): Promise<PayoutDetailResponse> {
    const res = await fetchWithAuth(`/api/v1/finance/payouts/${id}`);
    if (!res.ok) throw new Error('Failed to fetch payout detail');
    return res.json();
  }

  async getDisputes(query: DisputeListQuery): Promise<{ data: DisputeListItem[], nextCursor?: string }> {
    const params = new URLSearchParams(query as any).toString();
    const res = await fetchWithAuth(`/api/v1/finance/disputes?${params}`);
    if (!res.ok) throw new Error('Failed to fetch disputes');
    return res.json();
  }

  async getDisputeDetail(id: string): Promise<DisputeDetailResponse> {
    const res = await fetchWithAuth(`/api/v1/finance/disputes/${id}`);
    if (!res.ok) throw new Error('Failed to fetch dispute detail');
    return res.json();
  }

  // Communications
  async getCommunicationsSettings(): Promise<CommunicationsSettingsResponse> {
    const res = await fetchWithAuth('/api/v1/communications/settings');
    if (!res.ok) throw new Error('Failed to fetch communications settings');
    return res.json();
  }

  async listAutomations(){const r=await fetchWithAuth('/api/v1/automations');if(!r.ok)throw new Error('Failed to load automations');return r.json();}
  async getAutomation(id:string){const r=await fetchWithAuth(`/api/v1/automations/${id}`);if(!r.ok)throw new Error('Failed to load automation');return r.json();}
  async createAutomation(input:any){const r=await fetchWithAuth('/api/v1/automations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw new Error('Failed to create automation');return r.json();}
  async updateAutomation(id:string,input:any){const r=await fetchWithAuth(`/api/v1/automations/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw new Error('Failed to update automation');return r.json();}
  async automationCommand(id:string,command:'activate'|'pause'|'archive'){const r=await fetchWithAuth(`/api/v1/automations/${id}/${command}`,{method:'POST'});if(!r.ok)throw new Error(`Failed to ${command} automation`);return r.status===204?{}:r.json();}
  async getAutomationRuns(id:string){const r=await fetchWithAuth(`/api/v1/automations/${id}/runs`);if(!r.ok)throw new Error('Failed to load runs');return r.json();}
  async getAutomationRun(id:string){const r=await fetchWithAuth(`/api/v1/automation-runs/${id}`);if(!r.ok)throw new Error('Failed to load run');return r.json();}

  async updateCommunicationsSettings(settings: UpdateCommunicationsSettingsRequest): Promise<void> {
    const res = await fetchWithAuth('/api/v1/communications/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    });
    if (!res.ok) throw new Error('Failed to update communications settings');
  }

  async getEmailHistory(query: EmailHistoryQuery): Promise<{ data: EmailHistoryItem[], nextCursor?: string }> {
    const params = new URLSearchParams(query as any).toString();
    const res = await fetchWithAuth(`/api/v1/communications/history?${params}`);
    if (!res.ok) throw new Error('Failed to fetch email history');
    return res.json();
  }
}
