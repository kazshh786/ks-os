export type PlatformPlan = 'Starter' | 'Plus' | 'Pro';
export type VisitType = 'Shop' | 'Mobile';
export type PaymentPolicy = 'NoPayment' | 'PayLater' | 'Deposit' | 'FullPayment' | 'CustomerChoice';
export type AppointmentStatus = 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled' | 'NoShow';
export type AutomationEvent = 'Created' | 'Cancelled' | 'Rescheduled' | 'Completed' | 'NoShow';

export interface BusinessTenant {
  id: string;
  name: string;
  subdomain: string;
  customDomain?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  timezone: string;
  currency: string;
  plan: PlatformPlan;
  paymentPolicy: PaymentPolicy;
  depositPercentage: number;
  address?: string;
  phone?: string;
  email?: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMin: number;
  category: string;
  requiresResource?: string;
}

export interface StaffSchedule {
  dayOfWeek: number;
  shopStart?: string;
  shopEnd?: string;
  mobileStart?: string;
  mobileEnd?: string;
  isOff: boolean;
  shopActive?: boolean;
  mobileActive?: boolean;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  rating: number;
  servicesHandled: string[];
  schedules: StaffSchedule[];
  priceOverrides?: Record<string, number>;
  durationOverrides?: Record<string, number>;
}

export interface Resource {
  id: string;
  name: string;
  type: 'Room' | 'Equipment' | 'Chair';
  capacity: number;
}

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  streetAddress?: string;
  city?: string;
  postcode?: string;
  medicalNotes?: string;
  allergies?: string;
  formulas?: string;
  patchTestDate?: string;
  patchTestResult?: 'Positive' | 'Negative' | 'Pending';
  loyaltyPoints: number;
  walletBalance: number;
  giftCardBalance: number;
  packages: Array<{ name: string; remaining: number }>;
  formSubmissions: Array<{ title: string; date: string; status: 'Completed' | 'Pending' }>;
}

export interface Booking {
  id: string;
  tenantId: string;
  clientId?: string;
  reference: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  visitType: VisitType;
  streetAddress?: string;
  city?: string;
  postcode?: string;
  accessInstructions?: string;
  serviceId: string;
  staffId: string;
  resourceId?: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  price: number;
  paidAmount: number;
  paymentStatus: 'Unpaid' | 'DepositPaid' | 'FullyPaid' | 'Hold';
  status: AppointmentStatus;
  internalNotes?: string;
  isBlockedTime?: boolean;
  blockReason?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  category: string;
  image?: string;
}

export interface POSItem {
  id: string;
  name: string;
  type: 'Service' | 'Product';
  price: number;
  quantity: number;
}

export interface OutboxEvent {
  id: string;
  bookingId: string;
  clientName: string;
  eventType: AutomationEvent;
  timestamp: string;
  status: 'Pending' | 'Delivered' | 'Failed';
  attempts: number;
  payload: string;
}
