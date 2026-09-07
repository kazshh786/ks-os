import { z } from 'zod';

export const BusinessTypeSchema = z.enum([
  'SALON_BARBER','BEAUTY_AESTHETICS','LOGISTICS_COURIER','AGENCY','CONSULTANCY','PLUMBING','ELECTRICAL','CLEANING','CONSTRUCTION','PROPERTY_MANAGEMENT','ESTATE_AGENCY','RESTAURANT_CAFE','RETAIL','ECOMMERCE','GYM_PT','EDUCATION_TUTORING','MADRASSA','CHARITY_NONPROFIT','GARAGE_MECHANIC','PROFESSIONAL_SERVICES',
] as const);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

export const BUSINESS_TYPES: ReadonlyArray<{ key: BusinessType; label: string; aliases: readonly string[] }> = [
  { key:'SALON_BARBER', label:'Salon / Barber', aliases:['salon','hair salon','barber','barbershop','hairdresser','hairdressing'] },
  { key:'BEAUTY_AESTHETICS', label:'Beauty / Aesthetics', aliases:['beauty salon','beauty studio','beauty','aesthetics','clinic'] },
  { key:'LOGISTICS_COURIER', label:'Logistics / Courier', aliases:['logistics','courier','delivery','transport'] },
  { key:'AGENCY', label:'Marketing Agency', aliases:['marketing agency','agency','internal agency'] },
  { key:'CONSULTANCY', label:'Consultancy', aliases:['consultant','consultancy'] },
  { key:'PLUMBING', label:'Plumbing', aliases:['plumber','plumbing'] },
  { key:'ELECTRICAL', label:'Electrical', aliases:['electrician','electrical'] },
  { key:'CLEANING', label:'Cleaning', aliases:['cleaner','cleaning'] },
  { key:'CONSTRUCTION', label:'Construction', aliases:['builder','construction'] },
  { key:'PROPERTY_MANAGEMENT', label:'Property Management', aliases:['property management'] },
  { key:'ESTATE_AGENCY', label:'Estate Agency', aliases:['estate agent','estate agency','real estate'] },
  { key:'RESTAURANT_CAFE', label:'Restaurant / Café', aliases:['restaurant','cafe','restaurant cafe'] },
  { key:'RETAIL', label:'Retail', aliases:['retail','shop'] },
  { key:'ECOMMERCE', label:'E-commerce', aliases:['ecommerce','e commerce','online shop'] },
  { key:'GYM_PT', label:'Gym / PT', aliases:['gym','personal trainer','pt','fitness'] },
  { key:'EDUCATION_TUTORING', label:'Education / Tutoring', aliases:['education','tutoring','tutor','school'] },
  { key:'MADRASSA', label:'Madrassa', aliases:['madrassa','madrasa','madrasah'] },
  { key:'CHARITY_NONPROFIT', label:'Charity / Nonprofit', aliases:['charity','nonprofit','non profit'] },
  { key:'GARAGE_MECHANIC', label:'Garage / Mechanic', aliases:['garage','mechanic','car repair'] },
  { key:'PROFESSIONAL_SERVICES', label:'Professional Services', aliases:['professional services','accountant','solicitor'] },
];

const normalizedToken = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const aliases = new Map(BUSINESS_TYPES.flatMap(type => [type.key, type.label, ...type.aliases].map(alias => [normalizedToken(alias), type.key] as const)));
/** Exact normalized aliases only: unfamiliar free text is never guessed or persisted over. */
export function normalizeBusinessType(value: unknown): BusinessType | null {
  return typeof value === 'string' ? aliases.get(normalizedToken(value)) ?? null : null;
}

export const ModuleKeySchema = z.enum(['dashboard','crm','sales','bookings','services','calendar','work','tasks','projects','operations','forms','documents','communications','email-marketing','social','payments','pos','finance','inventory','team','analytics','reports','reputation','automations','integrations','fleet','routes','dispatch','assets','locations','booking-page','settings','security']);
export type ModuleKey = z.infer<typeof ModuleKeySchema>;
export type ModuleDefinition = {
  key: ModuleKey;
  defaultLabel: string;
  status: 'implemented' | 'foundation' | 'planned';
  route: string | null;
  capabilities: readonly string[];
  ownerOnly: boolean;
  entitlements: readonly string[];
  recommendedBusinessTypes: readonly BusinessType[];
};

