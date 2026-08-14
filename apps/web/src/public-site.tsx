import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  ChevronDown,
  CircleCheckBig,
  Gauge,
  Headphones,
  Info,
  Layers3,
  LockKeyhole,
  Menu,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  additionalCosts,
  includedWithEveryPackage,
  packages,
  services,
  stackComparison,
  standardScope,
  type PackageDefinition,
  type Service,
} from './public-site-data';
import './index.css';

const BOOKING_URL = '/book/ks-agency';
const KASIM_SHAH_LOGO = '/brand/kasim-shah.svg';
const KS_OS_LOGO = '/brand/ks-os.svg';

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

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }));
      return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, hash]);
  return null;
}

function KasimShahLogo({ inverse = false }: { inverse?: boolean }) {
  return <img src={KASIM_SHAH_LOGO} alt="Kasim Shah" className={`h-5 w-auto sm:h-6 ${inverse ? 'brightness-0 invert' : ''}`} />;
}

function KsOsLogo({ inverse = false, className = '' }: { inverse?: boolean; className?: string }) {
  return <img src={KS_OS_LOGO} alt="KS OS" className={`h-8 w-auto ${inverse ? 'brightness-0 invert' : ''} ${className}`} />;
}

const navItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/services', label: 'Services' },
  { to: '/packages', label: 'Packages' },
  { to: '/about', label: 'About Kasim' },
];

function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const linkClass = ({ isActive }: { isActive: boolean }) => `text-sm font-bold transition ${isActive ? 'text-indigo-700' : 'text-slate-600 hover:text-indigo-700'}`;
  const mobileLinkClass = ({ isActive }: { isActive: boolean }) => `rounded-xl px-4 py-3 text-sm font-bold ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
        <Link to="/" aria-label="Kasim Shah home" className="inline-flex shrink-0 items-center"><KasimShahLogo /></Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary navigation">
          {navItems.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>{item.label}</NavLink>)}
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
            {navItems.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={mobileLinkClass}>{item.label}</NavLink>)}
            <a href="/login" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">Client sign in</a>
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
        <div className="max-w-md"><KasimShahLogo inverse /><div className="mt-6 flex items-center gap-3"><KsOsLogo inverse className="h-6" /><span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-200">The product</span></div><p className="mt-5 text-sm leading-7 text-slate-400">A done-for-you business operating system built and managed by Kasim Shah, with your team kept in control.</p></div>
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Explore</p><div className="mt-4 grid gap-3 text-sm"><Link to="/" className="hover:text-white">Home</Link><Link to="/services" className="hover:text-white">Services</Link><Link to="/packages" className="hover:text-white">Packages</Link><Link to="/about" className="hover:text-white">About Kasim</Link></div></div>
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Access</p><div className="mt-4 grid gap-3 text-sm"><a href="/login" className="hover:text-white">Client sign in</a><a href="/customer/login" className="hover:text-white">Customer portal</a><a href={BOOKING_URL} className="hover:text-white">Book a consultation</a><span className="inline-flex items-center gap-2 text-slate-500"><LockKeyhole className="h-4 w-4" /> Securely powered by KS OS</span></div></div>
      </div>
      <div className="border-t border-slate-800 px-5 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} Kasim Shah. KS OS is a Kasim Shah product.</div>
    </footer>
  );
}

function SectionHeading({ eyebrow, title, copy, dark = false, centre = false }: { eyebrow: string; title: string; copy?: string; dark?: boolean; centre?: boolean }) {
  return <div className={`${centre ? 'mx-auto text-center' : ''} max-w-3xl`}><p className={`text-xs font-black uppercase tracking-[0.24em] ${dark ? 'text-indigo-300' : 'text-indigo-700'}`}>{eyebrow}</p><h2 className={`mt-4 text-3xl font-black tracking-[-0.045em] sm:text-4xl lg:text-5xl ${dark ? 'text-white' : 'text-slate-950'}`}>{title}</h2>{copy && <p className={`mt-5 text-base leading-8 sm:text-lg ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{copy}</p>}</div>;
}

