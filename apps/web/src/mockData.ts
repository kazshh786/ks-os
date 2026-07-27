/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BusinessTenant, Service, Staff, ClientProfile, Booking, Product, OutboxEvent, Resource, StaffSchedule, AutomationEvent } from './types';

export const TENANTS: BusinessTenant[] = [
  {
    id: 'sovereign-gents',
    name: 'Sovereign Gents Barbershop',
    subdomain: 'sovereign.kasimshah.com',
    customDomain: 'sovereigngents.co.uk',
    primaryColor: '#b45309', // amber-700
    secondaryColor: '#1e293b', // slate-800
    timezone: 'Europe/London',
    currency: 'GBP',
    plan: 'Plus',
    paymentPolicy: 'CustomerChoice',
    depositPercentage: 30,
    address: '88 Shoreditch High St, London E1 6JQ',
    phone: '+44 20 7123 4567',
    email: 'hello@sovereigngents.com'
  },
  {
    id: 'aura-aesthetics',
    name: 'Aura Aesthetics and Nails',
    subdomain: 'aura.kasimshah.com',
    customDomain: 'aurasalon.com',
    primaryColor: '#ec4899', // pink-500
    secondaryColor: '#0f172a', // slate-900
    timezone: 'Europe/London',
    currency: 'GBP',
    plan: 'Pro',
    paymentPolicy: 'Deposit',
    depositPercentage: 30,
    address: '14 Kensington Church St, London W8 4EP',
    phone: '+44 20 8987 6543',
    email: 'info@aurasalon.com'
  }
];

export const SERVICES: Record<string, Service[]> = {
  'sovereign-gents': [
    { id: 'sg-haircut', name: 'Signature Haircut', description: 'Precision cut, wash, hot towel finish and custom styling.', price: 35, durationMin: 30, category: 'Hair' },
    { id: 'sg-beard', name: 'Beard Trim and Hot Towel Shave', description: 'Beard sculpting, razor lines, essential oils and hot towel.', price: 25, durationMin: 30, category: 'Beard' },
    { id: 'sg-combo', name: 'Sovereign Haircut and Beard Combo', description: 'The ultimate grooming experience including haircut, wash, beard sculpt and luxury hot towel finish.', price: 55, durationMin: 60, category: 'Combos' },
    { id: 'sg-facial', name: 'Charcoal Face Mask and Peel', description: 'Deep exfoliating charcoal peel to clear pores and refresh the skin.', price: 20, durationMin: 20, category: 'Skincare' }
  ],
  'aura-aesthetics': [
    { id: 'aa-gel-mani', name: 'Gel Manicure', description: 'Nail shaping, cuticle care, high-shine professional Gel bottle polish, and moisture massage.', price: 40, durationMin: 45, category: 'Nails' },
    { id: 'aa-lash-lift', name: 'Lash Lift and Tint', description: 'Boosts and lifts your natural lashes from the root, including a professional dark tint.', price: 60, durationMin: 60, category: 'Lashes', requiresResource: 'res-facial-suite' },
    { id: 'aa-hydrafacial', name: 'Advanced Hydrafacial', description: 'Multi-step facial treatment to cleanse, exfoliate, and hydrate the skin with antioxidants.', price: 120, durationMin: 60, category: 'Aesthetics', requiresResource: 'res-facial-suite' },
    { id: 'aa-brow-lam', name: 'Brow Lamination and Shape', description: 'Restructuring the brow hairs to keep them in a desired fuller shape.', price: 50, durationMin: 45, category: 'Brows' }
  ]
};

export const RESOURCES: Record<string, Resource[]> = {
  'sovereign-gents': [
    { id: 'res-chair-1', name: 'Barber Chair 1', type: 'Chair', capacity: 1 },
    { id: 'res-chair-2', name: 'Barber Chair 2', type: 'Chair', capacity: 1 }
  ],
  'aura-aesthetics': [
    { id: 'res-facial-suite', name: 'Facial and Lash Room A', type: 'Room', capacity: 1 },
    { id: 'res-nail-station-1', name: 'Nail Station 1', type: 'Chair', capacity: 1 }
  ]
};

