import {
  BarChart3,
  Bot,
  Building2,
  CalendarCheck2,
  CreditCard,
  MessageSquareText,
  PanelsTopLeft,
  Rocket,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export type Service = {
  slug: string;
  eyebrow: string;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
  icon: LucideIcon;
  features: string[];
  deliverables: string[];
  controls: string[];
};

export const services: Service[] = [
  {
    slug: 'websites-and-funnels',
    eyebrow: 'Digital presence',
    title: 'Websites and funnels that turn attention into action',
    shortTitle: 'Websites and funnels',
    summary: 'A conversion-led website with focused landing pages, clear journeys and booking built into the experience.',
    outcome: 'Look credible, explain your value clearly and convert more visitors without managing a web stack yourself.',
    icon: PanelsTopLeft,
    features: ['Conversion-led website', 'Service landing pages', 'Mobile-first UX', 'SEO-ready structure'],
    deliverables: ['Strategy and content architecture', 'Responsive design and build', 'Forms, calls-to-action and booking journeys', 'Performance, accessibility and launch checks'],
    controls: ['Approve messaging and design direction', 'Request content and offer updates', 'See live performance and conversion data', 'Keep ownership of your domain and business data'],
  },
  {
    slug: 'booking-and-crm',
    eyebrow: 'Customer management',
    title: 'Booking and CRM that keeps every customer journey connected',
    shortTitle: 'Booking and CRM',
    summary: 'Appointments, contacts, conversations and follow-up organised in one place around how your business works.',
    outcome: 'Reduce admin, prevent missed leads and give your team one reliable view of every customer.',
    icon: CalendarCheck2,
    features: ['Online booking', 'Customer records', 'Team calendars', 'Pipeline and follow-up'],
    deliverables: ['Branded booking experience', 'Services, staff and availability setup', 'Customer database and lead stages', 'Reschedule, cancellation and reminder journeys'],
    controls: ['Set availability, capacity and booking rules', 'Manage services, prices and team access', 'View every appointment and customer record', 'Export and retain your customer data'],
  },
  {
    slug: 'automation-and-ai',
    eyebrow: 'Workflow automation',
    title: 'Automations that remove repetitive work without removing oversight',
    shortTitle: 'Automation and AI',
    summary: 'Practical workflows for confirmations, reminders, lead response, forms, rebooking and internal tasks.',
    outcome: 'Save time, respond faster and make sure important work happens consistently.',
    icon: Bot,
    features: ['Lead response', 'Appointment workflows', 'Internal task automation', 'AI-assisted operations'],
    deliverables: ['Workflow mapping and opportunity audit', 'Automation design and implementation', 'Approval points and exception handling', 'Monitoring, optimisation and change support'],
    controls: ['Choose what is automated and what stays manual', 'Review messages before workflows go live', 'Pause or change automations at any time', 'See run history, outcomes and exceptions'],
  },
  {
    slug: 'email-and-messaging',
    eyebrow: 'Communications',
    title: 'Email and messaging that keeps customers informed and engaged',
    shortTitle: 'Email and messaging',
    summary: 'Branded confirmations, reminders, follow-ups and campaigns connected to real customer activity.',
    outcome: 'Create a consistent customer experience and reduce no-shows without juggling separate tools.',
    icon: MessageSquareText,
    features: ['Transactional email', 'SMS reminders', 'Follow-up campaigns', 'Communication history'],
    deliverables: ['Brand-aligned message templates', 'Booking and service notifications', 'Audience segments and follow-up sequences', 'Delivery monitoring and communication logs'],
    controls: ['Approve all templates and sending rules', 'Control audiences and communication frequency', 'See what was sent and when', 'Manage opt-outs and customer preferences'],
  },
  {
    slug: 'reputation-and-reviews',
    eyebrow: 'Trust and reputation',
    title: 'A reputation system that turns good service into visible proof',
    shortTitle: 'Reviews and reputation',
    summary: 'Automated review requests, feedback capture and reputation monitoring connected to completed journeys.',
    outcome: 'Generate more credible reviews, spot service issues earlier and build trust before prospects contact you.',
    icon: Star,
    features: ['Review requests', 'Private feedback', 'Reputation inbox', 'Service recovery workflows'],
    deliverables: ['Review journey and timing setup', 'Branded feedback collection', 'Review platform connections', 'Alerts and response processes'],
    controls: ['Choose when review requests are sent', 'See feedback before deciding how to respond', 'Control connected review channels', 'Track invitations, responses and trends'],
  },
  {
    slug: 'payments-and-operations',
    eyebrow: 'Business operations',
    title: 'Payments and operations that keep work moving',
    shortTitle: 'Payments and operations',
    summary: 'Deposits, checkout, forms, tasks and operational issues in the same system as bookings and customers.',
    outcome: 'Reduce disconnected admin and give the team a clearer process from enquiry to delivery and payment.',
    icon: CreditCard,
    features: ['Deposits and checkout', 'Forms and consent', 'Tasks and issues', 'Operational workflows'],
    deliverables: ['Payment and deposit configuration', 'Digital forms and completion journeys', 'Task and issue workflows', 'Roles, permissions and operational handovers'],
    controls: ['Set payment rules and refund policies', 'Control team roles and permissions', 'View transactions, forms and work status', 'Keep an auditable record of key actions'],
  },
  {
    slug: 'analytics-and-growth',
    eyebrow: 'Insights and optimisation',
    title: 'Analytics that show what is working and what to improve next',
    shortTitle: 'Analytics and growth',
    summary: 'Clear reporting across leads, bookings, customers, revenue, team utilisation and campaign performance.',
    outcome: 'Make better decisions using one connected view instead of manually combining reports.',
    icon: BarChart3,
    features: ['Conversion reporting', 'Revenue insights', 'Customer retention', 'Operational performance'],
    deliverables: ['Measurement plan and KPI setup', 'Performance dashboards', 'Scheduled reports and review rhythm', 'Ongoing optimisation recommendations'],
    controls: ['Choose the KPIs that matter to you', 'Access your dashboards at any time', 'Drill into the underlying activity', 'Decide which recommendations to prioritise'],
  },
];

export type PackageDefinition = {
  id: string;
  name: string;
  audience: string;
  launchPrice: string;
  monthlyPrice: string;
  summary: string;
  icon: LucideIcon;
  popular?: boolean;
  launchIncludes: string[];
  monthlyIncludes: string[];
  notes: string[];
};

export const packages: PackageDefinition[] = [
  {
    id: 'essential',
    name: 'Essential',
    audience: 'Sole traders and small service businesses that need a complete professional presence and the essential tools to operate online.',
    launchPrice: '£197',
    monthlyPrice: '£97',
    summary: 'A complete website, new logo, professional copywriting, business email, business card and leaflet design, booking tools, CRM, monthly social content and ongoing support.',
    icon: Rocket,
    launchIncludes: ['New professional logo', 'Brand colours and typography', 'Professionally designed business website', 'Unlimited reasonable pages required for launch', 'Mobile-responsive design', 'Website copywriting included', 'Service and business content creation', 'Business card design', 'Promotional leaflet design', 'Print-ready artwork files', 'Online booking integration', 'Google Business Profile integration', 'Google review integration', 'Trustpilot review integration', 'Zoho professional business email', 'Domain connection', 'Website launch'],
    monthlyIncludes: ['KS OS business-management platform', 'Online appointment booking', 'Customer CRM', 'Services and pricing management', 'Appointment calendar', 'Customer records and notes', '4 professionally designed branded social-media posts per month', 'Basic reporting', 'Website hosting', 'Website maintenance', 'Security and backups', 'Software updates', 'Standard technical support'],
    notes: ['Printing costs are charged separately.', 'The monthly social-media allowance covers design and content creation. Account management, community replies, paid advertising and extra posts are quoted separately.'],
  },
  {
    id: 'growth',
    name: 'Growth',
    audience: 'Established businesses that want stronger operational tools, automation and customer-growth features.',
    launchPrice: '£297',
    monthlyPrice: '£197',
    summary: 'Everything needed to run and grow an established business, including Google Workspace, advanced CRM, staff management, automation, review collection, reporting and 8 branded social posts each month.',
    icon: TrendingUp,
    popular: true,
    launchIncludes: ['Everything included in Essential', 'Google Workspace business email', 'Advanced forms and customer journeys', 'Staff and service configuration', 'Existing customer-data import', 'Payment and deposit setup', 'Automated review-request setup', 'Customer follow-up configuration', 'Advanced KS OS onboarding'],
    monthlyIncludes: ['Everything included in Essential', '8 professionally designed branded social-media posts per month', 'Advanced customer CRM', 'Staff calendars and permissions', 'Stock and product management', 'Deposits and payment management', 'Memberships and customer packages', 'Gift cards', 'Automated appointment follow-ups', 'Automated Google review requests', 'Automated Trustpilot review requests', 'Customer reactivation campaigns', 'Customer segmentation', 'Advanced business reporting', 'Staff-performance reporting', 'Priority technical support'],
    notes: ['Printing costs and additional Google Workspace licences are charged separately.', 'The Growth social-media allowance replaces the Essential allowance and covers 8 posts in total each month. Account management, community replies, paid advertising and extra posts are quoted separately.'],
  },
  {
    id: 'scale',
    name: 'Scale',
    audience: 'Ambitious businesses, larger teams and owners who want strategic marketing and sales support alongside their digital platform.',
    launchPrice: '£397',
    monthlyPrice: '£297',
    summary: 'A complete digital growth platform with advanced automation, reporting, 12 branded social posts per month and a monthly one-to-one marketing and sales strategy session.',
    icon: Building2,
    launchIncludes: ['Everything included in Growth', 'Advanced marketing automation setup', 'Custom customer journeys', 'Multi-team or multi-location configuration', 'Advanced reporting configuration', 'Custom workflows', 'Full data migration support', 'Dedicated launch and training session'],
    monthlyIncludes: ['Everything included in Growth', '12 professionally designed branded social-media posts per month', 'Advanced marketing automation', 'Custom CRM workflows', 'Multi-location management where required', 'Advanced dashboards', 'Location and team comparisons', 'Higher communication allowances', 'Priority technical support', 'Monthly performance report', 'Monthly marketing and sales consultation', 'Campaign and promotional planning', 'Customer-retention strategy', 'Lead-conversion advice', 'Rebooking and upselling strategy', 'Quarterly business-growth roadmap'],
    notes: ['Includes one scheduled 60-minute marketing and sales consultation each month.', 'The Scale social-media allowance replaces the Growth allowance and covers 12 posts in total each month.', 'Printing costs, advertising budgets, social account management, community replies and additional third-party subscriptions are charged separately.'],
  },
];

export const includedWithEveryPackage = ['A professionally designed website', 'A new logo', 'Website copywriting', 'Business card design', 'Leaflet design', 'Mobile-responsive layouts', 'Online booking integration', 'Google review integration', 'Trustpilot review integration', 'Website hosting', 'Maintenance and security', 'Ongoing software updates', 'A monthly branded social-media content allowance'];

export const additionalCosts = ['Business card or leaflet printing', 'Professional photography or videography', 'Paid stock imagery', 'Advertising spend', 'Social-media account management and community management', 'Social posts above the package allowance', 'Ongoing graphic-design requests outside the agreed allowance', 'Unlimited design revisions', 'Additional email licences', 'Premium Trustpilot subscriptions', 'Third-party software subscriptions', 'Bespoke functionality outside KS OS', 'Complete redesigns requested after launch approval'];

export const standardScope = ['One initial logo direction with agreed refinements', 'One website design direction', 'Two structured revision rounds', 'One business card design', 'One leaflet design', 'Reasonable website copy required for launch'];

export const stackComparison = [
  ['Website and online presence', '', ''],
  ['Website design and build', '£500–£3,000+ one-off', 'Included in the Growth launch package'],
  ['Hosting, maintenance and security', '£20–£100+/mo', 'Included and managed'],
  ['Funnels and landing pages', '£20–£150+/mo', 'Included'],
  ['Customer operations', '', ''],
  ['CRM and customer pipeline', '£20–£400+/mo', 'Included'],
  ['Booking and team scheduling', '£10–£50+/user/mo', 'Included'],
  ['Forms and lead capture', '£10–£75+/mo', 'Included'],
  ['Email and SMS tools', '£20–£200+/mo plus usage', 'Included; usage is billed transparently'],
  ['Workflow automation', '£20–£200+/mo', 'Included'],
  ['Growth and reputation', '', ''],
  ['Reviews and reputation', '£40–£200+/mo', 'Included'],
  ['Reporting and analytics', '£20–£150+/mo', 'Included'],
  ['8 branded social-media posts', '£200–£500+/mo', 'Included in Growth'],
  ['Creative and ongoing support', '', ''],
  ['Business card and leaflet design', '£125–£400+ one-off', 'Included with print-ready artwork'],
  ['Business card and leaflet printing', '£40–£250+ per print run', 'Quoted separately'],
  ['Setup, integrations and support', '£150–£600+/mo', 'Included'],
  ['Typical first-year total', '£6,985–£34,900+ before printing and usage', 'Growth: £2,661 in year one — £297 launch + £197/mo'],
];
