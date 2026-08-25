import { getDatabase, sql } from '@ks-os/database';
import type { SitesRuntimeConfig } from './config.js';
import {
  HostnameValidationError,
  normalizePublicPath,
  resolvePublicRequestHostname,
} from './hostname.js';

export const BARE_BEAUTY_HOSTNAME = 'barebeautykeighley.kasimshah.com';
export const BARE_BEAUTY_BOOKING_SLUG = 'barebeautykeighley';
const BARE_BEAUTY_TENANT_SUBDOMAIN = 'barebeautykeighley';
const BRAND_EMAIL = 'info@barebeautykeighley.co.uk';
const LOCATION_LABEL = 'Keighley, BD21';
const CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=120';

export type BareBeautyService = {
  id: string;
  publicReference: string;
  name: string;
  description: string;
  durationMinutes: number;
  pricePence: number;
  category: string;
  sortOrder: number;
};

export type BareBeautyOpeningHour = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type BareBeautyLiveData = {
  services: BareBeautyService[];
  openingHours: BareBeautyOpeningHour[];
  cancellationPolicy: string;
  consentAcknowledgement: string;
};

type ServiceDatabaseRow = {
  id: string;
  public_reference: string;
  name: string;
  description: string | null;
  duration: number;
  price: number;
  category: string | null;
  sort_order: number | null;
};

type HoursDatabaseRow = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type LegalDatabaseRow = {
  cancellation_policy: string | null;
  consent_acknowledgement: string | null;
};

type Editorial = {
  strapline: string;
  bestFor: string;
  includes: string[];
  preparation?: string[];
  aftercare?: string[];
  faqs?: Array<[string, string]>;
  patchTest?: boolean;
};

const SERVICE_ALIASES: Record<string, string> = {
  '219312bf-8504-4275-a7f8-80bb00d9a093': 'halal-brows-korean-lash-lift',
  '5951e791-37fb-4bbc-9f6a-4f096c227203': 'halal-brows-traditional-lash-lift',
  '48378d4b-d9e9-4429-a8ca-42e75635638b': 'halal-brows',
  '17536c62-1e62-4ba6-9ae9-f42248aaa213': 'hybrid-brows',
  '5ab64467-eab3-4eed-9a3d-73e5de009335': 'brow-lamination',
  '8561fff0-1ced-440b-aaf6-f6968030d7b6': 'brow-lightening',
  '4b25d7d5-a6a6-4d78-978a-f7cef5cf508d': 'bleach-only-brows',
  '02b3188d-513f-40a0-85a1-e5b48b74fdb2': 'korean-lash-lift',
  '76e524e6-6830-4d05-aa27-57dfbb277ee8': 'traditional-lash-lift',
  'ea84d5eb-8d6a-4c94-a0da-06a44f0c7cc2': 'halal-brow-maintenance',
  'db31ce85-3767-4db8-b8cb-f2e6d2b38cc5': 'lash-lift-maintenance',
  'dc3e3f98-c023-4c48-b5f4-ced80eb06f5b': 'chin-wax',
  '0ed9bd53-9fe5-492e-bd99-1fc076d33c7f': 'upper-lip-wax',
  '72556c50-e439-45a3-96fa-8875fc6eeb5e': 'full-face-wax',
  '9dc9c655-d002-48e1-973e-4516099ed0fd': 'full-face-wax-with-neck',
  '9af6e6dd-7132-476b-8165-e951f6f10b49': 'patch-test',
  '5a2020d3-a10c-44c7-83d8-aece54f3e37a': 'mobile-out-of-hours',
};

