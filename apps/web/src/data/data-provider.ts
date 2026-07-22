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
  ,BookingOperationsQuery, BookingOperationsResponse, BookingOperationsItem, BookingPageResponse, BookingPageUpdate, CreateBookingHold, BookingHoldResponse
  ,AppointmentsReportQuery, AppointmentsReportResponse, ClientsReportQuery, ClientsReportResponse,
  ServicesReportQuery, ServicesReportResponse, StaffReportQuery, StaffReportResponse,
  ProductsReportQuery, ProductsReportResponse, StockReportQuery, StockReportResponse,
  PaymentsReportQuery, PaymentsReportResponse, RefundsReportQuery, RefundsReportResponse,
  FormsReportQuery, FormsReportResponse, CommunicationsReportQuery, CommunicationsReportResponse,
  AdvancedAnalyticsQuery, AdvancedAnalyticsResponse, CreateReportExport, CreateReportSchedule, UpdateReportSchedule
} from '@ks-os/contracts';
import { MockDataProvider } from './mock-data-provider.js';

export interface DataProvider {
  getTenants(): Promise<BusinessTenant[]>;
  saveTenants(tenants: BusinessTenant[]): Promise<void>;

  getServices(tenantId: string): Promise<Service[]>;
  saveServices(tenantId: string, services: Service[]): Promise<void>;

  getStaff(tenantId: string): Promise<Staff[]>;
  saveStaff(tenantId: string, staffList: Staff[]): Promise<void>;

  getClients(tenantId: string): Promise<ClientProfile[]>;
  saveClients(tenantId: string, clientList: ClientProfile[]): Promise<void>;

  searchClients(query: any): Promise<any>;
  getClient(clientId: string): Promise<any>;

  getProducts(tenantId: string): Promise<Product[]>;
  saveProducts(tenantId: string, productList: Product[]): Promise<void>;

  getBookings(): Promise<Booking[]>;
  getBookingOperations(query: BookingOperationsQuery): Promise<BookingOperationsResponse>;
  getBookingDetail(bookingId: string): Promise<BookingOperationsItem>;
  /** @deprecated Do not use in live mode. Use granular methods instead. */
  saveBookings(bookings: Booking[]): Promise<void>;

  // Public Booking Methods
  getPublicCatalog(subdomain: string): Promise<any>;
  getPublicAvailability(subdomain: string, input: any): Promise<any>;
  getPublicBookingStatus(subdomain: string, reference: string): Promise<any>;
  createPublicBooking(subdomain: string, input: any): Promise<any>;
  createBookingHold(subdomain: string, input: CreateBookingHold): Promise<BookingHoldResponse>;
  releaseBookingHold(subdomain: string, holdId: string, token: string): Promise<void>;
  recordPublicBookingEvent(subdomain: string, input: Record<string, unknown>): Promise<void>;

  // Staff Booking Methods
  createStaffBooking(input: any): Promise<any>;
  updateBookingStatus(bookingId: string, status: string): Promise<void>;
  rescheduleBooking(bookingId: string, input: any): Promise<void>;
  cancelBooking(bookingId: string): Promise<void>;
  getBookingPageSettings(): Promise<BookingPageResponse>;
  updateBookingPageSettings(input: BookingPageUpdate): Promise<BookingPageResponse>;
  setBookingPagePublished(published: boolean): Promise<BookingPageResponse>;
  configureBookingCustomDomain(domain: string | null): Promise<any>;
  getBookingPageAnalytics(days?: number): Promise<any>;

  getEvents(): Promise<OutboxEvent[]>;
  saveEvents(events: OutboxEvent[]): Promise<void>;

  triggerEvent(bookingId: string, clientName: string, eventType: AutomationEvent, payloadObj: any): Promise<void>;

  // Live consent forms (tenant is always derived by the API)
  listForms(): Promise<any[]>;
  getForm(formId: string): Promise<any>;
  createForm(input: any): Promise<any>;
  updateForm(formId: string, input: any): Promise<any>;
  publishForm(formId: string): Promise<any>;
  archiveForm(formId: string): Promise<void>;
  listFormVersions(formId: string): Promise<any[]>;
  getFormVersion(formId: string, versionId: string): Promise<any>;
  createFormAssignment(input: any): Promise<any>;
  listFormAssignments(query?: Record<string, string>): Promise<any[]>;
  cancelFormAssignment(assignmentId: string): Promise<void>;
  regenerateFormLink(assignmentId: string): Promise<any>;
  listFormSubmissions(query?: Record<string, string>): Promise<any[]>;
  getFormSubmission(submissionId: string): Promise<any>;
  listTeam(): Promise<any>;
  getTeamMember(staffUserId:string):Promise<any>;
  createTeamInvitation(input:{email:string;name:string}):Promise<any>;
  resendTeamInvitation(invitationId:string):Promise<any>;
  cancelTeamInvitation(invitationId:string):Promise<void>;
  updateTeamMember(staffUserId:string,input:any):Promise<any>;
  updateTeamMemberServices(staffUserId:string,serviceIds:string[]):Promise<any>;
  updateTeamMemberSchedule(staffUserId:string,schedule:any[]):Promise<any>;
  updateTeamMemberBookingChannels(staffUserId:string,input:any):Promise<any>;
  previewTeamLifecycle(staffUserId:string,action:string):Promise<any>;
  applyTeamLifecycle(staffUserId:string,action:string):Promise<any>;
  /** @deprecated Prototype-only API retained until the old builder is removed. */
  getConsentTemplates(tenantId: string): Promise<any[]>;
  saveConsentTemplates(tenantId: string, templates: any[]): Promise<void>;
  getConsentSubmissions(tenantId: string): Promise<any[]>;
  saveConsentSubmissions(tenantId: string, submissions: any[]): Promise<void>;

