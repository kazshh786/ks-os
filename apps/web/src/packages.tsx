import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  Building2,
  Check,
  CircleCheckBig,
  Info,
  Rocket,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import './index.css';

const BOOKING_URL = '/book/ks-agency';
const KASIM_SHAH_LOGO = '/brand/kasim-shah.svg';
const KS_OS_LOGO = '/brand/ks-os.svg';

type PackageDefinition = {
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

const packages: PackageDefinition[] = [
  {
    id: 'essential',
    name: 'Essential',
    audience: 'Sole traders and small service businesses that need a complete professional presence and the essential tools to operate online.',
    launchPrice: '£197',
    monthlyPrice: '£97',
    summary: 'A complete website, new logo, professional copywriting, business email, printed-marketing designs, booking tools, CRM and ongoing support.',
    icon: Rocket,
    launchIncludes: [
      'New professional logo',
      'Brand colours and typography',
      'Professionally designed business website',
      'Unlimited reasonable pages required for launch',
      'Mobile-responsive design',
      'Website copywriting included',
      'Service and business content creation',
      'Business card design',
      'Promotional leaflet design',
      'Print-ready artwork files',
      'Online booking integration',
      'Google Business Profile integration',
      'Google review integration',
      'Trustpilot review integration',
      'Zoho professional business email',
      'Domain connection',
      'Website launch',
    ],
    monthlyIncludes: [
      'KS OS business-management platform',
      'Online appointment booking',
      'Customer CRM',
      'Services and pricing management',
      'Appointment calendar',
      'Customer records and notes',
      'Basic reporting',
      'Website hosting',
      'Website maintenance',
      'Security and backups',
      'Software updates',
      'Standard technical support',
    ],
    notes: ['Printing costs are charged separately.'],
  },
  {
    id: 'growth',
    name: 'Growth',
    audience: 'Established businesses that want stronger operational tools, automation and customer-growth features.',
    launchPrice: '£297',
    monthlyPrice: '£197',
    summary: 'Everything needed to run and grow an established business, including Google Workspace, advanced CRM, staff management, automation, review collection and reporting.',
    icon: TrendingUp,
    popular: true,
    launchIncludes: [
      'Everything included in Essential',
      'Google Workspace business email',
      'Advanced forms and customer journeys',
      'Staff and service configuration',
      'Existing customer-data import',
      'Payment and deposit setup',
      'Automated review-request setup',
      'Customer follow-up configuration',
      'Advanced KS OS onboarding',
    ],
    monthlyIncludes: [
      'Everything included in Essential',
      'Advanced customer CRM',
      'Staff calendars and permissions',
      'Stock and product management',
      'Deposits and payment management',
      'Memberships and customer packages',
      'Gift cards',
      'Automated appointment follow-ups',
      'Automated Google review requests',
      'Automated Trustpilot review requests',
      'Customer reactivation campaigns',
      'Customer segmentation',
      'Advanced business reporting',
      'Staff-performance reporting',
      'Priority technical support',
    ],
    notes: ['Printing costs and additional Google Workspace licences are charged separately.'],
  },
  {
    id: 'scale',
    name: 'Scale',
    audience: 'Ambitious businesses, larger teams and owners who want strategic marketing and sales support alongside their digital platform.',
    launchPrice: '£397',
    monthlyPrice: '£297',
    summary: 'A complete digital growth platform with advanced automation, reporting and a monthly one-to-one marketing and sales strategy session.',
    icon: Building2,
    launchIncludes: [
      'Everything included in Growth',
      'Advanced marketing automation setup',
      'Custom customer journeys',
      'Multi-team or multi-location configuration',
      'Advanced reporting configuration',
      'Custom workflows',
      'Full data migration support',
      'Dedicated launch and training session',
    ],
    monthlyIncludes: [
      'Everything included in Growth',
      'Advanced marketing automation',
      'Custom CRM workflows',
      'Multi-location management where required',
      'Advanced dashboards',
      'Location and team comparisons',
      'Higher communication allowances',
      'Priority technical support',
      'Monthly performance report',
      'Monthly marketing and sales consultation',
      'Campaign and promotional planning',
      'Customer-retention strategy',
      'Lead-conversion advice',
      'Rebooking and upselling strategy',
      'Quarterly business-growth roadmap',
    ],
    notes: [
      'Includes one scheduled 60-minute marketing and sales consultation each month.',
      'Printing costs, advertising budgets and additional third-party subscriptions are charged separately.',
    ],
  },
];

const includedWithEveryPackage = [
  'A professionally designed website',
  'A new logo',
  'Website copywriting',
  'Business card design',
  'Leaflet design',
  'Mobile-responsive layouts',
  'Online booking integration',
  'Google review integration',
  'Trustpilot review integration',
  'Website hosting',
  'Maintenance and security',
  'Ongoing software updates',
];

const additionalCosts = [
  'Business card or leaflet printing',
  'Professional photography or videography',
  'Paid stock imagery',
  'Advertising spend',
  'Social-media management',
  'Ongoing graphic-design requests',
  'Unlimited design revisions',
  'Additional email licences',
  'Premium Trustpilot subscriptions',
  'Third-party software subscriptions',
  'Bespoke functionality outside KS OS',
  'Complete redesigns requested after launch approval',
];

const standardScope = [
  'One initial logo direction with agreed refinements',
  'One website design direction',
  'Two structured revision rounds',
  'One business card design',
  'One leaflet design',
  'Reasonable website copy required for launch',
];

function setMetadata() {
  document.title = 'KS OS packages and pricing | Kasim Shah';
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.appendChild(meta);
  }
  meta.content = 'Choose an Essential, Growth or Scale KS OS package with a professional brand, website, booking, CRM, automation and ongoing support from Kasim Shah.';
}

