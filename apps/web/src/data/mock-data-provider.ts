/**
 * =========================================================================
 * DEVELOPMENT ONLY MOCK PROVIDER
 * =========================================================================
 * WARNING: This data provider is designed strictly for local development and
 * prototyping. It uses browser localStorage for simulation.
 * 
 * It MUST NEVER be used in production or allowed to store any real client records,
 * medical histories, allergies, consent forms, signatures, payment credentials,
 * or authentication sessions.
 */

import { DataProvider } from './data-provider.js';
import { 
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
} from '@ks-os/contracts';
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

const TENANTS: BusinessTenant[] = [
  {
    id: 'sovereign-gents',
    name: 'Sovereign Gents Barbershop',
    subdomain: 'sovereign.kasimshah.com',
    customDomain: 'sovereigngents.co.uk',
    primaryColor: '#b45309',
    secondaryColor: '#1e293b',
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
    name: 'Aura Aesthetics & Nails',
    subdomain: 'aura.kasimshah.com',
    customDomain: 'aurasalon.com',
    primaryColor: '#ec4899',
    secondaryColor: '#0f172a',
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

const SERVICES: Record<string, Service[]> = {
  'sovereign-gents': [
    { id: 'sg-haircut', name: 'Signature Haircut', description: 'Precision cut, wash, hot towel finish and custom styling.', price: 35, durationMin: 30, category: 'Hair' },
    { id: 'sg-beard', name: 'Beard Trim & Hot Towel Shave', description: 'Beard sculpting, razor lines, essential oils and hot towel.', price: 25, durationMin: 30, category: 'Beard' },
    { id: 'sg-combo', name: 'Sovereign Haircut & Beard Combo', description: 'The ultimate grooming experience including haircut, wash, beard sculpt and luxury hot towel finish.', price: 55, durationMin: 60, category: 'Combos' },
    { id: 'sg-facial', name: 'Charcoal Face Mask & Peel', description: 'Deep exfoliating charcoal peel to clear pores and refresh the skin.', price: 20, durationMin: 20, category: 'Skincare' }
  ],
  'aura-aesthetics': [
    { id: 'aa-gel-mani', name: 'Gel Manicure', description: 'Nail shaping, cuticle care, high-shine professional Gel bottle polish, and moisture massage.', price: 40, durationMin: 45, category: 'Nails' },
    { id: 'aa-lash-lift', name: 'Lash Lift & Tint', description: 'Boosts and lifts your natural lashes from the root, including a professional dark tint.', price: 60, durationMin: 60, category: 'Lashes', requiresResource: 'res-facial-suite' },
    { id: 'aa-hydrafacial', name: 'Advanced Hydrafacial', description: 'Multi-step facial treatment to cleanse, exfoliate, and hydrate the skin with antioxidants.', price: 120, durationMin: 60, category: 'Aesthetics', requiresResource: 'res-facial-suite' },
    { id: 'aa-brow-lam', name: 'Brow Lamination & Shape', description: 'Restructuring the brow hairs to keep them in a desired fuller shape.', price: 50, durationMin: 45, category: 'Brows' }
  ]
};

const DEFAULT_SCHEDULES = [
  { dayOfWeek: 0, isOff: true },
  { dayOfWeek: 1, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false },
  { dayOfWeek: 2, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false },
  { dayOfWeek: 3, shopStart: '09:00', shopEnd: '18:00', mobileStart: '10:00', mobileEnd: '17:00', isOff: false },
  { dayOfWeek: 4, shopStart: '09:00', shopEnd: '20:00', mobileStart: '10:00', mobileEnd: '19:00', isOff: false },
  { dayOfWeek: 5, shopStart: '09:00', shopEnd: '20:00', mobileStart: '10:00', mobileEnd: '19:00', isOff: false },
  { dayOfWeek: 6, shopStart: '09:00', shopEnd: '17:00', isOff: false }
];

const STAFF: Record<string, Staff[]> = {
  'sovereign-gents': [
    {
      id: 'st-kasim',
      name: 'Kasim Shah',
      role: 'Master Barber & Founder',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      rating: 5.0,
      servicesHandled: ['sg-haircut', 'sg-beard', 'sg-combo', 'sg-facial'],
      schedules: DEFAULT_SCHEDULES,
      priceOverrides: { 'sg-combo': 60 }
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

const CLIENTS: Record<string, ClientProfile[]> = {
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

const PRODUCTS: Record<string, Product[]> = {
  'sovereign-gents': [
    { id: 'p-clay', name: 'Sovereign Matte Styling Clay (100g)', sku: 'SOV-CLY-01', price: 18, stock: 45, category: 'Hair Styling' },
    { id: 'p-oil', name: 'Premium Sandalwood Beard Oil (30ml)', sku: 'SOV-OIL-02', price: 22, stock: 32, category: 'Beard Care' },
    { id: 'p-wash', name: 'Tea Tree Invigorating Shampoo (250ml)', sku: 'SOV-WSH-03', price: 15, stock: 20, category: 'Hair Wash' }
  ],
  'aura-aesthetics': [
    { id: 'p-serum', name: 'Aura Hyaluronic Hydrating Serum (50ml)', sku: 'AUR-SER-01', price: 45, stock: 15, category: 'Skincare' },
    { id: 'p-cuticle', name: 'Nourishing Cuticle & Hand Cream (75ml)', sku: 'AUR-CUT-02', price: 16, stock: 40, category: 'Hand Care' },
    { id: 'p-mist', name: 'Rosewater Glow Refreshing Face Mist (100ml)', sku: 'AUR-MST-03', price: 24, stock: 28, category: 'Skincare' }
  ]
};

const generateInitialBookings = (): Booking[] => [
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
    price: 60,
    paidAmount: 18,
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
  }
];

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
  }
];

const STORAGE_KEYS = {
  TENANTS: 'ks_os_tenants',
  SERVICES: 'ks_os_services',
  STAFF: 'ks_os_staff',
  CLIENTS: 'ks_os_clients',
  PRODUCTS: 'ks_os_products',
  BOOKINGS: 'ks_os_bookings',
  EVENTS: 'ks_os_events'
};

function getStorageData<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveStorageData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save state to localStorage', e);
  }
}

export class MockDataProvider implements DataProvider {
  private reportsUnavailable():Promise<any>{return Promise.reject(new Error('Operational reports are unavailable in explicit mock mode.'));}
  getAppointmentsReport(_:any){return this.reportsUnavailable();}
  getClientsReport(_:any){return this.reportsUnavailable();}
  getServicesReport(_:any){return this.reportsUnavailable();}
  getStaffReport(_:any){return this.reportsUnavailable();}
  getProductsReport(_:any){return this.reportsUnavailable();}
  getStockReport(_:any){return this.reportsUnavailable();}
  getPaymentsReport(_:any){return this.reportsUnavailable();}
  getRefundsReport(_:any){return this.reportsUnavailable();}
  getFormsReport(_:any){return this.reportsUnavailable();}
  getCommunicationsReport(_:any){return this.reportsUnavailable();}
  createReportExport(_:any){return this.reportsUnavailable();}
  listReportExports(){return this.reportsUnavailable();}
  downloadReportExport(_:string){return this.reportsUnavailable();}
  cancelReportExport(_:string){return this.reportsUnavailable();}
  listReportSchedules(){return this.reportsUnavailable();}
  createReportSchedule(_:any){return this.reportsUnavailable();}
  updateReportSchedule(_:string,__:any){return this.reportsUnavailable();}
  reportScheduleCommand(_:string,__:any){return this.reportsUnavailable();}
  getReportScheduleRuns(_:string){return this.reportsUnavailable();}
  getAdvancedAnalytics(_:any){return this.reportsUnavailable();}
  async getDashboardOverview(query:DashboardOverviewQuery):Promise<DashboardOverviewResponse>{const now=new Date().toISOString();const k=(value:number)=>({value,previousValue:0,changeValue:value,changePercentage:null});const money=(value:number)=>({...k(value),currency:'GBP'});return{period:{preset:query.preset,from:now,to:now,previousFrom:now,previousTo:now,timezone:'Europe/London',localFrom:now.slice(0,10),localTo:now.slice(0,10)},currency:'GBP',bookings:{total:k(0),completed:k(0),cancelled:k(0),noShow:k(0),cancellationRate:k(0),noShowRate:k(0)},revenue:{recordedRevenue:money(0),refundedAmount:money(0),netRecordedRevenue:money(0),outstandingAmount:money(0),averageTransactionValue:money(0)},clients:{uniqueClients:k(0),newClients:k(0),returningClients:k(0)},operations:{todayAppointments:0,awaitingPayment:0,incompleteForms:0,failedEmails:0,failedSms:0,openDisputes:0,failedPayouts:0,stripeActionRequired:0},topServices:[],staffUtilisation:[],dailyTrend:[],generatedAt:now};}
  async getTenants(): Promise<BusinessTenant[]> {
    return getStorageData(STORAGE_KEYS.TENANTS, TENANTS);
  }
  async saveTenants(data: BusinessTenant[]): Promise<void> {
    saveStorageData(STORAGE_KEYS.TENANTS, data);
  }

  async getServices(tenantId: string): Promise<Service[]> {
    const all = getStorageData<Record<string, Service[]>>(STORAGE_KEYS.SERVICES, SERVICES);
    return all[tenantId] || SERVICES[tenantId] || [];
  }
  async saveServices(tenantId: string, servicesList: Service[]): Promise<void> {
    const all = getStorageData<Record<string, Service[]>>(STORAGE_KEYS.SERVICES, SERVICES);
    all[tenantId] = servicesList;
    saveStorageData(STORAGE_KEYS.SERVICES, all);
  }

  async getStaff(tenantId: string): Promise<Staff[]> {
    const all = getStorageData<Record<string, Staff[]>>(STORAGE_KEYS.STAFF, STAFF);
    return all[tenantId] || STAFF[tenantId] || [];
  }
  async saveStaff(tenantId: string, staffList: Staff[]): Promise<void> {
    const all = getStorageData<Record<string, Staff[]>>(STORAGE_KEYS.STAFF, STAFF);
    all[tenantId] = staffList;
    saveStorageData(STORAGE_KEYS.STAFF, all);
  }

  /** @deprecated */
  async getClients(tenantId: string): Promise<ClientProfile[]> {
    const all = getStorageData<Record<string, ClientProfile[]>>(STORAGE_KEYS.CLIENTS, CLIENTS);
    return all[tenantId] || CLIENTS[tenantId] || [];
  }
  /** @deprecated */
  async saveClients(tenantId: string, clientList: ClientProfile[]): Promise<void> {
    const all = getStorageData<Record<string, ClientProfile[]>>(STORAGE_KEYS.CLIENTS, CLIENTS);
    all[tenantId] = clientList;
    saveStorageData(STORAGE_KEYS.CLIENTS, all);
  }

  async searchClients(query: any): Promise<any> {
    const all = getStorageData<Record<string, ClientProfile[]>>(STORAGE_KEYS.CLIENTS, CLIENTS);
    let clients = all['sovereign-gents'] || [];
    if (query.search) {
      const s = query.search.toLowerCase();
      clients = clients.filter(c => c.name.toLowerCase().includes(s) || (c.email && c.email.toLowerCase().includes(s)));
    }
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const mapped = clients.slice(offset, offset + limit).map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      lastVisitDate: null,
      upcomingBookingCount: 0,
      totalBookingCount: 0
    }));

    return {
      data: mapped,
      meta: {
        total: clients.length,
        page,
        limit,
        totalPages: Math.ceil(clients.length / limit)
      }
    };
  }

  async getClient(clientId: string): Promise<any> {
    const all = getStorageData<Record<string, ClientProfile[]>>(STORAGE_KEYS.CLIENTS, CLIENTS);
    const client = (all['sovereign-gents'] || []).find(c => c.id === clientId);
    if (!client) throw new Error('CLIENT_NOT_FOUND');
    return {
      profile: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        patchTestDate: client.patchTestDate || null,
        lastVisitDate: null,
        loyaltyPoints: client.loyaltyPoints,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      bookingHistory: [],
      medicalNotes: client.medicalNotes || null
    };
  }

  async getProducts(tenantId: string): Promise<Product[]> {
    const all = getStorageData<Record<string, Product[]>>(STORAGE_KEYS.PRODUCTS, PRODUCTS);
    return all[tenantId] || PRODUCTS[tenantId] || [];
  }
  async saveProducts(tenantId: string, productList: Product[]): Promise<void> {
    const all = getStorageData<Record<string, Product[]>>(STORAGE_KEYS.PRODUCTS, PRODUCTS);
    all[tenantId] = productList;
    saveStorageData(STORAGE_KEYS.PRODUCTS, all);
  }

  async getBookings(): Promise<Booking[]> {
    return getStorageData(STORAGE_KEYS.BOOKINGS, generateInitialBookings());
  }
  async saveBookings(bookings: Booking[]): Promise<void> {
    saveStorageData(STORAGE_KEYS.BOOKINGS, bookings);
  }

  async getEvents(): Promise<OutboxEvent[]> {
    return getStorageData(STORAGE_KEYS.EVENTS, INITIAL_EVENTS());
  }
  async saveEvents(events: OutboxEvent[]): Promise<void> {
    saveStorageData(STORAGE_KEYS.EVENTS, events);
  }

  async triggerEvent(bookingId: string, clientName: string, eventType: AutomationEvent, payloadObj: any): Promise<void> {
    const events = await this.getEvents();
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
    
    events.unshift(newEvent);
    await this.saveEvents(events);
    
    // Simulate async outbox updates
    setTimeout(async () => {
      newEvent.status = 'Delivered';
      newEvent.attempts = 1;
      const current = await this.getEvents();
      const updated = current.map(e => e.id === newEvent.id ? newEvent : e);
      await this.saveEvents(updated);
      window.dispatchEvent(new CustomEvent('ks-events-updated'));
    }, 1500);

    window.dispatchEvent(new CustomEvent('ks-events-updated'));
  }

  // Public Booking Methods (Mock Stubs)
  async getPublicCatalog(subdomain: string): Promise<any> { throw new Error('Not implemented in mock'); }
  async getPublicAvailability(subdomain: string, input: any): Promise<any> { throw new Error('Not implemented in mock'); }
  async getPublicBookingStatus(subdomain: string, reference: string): Promise<any> { throw new Error('Not implemented in mock'); }
  async createPublicBooking(subdomain: string, input: any): Promise<any> { throw new Error('Not implemented in mock'); }

  // Staff Booking Methods (Mock Stubs)
  async createStaffBooking(input: any): Promise<any> { throw new Error('Not implemented in mock'); }
  async updateBookingStatus(bookingId: string, status: string): Promise<void> { throw new Error('Not implemented in mock'); }
  async rescheduleBooking(bookingId: string, input: any): Promise<void> { throw new Error('Not implemented in mock'); }
  async cancelBooking(bookingId: string): Promise<void> { throw new Error('Not implemented in mock'); }

  private formsUnavailable(): never { throw new Error('Consent forms are not available from the mock provider. Use the live API.'); }
  async listForms(): Promise<any[]> { return this.formsUnavailable(); }
  async getForm(_id:string):Promise<any>{return this.formsUnavailable();}
  async createForm(_input:any):Promise<any>{return this.formsUnavailable();}
  async updateForm(_id:string,_input:any):Promise<any>{return this.formsUnavailable();}
  async publishForm(_id:string):Promise<any>{return this.formsUnavailable();}
  async archiveForm(_id:string):Promise<void>{return this.formsUnavailable();}
  async listFormVersions(_id:string):Promise<any[]>{return this.formsUnavailable();}
  async getFormVersion(_id:string,_versionId:string):Promise<any>{return this.formsUnavailable();}
  async createFormAssignment(_input:any):Promise<any>{return this.formsUnavailable();}
  async listFormAssignments(_query?:Record<string,string>):Promise<any[]>{return this.formsUnavailable();}
  async cancelFormAssignment(_id:string):Promise<void>{return this.formsUnavailable();}
  async regenerateFormLink(_id:string):Promise<any>{return this.formsUnavailable();}
  async listFormSubmissions(_query?:Record<string,string>):Promise<any[]>{return this.formsUnavailable();}
  async getFormSubmission(_id:string):Promise<any>{return this.formsUnavailable();}
  private teamUnavailable():never{throw new Error('Team management requires the live API.');}
  async listTeam():Promise<any>{return this.teamUnavailable();} async getTeamMember():Promise<any>{return this.teamUnavailable();} async createTeamInvitation():Promise<any>{return this.teamUnavailable();} async resendTeamInvitation():Promise<any>{return this.teamUnavailable();} async cancelTeamInvitation():Promise<void>{return this.teamUnavailable();} async updateTeamMember():Promise<any>{return this.teamUnavailable();} async updateTeamMemberServices():Promise<any>{return this.teamUnavailable();} async updateTeamMemberSchedule():Promise<any>{return this.teamUnavailable();} async updateTeamMemberBookingChannels():Promise<any>{return this.teamUnavailable();} async previewTeamLifecycle():Promise<any>{return this.teamUnavailable();} async applyTeamLifecycle():Promise<any>{return this.teamUnavailable();}
  async getConsentTemplates():Promise<any[]>{return this.formsUnavailable();}
  async saveConsentTemplates():Promise<void>{return this.formsUnavailable();}
  async getConsentSubmissions():Promise<any[]>{return this.formsUnavailable();}
  async saveConsentSubmissions():Promise<void>{return this.formsUnavailable();}

  // POS Methods (Mock Stubs)
  async getCheckoutAppointments(): Promise<{ data: any[] }> { throw new Error('Not implemented in mock'); }
  async searchProducts(query?: string): Promise<{ data: ContractsProduct[] }> { throw new Error('Not implemented in mock'); }
  async previewCheckout(payload: any): Promise<any> { throw new Error('Not implemented in mock'); }
  async completeCheckout(payload: any): Promise<any> { throw new Error('Not implemented in mock'); }

  // Stripe Connect Methods (Mock Stubs)
  async getStripeConnection(): Promise<any> { throw new Error('Not implemented in mock'); }
  async connectStripe(): Promise<any> { throw new Error('Not implemented in mock'); }
  async generateOnboardingLink(): Promise<any> { throw new Error('Not implemented in mock'); }
  async syncStripe(): Promise<any> { throw new Error('Not implemented in mock'); }

  // Payment History & Refunds (Mock Stubs)
  async getPaymentHistory(query: PaymentHistoryQuery): Promise<{ data: PaymentHistoryItem[], nextCursor?: string }> {
    const data: PaymentHistoryItem[] = [
      {
        transactionId: crypto.randomUUID(),
        appointmentId: 'bk-3',
        bookingReference: 'KS-9210-U',
        clientDisplayName: 'Alex Mercer',
        serviceName: 'Sovereign Haircut & Beard Combo',
        amount: 5500,
        currency: 'GBP',
        paymentSource: 'STRIPE_ONLINE',
        paymentMethod: 'card_xxxx',
        paymentStatus: 'SUCCEEDED',
        refundedAmount: 0,
        refundableAmount: 5500,
        createdAt: new Date().toISOString()
      },
      {
        transactionId: crypto.randomUUID(),
        appointmentId: 'bk-1',
        bookingReference: 'KS-8394-H',
        clientDisplayName: 'James Harrison',
        serviceName: 'Sovereign Haircut & Beard Combo',
        amount: 6000,
        currency: 'GBP',
        paymentSource: 'MANUAL_CASH',
        paymentMethod: 'cash',
        paymentStatus: 'SUCCEEDED',
        refundedAmount: 0,
        refundableAmount: 0,
        createdAt: new Date(Date.now() - 86400000).toISOString()
      }
    ];

    if (query.status) {
      return { data: data.filter(d => d.paymentStatus === query.status) };
    }
    return { data };
  }

  async getPaymentDetail(transactionId: string): Promise<PaymentDetailResponse> {
    return {
      transactionId,
      appointmentId: 'bk-3',
      bookingReference: 'KS-9210-U',
      clientDisplayName: 'Alex Mercer',
      serviceName: 'Sovereign Haircut & Beard Combo',
      amount: 5500,
      currency: 'GBP',
      paymentSource: 'STRIPE_ONLINE',
      paymentMethod: 'card_xxxx',
      paymentStatus: 'SUCCEEDED',
      refundedAmount: 0,
      refundableAmount: 5500,
      providerVerificationState: 'VERIFIED',
      stripeStatus: 'succeeded',
      refundHistory: [],
      createdAt: new Date().toISOString()
    };
  }

  async createRefund(transactionId: string, request: CreateRefundRequest): Promise<CreateRefundResponse> {
    return {
      id: crypto.randomUUID(),
      status: 'PENDING',
      refundedAmount: request.amount || 5500,
      refundableAmount: 5500 - (request.amount || 5500)
    };
  }

  // Finance Methods
  async getStripeBalance(): Promise<StripeBalance> {
    return {
      available: [{ currency: 'gbp', amount: 150000 }],
      pending: [{ currency: 'gbp', amount: 35000 }],
      lastSyncedAt: new Date().toISOString()
    };
  }

  async getPayouts(query: PayoutListQuery): Promise<{ data: PayoutListItem[], nextCursor?: string }> {
    const data: PayoutListItem[] = [
      {
        id: crypto.randomUUID(),
        amount: 85000,
        currency: 'gbp',
        status: 'PAID',
        arrivalDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        automatic: true,
        reconciliationStatus: 'MATCHED',
        transactionCount: 24
      },
      {
        id: crypto.randomUUID(),
        amount: 32000,
        currency: 'gbp',
        status: 'IN_TRANSIT',
        arrivalDate: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
        automatic: true,
        reconciliationStatus: 'MATCHED',
        transactionCount: 8
      }
    ];
    return { data };
  }

  async getPayoutDetail(id: string): Promise<PayoutDetailResponse> {
    return {
      payout: {
        id,
        amount: 85000,
        currency: 'gbp',
        status: 'PAID',
        arrivalDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        automatic: true,
        reconciliationStatus: 'MATCHED',
        transactionCount: 2
      },
      reconciliation: {
        payoutAmount: 85000,
        grossPayments: 90000,
        refunds: 2000,
        disputes: 0,
        stripeFees: 2000,
        applicationFees: 1000,
        otherAdjustments: 0,
        calculatedNet: 85000,
        difference: 0,
        status: 'MATCHED'
      },
      items: [
        {
          id: crypto.randomUUID(),
          sourceType: 'charge',
          grossAmount: 45000,
          stripeFee: 1000,
          netAmount: 44000,
          currency: 'gbp',
          availableOn: new Date().toISOString(),
          checkoutTransactionId: crypto.randomUUID(),
          stripeRefundId: null,
          stripeDisputeId: null,
          createdAt: new Date().toISOString()
        },
        {
          id: crypto.randomUUID(),
          sourceType: 'charge',
          grossAmount: 45000,
          stripeFee: 1000,
          netAmount: 44000,
          currency: 'gbp',
          availableOn: new Date().toISOString(),
          checkoutTransactionId: crypto.randomUUID(),
          stripeRefundId: null,
          stripeDisputeId: null,
          createdAt: new Date().toISOString()
        }
      ],
      failureCode: null,
      failureMessageSafe: null,
      lastSyncedAt: new Date().toISOString()
    };
  }

  async getDisputes(query: DisputeListQuery): Promise<{ data: DisputeListItem[], nextCursor?: string }> {
    const data: DisputeListItem[] = [
      {
        id: crypto.randomUUID(),
        bookingReference: 'KS-8394-H',
        appointmentId: 'bk-1',
        checkoutTransactionId: crypto.randomUUID(),
        amount: 6000,
        currency: 'gbp',
        reason: 'fraudulent',
        status: 'NEEDS_RESPONSE',
        evidenceDueBy: new Date(Date.now() + 5 * 86400000).toISOString(),
        actionRequired: true,
        lastSyncedAt: new Date().toISOString()
      }
    ];
    return { data };
  }

  async getDisputeDetail(id: string): Promise<DisputeDetailResponse> {
    return {
      id,
      bookingReference: 'KS-8394-H',
      appointmentId: 'bk-1',
      checkoutTransactionId: crypto.randomUUID(),
      amount: 6000,
      currency: 'gbp',
      reason: 'fraudulent',
      status: 'NEEDS_RESPONSE',
      evidenceDueBy: new Date(Date.now() + 5 * 86400000).toISOString(),
      actionRequired: true,
      lastSyncedAt: new Date().toISOString(),
      dashboardUrl: 'https://dashboard.stripe.com/test/disputes/' + id,
      timeline: [
        {
          date: new Date().toISOString(),
          description: 'Dispute created'
        }
      ],
      payoutImpact: -7500 // 6000 + 1500 dispute fee
    };
  }

  // Communications
  async getCommunicationsSettings(): Promise<CommunicationsSettingsResponse> {
    return getStorageData('ks_os_comm_settings', {
      replyToEmail: 'hello@sovereigngents.com',
      senderDisplayName: 'Sovereign Gents Barbershop',
      bookingConfirmationEnabled: true,
      bookingCancellationEnabled: true,
      bookingRescheduleEnabled: true,
      appointmentRemindersEnabled: true,
      formDeliveryEnabled: true,
      formRemindersEnabled: true,
      paymentConfirmationEnabled: true,
      formReminderTiming: '24_hours_after_assignment'
    });
  }

  async updateCommunicationsSettings(settings: UpdateCommunicationsSettingsRequest): Promise<void> {
    const current = await this.getCommunicationsSettings();
    saveStorageData('ks_os_comm_settings', { ...current, ...settings });
  }

  async getEmailHistory(query: EmailHistoryQuery): Promise<{ data: EmailHistoryItem[], nextCursor?: string }> {
    const defaultHistory: EmailHistoryItem[] = [
      {
        id: 'eh-1',
        recipientEmailMasked: 'j***s.h@gmail.com',
        templateKey: 'booking_confirmation',
        status: 'delivered',
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        failedAt: null,
        lastErrorCode: null,
        relatedEntityType: 'booking'
      },
      {
        id: 'eh-2',
        recipientEmailMasked: 'm***s.sterling@outlook.com',
        templateKey: 'appointment_reminder',
        status: 'delivered',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        sentAt: new Date(Date.now() - 86400000).toISOString(),
        deliveredAt: new Date(Date.now() - 86400000).toISOString(),
        failedAt: null,
        lastErrorCode: null,
        relatedEntityType: 'booking'
      }
    ];

    const data = getStorageData('ks_os_comm_history', defaultHistory);
    return { data };
  }
  async listAutomations(){return{data:getStorageData('ks_os_automations',[])};}
  async getAutomation(id:string){return{data:getStorageData<any[]>('ks_os_automations',[]).find(x=>x.id===id)};}
  async createAutomation(input:any){const rows=getStorageData<any[]>('ks_os_automations',[]);const data={...input,id:crypto.randomUUID(),status:'DRAFT',createdAt:new Date().toISOString()};saveStorageData('ks_os_automations',[data,...rows]);return{data};}
  async updateAutomation(id:string,input:any){const rows=getStorageData<any[]>('ks_os_automations',[]);const data={...rows.find(x=>x.id===id),...input};saveStorageData('ks_os_automations',rows.map(x=>x.id===id?data:x));return{data};}
  async automationCommand(id:string,command:'activate'|'pause'|'archive'){const row=await this.getAutomation(id);return this.updateAutomation(id,{status:command==='activate'?'ACTIVE':command==='pause'?'PAUSED':'ARCHIVED',...row.data});}
  async getAutomationRuns(_id:string){return{data:[]};}
  async getAutomationRun(id:string){return{data:{id,status:'SUCCEEDED',actions:[]}};}
  private reputationUnavailable(): never { throw new Error('External reputation integrations are unavailable in mock-data mode.'); }
  async getReputationOverview(){return this.reputationUnavailable();}
  async listReviewConnections(){return this.reputationUnavailable();}
  async listReviewLocations(){return this.reputationUnavailable();}
  async configureGoogleReviewLink(_input:any){return this.reputationUnavailable();}
  async configureTrustpilot(_input:any){return this.reputationUnavailable();}
  async testReviewConnection(_id:string){return this.reputationUnavailable();}
  async deleteReviewConnection(_id:string){return this.reputationUnavailable();}
  async startGoogleReviewOauth(){return this.reputationUnavailable();}
  async listReviewInvitationRules(){return this.reputationUnavailable();}
  async createReviewInvitationRule(_input:any){return this.reputationUnavailable();}
  async updateReviewInvitationRule(_id:string,_input:any){return this.reputationUnavailable();}
  async reviewInvitationRuleCommand(_id:string,_command:'pause'|'resume'){return this.reputationUnavailable();}
  async listReviewInvitations(_query:Record<string,string>={}){return this.reputationUnavailable();}
  async listExternalReviews(_query:Record<string,string>={}){return this.reputationUnavailable();}
  async syncExternalReviews(){return this.reputationUnavailable();}
  async saveExternalReviewReply(_id:string,_reply:string){return this.reputationUnavailable();}
  async deleteExternalReviewReply(_id:string){return this.reputationUnavailable();}
}