const DEFAULT_SCHEDULES: StaffSchedule[] = [
  { dayOfWeek: 0, isOff: true }, // Sun
  { dayOfWeek: 1, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false }, // Mon
  { dayOfWeek: 2, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false }, // Tue
  { dayOfWeek: 3, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false }, // Wed
  { dayOfWeek: 4, shopStart: '09:00', shopEnd: '20:00', mobileStart: '10:00', mobileEnd: '19:00', isOff: false }, // Thu
  { dayOfWeek: 5, shopStart: '09:00', shopEnd: '20:00', mobileStart: '10:00', mobileEnd: '19:00', isOff: false }, // Fri
  { dayOfWeek: 6, shopStart: '09:00', shopEnd: '17:00', isOff: false } // Sat
];

export const STAFF: Record<string, Staff[]> = {
  'sovereign-gents': [
    {
      id: 'st-kasim',
      name: 'Kasim Shah',
      role: 'Master Barber and Founder',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      rating: 5.0,
      servicesHandled: ['sg-haircut', 'sg-beard', 'sg-combo', 'sg-facial'],
      schedules: DEFAULT_SCHEDULES,
      priceOverrides: { 'sg-combo': 60 } // Master pricing
    },
    {
      id: 'st-liam',
      name: 'Liam Ross',
      role: 'Senior Grooming Expert',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      rating: 4.8,
      servicesHandled: ['sg-haircut', 'sg-beard', 'sg-combo'],
      schedules: DEFAULT_SCHEDULES
    }
  ],
  'aura-aesthetics': [
    {
      id: 'st-sarah',
      name: 'Sarah Jenkins',
      role: 'Lead Aesthetician',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      rating: 4.9,
      servicesHandled: ['aa-lash-lift', 'aa-hydrafacial', 'aa-brow-lam'],
      schedules: DEFAULT_SCHEDULES
    },
    {
      id: 'st-emily',
      name: 'Emily Wong',
      role: 'Senior Nail Specialist',
      avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      rating: 4.7,
      servicesHandled: ['aa-gel-mani', 'aa-brow-lam'],
      schedules: DEFAULT_SCHEDULES
    }
  ]
};

export const CLIENTS: Record<string, ClientProfile[]> = {
  'sovereign-gents': [
    {
      id: 'cl-james',
      name: 'James Harrison',
      email: 'james.h@gmail.com',
      phone: '+44 7712 345678',
      streetAddress: '42 Brick Lane',
      city: 'London',
      postcode: 'E1 6RF',
      medicalNotes: 'None',
      allergies: 'Slight sensitivity to tea tree oils',
      formulas: 'Grade 2 fade, pomade finish',
      patchTestDate: '2026-05-10',
      patchTestResult: 'Negative',
      loyaltyPoints: 120,
      walletBalance: 15.00,
      giftCardBalance: 0,
      packages: [{ name: '5x Signature Cuts Bundle', remaining: 3 }],
      formSubmissions: [
        { title: 'Covid-19 Health Screening', date: '2026-06-01', status: 'Completed' },
        { title: 'Grooming Consult Form', date: '2026-06-01', status: 'Completed' }
      ]
    },
    {
      id: 'cl-marcus',
      name: 'Marcus Sterling',
      email: 'marcus.sterling@outlook.com',
      phone: '+44 7789 987654',
      streetAddress: '10 Dunsmore Road',
      city: 'London',
      postcode: 'N16 5PT',
      medicalNotes: 'Severe eczema on neck area',
      allergies: 'Lavender extract, fragrance oils',
      formulas: 'Scissor cut only, light beard trim with natural balm',
      patchTestDate: '2026-06-12',
      patchTestResult: 'Negative',
      loyaltyPoints: 45,
      walletBalance: 0,
      giftCardBalance: 25.00,
      packages: [],
      formSubmissions: []
    }
  ],
  'aura-aesthetics': [
    {
      id: 'cl-sophia',
      name: 'Sophia Loren',
      email: 'sophia.loren@icloud.com',
      phone: '+44 7822 112233',
      streetAddress: '18 Holland Park Garden',
      city: 'London',
      postcode: 'W11 3RE',
      medicalNotes: 'Using topical retinoids (stop 5 days before peel)',
      allergies: 'Aspirin (salicylic acid sensitivity)',
      formulas: 'Aura Peel - 2 mins duration. Gel Nails - shade "Cotton Candy"',
      patchTestDate: '2026-07-01',
      patchTestResult: 'Negative',
      loyaltyPoints: 340,
      walletBalance: 50.00,
      giftCardBalance: 100.00,
      packages: [{ name: '3x Hydrafacial Package', remaining: 2 }],
      formSubmissions: [
        { title: 'Skin Assessment Questionnaire', date: '2026-07-01', status: 'Completed' },
        { title: 'Lash Lift Consent Form', date: '2026-07-01', status: 'Completed' }
      ]
    },
    {
      id: 'cl-chloe',
      name: 'Chloe Bennett',
      email: 'chloe.b@gmail.com',
      phone: '+44 7899 554433',
      streetAddress: '15 High Street Kensington',
      city: 'London',
      postcode: 'W8 5PE',
      medicalNotes: 'Pregnancy (no chemical peels)',
      allergies: 'None',
      formulas: 'Lash lift shield size M, 8 mins processing',
      patchTestDate: '2026-07-14',
      patchTestResult: 'Negative',
      loyaltyPoints: 60,
      walletBalance: 0,
      giftCardBalance: 0,
      packages: [],
      formSubmissions: [
        { title: 'Pregnancy Safety Checklist', date: '2026-07-14', status: 'Completed' }
      ]
    }
  ]
};