const implemented: Partial<Record<ModuleKey, [string, string, string[], boolean, string[]]>> = {
  dashboard:['Dashboard','/app/dashboard',[],true,[]],
  crm:['Customers','/app/clients',['CLIENTS_VIEW_BASIC'],false,[]],
  sales:['Sales','/app/sales',['SALES_VIEW_OWN','SALES_VIEW_ALL'],false,[]],
  bookings:['Bookings','/app/bookings',['BOOKINGS_VIEW_OWN','BOOKINGS_VIEW_ALL'],false,[]],
  calendar:['Booking Calendar','/app/calendar',['BOOKINGS_VIEW_OWN','BOOKINGS_VIEW_ALL'],false,[]],
  services:['Services','/app/services',[],true,[]],
  work:['Work','/app/work',['WORK_VIEW_OWN','WORK_VIEW_ALL'],false,[]],
  tasks:['Tasks','/app/tasks/my',['TASKS_VIEW_OWN','TASKS_VIEW_ALL'],false,[]],
  operations:['Inbox','/app/operations',['OPERATIONS_VIEW_ASSIGNED','OPERATIONS_VIEW_ALL','OPERATIONS_MANAGE'],false,[]],
  forms:['Forms','/app/forms',['FORMS_VIEW_ASSIGNED','FORMS_VIEW_ALL','FORMS_MANAGE'],false,[]],
  communications:['Communications','/app/settings/communications',[],true,[]],
  'email-marketing':['Email Marketing','/app/email-marketing/automated-emails',[],true,[]],
  payments:['Payments','/app/payments',[],true,[]],
  pos:['Point of Sale','/app/pos',['POS_USE'],false,[]],
  finance:['Finance','/app/finance',[],true,[]],
  inventory:['Inventory','/app/inventory',[],true,['inventory.enabled']],
  team:['Team','/app/settings/team',[],true,[]],
  analytics:['Analytics','/app/analytics',[],true,['analytics.advanced']],
  reports:['Reports','/app/reports',[],true,[]],
  reputation:['Reviews','/app/reputation',['REPUTATION_VIEW'],false,[]],
  automations:['Automations','/app/automations',[],true,['automations.enabled']],
  integrations:['Integrations','/app/settings/integrations',[],true,[]],
  locations:['Locations and resources','/app/settings/locations',[],true,[]],
  'booking-page':['Booking Page','/app/settings/booking-page',[],true,[]],
  settings:['Business Settings','/app/settings',[],true,[]],
  security:['Security','/app/settings/security',[],false,[]],
};

const core: ModuleKey[] = ['dashboard','crm','tasks','operations','forms','communications','payments','finance','team','reports','automations','integrations','settings','security'];
const appointmentModules: ModuleKey[] = ['services','bookings','calendar','pos','analytics','reputation','email-marketing','inventory','locations','booking-page'];
const modelModules: Record<string, ModuleKey[]> = {
  appointments: appointmentModules,
  jobs:['sales','work','calendar','documents','assets','inventory'],
  projects:['work','sales','documents','email-marketing'],
  deliveries:['sales','work','dispatch','fleet','routes','documents'],
  classes:['bookings','calendar','services','documents','locations'],
  orders:['pos','inventory','sales','work','documents'],
  cases:['sales','work','documents'],
};