function ServiceCard({ service, featured = false }: { service: Service; featured?: boolean }) {
  const Icon = service.icon;
  return <Link to={`/services/${service.slug}`} className={`group rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg ${featured ? 'lg:col-span-2' : ''}`}><div className="flex items-start justify-between gap-4"><span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-5 w-5" /></span><ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-indigo-700" /></div><p className="mt-7 text-xs font-black uppercase tracking-[0.2em] text-indigo-700">{service.eyebrow}</p><h3 className="mt-3 text-2xl font-black tracking-[-0.035em] text-slate-950">{service.shortTitle}</h3><p className="mt-4 leading-7 text-slate-600">{service.summary}</p><div className="mt-6 flex flex-wrap gap-2">{service.features.map(feature => <span key={feature} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{feature}</span>)}</div></Link>;
}

function ProductPreview() {
  const metrics: Array<[LucideIcon, string, string, string]> = [[CalendarCheck2, 'Bookings', '42 this week', '+18%'], [UsersRound, 'Customers', '1,284', '+64'], [Gauge, 'Response time', '4m 12s', '-31%'], [BarChart3, 'Conversion', '28.6%', '+6.4%']];
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)]"><div className="flex min-h-[500px]"><aside className="hidden w-44 shrink-0 border-r border-slate-200 bg-white p-4 sm:block"><KsOsLogo className="h-6" /><a href={BOOKING_URL} className="mt-6 flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white"><CalendarCheck2 className="h-4 w-4" />Create booking</a><div className="mt-5 grid gap-1 text-xs font-bold text-slate-500">{['Dashboard', 'Calendar', 'Bookings', 'Customers', 'Services', 'Automations', 'Reports'].map((item, index) => <span key={item} className={`rounded-lg px-3 py-2.5 ${index === 0 ? 'bg-indigo-50 text-indigo-700' : ''}`}>{item}</span>)}</div></aside><div className="min-w-0 flex-1 bg-slate-50"><div className="border-b border-slate-200 bg-white px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">KS Agency</p><div className="mt-1 flex items-center justify-between gap-3"><h2 className="text-xl font-black text-slate-950">Dashboard</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">Live</span></div></div><div className="p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2">{metrics.map(([Icon, label, value, delta]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon className="h-4 w-4" /></span><span className="text-xs font-black text-emerald-700">{delta}</span></div><p className="mt-5 text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p></div>)}</div><div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-black text-slate-700">Connected customer journey</p><span className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Automated</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center text-[9px] font-black uppercase tracking-wider text-slate-500 sm:grid-cols-6">{['Visit', 'Enquiry', 'Booked', 'Reminder', 'Paid', 'Review'].map((step, index) => <span key={step} className={`rounded-lg border px-2 py-2.5 ${index < 4 ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50'}`}>{step}</span>)}</div></div></div></div></div></div>;
}

function AboutPreview() {
  return <section className="bg-white px-5 py-20 sm:py-24 lg:px-8"><div className="mx-auto grid max-w-7xl items-center gap-10 rounded-2xl border border-slate-200 bg-slate-50 p-7 shadow-sm sm:p-10 lg:grid-cols-[1.1fr_0.9fr]"><div><SectionHeading eyebrow="The experience behind KS OS" title="Enterprise-level digital thinking, brought directly to your business." copy="Kasim Shah has spent more than a decade improving customer journeys, conversion and digital performance for major UK businesses and global brands. KS OS turns that experience into a practical managed service for growing businesses." /><Link to="/about" className="mt-7 inline-flex items-center gap-2 text-sm font-black text-indigo-700 hover:text-indigo-800">Learn about Kasim and the results behind KS OS <ArrowRight className="h-4 w-4" /></Link></div><div className="grid grid-cols-2 gap-3">{[['10+', 'Years of commercial experience'], ['+25%', 'Conversion uplift'], ['+29%', 'Platform engagement'], ['+23%', 'Automation efficiency']].map(([value, label]) => <div key={value} className="rounded-xl bg-slate-950 p-5 text-white"><p className="text-3xl font-black tracking-tight">{value}</p><p className="mt-2 text-xs font-bold leading-5 text-slate-300">{label}</p></div>)}</div></div></section>;
}

function PackagesPreview() {
  return <section className="border-y border-slate-200 bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="KS OS packages" title="A clear launch fee and monthly plan." copy="The packages do not replace the wider KS OS service catalogue. They define the launch scope, platform access and ongoing support level that fits your business now." centre /><div className="mt-14 grid gap-7 lg:grid-cols-3">{packages.map(item => <article key={item.id} className={`relative rounded-2xl border bg-white p-7 shadow-sm ${item.popular ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}`}>{item.popular && <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">Most popular</span>}<h3 className="text-3xl font-black text-slate-950">{item.name}</h3><p className="mt-3 text-sm leading-7 text-slate-600">{item.audience}</p><div className="mt-6 rounded-xl bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Launch</p><p className="mt-1 text-3xl font-black text-slate-950">{item.launchPrice}</p><p className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Then monthly</p><p className="mt-1 text-3xl font-black text-indigo-600">{item.monthlyPrice}<span className="text-sm font-bold text-slate-500"> / month</span></p></div><Link to={`/packages#${item.id}`} className="mt-7 inline-flex items-center gap-2 text-sm font-black text-indigo-700">View {item.name} <ArrowRight className="h-4 w-4" /></Link></article>)}</div><div className="mt-10 text-center"><Link to="/packages" className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white">Compare all package inclusions <ArrowRight className="h-4 w-4" /></Link></div></div></section>;
}

function HomePage() {
  usePageMetadata('Kasim Shah | KS OS business operating system', 'KS OS is the done-for-you business operating system offered by Kasim Shah, backed by more than a decade of commercial UX, conversion, brand and digital strategy experience.');
  const [faq, setFaq] = useState<number | null>(0);
  const faqs = [
    ['Is KS OS another piece of software I have to set up?', 'No. KS OS is delivered as a managed solution by Kasim Shah. We map your processes, configure the platform, build the journeys and support ongoing improvements.'],
    ['Do I still control my business and data?', 'Yes. You approve the journeys, messaging, rules and permissions. Your team can access the live system, see activity and make operational changes.'],
    ['Can I start with only the services I need?', 'Yes. KS OS is modular. We can begin with the website and booking journey, then add CRM, automations, communications, reputation, payments or analytics.'],
    ['Does KS OS replace every tool immediately?', 'Not necessarily. We first identify what should be consolidated, what should remain and what needs integrating. The goal is a simpler operation, not change for the sake of it.'],
    ['How do I choose a package?', 'Review the Essential, Growth and Scale packages, then book a consultation so the recommended starting scope can be matched to your operation.'],
  ];
  return <>
    <section className="relative overflow-hidden bg-slate-50"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.12),transparent_28%),radial-gradient(circle_at_90%_30%,rgba(129,140,248,0.10),transparent_25%)]" /><div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:py-28 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-32"><div><div className="flex items-center gap-3"><KsOsLogo className="h-8 sm:h-9" /><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">A Kasim Shah product</span></div><div className="mt-8 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-indigo-700 shadow-sm"><WandSparkles className="h-4 w-4" /> Done for you. Controlled by you.</div><h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.97] tracking-[-0.06em] text-slate-950 sm:text-6xl lg:text-7xl">Your entire business, <span className="text-indigo-600">working as one system.</span></h1><p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">KS OS brings your website, bookings, customers, follow-up, payments and operations together. Kasim Shah builds and manages it around your business, while you stay in control.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><a href={BOOKING_URL} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-indigo-700">Book your systems consultation <ArrowRight className="h-4 w-4" /></a><Link to="/packages" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100">View packages</Link></div><div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm font-bold text-slate-500">{['Built around your workflow', 'One connected customer record', 'Ongoing support included'].map(item => <span key={item} className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />{item}</span>)}</div></div><ProductPreview /></div></section>
    <section className="border-y border-slate-200 bg-white"><div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 text-center sm:grid-cols-3 lg:px-8">{[[Layers3, 'One platform', 'Instead of a patchwork of subscriptions'], [Headphones, 'One accountable partner', 'Instead of five different support teams'], [ShieldCheck, 'Your rules and data', 'Instead of losing control to complexity']].map(([Icon, title, copy]) => { const ItemIcon = Icon as LucideIcon; return <div key={title as string} className="flex items-center justify-center gap-4 sm:text-left"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><ItemIcon className="h-5 w-5" /></span><div><p className="font-black text-slate-950">{title as string}</p><p className="mt-1 text-xs leading-5 text-slate-500">{copy as string}</p></div></div>; })}</div></section>
    <AboutPreview />
    <section className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="The KS OS service catalogue" title="Everything your business needs to attract, convert and serve customers" copy="Each capability has its own page so you can understand what it does, what is delivered and what remains in your control." centre /><div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{services.map((service, index) => <ServiceCard key={service.slug} service={service} featured={index === 0} />)}</div><div className="mt-10 text-center"><Link to="/services" className="inline-flex items-center gap-2 text-sm font-black text-indigo-700">Explore the full service catalogue <ArrowRight className="h-4 w-4" /></Link></div></div></section>
    <PackagesPreview />
    <section className="overflow-hidden bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2"><div><SectionHeading eyebrow="Managed, not mysterious" title="I run the system. You run the business." copy="Done-for-you should not mean locked out. KS OS separates technical administration from business control, so you get expert implementation without giving up visibility or ownership." /><div className="mt-9 grid gap-5">{[['I design and configure', 'I map the journey, build the workflows, connect the tools and test the complete experience.', WandSparkles], ['You approve and control', 'You decide services, pricing, availability, messaging, permissions and what should be automated.', MousePointerClick], ['I monitor and improve', 'I keep the system healthy, respond to issues and help prioritise improvements as your business evolves.', Gauge]].map(([title, copy, Icon]) => { const StepIcon = Icon as LucideIcon; return <div key={title as string} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><StepIcon className="h-5 w-5" /></span><div><h3 className="font-black text-slate-950">{title as string}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{copy as string}</p></div></div>; })}</div></div><div className="relative rounded-2xl bg-slate-950 p-6 text-white shadow-2xl sm:p-9"><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">Your control layer</p><h3 className="mt-4 text-3xl font-black tracking-[-0.04em]">Clear decisions. Clear ownership. No black box.</h3><div className="mt-8 grid gap-3 sm:grid-cols-2">{['Your domain and brand', 'Your customer data', 'Your service rules', 'Your team permissions', 'Your communication approvals', 'Your performance dashboards', 'Your payment settings', 'Your change priorities'].map(item => <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-200"><Check className="h-4 w-4 shrink-0 text-indigo-300" />{item}</div>)}</div></div></div></section>
    <section className="bg-slate-950 px-5 py-20 text-white sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="The real cost of disconnected software" title="Stop paying for a stack you still have to operate yourself" copy="Separate subscriptions can look affordable one by one. The cost and complexity appear when you need them connected, configured, maintained and supported." dark /><div className="mt-12 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl"><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left"><thead><tr className="border-b border-white/10 bg-white/[0.04]"><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Capability</th><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-rose-200">Buying separately</th><th className="px-6 py-5 text-xs font-black uppercase tracking-[0.18em] text-indigo-300">With KS OS</th></tr></thead><tbody>{stackComparison.map(([capability, separate, included]) => <tr key={capability} className="border-b border-white/10 last:border-0"><td className="px-6 py-5 font-bold text-white">{capability}</td><td className="px-6 py-5 text-sm text-slate-300">{separate}</td><td className="px-6 py-5 text-sm font-bold text-indigo-100">{included}</td></tr>)}</tbody></table></div></div></div></section>
    <section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="A structured path to launch" title="From scattered tools to one working operating system" centre /><div className="mt-14 grid gap-5 md:grid-cols-4">{[['01', 'Discover', 'I review your customer journey, tools, bottlenecks and priorities.'], ['02', 'Design', 'I define the system, data, journeys, controls and launch sequence.'], ['03', 'Build', 'I configure, integrate, test and prepare your team for launch.'], ['04', 'Improve', 'I monitor performance and evolve the system with your business.']].map(([number, title, copy]) => <div key={number} className="rounded-xl border border-slate-200 p-6 shadow-sm"><span className="text-4xl font-black text-indigo-100">{number}</span><h3 className="mt-8 text-xl font-black text-slate-950">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{copy}</p></div>)}</div></div></section>
    <section className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]"><SectionHeading eyebrow="Common questions" title="What working with Kasim Shah and KS OS actually means" copy="A managed platform should make the business simpler, not create a new dependency you cannot understand." /><div className="grid gap-3">{faqs.map(([question, answer], index) => <div key={question} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button type="button" onClick={() => setFaq(faq === index ? null : index)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-black text-slate-950" aria-expanded={faq === index}><span>{question}</span><ChevronDown className={`h-5 w-5 shrink-0 transition ${faq === index ? 'rotate-180 text-indigo-700' : 'text-slate-400'}`} /></button>{faq === index && <p className="px-6 pb-6 text-sm leading-7 text-slate-600">{answer}</p>}</div>)}</div></div></section>
    <CallToAction />
  </>;
}

