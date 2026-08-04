import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck2,
  Check,
  ChevronDown,
  CircleCheckBig,
  CreditCard,
  Gauge,
  Headphones,
  Layers3,
  LockKeyhole,
  Menu,
  MessageSquareText,
  MousePointerClick,
  PanelsTopLeft,
  ShieldCheck,
  Star,
  UsersRound,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import './index.css';

const BOOKING_URL = '/book/ks-agency';
const KASIM_SHAH_LOGO = '/brand/kasim-shah.svg';
const KS_OS_LOGO = '/brand/ks-os.svg';

type Service = {
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

const services: Service[] = [
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

const stackComparison = [
  ['Website, hosting and landing pages', '£35–£250+/mo', 'Included, designed and managed'],
  ['CRM and customer pipeline', '£20–£400+/mo', 'Included and configured around your process'],
  ['Booking and team scheduling', '£10–£50+/user/mo', 'Included with your services, staff and rules'],
  ['Workflow automation', '£20–£150+/mo', 'Included, built and monitored for you'],
  ['Email and SMS platform', '£20–£200+/mo plus usage', 'Included; usage costs remain transparent'],
  ['Reviews and reputation tools', '£40–£200+/mo', 'Included and connected to real journeys'],
  ['Reporting and analytics', '£20–£150+/mo', 'Included in one connected dashboard'],
  ['Setup, integrations and ongoing support', '£150–£600+/mo', 'A core part of the KS OS service'],
];

function usePageMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [title, description]);
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo({ top: 0, behavior: 'auto' }), [pathname]);
  return null;
}

function KasimShahLogo({ inverse = false }: { inverse?: boolean }) {
  return <img src={KASIM_SHAH_LOGO} alt="Kasim Shah" className={`h-5 w-auto sm:h-6 ${inverse ? 'brightness-0 invert' : ''}`} />;
}

function KsOsLogo({ inverse = false, className = '' }: { inverse?: boolean; className?: string }) {
  return <img src={KS_OS_LOGO} alt="KS OS" className={`h-8 w-auto ${inverse ? 'brightness-0 invert' : ''} ${className}`} />;
}

function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
        <Link to="/" aria-label="Kasim Shah home" className="inline-flex items-center"><KasimShahLogo /></Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary navigation">
          <Link to="/services" className="text-sm font-bold text-slate-600 transition hover:text-indigo-700">KS OS services</Link>
          <a href="/#control" className="text-sm font-bold text-slate-600 transition hover:text-indigo-700">How it works</a>
          <a href="/#comparison" className="text-sm font-bold text-slate-600 transition hover:text-indigo-700">Compare costs</a>
          <a href="/#faq" className="text-sm font-bold text-slate-600 transition hover:text-indigo-700">FAQs</a>
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <a href="/login" className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">Client sign in</a>
          <a href={BOOKING_URL} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700">Book a consultation <ArrowRight className="h-4 w-4" /></a>
        </div>
        <button type="button" onClick={() => setOpen(value => !value)} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-950 lg:hidden" aria-label={open ? 'Close navigation' : 'Open navigation'}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <nav className="border-t border-slate-200 bg-white px-5 py-5 lg:hidden" aria-label="Mobile navigation">
          <div className="mx-auto grid max-w-7xl gap-2">
            <Link to="/services" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">KS OS services</Link>
            <a href="/#control" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">How it works</a>
            <a href="/#comparison" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">Compare costs</a>
            <a href="/#faq" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">FAQs</a>
            <a href={BOOKING_URL} className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white">Book a consultation <ArrowRight className="h-4 w-4" /></a>
          </div>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-md"><KasimShahLogo inverse /><div className="mt-6 flex items-center gap-3"><KsOsLogo inverse className="h-6" /><span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-200">The offer</span></div><p className="mt-5 text-sm leading-7 text-slate-400">A done-for-you business operating system built and managed by Kasim Shah, with your team kept in control.</p></div>
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Explore</p><div className="mt-4 grid gap-3 text-sm"><Link to="/services" className="hover:text-white">KS OS services</Link><a href="/#comparison" className="hover:text-white">Compare costs</a><a href={BOOKING_URL} className="hover:text-white">Book a consultation</a></div></div>
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Access</p><div className="mt-4 grid gap-3 text-sm"><a href="/login" className="hover:text-white">Client sign in</a><a href="/customer/login" className="hover:text-white">Customer portal</a><span className="inline-flex items-center gap-2 text-slate-500"><LockKeyhole className="h-4 w-4" /> Securely powered by KS OS</span></div></div>
      </div>
      <div className="border-t border-slate-800 px-5 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} Kasim Shah. KS OS is a Kasim Shah product.</div>
    </footer>
  );
}