  getCheckoutAppointments(): Promise<{ data: CheckoutCandidate[] }>;
  searchProducts(query?: string): Promise<{ data: ContractsProduct[] }>;
  previewCheckout(payload: CheckoutPreviewRequest): Promise<CheckoutPreviewResponse>;
  completeCheckout(payload: CheckoutRequest): Promise<CheckoutResponse>;

  // Stripe Connect Methods
  getStripeConnection(): Promise<any>;
  connectStripe(): Promise<any>;
  generateOnboardingLink(): Promise<any>;
  syncStripe(): Promise<any>;

  // Payment History & Refunds
  getPaymentHistory(query: PaymentHistoryQuery): Promise<{ data: PaymentHistoryItem[], nextCursor?: string }>;
  getPaymentDetail(transactionId: string): Promise<PaymentDetailResponse>;
  createRefund(transactionId: string, request: CreateRefundRequest): Promise<CreateRefundResponse>;

  // Finance Methods
  getStripeBalance(): Promise<StripeBalance>;
  getPayouts(query: PayoutListQuery): Promise<{ data: PayoutListItem[], nextCursor?: string }>;
  getPayoutDetail(id: string): Promise<PayoutDetailResponse>;
  getDisputes(query: DisputeListQuery): Promise<{ data: DisputeListItem[], nextCursor?: string }>;
  getDisputeDetail(id: string): Promise<DisputeDetailResponse>;

  // Communications
  getCommunicationsSettings(): Promise<CommunicationsSettingsResponse>;
  updateCommunicationsSettings(settings: UpdateCommunicationsSettingsRequest): Promise<void>;
  getEmailHistory(query: EmailHistoryQuery): Promise<{ data: EmailHistoryItem[], nextCursor?: string }>;
  getDashboardOverview(query: DashboardOverviewQuery): Promise<DashboardOverviewResponse>;
  getAppointmentsReport(query:AppointmentsReportQuery):Promise<AppointmentsReportResponse>;
  getClientsReport(query:ClientsReportQuery):Promise<ClientsReportResponse>;
  getServicesReport(query:ServicesReportQuery):Promise<ServicesReportResponse>;
  getStaffReport(query:StaffReportQuery):Promise<StaffReportResponse>;
  getProductsReport(query:ProductsReportQuery):Promise<ProductsReportResponse>;
  getStockReport(query:StockReportQuery):Promise<StockReportResponse>;
  getPaymentsReport(query:PaymentsReportQuery):Promise<PaymentsReportResponse>;
  getRefundsReport(query:RefundsReportQuery):Promise<RefundsReportResponse>;
  getFormsReport(query:FormsReportQuery):Promise<FormsReportResponse>;
  getCommunicationsReport(query:CommunicationsReportQuery):Promise<CommunicationsReportResponse>;
  createReportExport(input:CreateReportExport):Promise<any>;
  listReportExports():Promise<any>;
  downloadReportExport(exportId:string):Promise<any>;
  cancelReportExport(exportId:string):Promise<any>;
  listReportSchedules():Promise<any>;
  createReportSchedule(input:CreateReportSchedule):Promise<any>;
  updateReportSchedule(scheduleId:string,input:UpdateReportSchedule):Promise<any>;
  reportScheduleCommand(scheduleId:string,command:'pause'|'resume'|'delete'):Promise<any>;
  getReportScheduleRuns(scheduleId:string):Promise<any[]>;
  getAdvancedAnalytics(query:AdvancedAnalyticsQuery):Promise<AdvancedAnalyticsResponse>;
  listAutomations(): Promise<{ data: any[] }>;
  getAutomation(id: string): Promise<{ data: any }>;
  createAutomation(input: any): Promise<{ data: any }>;
  updateAutomation(id: string, input: any): Promise<{ data: any }>;
  automationCommand(id: string, command: 'activate'|'pause'|'archive'): Promise<any>;
  getAutomationRuns(id: string): Promise<{ data: any[] }>;
  getAutomationRun(id: string): Promise<{ data: any }>;
  getReputationOverview(): Promise<any>;
  listReviewConnections(): Promise<any[]>;
  listReviewLocations(): Promise<any[]>;
  configureGoogleReviewLink(input: any): Promise<any>;
  configureTrustpilot(input: any): Promise<any>;
  testReviewConnection(connectionId: string): Promise<any>;
  deleteReviewConnection(connectionId: string): Promise<void>;
  startGoogleReviewOauth(): Promise<any>;
  listReviewInvitationRules(): Promise<any[]>;
  createReviewInvitationRule(input: any): Promise<any>;
  updateReviewInvitationRule(ruleId: string, input: any): Promise<any>;
  reviewInvitationRuleCommand(ruleId: string, command: 'pause'|'resume'): Promise<any>;
  listReviewInvitations(query?: Record<string, string>): Promise<any[]>;
  listExternalReviews(query?: Record<string, string>): Promise<any[]>;
  syncExternalReviews(): Promise<any>;
  saveExternalReviewReply(reviewId: string, reply: string): Promise<void>;
  deleteExternalReviewReply(reviewId: string): Promise<void>;
}

import { ApiDataProvider } from './api-data-provider.js';

// Default to the API provider. Only use mock if explicitly enabled in dev.
const useMock = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_DATA === 'true';

let currentProvider: DataProvider = useMock ? new MockDataProvider() : new ApiDataProvider();

export function getDataProvider(): DataProvider {
  return currentProvider;
}

export function registerDataProvider(provider: DataProvider) {
  currentProvider = provider;
}