const EDITORIAL: Record<string, Editorial> = {
  '48378d4b-d9e9-4429-a8ca-42e75635638b': {
    strapline: 'Beautifully defined brows, created with your values in mind.',
    bestFor: 'Clients who want fuller, more structured brows without removing a single eyebrow hair. This faith-conscious option can also suit anyone who prefers to avoid waxing, threading or plucking.',
    includes: ['Personal brow consultation and mapping', 'Cleansing and preparation', 'Brow lamination to style and set the hairs', 'Lightening of stray hairs to soften their appearance', 'Wudhu-friendly tint for definition', 'Final styling and personalised aftercare'],
    preparation: ['Arrive with clean brows.', 'Avoid oils or heavy skincare around the brow area before your appointment.', 'Where possible, allow 2–3 weeks of brow growth before treatment.', 'Avoid retinol, strong active ingredients and vitamin C around the brow area before treatment.'],
    aftercare: ['Follow the personalised aftercare given at your appointment.', 'Results vary with hair growth, skin type, lifestyle and aftercare.', 'Lamination and tint results commonly last around 6–8 weeks.'],
    faqs: [
      ['Do you remove eyebrow hair?', 'No. The Halal Brows treatment does not involve plucking, threading, waxing or eyebrow-hair removal.'],
      ['What makes this different from a traditional brow treatment?', 'The focus is on enhancing your existing hairs with lamination, lightening and tint rather than creating shape through hair removal.'],
      ['Are the products wudhu-friendly?', 'Products are selected for clients seeking a wudhu-friendly option. You should still make your own decision based on your personal beliefs and requirements.'],
      ['Can this work on sparse brows?', 'Yes. Styling the hairs you already have and adding definition can create a fuller-looking finish.'],
    ],
    patchTest: true,
  },
  '17536c62-1e62-4ba6-9ae9-f42248aaa213': {
    strapline: 'Defined, fuller-looking brows with a soft stain finish.',
    bestFor: 'Clients who want more definition and a longer-lasting, makeup-like brow effect while keeping the overall result refined and natural.',
    includes: ['Brow consultation and assessment', 'Cleansing and preparation', 'Brow mapping', 'Hybrid tint or stain application', 'Precision styling', 'Finishing and aftercare advice'],
    preparation: ['Arrive with clean brows.', 'Avoid oils or heavy skincare around the brow area before treatment.'],
    aftercare: ['Avoid excessive rubbing and exfoliation around the brows.', 'Skin stain naturally fades before the colour on the brow hairs.', 'Follow your personalised aftercare to help the result last.'],
    faqs: [
      ['What are Hybrid Brows?', 'A specialised tint or stain colours the brow hairs and lightly stains the skin to create a fuller, more defined appearance.'],
      ['Will my brows look too dark?', 'Your shade is selected to complement your colouring and preferred finish, from softer and natural to more defined.'],
      ['Are Hybrid Brows suitable for sparse brows?', 'They can be a useful option where brows are lighter or have visible gaps because the skin stain adds the appearance of fullness.'],
    ],
    patchTest: true,
  },
  '5ab64467-eab3-4eed-9a3d-73e5de009335': {
    strapline: 'Fuller, fluffier brows with a beautifully styled finish.',
    bestFor: 'Unruly, downward-growing, sparse-looking or naturally full brows that would benefit from a lifted, groomed shape with less daily styling.',
    includes: ['Brow consultation and assessment', 'Cleansing and preparation', 'Brow lifting and styling treatment', 'Nourishing treatment to support the brow hairs', 'Tint where suitable and selected', 'Final styling and aftercare'],
    preparation: ['Arrive with clean brows.', 'Avoid oils and heavy skincare around the brow area before your appointment.'],
    aftercare: ['Keep brows dry for the first 24 hours unless advised otherwise.', 'Follow the aftercare provided to support the condition of your brow hairs.', 'Results commonly last around 6–8 weeks, depending on growth and aftercare.'],
    faqs: [
      ['Will lamination make my brows thicker?', 'It does not add hair, but redirecting your existing hairs can make the brows look fuller and more uniform.'],
      ['Can I choose how fluffy they look?', 'Yes. Your brows can be styled from softly groomed to a more lifted, fluffy finish.'],
    ],
    patchTest: true,
  },
  '8561fff0-1ced-440b-aaf6-f6968030d7b6': {
    strapline: 'A softer brow appearance through professional lightening.',
    bestFor: 'Clients who want to reduce the intensity of darker brow hairs or create a softer finish while keeping their natural brow shape.',
    includes: ['Consultation and brow assessment', 'Brow cleansing and preparation', 'Controlled professional lightening', 'Conditioning and finishing', 'Aftercare advice'],
    preparation: ['Arrive with clean brows.', 'Avoid oils or heavy skincare around the brow area before treatment.'],
    patchTest: true,
  },
  '4b25d7d5-a6a6-4d78-978a-f7cef5cf508d': {
    strapline: 'Soft, natural-looking brows with a lighter finish.',
    bestFor: 'Clients wanting to soften darker brow hairs, reduce brow intensity or disguise stray hairs without removing them.',
    includes: ['Brow consultation and assessment', 'Cleansing and preparation', 'Professional brow bleaching', 'Conditioning and finishing', 'Aftercare advice'],
    preparation: ['Arrive with clean brows.', 'Avoid oils or heavy skincare around the brow area before treatment.'],
    faqs: [
      ['Does bleaching remove eyebrow hair?', 'No. The treatment changes the visible colour of existing hairs; it does not remove them.'],
      ['How long does the result last?', 'The effect gradually grows out as new hairs come through in your natural colour.'],
    ],
    patchTest: true,
  },
  '02b3188d-513f-40a0-85a1-e5b48b74fdb2': {
    strapline: 'Soft, natural-looking lashes with a beautiful lift.',
    bestFor: 'Straight, downward-growing or hard-to-see lashes that would benefit from a gentle root-to-tip lift and a naturally polished finish without extensions.',
    includes: ['Lash consultation and assessment', 'Gentle lash preparation', 'Lifting and shaping', 'Nourishing treatment to support lash condition', 'Lash tint for definition', 'Final styling and aftercare'],
    preparation: ['Arrive with clean lashes.', 'Do not wear mascara or oily eye products to the appointment.'],
    aftercare: ['Avoid rubbing the eyes and use gentle products around the eye area.', 'Wait at least 24 hours before applying mascara unless advised otherwise.', 'Results commonly last around 6–8 weeks depending on your natural lash cycle.'],
    faqs: [
      ['What makes a Korean Lash Lift different?', 'The approach focuses on a softer curl, gentler and more hydrating treatment choices, and the condition of your natural lashes.'],
      ['Does it work on short or straight lashes?', 'It can be a good option for straight, downward-growing or hard-to-see natural lashes.'],
    ],
    patchTest: true,
  },
  '76e524e6-6830-4d05-aa27-57dfbb277ee8': {
    strapline: 'Effortlessly lifted lashes without extensions.',
    bestFor: 'Clients who want a classic, mascara-like lift that opens the eye while keeping their routine simple and natural.',
    includes: ['Lash consultation and assessment', 'Cleansing and preparation', 'Lash lifting and shaping', 'Lash tint for definition', 'Final styling and aftercare'],
    preparation: ['Arrive with clean lashes.', 'Avoid mascara and oily products around the eye area before treatment.'],
    aftercare: ['Keep lashes dry for the first 24 hours unless advised otherwise.', 'Be gentle around the eye area.', 'Results commonly last around 6–8 weeks depending on your natural lash cycle.'],
    faqs: [
      ['What is a lash lift?', 'A lash lift curls and lifts your own natural lashes from the root to create a more open, defined eye appearance.'],
      ['Can I wear mascara afterwards?', 'Yes. It is generally recommended to wait at least 24 hours after treatment.'],
    ],
    patchTest: true,
  },
  'ea84d5eb-8d6a-4c94-a0da-06a44f0c7cc2': {
    strapline: 'Keep your halal brow result looking fresh between full treatments.',
    bestFor: 'Returning clients whose previous treatment is still present and needs a considered refresh rather than a complete restart.',
    includes: ['Brow assessment', 'Tint or bleach refresh where suitable', 'Gentle refresh and restyling', 'Conditioning treatment', 'Aftercare advice'],
    faqs: [['Do I need maintenance or a full treatment?', 'Maintenance is intended for returning clients whose previous result is still present. If it has fully grown out, a full treatment may be recommended.']],
  },
  'db31ce85-3767-4db8-b8cb-f2e6d2b38cc5': {
    strapline: 'Maintain the definition and condition of your lifted lashes.',
    bestFor: 'Returning lash-lift clients who want a tint and conditioning refresh while supporting healthy-looking natural lashes.',
    includes: ['Lash assessment', 'Tint refresh where suitable', 'Nourishing mask or conditioning treatment', 'Final styling', 'Aftercare advice'],
    faqs: [['Do I need another patch test?', 'Maintenance is commonly booked a few weeks after the original treatment. A new patch test may be advised if products, health information or circumstances have changed.']],
  },
  '219312bf-8504-4275-a7f8-80bb00d9a093': {
    strapline: 'Our signature eye-enhancing pairing for soft, polished brows and lashes.',
    bestFor: 'Clients who want the faith-conscious definition of Halal Brows together with the softer, nourishing finish of a Korean Lash Lift in one appointment.',
    includes: ['Halal Brows consultation, mapping, lamination, lightening and tint', 'Korean lash consultation, lift, tint and nourishing treatment', 'Finishing touches for a balanced result', 'Personalised brow and lash aftercare'],
    preparation: ['Arrive with clean brows and lashes.', 'Avoid oils, heavy skincare around the brows and oily eye products.', 'Do not wear mascara to the appointment.'],
    patchTest: true,
  },
  '5951e791-37fb-4bbc-9f6a-4f096c227203': {
    strapline: 'Defined halal brows paired with a classic, eye-opening lash lift.',
    bestFor: 'Clients who want a complete natural eye refresh with structured brows and a classic lifted-lash finish without extensions.',
    includes: ['Halal Brows consultation, mapping, lamination, lightening and tint', 'Traditional lash lift and tint', 'Final styling for a balanced finish', 'Personalised aftercare advice'],
    preparation: ['Arrive with clean brows and lashes.', 'Avoid oils and heavy skincare around the brow and eye area.', 'Do not wear mascara to the appointment.'],
    patchTest: true,
  },
  '9af6e6dd-7132-476b-8165-e951f6f10b49': {
    strapline: 'A quick, complimentary check before an applicable treatment.',
    bestFor: 'Clients booking a treatment that requires product suitability testing before the main appointment.',
    includes: ['Brief consultation', 'Application of the relevant test products', 'Guidance on the required waiting timeframe before treatment'],
    faqs: [['Why do I need a patch test?', 'Patch testing helps identify a possible reaction to treatment products before the full service. It must be completed within the recommended timeframe for the treatment you book.']],
  },
};

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}

export async function loadBareBeautyLiveData(): Promise<BareBeautyLiveData> {
  const database = getDatabase();
  const servicesResult = await database.execute(sql<ServiceDatabaseRow>`
    select
      service.id,
      service.public_reference,
      service.name,
      service.description,
      service.duration,
      service.price,
      service.category,
      service.sort_order
    from services service
    join tenants tenant on tenant.id = service.tenant_id
    join booking_pages page on page.tenant_id = tenant.id
    where tenant.subdomain = ${BARE_BEAUTY_TENANT_SUBDOMAIN}
      and tenant.is_active = true
      and tenant.lifecycle_status = 'ACTIVE'
      and page.public_slug = ${BARE_BEAUTY_BOOKING_SLUG}
      and page.enabled = true
      and page.published = true
      and service.is_active = true
      and lower(trim(service.name)) <> 'test'
      and (
        coalesce(cardinality(page.allowed_service_ids), 0) = 0
        or service.id = any(page.allowed_service_ids)
      )
    order by coalesce(service.sort_order, 9999), service.name
  `);
  const hoursResult = await database.execute(sql<HoursDatabaseRow>`
    select distinct
      schedule.day_of_week,
      schedule.start_time::text,
      schedule.end_time::text
    from booking_channel_schedules schedule
    join tenants tenant on tenant.id = schedule.tenant_id
    join booking_pages page on page.tenant_id = tenant.id
    where tenant.subdomain = ${BARE_BEAUTY_TENANT_SUBDOMAIN}
      and tenant.is_active = true
      and page.public_slug = ${BARE_BEAUTY_BOOKING_SLUG}
      and page.enabled = true
      and page.published = true
      and schedule.booking_channel = 'in_shop'
    order by schedule.day_of_week, schedule.start_time
  `);
  const legalResult = await database.execute(sql<LegalDatabaseRow>`
    select
      page.cancellation_settings ->> 'policyText' as cancellation_policy,
      version.acknowledgement_text as consent_acknowledgement
    from tenants tenant
    join booking_pages page on page.tenant_id = tenant.id
    left join forms form on form.tenant_id = tenant.id
      and form.status = 'PUBLISHED'
      and lower(form.title) = 'consent form'
    left join form_versions version on version.id = form.published_version_id
    where tenant.subdomain = ${BARE_BEAUTY_TENANT_SUBDOMAIN}
      and page.public_slug = ${BARE_BEAUTY_BOOKING_SLUG}
    order by form.created_at asc nulls last
    limit 1
  `);

  const services = rowsFromResult<ServiceDatabaseRow>(servicesResult).map(row => ({
    id: row.id,
    publicReference: row.public_reference,
    name: row.name,
    description: row.description?.trim() || 'A personalised Bare Beauty treatment tailored to your natural features and preferred finish.',
    durationMinutes: Math.max(0, row.duration || 0),
    pricePence: Math.max(0, row.price || 0),
    category: row.category?.trim() || 'Treatments',
    sortOrder: row.sort_order ?? 9999,
  }));
  const openingHours = rowsFromResult<HoursDatabaseRow>(hoursResult).map(row => ({
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
  const legal = rowsFromResult<LegalDatabaseRow>(legalResult)[0];
  return {
    services,
    openingHours,
    cancellationPolicy: legal?.cancellation_policy?.trim() || 'Booking terms are shown and agreed at the point of booking.',
    consentAcknowledgement: legal?.consent_acknowledgement?.trim() || 'Your appointment-specific consent form will be sent securely after booking.',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] || character));
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'treatment';
}

export function serviceSlug(service: BareBeautyService): string {
  return SERVICE_ALIASES[service.publicReference] || slugify(service.name);
}

function bookingUrl(config: SitesRuntimeConfig): string {
  const origin = config.publicBookingOrigin || 'https://app.kasimshah.com';
  return new URL(`/book/${BARE_BEAUTY_BOOKING_SLUG}`, origin).toString();
}

function formatPrice(pricePence: number): string {
  if (pricePence === 0) return 'Free';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: pricePence % 100 === 0 ? 0 : 2,
  }).format(pricePence / 100);
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return 'Ask when booking';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const normalized = hour % 12 || 12;
  return `${normalized}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${suffix}`;
}