export const PRODUCTS: Record<string, Product[]> = {
  'sovereign-gents': [
    { id: 'p-clay', name: 'Sovereign Matte Styling Clay (100g)', sku: 'SOV-CLY-01', price: 18, stock: 45, category: 'Hair Styling' },
    { id: 'p-oil', name: 'Premium Sandalwood Beard Oil (30ml)', sku: 'SOV-OIL-02', price: 22, stock: 32, category: 'Beard Care' },
    { id: 'p-wash', name: 'Tea Tree Invigorating Shampoo (250ml)', sku: 'SOV-WSH-03', price: 15, stock: 20, category: 'Hair Wash' }
  ],
  'aura-aesthetics': [
    { id: 'p-serum', name: 'Aura Hyaluronic Hydrating Serum (50ml)', sku: 'AUR-SER-01', price: 45, stock: 15, category: 'Skincare' },
    { id: 'p-cuticle', name: 'Nourishing Cuticle and Hand Cream (75ml)', sku: 'AUR-CUT-02', price: 16, stock: 40, category: 'Hand Care' },
    { id: 'p-mist', name: 'Rosewater Glow Refreshing Face Mist (100ml)', sku: 'AUR-MST-03', price: 24, stock: 28, category: 'Skincare' }
  ]
};

// Generates initial appointments around current date
const generateInitialBookings = (): Booking[] => {
  // Let's create bookings for today (2026-07-16), yesterday, and tomorrow
  return [
    {
      id: 'bk-1',
      tenantId: 'sovereign-gents',
      reference: 'KS-8394-H',
      clientName: 'James Harrison',
      clientEmail: 'james.h@gmail.com',
      clientPhone: '+44 7712 345678',
      visitType: 'Shop',
      serviceId: 'sg-combo',
      staffId: 'st-kasim',
      resourceId: 'res-chair-1',
      date: '2026-07-16',
      startTime: '10:00',
      endTime: '11:00',
      duration: 60,
      price: 60, // Using overrides for Kasim
      paidAmount: 18, // 30% deposit
      paymentStatus: 'DepositPaid',
      status: 'Confirmed',
      internalNotes: 'Wants to talk about adding beard dyes next month.',
      createdAt: '2026-07-14T11:22:00Z'
    },
    {
      id: 'bk-2',
      tenantId: 'sovereign-gents',
      reference: 'KS-4812-Y',
      clientName: 'Marcus Sterling',
      clientEmail: 'marcus.sterling@outlook.com',
      clientPhone: '+44 7789 987654',
      visitType: 'Mobile',
      streetAddress: '10 Dunsmore Road',
      city: 'London',
      postcode: 'N16 5PT',
      accessInstructions: 'Ring bell #3. Free parking on driveway.',
      serviceId: 'sg-haircut',
      staffId: 'st-liam',
      date: '2026-07-16',
      startTime: '13:00',
      endTime: '13:30',
      duration: 30,
      price: 35,
      paidAmount: 0,
      paymentStatus: 'Unpaid',
      status: 'Confirmed',
      internalNotes: 'Be mindful of severe eczema on his neck, use natural products only.',
      createdAt: '2026-07-15T09:15:00Z'
    },
    {
      id: 'bk-3',
      tenantId: 'sovereign-gents',
      reference: 'KS-9210-U',
      clientName: 'Alex Mercer',
      clientEmail: 'alex@mercer.com',
      clientPhone: '+44 7755 443322',
      visitType: 'Shop',
      serviceId: 'sg-beard',
      staffId: 'st-kasim',
      resourceId: 'res-chair-1',
      date: '2026-07-16',
      startTime: '11:30',
      endTime: '12:00',
      duration: 30,
      price: 25,
      paidAmount: 25,
      paymentStatus: 'FullyPaid',
      status: 'Completed',
      internalNotes: 'Regular client. Loves strong mint scent oils.',
      createdAt: '2026-07-16T08:30:00Z'
    },
    {
      id: 'bk-4',
      tenantId: 'aura-aesthetics',
      reference: 'KS-2931-S',
      clientName: 'Sophia Loren',
      clientEmail: 'sophia.loren@icloud.com',
      clientPhone: '+44 7822 112233',
      visitType: 'Shop',
      serviceId: 'aa-hydrafacial',
      staffId: 'st-sarah',
      resourceId: 'res-facial-suite',
      date: '2026-07-16',
      startTime: '14:00',
      endTime: '15:00',
      duration: 60,
      price: 120,
      paidAmount: 36, // 30% deposit
      paymentStatus: 'DepositPaid',
      status: 'Confirmed',
      internalNotes: 'Has active retinol treatments. Make sure she paused retinoids on Monday.',
      createdAt: '2026-07-12T14:45:00Z'
    },
    {
      id: 'bk-5',
      tenantId: 'aura-aesthetics',
      reference: 'KS-7741-K',
      clientName: 'Chloe Bennett',
      clientEmail: 'chloe.b@gmail.com',
      clientPhone: '+44 7899 554433',
      visitType: 'Shop',
      serviceId: 'aa-gel-mani',
      staffId: 'st-emily',
      resourceId: 'res-nail-station-1',
      date: '2026-07-16',
      startTime: '11:00',
      endTime: '11:45',
      duration: 45,
      price: 40,
      paidAmount: 40,
      paymentStatus: 'FullyPaid',
      status: 'Completed',
      createdAt: '2026-07-14T10:00:00Z'
    },
    {
      id: 'bk-6',
      tenantId: 'aura-aesthetics',
      reference: 'KS-1284-Q',
      clientName: 'Deborah Miller',
      clientEmail: 'deborah@gmail.com',
      clientPhone: '+44 7811 229988',
      visitType: 'Mobile',
      streetAddress: '78 Ladbroke Grove',
      city: 'London',
      postcode: 'W11 2PB',
      serviceId: 'aa-brow-lam',
      staffId: 'st-sarah',
      date: '2026-07-17',
      startTime: '10:00',
      endTime: '10:45',
      duration: 45,
      price: 50,
      paidAmount: 15,
      paymentStatus: 'DepositPaid',
      status: 'Confirmed',
      createdAt: '2026-07-15T15:30:00Z'
    }
  ];
};