function AboutPage() {
  usePageMetadata('About Kasim Shah | Experience behind KS OS', 'Learn how Kasim Shah brings more than a decade of UX, conversion, brand and digital strategy experience to growing businesses through KS OS.');
  const impact = [['10+ years', 'Commercial UX, conversion, brand and digital strategy'], ['+25%', 'Conversion uplift delivered on key AO.com journeys'], ['+29%', 'Platform engagement growth delivered at Zuto'], ['+23%', 'Automation efficiency delivered at Anywhere Works']];
  const brands = ['AO.com', 'Zuto', 'Samsung', 'Intel', 'Neff'];
  return <>
    <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(99,102,241,0.14),transparent_30%)]" /><div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_0.85fr]"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-700">Who is Kasim Shah?</p><h1 className="mt-5 text-5xl font-black leading-[0.98] tracking-[-0.06em] text-slate-950 sm:text-6xl">A decade of enterprise digital experience, now brought directly to your business.</h1><p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600">This is not a CV page. It is the reason KS OS is different: the same commercial thinking, research discipline and conversion focus used inside major online businesses, applied directly to helping your business grow.</p></div><div className="rounded-2xl bg-slate-950 p-7 text-white shadow-2xl"><KasimShahLogo inverse /><p className="mt-7 text-2xl font-black leading-9">I built KS OS to make high-quality digital strategy, design and technology accessible without requiring customers to assemble an enterprise team.</p></div></div></section>
    <section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr]"><div><SectionHeading eyebrow="Commercial experience" title="Built around outcomes, not decoration." /><div className="mt-7 space-y-5 text-lg leading-8 text-slate-600"><p>I have spent more than 10 years working across customer experience, UX, conversion, branding and digital strategy—inside major UK online businesses and on work for recognised global brands.</p><p>From improving high-traffic e-commerce journeys at AO.com to transforming customer platforms at Zuto, my work has increased conversion, engagement and operational performance, helping generate hundreds of thousands of pounds through online platforms.</p><p>KS OS brings that experience to sole traders, service businesses and growing teams through a practical platform, professional website and ongoing strategic support.</p></div><a href={BOOKING_URL} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white">Bring this experience into your business <ArrowRight className="h-4 w-4" /></a></div><div className="grid grid-cols-2 gap-3">{impact.map(([value, label]) => <div key={value} className="rounded-2xl border border-slate-200 bg-slate-50 p-6"><p className="text-4xl font-black tracking-tight text-indigo-600">{value}</p><p className="mt-3 text-sm font-bold leading-6 text-slate-600">{label}</p></div>)}</div></div></section>
    <section className="bg-slate-950 px-5 py-20 text-white sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Experience across" title="Major UK platforms and global household names." copy="The value is not the logo list by itself. It is the standards, scale and commercial accountability learned while working within those environments." dark /><div className="mt-10 flex flex-wrap gap-3">{brands.map(brand => <span key={brand} className="rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black text-slate-200">{brand}</span>)}</div></div></section>
    <section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="What customers receive" title="One perspective across product, brand, marketing and technology." centre /><div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{[[BriefcaseBusiness, 'Commercial thinking', 'Every decision is connected to revenue, customer behaviour or operational performance.'], [UsersRound, 'Customer-led design', 'Journeys are shaped around what customers need to understand, trust and do next.'], [Sparkles, 'Brand and conversion', 'The visual identity, copy and experience work together instead of being treated separately.'], [Gauge, 'Technical delivery', 'The strategy is implemented, monitored and improved rather than handed over as a presentation.']].map(([Icon, title, copy]) => { const ItemIcon = Icon as LucideIcon; return <div key={title as string} className="rounded-2xl border border-slate-200 p-6 shadow-sm"><span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><ItemIcon className="h-5 w-5" /></span><h2 className="mt-6 text-xl font-black text-slate-950">{title as string}</h2><p className="mt-3 text-sm leading-7 text-slate-600">{copy as string}</p></div>; })}</div></div></section>
    <CallToAction />
  </>;
}