const profileSeeds = {
  SALON_BARBER:{ operatingModel:'appointments', terminology:{ customer:'Customer',customers:'Customers',work:'Appointment',works:'Appointments',staff:'Practitioner',staffPlural:'Practitioners' } },
  BEAUTY_AESTHETICS:{ operatingModel:'appointments', terminology:{ customer:'Client',customers:'Clients',work:'Appointment',works:'Appointments',staff:'Practitioner',staffPlural:'Practitioners' } },
  LOGISTICS_COURIER:{ operatingModel:'deliveries', terminology:{ customer:'Customer',customers:'Customers',work:'Delivery',works:'Deliveries',staff:'Driver',staffPlural:'Drivers' } },
  AGENCY:{ operatingModel:'projects', terminology:{ customer:'Client',customers:'Clients',work:'Project',works:'Projects',staff:'Team member',staffPlural:'Team members' } },
  CONSULTANCY:{ operatingModel:'projects', terminology:{ customer:'Client',customers:'Clients',work:'Project',works:'Projects',staff:'Consultant',staffPlural:'Consultants' } },
  PLUMBING:{ operatingModel:'jobs', terminology:{ customer:'Customer',customers:'Customers',work:'Job',works:'Jobs',staff:'Engineer',staffPlural:'Engineers' } },
  ELECTRICAL:{ operatingModel:'jobs', terminology:{ customer:'Customer',customers:'Customers',work:'Job',works:'Jobs',staff:'Engineer',staffPlural:'Engineers' } },
  CLEANING:{ operatingModel:'jobs', terminology:{ customer:'Customer',customers:'Customers',work:'Job',works:'Jobs',staff:'Team member',staffPlural:'Team members' } },
  CONSTRUCTION:{ operatingModel:'projects', terminology:{ customer:'Client',customers:'Clients',work:'Project',works:'Projects',staff:'Team member',staffPlural:'Team members' } },
  PROPERTY_MANAGEMENT:{ operatingModel:'jobs', terminology:{ customer:'Client',customers:'Clients',work:'Job',works:'Jobs',staff:'Team member',staffPlural:'Team members' } },
  ESTATE_AGENCY:{ operatingModel:'cases', terminology:{ customer:'Client',customers:'Clients',work:'Case',works:'Cases',staff:'Agent',staffPlural:'Agents' } },
  RESTAURANT_CAFE:{ operatingModel:'orders', terminology:{ customer:'Customer',customers:'Customers',work:'Order',works:'Orders',staff:'Team member',staffPlural:'Team members' } },
  RETAIL:{ operatingModel:'orders', terminology:{ customer:'Customer',customers:'Customers',work:'Order',works:'Orders',staff:'Team member',staffPlural:'Team members' } },
  ECOMMERCE:{ operatingModel:'orders', terminology:{ customer:'Customer',customers:'Customers',work:'Order',works:'Orders',staff:'Team member',staffPlural:'Team members' } },
  GYM_PT:{ operatingModel:'appointments', terminology:{ customer:'Member',customers:'Members',work:'Session',works:'Sessions',staff:'Trainer',staffPlural:'Trainers' } },
  EDUCATION_TUTORING:{ operatingModel:'classes', terminology:{ customer:'Student',customers:'Students',work:'Class',works:'Classes',staff:'Teacher',staffPlural:'Teachers' } },
  MADRASSA:{ operatingModel:'classes', terminology:{ customer:'Student',customers:'Students',work:'Class',works:'Classes',staff:'Teacher',staffPlural:'Teachers' } },
  CHARITY_NONPROFIT:{ operatingModel:'cases', terminology:{ customer:'Member',customers:'Members',work:'Case',works:'Cases',staff:'Volunteer',staffPlural:'Volunteers' } },
  GARAGE_MECHANIC:{ operatingModel:'jobs', terminology:{ customer:'Customer',customers:'Customers',work:'Job',works:'Jobs',staff:'Mechanic',staffPlural:'Mechanics' } },
  PROFESSIONAL_SERVICES:{ operatingModel:'cases', terminology:{ customer:'Client',customers:'Clients',work:'Case',works:'Cases',staff:'Team member',staffPlural:'Team members' } },
} as const satisfies Record<BusinessType, { operatingModel:string; terminology:{customer:string;customers:string;work:string;works:string;staff:string;staffPlural:string} }>;