function KasimShahLogo({ inverse = false }: { inverse?: boolean }) {
  return <img src={KASIM_SHAH_LOGO} alt="Kasim Shah" className={`h-5 w-auto sm:h-6 ${inverse ? 'brightness-0 invert' : ''}`} />;
}

function KsOsLogo({ inverse = false, className = '' }: { inverse?: boolean; className?: string }) {
  return <img src={KS_OS_LOGO} alt="KS OS" className={`h-8 w-auto ${inverse ? 'brightness-0 invert' : ''} ${className}`} />;
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
        <a href="/" aria-label="Kasim Shah home"><KasimShahLogo /></a>
        <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
          <a href="/" className="text-sm font-bold text-slate-600 hover:text-indigo-700">Home</a>
          <a href="/services" className="text-sm font-bold text-slate-600 hover:text-indigo-700">KS OS services</a>
          <a href="#compare" className="text-sm font-bold text-indigo-700">Packages</a>
        </nav>
        <a href={BOOKING_URL} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 sm:px-5">Book a consultation <ArrowRight className="hidden h-4 w-4 sm:block" /></a>
      </div>
    </header>
  );
}

function PackageCard({ item }: { item: PackageDefinition }) {
  const Icon = item.icon;
  return (
    <article className={`relative flex h-full flex-col rounded-2xl border bg-white p-7 shadow-sm ${item.popular ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}`}>
      {item.popular && <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">Most popular</span>}
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-5 w-5" /></span>
      <h2 className="mt-6 text-3xl font-black tracking-[-0.04em] text-slate-950">{item.name}</h2>
      <p className="mt-3 min-h-20 text-sm leading-7 text-slate-600">{item.audience}</p>
      <div className="mt-7 rounded-xl bg-slate-50 p-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Brand, website and launch</p>
        <p className="mt-2 text-4xl font-black tracking-[-0.05em] text-slate-950">{item.launchPrice}</p>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Then monthly</p>
        <p className="mt-2 text-4xl font-black tracking-[-0.05em] text-indigo-600">{item.monthlyPrice}<span className="text-base font-bold text-slate-500"> / month</span></p>
      </div>
      <p className="mt-6 text-sm font-semibold leading-7 text-slate-700">{item.summary}</p>
      <div className="mt-6 grid gap-3">{item.monthlyIncludes.slice(0, 5).map(feature => <span key={feature} className="flex items-start gap-3 text-sm font-bold text-slate-700"><CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />{feature}</span>)}</div>
      <a href={`#${item.id}`} className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 text-sm font-black text-indigo-700 transition hover:bg-indigo-100">View full package <ArrowRight className="h-4 w-4" /></a>
    </article>
  );
}

function FeatureList({ title, items, dark = false }: { title: string; items: string[]; dark?: boolean }) {
  return (
    <div className={`rounded-2xl border p-6 ${dark ? 'border-slate-800 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-950'}`}>
      <h3 className="text-xl font-black tracking-[-0.03em]">{title}</h3>
      <div className="mt-6 grid gap-3">{items.map(item => <div key={item} className={`flex items-start gap-3 text-sm font-semibold leading-6 ${dark ? 'text-slate-300' : 'text-slate-700'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${dark ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-50 text-indigo-700'}`}><Check className="h-3.5 w-3.5" /></span>{item}</div>)}</div>
    </div>
  );
}

function PackageDetail({ item }: { item: PackageDefinition }) {
  const Icon = item.icon;
  return (
    <section id={item.id} className="scroll-mt-28 border-t border-slate-200 bg-white px-5 py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <span className="grid h-14 w-14 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Icon className="h-6 w-6" /></span>
            <div className="mt-6 flex items-center gap-3"><h2 className="text-4xl font-black tracking-[-0.05em] text-slate-950">{item.name}</h2>{item.popular && <span className="rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">Most popular</span>}</div>
            <p className="mt-5 text-base leading-8 text-slate-600">{item.audience}</p>
            <div className="mt-7 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
              <p className="text-sm font-black text-slate-950">{item.launchPrice} to launch</p>
              <p className="mt-1 text-2xl font-black text-indigo-700">Then {item.monthlyPrice} per month</p>
            </div>
            <a href={BOOKING_URL} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white transition hover:bg-indigo-700">Discuss {item.name} <ArrowRight className="h-4 w-4" /></a>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <FeatureList title="Brand, website and launch package" items={item.launchIncludes} />
            <FeatureList title="Ongoing monthly package" items={item.monthlyIncludes} dark />
            <div className="xl:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold leading-7 text-amber-950"><div className="flex items-start gap-3"><Info className="mt-1 h-5 w-5 shrink-0" /><div>{item.notes.map(note => <p key={note} className="first:mt-0 mt-2">{note}</p>)}</div></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function App() {
  setMetadata();
  return (
    <div className="min-h-screen bg-white font-sans text-slate-950 antialiased selection:bg-indigo-200 selection:text-slate-950">
      <Header />
      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 py-20 sm:py-28 lg:px-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.14),transparent_28%),radial-gradient(circle_at_90%_30%,rgba(129,140,248,0.10),transparent_25%)]" />
          <div className="relative mx-auto max-w-7xl text-center">
            <div className="flex items-center justify-center gap-3"><KsOsLogo className="h-9" /><span className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700 shadow-sm">Packages</span></div>
            <p className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-indigo-700"><Sparkles className="h-4 w-4" /> Brand, website, platform and support</p>
            <h1 className="mx-auto mt-7 max-w-5xl text-5xl font-black leading-[0.98] tracking-[-0.06em] text-slate-950 sm:text-6xl lg:text-7xl">Choose the level of support your business needs now.</h1>
            <p className="mx-auto mt-7 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">Every package combines a professional launch with the KS OS platform and ongoing support. The existing KS OS services remain available throughout the offer; the packages simply define the starting scope and monthly service level.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm font-bold text-slate-600"><span className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />No per-page website charge</span><span className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />Copywriting included</span><span className="inline-flex items-center gap-2"><CircleCheckBig className="h-4 w-4 text-indigo-600" />12-month minimum commitment</span></div>
          </div>
        </section>

        <section id="compare" className="bg-white px-5 py-20 sm:py-28 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center"><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-700">KS OS packages</p><h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">A clear launch fee. A clear monthly plan.</h2><p className="mt-5 text-lg leading-8 text-slate-600">Start with the package that matches your current operation. The underlying KS OS capability catalogue remains intact and can evolve with your business.</p></div>
            <div className="mt-14 grid gap-7 lg:grid-cols-3">{packages.map(item => <PackageCard key={item.id} item={item} />)}</div>
            <p className="mx-auto mt-8 max-w-4xl text-center text-xs leading-6 text-slate-500">The Brand, Website and Launch Fee is payable before work begins. Each package carries a minimum 12-month subscription commitment. The launch fee becomes non-refundable once design or copywriting work has started.</p>
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950 px-5 py-20 text-white lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
            <div><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">Included with every package</p><h2 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-5xl">The professional foundations are never held back.</h2><p className="mt-5 text-lg leading-8 text-slate-300">Every customer gets the brand, website and operational essentials needed to launch properly. There is no charge based on the number of website pages; the reasonable pages required to represent the business are included.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">{includedWithEveryPackage.map(item => <div key={item} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm font-bold text-slate-200"><CircleCheckBig className="h-4 w-4 shrink-0 text-indigo-300" />{item}</div>)}</div>
          </div>
        </section>

        {packages.map(item => <PackageDetail key={item.id} item={item} />)}

        <section className="bg-slate-50 px-5 py-20 sm:py-28 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-700">Standard launch scope</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">A structured process keeps the subsidised launch price sustainable.</h2><div className="mt-7 grid gap-3">{standardScope.map(item => <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />{item}</div>)}</div><p className="mt-7 text-sm leading-7 text-slate-600">Additional concepts, extensive revisions or changes requested after approval can be quoted separately.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-700">Additional costs</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">Clear boundaries prevent surprise charges.</h2><div className="mt-7 grid gap-3 sm:grid-cols-2">{additionalCosts.map(item => <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-6 text-slate-700"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{item}</div>)}</div><p className="mt-7 text-sm leading-7 text-slate-600">Items can still be provided where suitable; they are simply quoted or billed separately unless specifically agreed in writing.</p></div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-7xl overflow-hidden rounded-2xl bg-indigo-600 p-8 text-white shadow-[0_28px_90px_rgba(79,70,229,0.24)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-12">
            <div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-200">Choose with confidence</p><h2 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-5xl">Not sure which package fits your operation?</h2><p className="mt-5 text-base font-semibold leading-7 text-indigo-100">Book a consultation through KS Agency. I will review your team, current systems and growth priorities, then recommend the right starting package without removing access to the wider KS OS service catalogue.</p></div>
            <a href={BOOKING_URL} className="mt-8 inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-black text-indigo-700 shadow-xl transition hover:-translate-y-0.5 lg:mt-0">Book a consultation <ArrowRight className="h-4 w-4" /></a>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-800 bg-slate-950 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div className="max-w-md"><KasimShahLogo inverse /><div className="mt-6 flex items-center gap-3"><KsOsLogo inverse className="h-6" /><span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-indigo-200">The offer</span></div><p className="mt-5 text-sm leading-7 text-slate-400">A done-for-you business operating system, professional website and ongoing growth support, while your business remains in control.</p></div>
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Explore</p><div className="mt-4 grid gap-3 text-sm"><a href="/" className="hover:text-white">Home</a><a href="/services" className="hover:text-white">KS OS services</a><a href="#compare" className="hover:text-white">Compare packages</a></div></div>
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-white">Access</p><div className="mt-4 grid gap-3 text-sm"><a href="/login" className="hover:text-white">Client sign in</a><a href="/customer/login" className="hover:text-white">Customer portal</a><a href={BOOKING_URL} className="hover:text-white">Book a consultation</a></div></div>
        </div>
        <div className="border-t border-slate-800 px-5 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} Kasim Shah. KS OS is a Kasim Shah product.</div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
