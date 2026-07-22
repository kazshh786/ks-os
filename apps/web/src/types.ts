/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  depositPercentage: number; // e.g. 30
  address?: string;
  phone?: string;
  email?: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMin: number; // minutes
  category: string;
  requiresResource?: string; // Room, Chair, Equipment ID
}

export interface StaffSchedule {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  shopStart?: string; // "09:00"
  shopEnd?: string;
  mobileStart?: string; // "10:00"
  mobileEnd?: string;
  isOff: boolean;
  shopActive?: boolean; // If false, salon visits are not offered on this day
  mobileActive?: boolean; // If false, mobile visits are not offered on this day
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  rating: number;
  servicesHandled: string[]; // Service IDs
  schedules: StaffSchedule[];
  priceOverrides?: Record<string, number>; // serviceId -> price
  durationOverrides?: Record<string, number>; // serviceId -> minutes
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
  formulas?: string; // hair/skincare formulas
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
  reference: string; // e.g. "KS-8394-A"
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  visitType: VisitType;
  // Mobile details
  streetAddress?: string;
  city?: string;
  postcode?: string;
  accessInstructions?: string;
  
  serviceId: string;
  staffId: string;
  resourceId?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  duration: number;
  price: number;
  paidAmount: number;
  paymentStatus: 'Unpaid' | 'DepositPaid' | 'FullyPaid' | 'Hold';
  status: AppointmentStatus;
  internalNotes?: string;
  isBlockedTime?: boolean; // True if this slot is blocked for personal or fake overbooking reasons
  blockReason?: string; // Reason e.g. "Personal Break", "Fake Overbooking Fill"
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
  id: string; // product or service ID
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