function SectionHeading({ eyebrow, title, copy, dark = false, centre = false }: { eyebrow: string; title: string; copy?: string; dark?: boolean; centre?: boolean }) {
  return (
    <div className={`${centre ? 'mx-auto text-center' : ''} max-w-3xl`}>
      <p className={`text-xs font-black uppercase tracking-[0.24em] ${dark ? 'text-indigo-300' : 'text-indigo-700'}`}>{eyebrow}</p>
      <h2 className={`mt-4 text-3xl font-black tracking-[-0.045em] sm:text-4xl lg:text-5xl ${dark ? 'text-white' : 'text-slate-950'}`}>{title}</h2>
      {copy && <p className={`mt-5 text-base leading-8 sm:text-lg ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{copy}</p>}
    </div>
  );
}

function ServiceCard({ service, featured = false }: { service: Service; featured?: boolean }) {
  const Icon = service.icon;
  return (
    <Link to={`/services/${service.slug}`} className={`group rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg ${featured ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-start justify-between gap-4"><span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-5 w-5" /></span><ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-700" /></div>
      <p className="mt-7 text-xs font-black uppercase tracking-[0.2em] text-indigo-700">{service.eyebrow}</p>
      <h3 className="mt-3 text-2xl font-black tracking-[-0.035em] text-slate-950">{service.shortTitle}</h3>
      <p className="mt-4 leading-7 text-slate-600">{service.summary}</p>
      <div className="mt-6 flex flex-wrap gap-2">{service.features.map(feature => <span key={feature} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{feature}</span>)}</div>
    </Link>
  );
}

function ProductPreview() {
  const metrics: Array<[LucideIcon, string, string, string]> = [[CalendarCheck2, 'Bookings', '42 this week', '+18%'], [UsersRound, 'Customers', '1,284', '+64'], [Gauge, 'Response time', '4m 12s', '-31%'], [BarChart3, 'Conversion', '28.6%', '+6.4%']];
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
      <div className="flex min-h-[500px]">
        <aside className="hidden w-44 shrink-0 border-r border-slate-200 bg-white p-4 sm:block">
          <KsOsLogo className="h-6" />
          <a href={BOOKING_URL} className="mt-6 flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white"><CalendarCheck2 className="h-4 w-4" />Create booking</a>
          <div className="mt-5 grid gap-1 text-xs font-bold text-slate-500">{['Dashboard', 'Calendar', 'Bookings', 'Customers', 'Services', 'Automations', 'Reports'].map((item, index) => <span key={item} className={`rounded-lg px-3 py-2.5 ${index === 0 ? 'bg-indigo-50 text-indigo-700' : ''}`}>{item}</span>)}</div>
        </aside>
        <div className="min-w-0 flex-1 bg-slate-50">
          <div className="border-b border-slate-200 bg-white px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">KS Agency</p><div className="mt-1 flex items-center justify-between gap-3"><h2 className="text-xl font-black text-slate-950">Dashboard</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">Live</span></div></div>
          <div className="p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">{metrics.map(([Icon, label, value, delta]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon className="h-4 w-4" /></span><span className="text-xs font-black text-emerald-700">{delta}</span></div><p className="mt-5 text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p></div>)}</div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-black text-slate-700">Connected customer journey</p><span className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Automated</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center text-[9px] font-black uppercase tracking-wider text-slate-500 sm:grid-cols-6">{['Visit', 'Enquiry', 'Booked', 'Reminder', 'Paid', 'Review'].map((step, index) => <span key={step} className={`rounded-lg border px-2 py-2.5 ${index < 4 ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50'}`}>{step}</span>)}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  usePageMetadata('Kasim Shah | KS OS business operating system', 'KS OS is the done-for-you business operating system offered by Kasim Shah for websites, bookings, CRM, automation, communications, payments and analytics.');
  const [faq, setFaq] = useState<number | null>(0);
  const faqs = [
    ['Is KS OS another piece of software I have to set up?', 'No. KS OS is delivered as a managed solution by Kasim Shah. We map your processes, configure the platform, build the journeys and support ongoing improvements.'],
    ['Do I still control my business and data?', 'Yes. You approve the journeys, messaging, rules and permissions. Your team can access the live system, see activity and make operational changes.'],
    ['Can I start with only the services I need?', 'Yes. KS OS is modular. We can begin with the website and booking journey, then add CRM, automations, communications, reputation, payments or analytics.'],
    ['Does KS OS replace every tool immediately?', 'Not necessarily. We first identify what should be consolidated, what should remain and what needs integrating. The goal is a simpler operation, not change for the sake of it.'],
    ['How do I get a price?', 'Book a consultation through the KS Agency booking system. We will review your current setup and recommend a clear implementation and monthly service plan.'],
  ];
  return (
    <>
      <section className="relative overflow-hidden bg-slate-50">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.12),transparent_28%),radial-gradient(circle_at_90%_30%,rgba(129,140,248,0.10),transparent_25%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:py-28 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-32">
          <div>
            <div className="flex items-center gap-3"><KsOsLogo className="h-8 sm:h-9" /><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">A Kasim Shah product</span></div>
            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-indigo-700 shadow-sm"><WandSparkles className="h-4 w-4" /> Done for you. Controlled by you.</div>
            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.97] tracking-[-0.06em] text-slate-950 sm:text-6xl lg:text-7xl">Your entire business, <span className="text-indigo-600">working as one system.</span></h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">KS OS brings your website, bookings, customers, follow-up, payments and operations together. Kasim Shah builds and manages it around your business, while you stay in control.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row"><a href={BOOKING_URL} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700">Book your systems consultation <ArrowRight className="h-4 w-4" /></a><a href="#comparison" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100">See the cost of separate tools</a></div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold text-slate-500">{['Built around your workflow', 'One connected customer record', 'Ongoing support included'].map(item => <span key={item} className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />{item}</span>)}</div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white"><div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 text-center sm:grid-cols-3 lg:px-8">{[[Layers3, 'One platform', 'Instead of a patchwork of subscriptions'], [Headphones, 'One accountable partner', 'Instead of five different support teams'], [ShieldCheck, 'Your rules and data', 'Instead of losing control to complexity']].map(([Icon, title, copy]) => { const ItemIcon = Icon as LucideIcon; return <div key={title as string} className="flex items-center justify-center gap-4 sm:text-left"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><ItemIcon className="h-5 w-5" /></span><div><p className="font-black text-slate-950">{title as string}</p><p className="mt-1 text-xs leading-5 text-slate-500">{copy as string}</p></div></div>; })}</div></section>

      <section className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="The KS OS offer" title="Everything your business needs to attract, convert and serve customers" copy="Choose the capabilities you need now. KS OS connects them into one operating system and Kasim Shah manages the technical detail behind the scenes." centre /><div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{services.map((service, index) => <ServiceCard key={service.slug} service={service} featured={index === 0} />)}</div></div></section>

      <section id="control" className="overflow-hidden bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2"><div><SectionHeading eyebrow="Managed, not mysterious" title="I run the system. You run the business." copy="Done-for-you should not mean locked out. KS OS separates technical administration from business control, so you get expert implementation without giving up visibility or ownership." /><div className="mt-9 grid gap-5">{[['I design and configure', 'I map the journey, build the workflows, connect the tools and test the complete experience.', WandSparkles], ['You approve and control', 'You decide services, pricing, availability, messaging, permissions and what should be automated.', MousePointerClick], ['I monitor and improve', 'I keep the system healthy, respond to issues and help prioritise improvements as your business evolves.', Gauge]].map(([title, copy, Icon]) => { const StepIcon = Icon as LucideIcon; return <div key={title as string} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><StepIcon className="h-5 w-5" /></span><div><h3 className="font-black text-slate-950">{title as string}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{copy as string}</p></div></div>; })}</div></div><div className="relative rounded-2xl bg-slate-950 p-6 text-white shadow-2xl sm:p-9"><div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-indigo-500/20 blur-3xl" /><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">Your control layer</p><h3 className="mt-4 text-3xl font-black tracking-[-0.04em]">Clear decisions. Clear ownership. No black box.</h3><div className="mt-8 grid gap-3 sm:grid-cols-2">{['Your domain and brand', 'Your customer data', 'Your service rules', 'Your team permissions', 'Your communication approvals', 'Your performance dashboards', 'Your payment settings', 'Your change priorities'].map(item => <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-200"><Check className="h-4 w-4 shrink-0 text-indigo-300" />{item}</div>)}</div></div></div></section>

      <section id="comparison" className="bg-slate-950 px-5 py-20 text-white sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="The real cost of disconnected software" title="Stop paying for a stack you still have to operate yourself" copy="Separate subscriptions can look affordable one by one. The cost and complexity appear when you need them connected, configured, maintained and supported." dark /><div className="mt-12 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left"><thead><tr className="border-b border-white/10 bg-white/[0.04]"><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Capability</th><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-rose-200">Buying separately</th><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-indigo-300">With KS OS</th></tr></thead><tbody>{stackComparison.map(([capability, separate, included]) => <tr key={capability} className="border-b border-white/10 last:border-0"><td className="px-6 py-5 font-bold text-white">{capability}</td><td className="px-6 py-5 text-sm text-slate-300">{separate}</td><td className="px-6 py-5"><span className="inline-flex items-center gap-2 text-sm font-bold text-indigo-100"><CircleCheckBig className="h-4 w-4 text-indigo-300" />{included}</span></td></tr>)}</tbody><tfoot><tr className="bg-indigo-600 text-white"><td className="px-6 py-6 text-lg font-black">Typical combined position</td><td className="px-6 py-6"><span className="block text-2xl font-black">£315–£2,000+/mo</span><span className="text-xs font-bold text-indigo-100">before implementation projects and internal admin time</span></td><td className="px-6 py-6"><span className="block text-2xl font-black">One tailored plan</span><span className="text-xs font-bold text-indigo-100">platform, implementation and ongoing support together</span></td></tr></tfoot></table></div></div><p className="mt-4 text-xs leading-6 text-slate-500">Illustrative monthly market ranges. Actual costs vary by users, contacts, usage and feature tier. Email, SMS and payment processing usage may carry separate transparent charges.</p></div></section>

      <section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="A structured path to launch" title="From scattered tools to one working operating system" centre /><div className="mt-14 grid gap-5 md:grid-cols-4">{[['01', 'Discover', 'I review your customer journey, tools, bottlenecks and priorities.'], ['02', 'Design', 'I define the system, data, journeys, controls and launch sequence.'], ['03', 'Build', 'I configure, integrate, test and prepare your team for launch.'], ['04', 'Improve', 'I monitor performance and evolve the system with your business.']].map(([number, title, copy]) => <div key={number} className="relative rounded-xl border border-slate-200 p-6 shadow-sm"><span className="text-4xl font-black tracking-[-0.06em] text-indigo-100">{number}</span><h3 className="mt-8 text-xl font-black text-slate-950">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{copy}</p></div>)}</div></div></section>

      <section id="faq" className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]"><SectionHeading eyebrow="Common questions" title="What working with Kasim Shah and KS OS actually means" copy="A managed platform should make the business simpler, not create a new dependency you cannot understand." /><div className="grid gap-3">{faqs.map(([question, answer], index) => <div key={question} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button type="button" onClick={() => setFaq(faq === index ? null : index)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-black text-slate-950" aria-expanded={faq === index}><span>{question}</span><ChevronDown className={`h-5 w-5 shrink-0 transition ${faq === index ? 'rotate-180 text-indigo-700' : 'text-slate-400'}`} /></button>{faq === index && <p className="px-6 pb-6 text-sm leading-7 text-slate-600">{answer}</p>}</div>)}</div></div></section>

      <section className="bg-white px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-indigo-600 p-8 text-white shadow-[0_28px_90px_rgba(79,70,229,0.24)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-12"><div className="max-w-3xl"><div className="flex items-center gap-3"><KsOsLogo inverse className="h-7" /><span className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Start with clarity</span></div><h2 className="mt-5 text-3xl font-black tracking-[-0.05em] sm:text-5xl">See what your business could run like when everything is connected.</h2><p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-indigo-100">Book a systems consultation. I will identify the highest-impact improvements and recommend a practical path forward.</p></div><a href={BOOKING_URL} className="mt-8 inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-black text-indigo-700 shadow-xl transition hover:-translate-y-0.5 lg:mt-0">Book a consultation <ArrowRight className="h-4 w-4" /></a></div></section>
    </>
  );
}

function ServicesIndexPage() {
  usePageMetadata('KS OS services | Kasim Shah', 'Explore the KS OS services offered by Kasim Shah for websites, booking, CRM, automation, communications, reputation, operations and analytics.');
  return <><section className="border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><div className="flex items-center gap-3"><KsOsLogo className="h-8" /><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">The offer</span></div><h1 className="mt-8 max-w-5xl text-5xl font-black tracking-[-0.055em] text-slate-950 sm:text-6xl">A complete growth and operations stack, delivered as one managed system.</h1><p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600">Each service works on its own. The real advantage comes when they share customer data, trigger the right workflows and give you one connected view of the business.</p></div></section><section className="bg-slate-50 px-5 py-20 lg:px-8"><div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-2">{services.map(service => <ServiceCard key={service.slug} service={service} />)}</div></section></>;
}

function ServiceDetailPage() {
  const { slug } = useParams();
  const service = useMemo(() => services.find(item => item.slug === slug), [slug]);
  usePageMetadata(service ? `${service.shortTitle} | KS OS by Kasim Shah` : 'Service not found | Kasim Shah', service?.summary || 'Explore KS OS services.');
  if (!service) return <Navigate to="/services" replace />;
  const Icon = service.icon;
  const related = services.filter(item => item.slug !== service.slug).slice(0, 3);
  return <><section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(99,102,241,0.12),transparent_30%)]" /><div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_0.7fr]"><div><Link to="/services" className="inline-flex items-center gap-2 text-sm font-bold text-indigo-700 hover:text-indigo-800">← All KS OS services</Link><p className="mt-8 text-xs font-black uppercase tracking-[0.24em] text-indigo-700">{service.eyebrow}</p><h1 className="mt-5 text-5xl font-black leading-[1] tracking-[-0.055em] text-slate-950 sm:text-6xl">{service.title}</h1><p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600">{service.summary}</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><a href={BOOKING_URL} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white">Discuss this service <ArrowRight className="h-4 w-4" /></a><a href="#included" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-4 text-sm font-black text-slate-700">See what is included</a></div></div><div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl"><span className="grid h-16 w-16 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-7 w-7" /></span><p className="mt-8 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Business outcome</p><p className="mt-3 text-2xl font-black leading-9 text-slate-950">{service.outcome}</p><div className="mt-7 grid gap-3">{service.features.map(feature => <span key={feature} className="flex items-center gap-3 text-sm font-bold text-slate-700"><CircleCheckBig className="h-4 w-4 text-indigo-600" />{feature}</span>)}</div></div></div></section><section id="included" className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2"><div><SectionHeading eyebrow="Done-for-you delivery" title="What I handle for you" /><div className="mt-9 grid gap-3">{service.deliverables.map(item => <div key={item} className="flex items-start gap-4 rounded-xl border border-slate-200 p-5"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Check className="h-4 w-4" /></span><p className="font-bold leading-7 text-slate-700">{item}</p></div>)}</div></div><div><SectionHeading eyebrow="You remain in control" title="What stays in your hands" /><div className="mt-9 grid gap-3">{service.controls.map(item => <div key={item} className="flex items-start gap-4 rounded-xl bg-slate-950 p-5 text-white"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-indigo-300"><ShieldCheck className="h-4 w-4" /></span><p className="font-bold leading-7 text-slate-200">{item}</p></div>)}</div></div></div></section><section className="bg-slate-50 px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Connected by design" title="This service becomes more valuable when it works with the rest of KS OS" /><div className="mt-10 grid gap-5 md:grid-cols-3">{related.map(item => <ServiceCard key={item.slug} service={item} />)}</div></div></section><section className="bg-white px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl rounded-2xl bg-indigo-600 p-8 text-white sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-10"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Make it practical</p><h2 className="mt-4 max-w-3xl text-3xl font-black tracking-[-0.05em] sm:text-5xl">Let’s map this service to the way your business actually works.</h2></div><a href={BOOKING_URL} className="mt-8 inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-black text-indigo-700 lg:mt-0">Book a consultation <ArrowRight className="h-4 w-4" /></a></div></section></>;
}

function MarketingApp() {
  return <BrowserRouter><ScrollToTop /><div className="min-h-screen bg-white font-sans text-slate-950 antialiased selection:bg-indigo-200 selection:text-slate-950"><Header /><main><Routes><Route path="/" element={<HomePage />} /><Route path="/services" element={<ServicesIndexPage />} /><Route path="/services/:slug" element={<ServiceDetailPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main><Footer /></div></BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><MarketingApp /></StrictMode>);