function buildModuleRegistry(): Record<ModuleKey, ModuleDefinition> {
  const registry = {} as Record<ModuleKey, ModuleDefinition>;
  for (const key of ModuleKeySchema.options) {
    const value = implemented[key];
    registry[key] = {
      key,
      defaultLabel:value?.[0] ?? key.charAt(0).toUpperCase() + key.slice(1),
      status:(value ? 'implemented' : key === 'documents' ? 'foundation' : 'planned') as ModuleDefinition['status'],
      route:value?.[1] ?? null,
      capabilities:value?.[2] ?? [],
      ownerOnly:value?.[3] ?? false,
      entitlements:value?.[4] ?? [],
      recommendedBusinessTypes:BusinessTypeSchema.options.filter(type => [...core, ...(modelModules[profileSeeds[type].operatingModel] ?? [])].includes(key)),
    };
  }
  return registry;
}
export const MODULE_REGISTRY = buildModuleRegistry();

export const ProductOnboardingAnswersSchema = z.object({
  businessName:z.string().trim().min(2).max(255),
  businessType:z.string().trim().min(2).max(80),
  teamSize:z.enum(['1','2-5','6-20','21-50','51+']),
  buying:z.array(z.enum(['appointments','quotes','direct-purchase','recurring-contracts','subscription'])).min(1).max(5),
  delivery:z.array(z.enum(['appointments','jobs','projects','deliveries','classes','orders'])).min(1).max(6),
  resources:z.array(z.enum(['staff','vehicles','stock','documents','multiple-locations','equipment'])).max(6),
  payment:z.array(z.enum(['quotes','invoices','card','pos','subscription'])).min(1).max(5),
  manage:z.array(z.enum(['customers','leads','sales','bookings','jobs','projects','staff','calendar','money','documents','marketing','inventory','support','reports','automation'])).min(1).max(15),
}).strict();
export type ProductOnboardingAnswers = z.infer<typeof ProductOnboardingAnswersSchema>;
export const ProductOnboardingConfigurationSchema = z.object({ version:z.literal(1),completedAt:z.string().datetime(),answers:ProductOnboardingAnswersSchema }).strict();
export type ProductOnboardingConfiguration = z.infer<typeof ProductOnboardingConfigurationSchema>;