function groupHours(hours: BareBeautyOpeningHour[]): Map<number, BareBeautyOpeningHour[]> {
  const grouped = new Map<number, BareBeautyOpeningHour[]>();
  for (const item of hours) {
    const current = grouped.get(item.dayOfWeek) || [];
    current.push(item);
    grouped.set(item.dayOfWeek, current);
  }
  return grouped;
}

function openingHoursTable(hours: BareBeautyOpeningHour[]): string {
  const grouped = groupHours(hours);
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];
  return `<div class="hours-grid">${orderedDays.map(day => {
    const intervals = grouped.get(day) || [];
    const value = intervals.length
      ? intervals.map(item => `${clock(item.startTime)} – ${clock(item.endTime)}`).join(', ')
      : 'Closed';
    return `<div class="hours-row"><span>${DAY_NAMES[day]}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join('')}</div>`;
}

function openDaysLabel(hours: BareBeautyOpeningHour[]): string {
  const days = [...new Set(hours.map(item => item.dayOfWeek))];
  return days.length ? days.map(day => DAY_SHORT[day]).join(' · ') : 'By appointment';
}

function richPlainText(value: string): string {
  return `<div class="policy-copy">${escapeHtml(value)}</div>`;
}

function monogram(): string {
  return `<span class="monogram" aria-hidden="true"><span>B</span><span>B</span></span>`;
}

function serviceMark(service: BareBeautyService): string {
  const category = service.category.toLowerCase();
  if (category.includes('lash')) return 'L';
  if (category.includes('package')) return 'BB';
  if (category.includes('maintenance')) return 'M';
  if (category.includes('add')) return '✦';
  if (service.name.toLowerCase().includes('patch')) return 'P';
  return 'B';
}

function baseStyles(): string {
  return `
    :root{--ink:#241b17;--espresso:#18120f;--chocolate:#34261f;--cream:#f5eee6;--ivory:#fffdf9;--sand:#d8b99f;--rose:#c69d84;--taupe:#7b695e;--line:#e7d9cc;--muted:#695c54;--shadow:0 24px 70px rgba(53,38,31,.12)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ivory);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}a{color:inherit}img{max-width:100%}::selection{background:#dcc1ad;color:#201713}
    .shell{width:min(1180px,calc(100% - 40px));margin:auto}.serif,h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}.eyebrow{margin:0 0 14px;text-transform:uppercase;letter-spacing:.24em;font-size:.72rem;font-weight:750;color:#9c745d}.eyebrow.light{color:#d9b89f}.muted{color:var(--muted)}
    .site-header{position:sticky;top:0;z-index:20;background:rgba(255,253,249,.94);backdrop-filter:blur(14px);border-bottom:1px solid rgba(231,217,204,.9)}.header-inner{min-height:86px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:15px;text-decoration:none}.brand-words{line-height:1}.brand-name{display:block;font-family:Georgia,serif;font-size:1.08rem;letter-spacing:.15em}.brand-place{display:block;margin-top:7px;font-size:.58rem;letter-spacing:.33em;color:#9a7966;text-transform:uppercase}.monogram{position:relative;display:inline-block;width:45px;height:54px;color:#b98970;font-family:Georgia,serif}.monogram span{position:absolute;font-size:3.2rem;line-height:1}.monogram span:first-child{left:0;top:0}.monogram span:last-child{left:13px;top:5px;opacity:.76}.nav{display:flex;align-items:center;gap:24px}.nav a{text-decoration:none;font-size:.82rem;font-weight:650;letter-spacing:.035em;color:#51453e}.nav a:hover{text-decoration:underline;text-underline-offset:8px;text-decoration-color:#c7a48e}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:0 20px;background:#d9bca5;color:#241b17;border:1px solid #d1ad91;text-decoration:none;text-transform:uppercase;letter-spacing:.12em;font-size:.71rem;font-weight:800;box-shadow:0 10px 25px rgba(90,60,43,.12);transition:transform .2s,box-shadow .2s,background .2s}.btn:hover{transform:translateY(-2px);box-shadow:0 15px 34px rgba(90,60,43,.18);background:#e2c8b4}.btn.dark{background:#2f231d;border-color:#2f231d;color:#fff9f3}.btn.ghost{background:transparent;border-color:#cab4a4;color:#fff}.btn.small{min-height:42px;padding:0 15px;font-size:.64rem}.mobile-nav{display:none}
    .hero{overflow:hidden;background:linear-gradient(105deg,#fffaf4 0%,#f7ede3 54%,#e7d2c2 100%)}.hero-grid{min-height:690px;display:grid;grid-template-columns:1.02fr .98fr;align-items:stretch}.hero-copy{padding:110px 6vw 90px max(20px,calc((100vw - 1180px)/2));display:flex;flex-direction:column;justify-content:center}.hero h1{font-size:clamp(3.5rem,7.2vw,7rem);line-height:.87;margin:0;max-width:760px;text-transform:uppercase}.hero h1 span{display:block;color:#aa8068;font-size:.64em;margin-top:.12em}.hero-lead{max-width:580px;font-size:1.08rem;color:#5d4f47;margin:28px 0 0}.hero-actions{display:flex;gap:13px;flex-wrap:wrap;margin-top:32px}.trust-line{display:flex;gap:20px;flex-wrap:wrap;margin-top:33px;font-size:.78rem;color:#725f54}.trust-line span:before{content:"◇";color:#ad8269;margin-right:8px}.studio-art{position:relative;min-height:620px;background:linear-gradient(150deg,#725547 0%,#34261f 55%,#1e1713 100%);overflow:hidden}.studio-glow{position:absolute;width:55%;height:75%;right:8%;top:7%;border-radius:200px 200px 0 0;background:radial-gradient(circle at 50% 25%,#f0d2b5 0 3%,transparent 4%),linear-gradient(180deg,rgba(255,225,197,.24),rgba(24,18,15,.08));border:1px solid rgba(244,220,197,.25)}.shelf{position:absolute;right:13%;width:38%;height:1px;background:rgba(255,236,218,.28)}.shelf:before,.shelf:after{content:"";position:absolute;bottom:1px;width:22px;border-radius:10px 10px 2px 2px;background:rgba(238,214,191,.66)}.shelf:before{height:46px;left:18%}.shelf:after{height:61px;right:22%}.shelf.one{top:30%}.shelf.two{top:45%}.shelf.three{top:60%}.counter{position:absolute;left:8%;right:0;bottom:0;height:31%;background:linear-gradient(180deg,#d7c3b1,#9d7d68);border-top-left-radius:45px;box-shadow:0 -20px 60px rgba(0,0,0,.18)}.counter:after{content:"";position:absolute;inset:24px 0 0 0;background:repeating-linear-gradient(90deg,rgba(62,44,35,.2) 0 3px,transparent 3px 18px)}.studio-logo{position:absolute;left:13%;top:18%;color:#ead9c8;text-align:center}.studio-logo .big{display:block;font-family:Georgia,serif;font-size:2.6rem;letter-spacing:.08em}.studio-logo .small{display:block;font-size:.63rem;text-transform:uppercase;letter-spacing:.28em;margin-top:4px;color:#cbb19f}.pendant{position:absolute;top:-20px;width:1px;height:170px;background:rgba(255,231,207,.3)}.pendant:after{content:"";position:absolute;left:-24px;bottom:-42px;width:48px;height:48px;border:1px solid rgba(255,226,199,.52);border-radius:50%;background:radial-gradient(circle,#ffd19b 0 4%,rgba(255,208,154,.2) 13%,rgba(255,255,255,.04) 64%)}.pendant.a{left:53%}.pendant.b{left:67%;height:125px}
    .section{padding:94px 0}.section.soft{background:#faf5ef}.section.dark{background:#30241e;color:#fff8f1}.section-head{max-width:710px;margin-bottom:43px}.section-head.center{text-align:center;margin-left:auto;margin-right:auto}.section h2{font-size:clamp(2.4rem,4.5vw,4.2rem);line-height:1.03;margin:0}.section-copy{font-size:1.02rem;color:#695a52;max-width:720px}.dark .section-copy{color:#d8c9bf}.line-title{display:flex;align-items:center;gap:18px;justify-content:center;margin-bottom:44px;text-transform:uppercase;letter-spacing:.2em;font-size:.7rem;font-weight:760}.line-title:before,.line-title:after{content:"";height:1px;background:#d8c7b8;flex:1;max-width:180px}
    .service-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}.service-card{display:flex;flex-direction:column;min-height:330px;background:#fff;border:1px solid #eadfd5;text-decoration:none;box-shadow:0 12px 30px rgba(61,42,32,.06);transition:transform .25s,box-shadow .25s,border-color .25s}.service-card:hover{transform:translateY(-5px);box-shadow:var(--shadow);border-color:#cfaf99}.service-visual{height:145px;position:relative;display:grid;place-items:center;overflow:hidden;background:linear-gradient(135deg,#edd8c8,#b98b72)}.service-visual:before{content:"";position:absolute;width:130px;height:130px;border:1px solid rgba(255,255,255,.42);border-radius:50%;transform:translate(-42px,35px)}.service-visual:after{content:"";position:absolute;width:95px;height:150px;border:1px solid rgba(54,35,27,.12);border-radius:90px 90px 0 0;right:20px;bottom:-60px}.service-mark{font-family:Georgia,serif;color:#fff8f2;font-size:3rem;letter-spacing:-.08em;position:relative;z-index:1}.service-body{padding:22px 22px 24px;display:flex;flex-direction:column;flex:1}.service-category{text-transform:uppercase;letter-spacing:.18em;font-size:.6rem;font-weight:800;color:#a27d68}.service-card h3{font-size:1.35rem;margin:7px 0 8px}.service-card p{font-size:.85rem;color:#75645a;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.service-meta{margin-top:auto;padding-top:19px;display:flex;justify-content:space-between;gap:10px;font-size:.74rem;font-weight:750;color:#51443d}.service-meta .price{color:#9a6d55}.service-arrow{margin-left:auto;font-size:1.1rem;color:#ad8068}.category-block+.category-block{margin-top:56px}.category-title{display:flex;align-items:end;justify-content:space-between;gap:20px;border-bottom:1px solid #e5d6ca;padding-bottom:14px;margin-bottom:24px}.category-title h2{font-size:2.25rem}.category-title span{font-size:.74rem;color:#8c776b;text-transform:uppercase;letter-spacing:.14em}
    .values{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#695349}.value{padding:38px 30px;background:#34261f}.value-icon{font-family:Georgia,serif;color:#d6b399;font-size:1.8rem}.value h3{font-family:inherit;font-size:.9rem;text-transform:uppercase;letter-spacing:.12em;margin:16px 0 9px}.value p{margin:0;color:#d8c8bd;font-size:.86rem}.split{display:grid;grid-template-columns:1fr 1fr;min-height:480px}.story{padding:72px max(36px,8vw);background:#e5cbb8}.story h2{font-size:3.2rem;margin:0 0 22px}.story p{color:#5c493f}.mirror-art{position:relative;background:linear-gradient(145deg,#f7efe7,#a8836d);min-height:460px;overflow:hidden}.mirror-art:before{content:"";position:absolute;width:52%;height:70%;border:4px solid rgba(110,76,58,.35);border-radius:50% 50% 8px 8px;left:24%;top:11%;box-shadow:inset 0 0 0 12px rgba(255,255,255,.18),0 20px 50px rgba(67,43,32,.16)}.mirror-art:after{content:"Bare Beauty";position:absolute;bottom:12%;left:0;right:0;text-align:center;font-family:Georgia,serif;font-size:2rem;color:rgba(67,43,32,.48);letter-spacing:.1em}
    .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}.step{border-top:1px solid #d6c4b6;padding-top:24px}.step-no{font-family:Georgia,serif;color:#b38a71;font-size:2rem}.step h3{font-size:1.25rem;margin:12px 0 8px}.step p{color:#6d5e55;font-size:.88rem}.notice{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:24px;padding:28px 32px;border:1px solid #d9c3b2;background:#fffaf5}.notice-icon{font-family:Georgia,serif;font-size:2.4rem;color:#b2856b}.notice h3{font-size:1.4rem;margin:0 0 4px}.notice p{margin:0;color:#6b5a50;font-size:.9rem}
    .hours-layout{display:grid;grid-template-columns:.8fr 1.2fr;gap:70px;align-items:start}.hours-grid{border-top:1px solid #d9c9bd}.hours-row{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e6dacf;padding:14px 0;font-size:.88rem}.hours-row strong{font-weight:700}.dark .hours-row{border-color:rgba(255,255,255,.12)}.dark .hours-grid{border-color:rgba(255,255,255,.18)}.dark .hours-row span{color:#cfbeb3}.location-card{border:1px solid rgba(255,255,255,.15);padding:30px;background:rgba(255,255,255,.04)}.location-card h3{font-size:1.8rem;margin:0 0 10px}.location-card p{color:#d8c9bf}.badge{display:inline-flex;padding:8px 12px;border:1px solid #dbc3b1;background:#fff8f1;text-transform:uppercase;letter-spacing:.13em;font-size:.6rem;font-weight:800;color:#765a4a}
    .page-hero{background:linear-gradient(120deg,#fdf8f2,#ead4c3);padding:100px 0 78px;border-bottom:1px solid #dfccbc}.page-hero h1{font-size:clamp(3.2rem,7vw,6.2rem);line-height:.95;margin:0;max-width:900px}.page-hero .lead{max-width:760px;font-size:1.05rem;color:#65544b;margin-top:22px}.breadcrumbs{font-size:.7rem;text-transform:uppercase;letter-spacing:.13em;color:#917461;margin-bottom:28px}.breadcrumbs a{text-decoration:none}.breadcrumbs a:hover{text-decoration:underline}.detail-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:70px}.detail-grid h2{font-size:2.4rem}.detail-grid h3{font-size:1.45rem;margin-top:32px}.detail-sidebar{position:sticky;top:116px;align-self:start;background:#30241e;color:#fff6ef;padding:32px;box-shadow:var(--shadow)}.detail-sidebar .meta-block{padding:16px 0;border-bottom:1px solid rgba(255,255,255,.13);display:flex;justify-content:space-between;gap:18px}.detail-sidebar .meta-block span{color:#cdbbb0;font-size:.77rem}.detail-sidebar .meta-block strong{font-size:.86rem;text-align:right}.detail-sidebar .btn{width:100%;margin-top:24px}.check-list{list-style:none;padding:0;margin:22px 0}.check-list li{position:relative;padding-left:27px;margin:11px 0;color:#5f5048}.check-list li:before{content:"◇";position:absolute;left:0;color:#ad7e64}.faq{border-top:1px solid #e3d5c9}.faq-item{padding:22px 0;border-bottom:1px solid #e3d5c9}.faq-item h3{font-family:inherit;font-weight:760;font-size:.98rem;margin:0 0 7px}.faq-item p{margin:0;color:#695b52}.live-note{font-size:.74rem;color:#806c61;margin-top:14px}.legal-wrap{max-width:850px}.legal-card{background:#fff;border:1px solid #e5d6ca;padding:32px;margin:26px 0}.legal-card h2{font-size:2rem;margin-top:0}.policy-copy{white-space:pre-line;color:#594a42;line-height:1.8}.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:50px}.contact-card{padding:34px;border:1px solid #e3d3c6;background:#fff}.contact-card h2{font-size:2rem;margin-top:0}.contact-list{display:grid;gap:15px}.contact-list a{text-underline-offset:4px}
    .cta-band{background:#261c17;color:#fff8f2;padding:55px 0}.cta-band-inner{display:flex;align-items:center;justify-content:space-between;gap:30px}.cta-band h2{font-size:2.5rem;margin:0}.cta-band p{margin:8px 0 0;color:#d5c5ba}.footer{background:#1c1512;color:#d7c7bc;padding:64px 0 22px}.footer-grid{display:grid;grid-template-columns:1.45fr 1fr 1fr 1fr;gap:50px}.footer h3{font-family:inherit;font-size:.68rem;text-transform:uppercase;letter-spacing:.18em;color:#fff;margin:0 0 18px}.footer a{display:block;text-decoration:none;font-size:.84rem;margin:10px 0;color:#d7c7bc}.footer a:hover{color:#fff}.footer-brand{max-width:340px}.footer-brand p{font-size:.86rem;color:#bdaaa0}.footer-bottom{border-top:1px solid rgba(255,255,255,.1);margin-top:45px;padding-top:18px;display:flex;justify-content:space-between;gap:20px;font-size:.7rem;color:#927f75}
    @media(max-width:980px){.nav>a:not(.btn){display:none}.hero-grid{grid-template-columns:1fr}.hero-copy{padding:90px max(28px,7vw)}.studio-art{min-height:480px}.service-grid{grid-template-columns:repeat(2,1fr)}.values{grid-template-columns:repeat(2,1fr)}.steps{grid-template-columns:repeat(2,1fr)}.hours-layout,.detail-grid,.contact-grid{grid-template-columns:1fr}.detail-sidebar{position:static}.footer-grid{grid-template-columns:1.3fr 1fr 1fr}.footer-grid>div:last-child{grid-column:2/4}.split{grid-template-columns:1fr}.story{padding:60px max(28px,7vw)}}
    @media(max-width:650px){.shell{width:min(100% - 28px,1180px)}.header-inner{min-height:74px}.brand-name{font-size:.9rem}.brand-place{font-size:.5rem}.monogram{transform:scale(.82);transform-origin:left center;width:38px}.nav .btn{display:none}.mobile-nav{display:inline-flex;text-decoration:none;text-transform:uppercase;letter-spacing:.13em;font-size:.62rem;font-weight:800}.hero-grid{min-height:auto}.hero-copy{padding:75px 24px 65px}.hero h1{font-size:3.5rem}.studio-art{min-height:390px}.section{padding:70px 0}.service-grid{grid-template-columns:1fr}.values,.steps{grid-template-columns:1fr}.notice{grid-template-columns:1fr;text-align:left}.page-hero{padding:75px 0 58px}.page-hero h1{font-size:3.15rem}.cta-band-inner{align-items:flex-start;flex-direction:column}.footer-grid{grid-template-columns:1fr 1fr;gap:35px}.footer-brand{grid-column:1/-1}.footer-grid>div:last-child{grid-column:auto}.footer-bottom{flex-direction:column}.category-title{align-items:flex-start;flex-direction:column}.hours-row{font-size:.8rem}.story h2{font-size:2.5rem}}
  `;
}

function pageHeader(booking: string): string {
  return `<header class="site-header"><div class="shell header-inner"><a class="brand" href="/" aria-label="Bare Beauty Keighley home">${monogram()}<span class="brand-words"><span class="brand-name">BARE BEAUTY</span><span class="brand-place">Keighley</span></span></a><nav class="nav" aria-label="Main navigation"><a href="/">Home</a><a href="/about">About</a><a href="/services">Treatments</a><a href="/packages">Packages</a><a href="/contact">Contact</a><a class="btn small" href="${escapeHtml(booking)}">Book appointment <span aria-hidden="true">→</span></a></nav><a class="mobile-nav" href="/services">Treatments</a></div></header>`;
}

function pageFooter(booking: string, data: BareBeautyLiveData): string {
  const primary = data.services.slice(0, 5);
  return `<section class="cta-band"><div class="shell cta-band-inner"><div><p class="eyebrow light">Your time, your features, your finish</p><h2>Ready to feel effortlessly put together?</h2><p>Choose your treatment and a time that works for you.</p></div><a class="btn" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><footer class="footer"><div class="shell"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="/">${monogram()}<span class="brand-words"><span class="brand-name" style="color:#fff">BARE BEAUTY</span><span class="brand-place">Keighley</span></span></a><p>Faith-conscious brow and lash treatments, natural-looking results and personalised care in a calm private women-only studio in Keighley.</p><p>${escapeHtml(BRAND_EMAIL)}<br>${escapeHtml(LOCATION_LABEL)}</p></div><div><h3>Explore</h3><a href="/about">Our story</a><a href="/services">All treatments</a><a href="/packages">Packages</a><a href="/contact">Contact & hours</a></div><div><h3>Popular treatments</h3>${primary.map(service => `<a href="/services/${serviceSlug(service)}">${escapeHtml(service.name)}</a>`).join('')}</div><div><h3>Important</h3><a href="/terms-and-conditions">Terms & Conditions</a><a href="/consent">Consent information</a><a href="${escapeHtml(booking)}">Book online</a></div></div><div class="footer-bottom"><span>© ${new Date().getUTCFullYear()} Bare Beauty – Keighley</span><span>Private women-only studio · Full address supplied after booking</span></div></div></footer>`;
}

function documentHtml(input: {
  title: string;
  description: string;
  path: string;
  body: string;
  booking: string;
  data: BareBeautyLiveData;
  structuredData?: unknown;
}): string {
  const canonical = `https://${BARE_BEAUTY_HOSTNAME}${input.path === '/' ? '' : input.path}`;
  const jsonLd = input.structuredData ? `<script type="application/ld+json">${escapeJson(input.structuredData)}</script>` : '';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><meta name="description" content="${escapeHtml(input.description)}"><meta name="theme-color" content="#f5eee6"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Bare Beauty Keighley"><meta property="og:title" content="${escapeHtml(input.title)}"><meta property="og:description" content="${escapeHtml(input.description)}"><meta property="og:url" content="${escapeHtml(canonical)}">${jsonLd}<style>${baseStyles()}</style></head><body>${pageHeader(input.booking)}<main>${input.body}</main>${pageFooter(input.booking, input.data)}</body></html>`;
}

function serviceCards(services: BareBeautyService[], limit?: number): string {
  const visible = typeof limit === 'number' ? services.slice(0, limit) : services;
  return `<div class="service-grid">${visible.map(service => `<a class="service-card" href="/services/${serviceSlug(service)}"><div class="service-visual"><span class="service-mark">${escapeHtml(serviceMark(service))}</span></div><div class="service-body"><span class="service-category">${escapeHtml(service.category)}</span><h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p><div class="service-meta"><span>${escapeHtml(formatDuration(service.durationMinutes))}</span><span class="price">${escapeHtml(formatPrice(service.pricePence))}</span><span class="service-arrow" aria-hidden="true">→</span></div></div></a>`).join('')}</div>`;
}

function homePage(data: BareBeautyLiveData, booking: string): string {
  const featured = data.services.filter(service => !['add-on', 'free'].includes(service.category.toLowerCase())).slice(0, 4);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    name: 'Bare Beauty Keighley',
    url: `https://${BARE_BEAUTY_HOSTNAME}/`,
    email: BRAND_EMAIL,
    areaServed: 'Keighley',
    address: { '@type': 'PostalAddress', addressLocality: 'Keighley', postalCode: 'BD21', addressCountry: 'GB' },
    openingHoursSpecification: data.openingHours.map(hour => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${DAY_NAMES[hour.dayOfWeek]}`,
      opens: hour.startTime.slice(0, 5),
      closes: hour.endTime.slice(0, 5),
    })),
  };
  const body = `<section class="hero"><div class="hero-grid"><div class="hero-copy"><p class="eyebrow">Enhance · Empower · Elevate</p><h1>Bare Beauty<span>Keighley</span></h1><p class="hero-lead">Natural-looking brow and lash treatments with faith-conscious options, personalised to your features and delivered in a calm, private women-only studio.</p><div class="hero-actions"><a class="btn" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div><div class="trust-line"><span>Women-only private studio</span><span>${escapeHtml(LOCATION_LABEL)}</span><span>Appointments ${escapeHtml(openDaysLabel(data.openingHours))}</span></div></div><div class="studio-art" aria-hidden="true"><div class="studio-glow"></div><div class="shelf one"></div><div class="shelf two"></div><div class="shelf three"></div><div class="pendant a"></div><div class="pendant b"></div><div class="studio-logo"><span class="big">BARE<br>BEAUTY</span><span class="small">Keighley</span></div><div class="counter"></div></div></div></section>
  <section class="section"><div class="shell"><div class="line-title">Our most popular treatments</div>${serviceCards(featured)}<div style="text-align:center;margin-top:34px"><a class="btn" href="${escapeHtml(booking)}">Book a treatment <span aria-hidden="true">→</span></a></div></div></section>
  <section class="section dark" style="padding:0"><div class="values"><article class="value"><span class="value-icon">◇</span><h3>Faith-conscious options</h3><p>Including our signature wudhu-friendly Halal Brows treatment, designed with your values and personal requirements in mind.</p></article><article class="value"><span class="value-icon">✦</span><h3>Natural results</h3><p>We enhance your existing features with soft, polished results that feel like you — never a one-size-fits-all finish.</p></article><article class="value"><span class="value-icon">◌</span><h3>Personalised care</h3><p>Every appointment begins with a consultation so your face shape, brow goals, lash condition and preferences guide the treatment.</p></article><article class="value"><span class="value-icon">♡</span><h3>Private & comfortable</h3><p>A calm women-only home studio where you can relax, feel valued and enjoy one-to-one attention.</p></article></div></section>
  <section class="split"><div class="story"><p class="eyebrow">About Bare Beauty</p><h2>Beauty should feel effortless, personal and true to you.</h2><p>Bare Beauty – Keighley began with a personal search for a way to feel refreshed and put together without compromising faith or everyday life. Discovering wudhu-friendly brows brought back that feeling of confidence — and inspired a space where other women could experience the same thoughtful care.</p><p>Today, every treatment is approached with precision, warmth and a focus on enhancing what is already yours.</p><a class="btn dark" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div><div class="mirror-art" aria-hidden="true"></div></section>
  <section class="section soft"><div class="shell"><div class="section-head center"><p class="eyebrow">Your appointment</p><h2>A considered experience from booking to aftercare.</h2></div><div class="steps"><article class="step"><span class="step-no">01</span><h3>Book</h3><p>Choose your treatment and select an available appointment in the live booking calendar.</p></article><article class="step"><span class="step-no">02</span><h3>Consult</h3><p>We discuss your goals, assess your brows or lashes and answer questions before treatment begins.</p></article><article class="step"><span class="step-no">03</span><h3>Treat</h3><p>Your service is tailored to your features and preferences, with precision and care in a calm environment.</p></article><article class="step"><span class="step-no">04</span><h3>Maintain</h3><p>You leave with personalised aftercare guidance and a clear idea of when to return for your next refresh.</p></article></div><div class="notice" style="margin-top:52px"><div class="notice-icon">P</div><div><h3>Patch tests are free and important.</h3><p>A patch test is required before applicable brow and lash treatments and must be completed within the recommended timeframe.</p></div><a class="btn" href="${escapeHtml(booking)}">Book patch test <span aria-hidden="true">→</span></a></div></div></section>
  <section class="section dark"><div class="shell hours-layout"><div><p class="eyebrow light">Appointments in Keighley</p><h2>Opening hours that stay in step with the booking calendar.</h2><p class="section-copy">These appointment hours are read from Bare Beauty’s live schedule. If availability changes in the booking system, the website schedule changes with it.</p><div class="location-card" style="margin-top:30px"><h3>${escapeHtml(LOCATION_LABEL)}</h3><p>Private home studio. The full address is supplied to confirmed clients after booking.</p><span class="badge">Women only</span></div></div><div>${openingHoursTable(data.openingHours)}<p class="live-note" style="color:#c9b6aa">Live appointment schedule · Out-of-hours and mobile appointments may be available subject to availability.</p><a class="btn ghost" style="margin-top:24px" href="${escapeHtml(booking)}">See live availability <span aria-hidden="true">→</span></a></div></div></section>`;
  return documentHtml({ title: 'Bare Beauty Keighley | Faith-Conscious Brows & Lashes', description: 'Natural-looking brows and lashes with faith-conscious options in a private women-only Keighley studio. Book Halal Brows, lash lifts, brow treatments and more.', path: '/', body, booking, data, structuredData: schema });
}

function groupedServices(data: BareBeautyLiveData, booking: string, packagesOnly = false): string {
  const services = packagesOnly ? data.services.filter(service => service.category.toLowerCase() === 'package') : data.services;
  const grouped = new Map<string, BareBeautyService[]>();
  for (const service of services) {
    const key = service.category || 'Treatments';
    const current = grouped.get(key) || [];
    current.push(service);
    grouped.set(key, current);
  }
  const sections = [...grouped.entries()].map(([category, items]) => `<section class="category-block"><div class="category-title"><h2>${escapeHtml(category)}</h2><span>${items.length} ${items.length === 1 ? 'option' : 'options'}</span></div>${serviceCards(items)}</section>`).join('');
  const label = packagesOnly ? 'Treatment packages' : 'Treatments & services';
  const title = packagesOnly ? 'Pairs designed to work beautifully together.' : 'Choose the finish that feels most like you.';
  const copy = packagesOnly ? 'Combine complementary brow and lash treatments in one considered appointment. Package names, timing and prices below are pulled live from the booking system.' : 'From our signature Halal Brows and soft lash lifts to maintenance, waxing and patch testing, every active service below is pulled live from the Bare Beauty booking catalogue.';
  const path = packagesOnly ? '/packages' : '/services';
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / ${escapeHtml(label)}</div><p class="eyebrow">${escapeHtml(label)}</p><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(copy)}</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="section"><div class="shell">${sections || '<p>No bookable services are currently published. Please check the booking page for the latest availability.</p>'}<p class="live-note">Service names, descriptions, duration and pricing are read from the live Bare Beauty booking catalogue.</p></div></section>`;
  return documentHtml({ title: packagesOnly ? 'Beauty Packages | Bare Beauty Keighley' : 'Treatments | Bare Beauty Keighley', description: packagesOnly ? 'Explore live brow and lash packages at Bare Beauty Keighley.' : 'Explore Bare Beauty Keighley brow, lash, maintenance and beauty services with live prices and durations.', path, body, booking, data });
}

function genericEditorial(service: BareBeautyService): Editorial {
  const lower = `${service.name} ${service.category}`.toLowerCase();
  if (lower.includes('wax')) return {
    strapline: 'Smooth, carefully finished skin with professional waxing and soothing aftercare.',
    bestFor: 'Clients looking for a quick, polished hair-removal service carried out with care and finished with a soothing product.',
    includes: ['Brief consultation', 'Professional waxing of the booked area', 'Skin-soothing finishing product', 'Aftercare guidance'],
    preparation: ['Arrive with clean, dry skin in the treatment area.', 'Tell us about sensitivities, medication or skin changes that could affect treatment.'],
    aftercare: ['Avoid heat, friction and strongly active skincare on freshly waxed skin for the period advised at your appointment.', 'Follow the personalised aftercare provided.'],
  };
  if (lower.includes('mobile') || lower.includes('out of hour')) return {
    strapline: 'Extra flexibility when the standard booking schedule does not quite fit.',
    bestFor: 'Clients who need an appointment outside standard studio hours or want to enquire about a mobile appointment, subject to availability and any additional charge.',
    includes: ['Availability enquiry', 'Appointment suitability check', 'Confirmation of any additional charge before treatment is arranged'],
  };
  return {
    strapline: 'A personalised Bare Beauty service with a natural, considered finish.',
    bestFor: `Clients looking for ${service.name.toLowerCase()} with one-to-one attention and a result tailored to their features and preferences.`,
    includes: ['Consultation and assessment', 'Treatment tailored to your preferences', 'Final finishing', 'Personalised aftercare guidance'],
  };
}

function serviceDetailPage(service: BareBeautyService, data: BareBeautyLiveData, booking: string): string {
  const editorial = EDITORIAL[service.publicReference] || genericEditorial(service);
  const faq = editorial.faqs?.length ? `<section style="margin-top:48px"><p class="eyebrow">Questions, answered</p><h2>Frequently asked questions</h2><div class="faq">${editorial.faqs.map(([question, answer]) => `<article class="faq-item"><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join('')}</div></section>` : '';
  const prep = editorial.preparation?.length ? `<h3>Before your appointment</h3><ul class="check-list">${editorial.preparation.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  const aftercare = editorial.aftercare?.length ? `<h3>Aftercare & longevity</h3><ul class="check-list">${editorial.aftercare.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  const patch = editorial.patchTest ? `<div class="notice" style="margin-top:38px"><div class="notice-icon">P</div><div><h3>Patch test required</h3><p>Please arrange your complimentary patch test within the recommended timeframe before this treatment. If it is not completed, your appointment may need to be rescheduled.</p></div><a class="btn" href="${escapeHtml(booking)}">Book online <span aria-hidden="true">→</span></a></div>` : '';
  const path = `/services/${serviceSlug(service)}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.description,
    provider: { '@type': 'BeautySalon', name: 'Bare Beauty Keighley', url: `https://${BARE_BEAUTY_HOSTNAME}/` },
    areaServed: 'Keighley',
    offers: { '@type': 'Offer', priceCurrency: 'GBP', price: (service.pricePence / 100).toFixed(2), url: booking },
  };
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / <a href="/services">Treatments</a> / ${escapeHtml(service.name)}</div><p class="eyebrow">${escapeHtml(service.category)}</p><h1>${escapeHtml(service.name)}</h1><p class="lead">${escapeHtml(editorial.strapline)}</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book this treatment <span aria-hidden="true">→</span></a></div></section><section class="section"><div class="shell detail-grid"><article><p class="eyebrow">The treatment</p><h2>A result shaped around you.</h2><p class="section-copy">${escapeHtml(service.description)}</p><h3>Who it is for</h3><p>${escapeHtml(editorial.bestFor)}</p><h3>What your appointment includes</h3><ul class="check-list">${editorial.includes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${prep}${aftercare}${patch}${faq}<p class="live-note">Treatment description, duration and price shown on this page are synced to the live Bare Beauty booking catalogue.</p></article><aside class="detail-sidebar"><p class="eyebrow light">At a glance</p><h2 style="font-size:2.1rem;margin:0 0 12px">${escapeHtml(service.name)}</h2><div class="meta-block"><span>Price</span><strong>${escapeHtml(formatPrice(service.pricePence))}</strong></div><div class="meta-block"><span>Appointment</span><strong>${escapeHtml(formatDuration(service.durationMinutes))}</strong></div><div class="meta-block"><span>Category</span><strong>${escapeHtml(service.category)}</strong></div><div class="meta-block"><span>Studio</span><strong>${escapeHtml(LOCATION_LABEL)}</strong></div><a class="btn" href="${escapeHtml(booking)}">Book appointment <span aria-hidden="true">→</span></a><p class="live-note" style="color:#bfaea3">A £10 deposit is currently required by the booking system to secure an appointment.</p></aside></div></section>`;
  return documentHtml({ title: `${service.name} | Bare Beauty Keighley`, description: `${service.description} View the live price and duration, treatment details and booking information for ${service.name} at Bare Beauty Keighley.`.slice(0, 280), path, body, booking, data, structuredData: schema });
}

function aboutPage(data: BareBeautyLiveData, booking: string): string {
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / About</div><p class="eyebrow">Our story</p><h1>Beauty that respects your values and still feels beautifully you.</h1><p class="lead">Bare Beauty – Keighley was created from a personal journey back to confidence — and the belief that thoughtful beauty should feel accessible, private and personal.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="split"><div class="story"><p class="eyebrow">Why Bare Beauty</p><h2>It began with missing that feeling of looking refreshed.</h2><p>A few years ago, the founder stopped having her brows done because of a combination of religious beliefs and the demands of being a busy mum. It was the right decision, but she still missed the confidence that came from feeling put together — even with makeup.</p><p>Discovering wudhu-friendly Halal Brows became a turning point. The brows felt more balanced and defined without relying on daily makeup, and the unexpected boost in confidence stayed with her.</p><p>That experience sparked Bare Beauty: a space created to give other women the same feeling without asking them to compromise their comfort, preferences or values.</p></div><div class="mirror-art" aria-hidden="true"></div></section><section class="section"><div class="shell"><div class="section-head"><p class="eyebrow">What matters here</p><h2>No one-size-fits-all beauty.</h2><p class="section-copy">From product choices to technique and aftercare, every detail is considered around the individual client.</p></div><div class="steps"><article class="step"><span class="step-no">01</span><h3>Personalised</h3><p>Your goals, natural features and treatment preferences guide the result.</p></article><article class="step"><span class="step-no">02</span><h3>Natural-looking</h3><p>The focus is enhancement rather than overpowering the features you already have.</p></article><article class="step"><span class="step-no">03</span><h3>Faith-conscious</h3><p>Wudhu-friendly Halal Brows are available for clients looking for an option aligned with their personal requirements.</p></article><article class="step"><span class="step-no">04</span><h3>Private</h3><p>The women-only home studio is appointment-led, calm and designed for comfort.</p></article></div></div></section>`;
  return documentHtml({ title: 'Our Story | Bare Beauty Keighley', description: 'Discover the story behind Bare Beauty Keighley: personalised, natural-looking and faith-conscious beauty in a private women-only studio.', path: '/about', body, booking, data });
}

function contactPage(data: BareBeautyLiveData, booking: string): string {
  const outOfHours = data.services.find(service => service.name.toLowerCase().includes('out of hour'));
  const phone = /0\d[\d\s]{8,}/.exec(outOfHours?.description || '')?.[0]?.trim();
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / Contact</div><p class="eyebrow">Contact & appointment hours</p><h1>A private beauty studio in Keighley.</h1><p class="lead">Bare Beauty is a women-only home studio in the BD21 area. For privacy, the full address is provided to confirmed clients after booking.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="section"><div class="shell contact-grid"><article class="contact-card"><p class="eyebrow">Get in touch</p><h2>Questions before you book?</h2><div class="contact-list"><p><strong>Email</strong><br><a href="mailto:${escapeHtml(BRAND_EMAIL)}">${escapeHtml(BRAND_EMAIL)}</a></p><p><strong>Location</strong><br>${escapeHtml(LOCATION_LABEL)}<br><span class="muted">Full address provided after booking.</span></p>${phone ? `<p><strong>Out-of-hours / mobile enquiries</strong><br>${escapeHtml(phone)}</p>` : ''}</div><p class="muted">You are welcome to ask for more information before booking. Please also carry out any personal due diligence you need when deciding whether a treatment is right for you.</p><a class="btn dark" href="${escapeHtml(booking)}">Book online <span aria-hidden="true">→</span></a></article><article class="contact-card"><p class="eyebrow">Live schedule</p><h2>Studio appointment hours</h2>${openingHoursTable(data.openingHours)}<p class="live-note">These hours come directly from the current in-studio booking schedule and update when the backend schedule changes.</p><a class="btn" style="margin-top:22px" href="${escapeHtml(booking)}">See available times <span aria-hidden="true">→</span></a></article></div></section>`;
  return documentHtml({ title: 'Contact & Opening Hours | Bare Beauty Keighley', description: 'Contact Bare Beauty Keighley and view live studio appointment hours for our private women-only BD21 beauty studio.', path: '/contact', body, booking, data });
}

function termsPage(data: BareBeautyLiveData, booking: string): string {
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / Terms & Conditions</div><p class="eyebrow">Booking information</p><h1>Terms & Conditions</h1><p class="lead">Clear expectations help us protect your appointment time, treatment safety and a respectful experience for every client.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="section soft"><div class="shell legal-wrap"><div class="legal-card"><p class="eyebrow">Live booking policy</p><h2>Deposits, cancellations & no-shows</h2>${richPlainText(data.cancellationPolicy)}<p class="live-note">This policy is read from the current Bare Beauty booking-page settings.</p></div><div class="legal-card"><p class="eyebrow">Before treatment</p><h2>Patch testing, consent & health information</h2><ul class="check-list"><li>Applicable patch tests must be completed within the recommended timeframe before treatment. If not, an appointment may need to be rescheduled.</li><li>A consent form is required for each appointment. If it has not been completed in advance, it can be completed at the appointment before treatment begins.</li><li>You are responsible for telling Bare Beauty about allergies, sensitivities, medical conditions, medication or changes to your health that may affect treatment.</li><li>Please carry out your own research and due diligence when deciding whether a treatment meets your personal, ethical or faith requirements. You are welcome to ask for more information before booking.</li></ul></div><div class="legal-card"><p class="eyebrow">Your appointment</p><h2>Studio etiquette & results</h2><ul class="check-list"><li>Clients are kindly asked to attend alone because of the nature and size of the private treatment space.</li><li>Results vary between clients depending on natural hair growth, skin type, lifestyle and aftercare. Bare Beauty will work toward your desired result, but a specific outcome cannot be guaranteed.</li><li>A safe, comfortable and respectful environment is expected at all times. Inappropriate behaviour will not be tolerated.</li><li>Any remaining balance and payment method are confirmed through the current booking journey and appointment information.</li></ul></div></div></section>`;
  return documentHtml({ title: 'Terms & Conditions | Bare Beauty Keighley', description: 'Read Bare Beauty Keighley booking terms, deposit and cancellation policy, patch testing, consent, studio etiquette and treatment information.', path: '/terms-and-conditions', body, booking, data });
}

function consentPage(data: BareBeautyLiveData, booking: string): string {
  const body = `<section class="page-hero"><div class="shell"><div class="breadcrumbs"><a href="/">Home</a> / Consent</div><p class="eyebrow">Treatment consent</p><h1>Consent information</h1><p class="lead">A fresh consent form is required for each appointment so your treatment information and health details are current.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="section"><div class="shell legal-wrap"><div class="legal-card"><p class="eyebrow">Current acknowledgement</p><h2>What you will be asked to confirm</h2>${richPlainText(data.consentAcknowledgement)}<p class="live-note">This acknowledgement is read from the currently published Bare Beauty consent form.</p></div><div class="legal-card"><p class="eyebrow">How it works</p><h2>Your secure form is linked to your appointment.</h2><p>After you book, the appointment-specific consent form can be sent securely for completion. This keeps the actual form tied to the correct appointment rather than exposing a reusable public form link.</p><p>If you have not completed it before arriving, you can complete it before treatment begins at your appointment.</p><a class="btn dark" href="${escapeHtml(booking)}">Book and receive your form <span aria-hidden="true">→</span></a></div></div></section>`;
  return documentHtml({ title: 'Consent Information | Bare Beauty Keighley', description: 'Read the current Bare Beauty Keighley treatment consent acknowledgement and learn how appointment-specific consent forms work.', path: '/consent', body, booking, data });
}

function notFoundPage(data: BareBeautyLiveData, booking: string): string {
  const body = `<section class="page-hero"><div class="shell"><p class="eyebrow">Page not found</p><h1>That page is no longer here.</h1><p class="lead">Treatments can change as the live booking catalogue is updated. Browse the current service list or book from the latest availability.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Book your appointment <span aria-hidden="true">→</span></a></div></section><section class="section"><div class="shell"><div class="section-head"><h2>Current treatments</h2></div>${serviceCards(data.services, 4)}</div></section>`;
  return documentHtml({ title: 'Page Not Found | Bare Beauty Keighley', description: 'Browse current Bare Beauty Keighley treatments and live booking availability.', path: '/404', body, booking, data });
}

function responseHeaders(cacheControl = CACHE_CONTROL): HeadersInit {
  return {
    'cache-control': cacheControl,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action https://app.kasimshah.com; upgrade-insecure-requests",
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function requestHostname(request: Request, config: SitesRuntimeConfig): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || null;
  return resolvePublicRequestHostname({
    host: request.headers.get('host'),
    forwardedHost,
    trustedProxy: config.trustedProxy,
  });
}

export function isBareBeautyRequest(request: Request, config: SitesRuntimeConfig): boolean {
  try {
    return requestHostname(request, config) === BARE_BEAUTY_HOSTNAME;
  } catch (error) {
    if (error instanceof HostnameValidationError) return false;
    throw error;
  }
}

export function renderBareBeautyPath(input: {
  data: BareBeautyLiveData;
  config: SitesRuntimeConfig;
  pathname: string;
}): Response {
  const booking = bookingUrl(input.config);
  let path: string;
  try {
    path = normalizePublicPath(input.pathname);
  } catch {
    return new Response(notFoundPage(input.data, booking), { status: 404, headers: responseHeaders('no-store') });
  }
  let html: string;
  let status = 200;
  if (path === '/') html = homePage(input.data, booking);
  else if (path === '/services' || path === '/treatments') html = groupedServices(input.data, booking);
  else if (path === '/packages') html = groupedServices(input.data, booking, true);
  else if (path === '/about') html = aboutPage(input.data, booking);
  else if (path === '/contact') html = contactPage(input.data, booking);
  else if (path === '/terms-and-conditions' || path === '/terms') html = termsPage(input.data, booking);
  else if (path === '/consent') html = consentPage(input.data, booking);
  else if (path.startsWith('/services/')) {
    const slug = path.slice('/services/'.length);
    const service = input.data.services.find(item => serviceSlug(item) === slug || slugify(item.name) === slug);
    if (service) html = serviceDetailPage(service, input.data, booking);
    else {
      html = notFoundPage(input.data, booking);
      status = 404;
    }
  } else {
    html = notFoundPage(input.data, booking);
    status = 404;
  }
  return new Response(html, { status, headers: responseHeaders(status === 200 ? CACHE_CONTROL : 'no-store') });
}

export async function maybeHandleBareBeautyPageRequest(
  request: Request,
  config: SitesRuntimeConfig,
): Promise<Response | null> {
  if (!isBareBeautyRequest(request, config)) return null;
  try {
    const data = await loadBareBeautyLiveData();
    return renderBareBeautyPath({ data, config, pathname: new URL(request.url).pathname });
  } catch {
    const booking = bookingUrl(config);
    const fallback: BareBeautyLiveData = { services: [], openingHours: [], cancellationPolicy: '', consentAcknowledgement: '' };
    const body = `<section class="page-hero"><div class="shell"><p class="eyebrow">Bare Beauty Keighley</p><h1>We’re refreshing the treatment list.</h1><p class="lead">The live catalogue is temporarily unavailable. You can still use the booking page for the latest services and availability.</p><a class="btn" style="margin-top:25px" href="${escapeHtml(booking)}">Open booking page <span aria-hidden="true">→</span></a></div></section>`;
    return new Response(documentHtml({ title: 'Bare Beauty Keighley', description: 'Open the live Bare Beauty Keighley booking page.', path: '/', body, booking, data: fallback }), { status: 503, headers: responseHeaders('no-store') });
  }
}

export async function maybeHandleBareBeautyBookingRequest(
  request: Request,
  config: SitesRuntimeConfig,
): Promise<Response | null> {
  if (!isBareBeautyRequest(request, config)) return null;
  return new Response(null, {
    status: 302,
    headers: {
      location: bookingUrl(config),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function maybeHandleBareBeautyRobotsRequest(
  request: Request,
  config: SitesRuntimeConfig,
): Promise<Response | null> {
  if (!isBareBeautyRequest(request, config)) return null;
  return new Response(`User-agent: *\nAllow: /\nSitemap: https://${BARE_BEAUTY_HOSTNAME}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}

export async function maybeHandleBareBeautySitemapRequest(
  request: Request,
  config: SitesRuntimeConfig,
): Promise<Response | null> {
  if (!isBareBeautyRequest(request, config)) return null;
  try {
    const data = await loadBareBeautyLiveData();
    const paths = ['/', '/services', '/packages', '/about', '/contact', '/terms-and-conditions', '/consent', ...data.services.map(service => `/services/${serviceSlug(service)}`)];
    const unique = [...new Set(paths)];
    const urls = unique.map(path => `<url><loc>https://${BARE_BEAUTY_HOSTNAME}${path === '/' ? '/' : escapeHtml(path)}</loc></url>`).join('');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': CACHE_CONTROL },
    });
  } catch {
    return new Response('Service unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
  }
}