const INITIAL_EVENTS = (): OutboxEvent[] => [
  {
    id: 'ev-1',
    bookingId: 'bk-3',
    clientName: 'Alex Mercer',
    eventType: 'Completed',
    timestamp: '2026-07-16T12:05:00Z',
    status: 'Delivered',
    attempts: 1,
    payload: JSON.stringify({ bookingId: 'bk-3', client: 'Alex Mercer', service: 'sg-beard', paid: 25 })
  },
  {
    id: 'ev-2',
    bookingId: 'bk-5',
    clientName: 'Chloe Bennett',
    eventType: 'Completed',
    timestamp: '2026-07-16T11:47:00Z',
    status: 'Delivered',
    attempts: 1,
    payload: JSON.stringify({ bookingId: 'bk-5', client: 'Chloe Bennett', service: 'aa-gel-mani', paid: 40 })
  },
  {
    id: 'ev-3',
    bookingId: 'bk-1',
    clientName: 'James Harrison',
    eventType: 'Created',
    timestamp: '2026-07-14T11:22:00Z',
    status: 'Delivered',
    attempts: 1,
    payload: JSON.stringify({ bookingId: 'bk-1', event: 'Created', value: 60 })
  }
];

// LocalStorage helpers with type safety
const STORAGE_KEYS = {
  TENANTS: 'ks_os_tenants',
  SERVICES: 'ks_os_services',
  STAFF: 'ks_os_staff',
  CLIENTS: 'ks_os_clients',
  PRODUCTS: 'ks_os_products',
  BOOKINGS: 'ks_os_bookings',
  EVENTS: 'ks_os_events'
};