export const BusinessProfileSchema = z.object({
  businessType:BusinessTypeSchema.nullable(),
  displayName:z.string(),
  compatibilityMode:z.boolean(),
  terminology:z.object({customer:z.string(),customers:z.string(),work:z.string(),works:z.string(),staff:z.string(),staffPlural:z.string()}),
  enabledModules:z.array(ModuleKeySchema),
  recommendedModules:z.array(ModuleKeySchema),
  navigation:z.array(ModuleKeySchema),
  dashboard:z.array(z.enum(['booking-summary','customer-summary','revenue-summary','operations','daily-trend','top-services','staff-utilisation'])),
  recommendedOperatingModel:z.string(),
  optionalEngines:z.array(ModuleKeySchema),
  pipelineMetadata:z.object({ status:z.enum(['planned','implemented']),workLabel:z.string() }),
  onboardingDefaults:ProductOnboardingAnswersSchema.omit({businessName:true,businessType:true}),
  crmExtensions:z.array(z.enum(['salon-care'])),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

const manageModules: Record<ProductOnboardingAnswers['manage'][number], ModuleKey[]> = {
  customers:['crm'],leads:['sales'],sales:['sales'],bookings:['bookings','calendar','services','booking-page'],
  jobs:['work'],projects:['work'],staff:['team'],calendar:['calendar'],money:['finance','payments'],
  documents:['documents','forms'],marketing:['email-marketing','reputation'],inventory:['inventory'],
  support:['operations','communications'],reports:['reports'],automation:['automations'],
};

export function onboardingModules(answers: ProductOnboardingAnswers): ModuleKey[] {
  const result = new Set<ModuleKey>(core);
  for (const choice of answers.manage) for (const key of manageModules[choice]) result.add(key);
  for (const delivery of answers.delivery) for (const key of modelModules[delivery] ?? []) result.add(key);
  if (answers.buying.includes('appointments')) for (const key of ['bookings','calendar','services','booking-page'] as const) result.add(key);
  if (answers.buying.includes('quotes') || answers.payment.includes('quotes')) result.add('sales');
  if (answers.payment.includes('pos')) result.add('pos');
  if (answers.resources.includes('vehicles')) result.add('fleet');
  if (answers.resources.includes('stock')) result.add('inventory');
  if (answers.resources.includes('documents')) result.add('documents');
  if (answers.resources.includes('multiple-locations')) result.add('locations');
  if (answers.resources.includes('equipment')) result.add('assets');
  return [...result];
}

/** Call with the authenticated tenant's stored fields. Configuration never grants permissions. */
export function resolveBusinessProfile(businessType: unknown, configuration?: unknown): BusinessProfile {
  const normalized = normalizeBusinessType(businessType);
  const parsed = ProductOnboardingConfigurationSchema.safeParse(configuration);
  const configured = parsed.success ? parsed.data.answers : undefined;
  const type = normalized;
  // Unknown legacy businesses retain their existing working navigation until an owner configures them.
  const seed = profileSeeds[type ?? (configured ? 'PROFESSIONAL_SERVICES' : 'SALON_BARBER')];
  const recommendation = [...new Set([...core, ...(modelModules[seed.operatingModel] ?? [])])];
  const enabled = configured ? onboardingModules(configured) : recommendation;
  const salonCare = type === 'SALON_BARBER' || type === 'BEAUTY_AESTHETICS' || (!type && !configured);
  const hasBookings = enabled.includes('bookings');
  const defaults: BusinessProfile['onboardingDefaults'] = {
    teamSize:'1',
    buying:hasBookings?['appointments']:['quotes'],
    delivery:seed.operatingModel === 'cases' ? ['jobs'] : [seed.operatingModel as ProductOnboardingAnswers['delivery'][number]],
    resources:['staff'],
    payment:hasBookings?['card','pos']:['invoices'],
    manage:['customers','staff','money','reports','automation'],
  };
  return {
    businessType:type,
    displayName:BUSINESS_TYPES.find(item=>item.key===type)?.label ?? 'Business',
    compatibilityMode:!type&&!configured,
    terminology:{...seed.terminology},
    enabledModules:enabled,
    recommendedModules:recommendation,
    navigation:enabled,
    dashboard:hasBookings ? ['booking-summary','customer-summary','revenue-summary','operations','daily-trend','top-services','staff-utilisation'] : ['customer-summary','revenue-summary','operations'],
    recommendedOperatingModel:configured?.delivery[0] ?? seed.operatingModel,
    optionalEngines:enabled.filter(key=>!core.includes(key)),
    pipelineMetadata:{status:enabled.includes('sales')?'implemented':'planned',workLabel:seed.terminology.work},
    onboardingDefaults:configured ? {teamSize:configured.teamSize,buying:configured.buying,delivery:configured.delivery,resources:configured.resources,payment:configured.payment,manage:configured.manage} : defaults,
    crmExtensions:salonCare?['salon-care']:[],
  };
}

export function terminology(profile: BusinessProfile, key: keyof BusinessProfile['terminology']): string { return profile.terminology[key]; }
export function canUseProfileModule(profile: BusinessProfile, key: ModuleKey, access: {role?:string;permissions?:readonly string[];entitlements?:Record<string,{enabled?:boolean}>}): boolean {
  const module = MODULE_REGISTRY[key];
  return module.status === 'implemented' && profile.enabledModules.includes(key) && profile.navigation.includes(key)
    && (!module.ownerOnly || access.role === 'owner')
    && (access.role === 'owner' || !module.capabilities.length || module.capabilities.some(capability=>access.permissions?.includes(capability)))
    && module.entitlements.every(entitlement=>access.entitlements?.[entitlement]?.enabled === true);
}

export function parseProductOnboardingConfiguration(value:unknown): ProductOnboardingConfiguration | null {
  const result=ProductOnboardingConfigurationSchema.safeParse(value);
  return result.success?result.data:null;
}