function ServicesIndexPage() {
  usePageMetadata('KS OS services | Kasim Shah', 'Explore KS OS services for websites, booking, CRM, automation, communications, reputation, operations and analytics.');
  return <><section className="border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><div className="flex items-center gap-3"><KsOsLogo className="h-8" /><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Services</span></div><h1 className="mt-8 max-w-5xl text-5xl font-black tracking-[-0.055em] text-slate-950 sm:text-6xl">A complete growth and operations stack, delivered as one managed system.</h1><p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600">Each service has its own scope and business outcome. The advantage comes when they share customer data, trigger the right workflows and give you one connected view of the business.</p></div></section><section className="bg-slate-50 px-5 py-20 lg:px-8"><div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-2">{services.map(service => <ServiceCard key={service.slug} service={service} />)}</div></section><CallToAction /></>;
}

function ServiceDetailPage() {
  const { slug } = useParams();
  const service = useMemo(() => services.find(item => item.slug === slug), [slug]);
  usePageMetadata(service ? `${service.shortTitle} | KS OS by Kasim Shah` : 'Service not found | Kasim Shah', service?.summary || 'Explore KS OS services.');
  if (!service) return <Navigate to="/services" replace />;
  const Icon = service.icon;
  const related = services.filter(item => item.slug !== service.slug).slice(0, 3);
  return <><section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_0.7fr]"><div><Link to="/services" className="inline-flex items-center gap-2 text-sm font-bold text-indigo-700">← All services</Link><p className="mt-8 text-xs font-black uppercase tracking-[0.24em] text-indigo-700">{service.eyebrow}</p><h1 className="mt-5 text-5xl font-black leading-[1] tracking-[-0.055em] text-slate-950 sm:text-6xl">{service.title}</h1><p className="mt-7 max-w-3xl text-lg leading-8 text-slate-600">{service.summary}</p><a href={BOOKING_URL} className="mt-9 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-sm font-black text-white">Discuss this service <ArrowRight className="h-4 w-4" /></a></div><div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl"><span className="grid h-16 w-16 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-7 w-7" /></span><p className="mt-8 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Business outcome</p><p className="mt-3 text-2xl font-black leading-9 text-slate-950">{service.outcome}</p><div className="mt-7 grid gap-3">{service.features.map(feature => <span key={feature} className="flex items-center gap-3 text-sm font-bold text-slate-700"><CircleCheckBig className="h-4 w-4 text-indigo-600" />{feature}</span>)}</div></div></div></section><section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2"><div><SectionHeading eyebrow="Done-for-you delivery" title="What I handle for you" /><div className="mt-9 grid gap-3">{service.deliverables.map(item => <div key={item} className="flex items-start gap-4 rounded-xl border border-slate-200 p-5"><Check className="mt-1 h-4 w-4 shrink-0 text-indigo-600" /><p className="font-bold leading-7 text-slate-700">{item}</p></div>)}</div></div><div><SectionHeading eyebrow="You remain in control" title="What stays in your hands" /><div className="mt-9 grid gap-3">{service.controls.map(item => <div key={item} className="flex items-start gap-4 rounded-xl bg-slate-950 p-5 text-white"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-indigo-300" /><p className="font-bold leading-7 text-slate-200">{item}</p></div>)}</div></div></div></section><section className="bg-slate-50 px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="Connected by design" title="This becomes more valuable when it works with the rest of KS OS" /><div className="mt-10 grid gap-5 md:grid-cols-3">{related.map(item => <ServiceCard key={item.slug} service={item} />)}</div></div></section><CallToAction /></>;
}

function PackageCard({ item }: { item: PackageDefinition }) {
  const Icon = item.icon;
  return <article className={`relative flex h-full flex-col rounded-2xl border bg-white p-7 shadow-sm ${item.popular ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}`}>{item.popular && <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">Most popular</span>}<span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-5 w-5" /></span><h2 className="mt-6 text-3xl font-black text-slate-950">{item.name}</h2><p className="mt-3 text-sm leading-7 text-slate-600">{item.audience}</p><div className="mt-7 rounded-xl bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Brand, website and launch</p><p className="mt-2 text-4xl font-black text-slate-950">{item.launchPrice}</p><p className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Then monthly</p><p className="mt-2 text-4xl font-black text-indigo-600">{item.monthlyPrice}<span className="text-base font-bold text-slate-500"> / month</span></p></div><p className="mt-6 text-sm font-semibold leading-7 text-slate-700">{item.summary}</p><div className="mt-6 grid gap-3">{item.monthlyIncludes.slice(0, 5).map(feature => <span key={feature} className="flex items-start gap-3 text-sm font-bold text-slate-700"><CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />{feature}</span>)}</div><a href={`#${item.id}`} className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-black text-indigo-700">View full package <ArrowRight className="h-4 w-4" /></a></article>;
}

function FeatureList({ title, items, dark = false }: { title: string; items: string[]; dark?: boolean }) {
  return <div className={`rounded-2xl border p-6 ${dark ? 'border-slate-800 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-950'}`}><h3 className="text-xl font-black">{title}</h3><div className="mt-6 grid gap-3">{items.map(item => <div key={item} className={`flex items-start gap-3 text-sm font-semibold leading-6 ${dark ? 'text-slate-300' : 'text-slate-700'}`}><Check className={`mt-1 h-4 w-4 shrink-0 ${dark ? 'text-indigo-300' : 'text-indigo-600'}`} />{item}</div>)}</div></div>;
}

function PackageDetail({ item }: { item: PackageDefinition }) {
  const Icon = item.icon;
  return <section id={item.id} className="scroll-mt-28 border-t border-slate-200 bg-white px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl"><div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr] lg:items-start"><div className="lg:sticky lg:top-28"><span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-6 w-6" /></span><div className="mt-6 flex items-center gap-3"><h2 className="text-4xl font-black text-slate-950">{item.name}</h2>{item.popular && <span className="rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase text-white">Most popular</span>}</div><p className="mt-5 text-base leading-8 text-slate-600">{item.audience}</p><div className="mt-7 rounded-xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-sm font-black text-slate-950">{item.launchPrice} to launch</p><p className="mt-1 text-2xl font-black text-indigo-700">Then {item.monthlyPrice} per month</p></div><a href={BOOKING_URL} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-4 text-sm font-black text-white">Discuss {item.name} <ArrowRight className="h-4 w-4" /></a></div><div className="grid gap-6 xl:grid-cols-2"><FeatureList title="Brand, website and launch package" items={item.launchIncludes} /><FeatureList title="Ongoing monthly package" items={item.monthlyIncludes} dark /><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold leading-7 text-amber-950 xl:col-span-2"><div className="flex items-start gap-3"><Info className="mt-1 h-5 w-5 shrink-0" /><div>{item.notes.map(note => <p key={note} className="mt-2 first:mt-0">{note}</p>)}</div></div></div></div></div></div></section>;
}

function PackagesPage() {
  usePageMetadata('KS OS packages and pricing | Kasim Shah', 'Choose an Essential, Growth or Scale KS OS package with professional branding, website, booking, CRM, automation and ongoing support.');
  return <><section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl text-center"><div className="flex items-center justify-center gap-3"><KsOsLogo className="h-9" /><span className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Packages</span></div><h1 className="mx-auto mt-8 max-w-5xl text-5xl font-black leading-[0.98] tracking-[-0.06em] text-slate-950 sm:text-6xl">Choose the level of support your business needs now.</h1><p className="mx-auto mt-7 max-w-3xl text-lg leading-8 text-slate-600">Every package combines a professional launch with the KS OS platform and ongoing support. The service catalogue remains intact; packages simply define the starting scope and monthly service level.</p><div className="mt-8 flex flex-wrap justify-center gap-4 text-sm font-bold text-slate-600">{['No per-page website charge', 'Copywriting included', '12-month minimum commitment'].map(item => <span key={item} className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />{item}</span>)}</div></div></section><section className="bg-white px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto max-w-7xl"><SectionHeading eyebrow="KS OS packages" title="A clear launch fee. A clear monthly plan." copy="Start with the package that matches your current operation, knowing the wider KS OS capability can evolve with your business." centre /><div className="mt-14 grid gap-7 lg:grid-cols-3">{packages.map(item => <PackageCard key={item.id} item={item} />)}</div><p className="mx-auto mt-8 max-w-4xl text-center text-xs leading-6 text-slate-500">The Brand, Website and Launch Fee is payable before work begins. Each package carries a minimum 12-month subscription commitment. The launch fee becomes non-refundable once design or copywriting work has started.</p></div></section><section className="border-y border-slate-800 bg-slate-950 px-5 py-20 text-white lg:px-8"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]"><div><SectionHeading eyebrow="Included with every package" title="The professional foundations are never held back." copy="Every customer gets the brand, website and operational essentials needed to launch properly. There is no charge based on the number of website pages." dark /></div><div className="grid gap-3 sm:grid-cols-2">{includedWithEveryPackage.map(item => <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm font-bold text-slate-200"><CircleCheckBig className="h-4 w-4 shrink-0 text-indigo-300" />{item}</div>)}</div></div></section>{packages.map(item => <PackageDetail key={item.id} item={item} />)}<section className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8"><div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-700">Standard launch scope</p><h2 className="mt-4 text-3xl font-black text-slate-950">A structured process keeps the subsidised launch price sustainable.</h2><div className="mt-7 grid gap-3">{standardScope.map(item => <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"><Check className="mt-1 h-4 w-4 shrink-0 text-indigo-600" />{item}</div>)}</div><p className="mt-7 text-sm leading-7 text-slate-600">Additional concepts, extensive revisions or changes requested after approval can be quoted separately.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-700">Additional costs</p><h2 className="mt-4 text-3xl font-black text-slate-950">Clear boundaries prevent surprise charges.</h2><div className="mt-7 grid gap-3 sm:grid-cols-2">{additionalCosts.map(item => <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"><Info className="mt-1 h-4 w-4 shrink-0 text-slate-400" />{item}</div>)}</div></div></div></section><CallToAction /></>;
}

function CallToAction() {
  return <section className="bg-white px-5 py-20 lg:px-8"><div className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-indigo-600 p-8 text-white shadow-[0_28px_90px_rgba(79,70,229,0.24)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-12"><div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Start with clarity</p><h2 className="mt-5 text-3xl font-black tracking-[-0.05em] sm:text-5xl">See what your business could run like when everything is connected.</h2><p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-indigo-100">Book a consultation. I will identify the highest-impact improvements and recommend the right practical starting point.</p></div><a href={BOOKING_URL} className="mt-8 inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-black text-indigo-700 shadow-xl lg:mt-0">Book a consultation <ArrowRight className="h-4 w-4" /></a></div></section>;
}

function PublicSite() {
  return <BrowserRouter><ScrollManager /><div className="min-h-screen bg-white font-sans text-slate-950 antialiased selection:bg-indigo-200 selection:text-slate-950"><Header /><main><Routes><Route path="/" element={<HomePage />} /><Route path="/about" element={<AboutPage />} /><Route path="/services" element={<ServicesIndexPage />} /><Route path="/services/:slug" element={<ServiceDetailPage />} /><Route path="/packages" element={<PackagesPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main><Footer /></div></BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><PublicSite /></StrictMode>);