export function getStorageData<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function saveStorageData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save state to localStorage', e);
  }
}

// Global active store interface
export class KSOSEngine {
  static getTenants(): BusinessTenant[] {
    return getStorageData(STORAGE_KEYS.TENANTS, TENANTS);
  }
  static saveTenants(data: BusinessTenant[]) {
    saveStorageData(STORAGE_KEYS.TENANTS, data);
  }

  static getServices(tenantId: string): Service[] {
    const all = getStorageData(STORAGE_KEYS.SERVICES, SERVICES);
    return all[tenantId] || SERVICES[tenantId] || [];
  }
  static saveServices(tenantId: string, services: Service[]) {
    const all = getStorageData(STORAGE_KEYS.SERVICES, SERVICES);
    all[tenantId] = services;
    saveStorageData(STORAGE_KEYS.SERVICES, all);
  }

  static getStaff(tenantId: string): Staff[] {
    const all = getStorageData(STORAGE_KEYS.STAFF, STAFF);
    return all[tenantId] || STAFF[tenantId] || [];
  }
  static saveStaff(tenantId: string, staffList: Staff[]) {
    const all = getStorageData(STORAGE_KEYS.STAFF, STAFF);
    all[tenantId] = staffList;
    saveStorageData(STORAGE_KEYS.STAFF, all);
  }

  static getClients(tenantId: string): ClientProfile[] {
    const all = getStorageData(STORAGE_KEYS.CLIENTS, CLIENTS);
    return all[tenantId] || CLIENTS[tenantId] || [];
  }
  static saveClients(tenantId: string, clientList: ClientProfile[]) {
    const all = getStorageData(STORAGE_KEYS.CLIENTS, CLIENTS);
    all[tenantId] = clientList;
    saveStorageData(STORAGE_KEYS.CLIENTS, all);
  }

  static getProducts(tenantId: string): Product[] {
    const all = getStorageData(STORAGE_KEYS.PRODUCTS, PRODUCTS);
    return all[tenantId] || PRODUCTS[tenantId] || [];
  }
  static saveProducts(tenantId: string, productList: Product[]) {
    const all = getStorageData(STORAGE_KEYS.PRODUCTS, PRODUCTS);
    all[tenantId] = productList;
    saveStorageData(STORAGE_KEYS.PRODUCTS, all);
  }

  static getBookings(): Booking[] {
    return getStorageData(STORAGE_KEYS.BOOKINGS, generateInitialBookings());
  }
  static saveBookings(bookings: Booking[]) {
    saveStorageData(STORAGE_KEYS.BOOKINGS, bookings);
  }

  static getEvents(): OutboxEvent[] {
    return getStorageData(STORAGE_KEYS.EVENTS, INITIAL_EVENTS());
  }
  static saveEvents(events: OutboxEvent[]) {
    saveStorageData(STORAGE_KEYS.EVENTS, events);
  }

  // Trigger automation log
  static triggerEvent(bookingId: string, clientName: string, eventType: AutomationEvent, payloadObj: any) {
    const events = this.getEvents();
    const newEvent: OutboxEvent = {
      id: `ev-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      bookingId,
      clientName,
      eventType,
      timestamp: new Date().toISOString(),
      status: 'Pending',
      attempts: 0,
      payload: JSON.stringify(payloadObj)
    };
    
    // Simulate instantaneous delivery to the agency outbox with 1 attempt
    setTimeout(() => {
      newEvent.status = 'Delivered';
      newEvent.attempts = 1;
      const updated = this.getEvents().map(e => e.id === newEvent.id ? newEvent : e);
      this.saveEvents(updated);
      window.dispatchEvent(new CustomEvent('ks-events-updated'));
    }, 1500);

    events.unshift(newEvent);
    this.saveEvents(events);
    window.dispatchEvent(new CustomEvent('ks-events-updated'));
  }
}
