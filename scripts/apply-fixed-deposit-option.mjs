import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const write = (path, content) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

function replaceRequired(path, search, replacement, description) {
  const before = read(path);
  const after = before.replace(search, replacement);
  if (after === before) throw new Error(`Could not apply ${description} in ${path}`);
  write(path, after);
}

write('packages/contracts/src/booking-payment-policy.ts', `import { z } from 'zod';

export const DepositTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);
export type DepositType = z.infer<typeof DepositTypeSchema>;

export const DEFAULT_DEPOSIT_PERCENTAGE = 20;
export const DEFAULT_FIXED_DEPOSIT_AMOUNT = 1_000;

export function normaliseDepositType(value: string | null | undefined): DepositType {
  return value === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
}

export function normaliseDepositPercentage(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 99
    ? Math.round(parsed)
    : DEFAULT_DEPOSIT_PERCENTAGE;
}

export function normaliseFixedDepositAmount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100_000_000
    ? Math.round(parsed)
    : DEFAULT_FIXED_DEPOSIT_AMOUNT;
}

export function calculateDepositAmount(
  totalMinorUnits: number,
  settings: {
    depositType?: string | null;
    depositPercentage?: number | string | null;
    depositFixedAmount?: number | string | null;
  },
): number {
  const parsedTotal = Number(totalMinorUnits);
  const total = Number.isFinite(parsedTotal) ? Math.max(0, Math.round(parsedTotal)) : 0;
  if (total === 0) return 0;

  if (normaliseDepositType(settings.depositType) === 'FIXED') {
    return Math.min(total, normaliseFixedDepositAmount(settings.depositFixedAmount));
  }

  return Math.min(total, Math.ceil(total * normaliseDepositPercentage(settings.depositPercentage) / 100));
}
`);

replaceRequired(
  'packages/contracts/src/index.ts',
  "export * from './booking.js';\n",
  "export * from './booking.js';\nexport * from './booking-payment-policy.js';\n",
  'booking payment policy export',
);

replaceRequired(
  'packages/contracts/src/booking-operations.ts',
  "import { z } from 'zod';\n",
  "import { z } from 'zod';\nimport { DepositTypeSchema } from './booking-payment-policy.js';\n",
  'deposit type schema import',
);
replaceRequired(
  'packages/contracts/src/booking-operations.ts',
  /const paymentSettingsSchema = z\.object\(\{[\s\S]*?\n\}\)\.strict\(\);/,
  `const paymentSettingsSchema = z.object({
  mode: z.enum(['NONE', 'DEPOSIT', 'FULL', 'PAY_LATER', 'CUSTOMER_CHOICE']).default('PAY_LATER'),
  depositType: DepositTypeSchema.optional(),
  depositPercentage: z.number().min(0).max(100).default(0),
  depositFixedAmount: z.number().int().min(1).max(100_000_000).optional(),
  promotionCodesEnabled: z.boolean().default(false),
  giftCardsEnabled: z.boolean().default(false),
}).strict();`,
  'fixed deposit contract fields',
);

replaceRequired(
  'apps/api/src/modules/bookings/booking-page.service.ts',
  "const DEFAULT_PAYMENT = { mode: 'PAY_LATER', depositPercentage: 0, promotionCodesEnabled: false, giftCardsEnabled: false };",
  "const DEFAULT_PAYMENT = { mode: 'DEPOSIT', depositType: 'PERCENTAGE', depositPercentage: 20, depositFixedAmount: 1_000, promotionCodesEnabled: false, giftCardsEnabled: false };",
  'booking page payment defaults',
);
replaceRequired(
  'apps/api/src/modules/bookings/booking-page.service.ts',
  '      if (update.paymentSettings) values.paymentSettings = update.paymentSettings;',
  '      if (update.paymentSettings) values.paymentSettings = { ...mergeObject(page.paymentSettings, DEFAULT_PAYMENT), ...update.paymentSettings };',
  'payment settings merge',
);

replaceRequired(
  'apps/api/src/routes/public/booking.ts',
  "import { \n  CreateBookingRequestSchema, ",
  "import { \n  calculateDepositAmount,\n  CreateBookingRequestSchema, ",
  'deposit calculator import',
);
replaceRequired(
  'apps/api/src/routes/public/booking.ts',
  /      const paymentSettings = page\.paymentSettings as \{ mode\?: string; depositPercentage\?: number \};[\s\S]*?      const expectedAmountDue = verifiedPaymentMode === 'deposit_required'\n        \? Math\.ceil\(baseServiceAmount \* \(depositPercentage > 0 \? depositPercentage : 100\) \/ 100\)\n        : baseServiceAmount;/,
  `      const paymentSettings = page.paymentSettings as {
        mode?: string;
        depositType?: string;
        depositPercentage?: number;
        depositFixedAmount?: number;
      };
      const verifiedPaymentMode = bookedService.requiresDeposit ? 'deposit_required'
        : paymentSettings.mode === 'FULL' ? 'pay_now'
        : paymentSettings.mode === 'DEPOSIT' ? 'deposit_required'
          : paymentSettings.mode === 'CUSTOMER_CHOICE' ? data.paymentMode
            : 'pay_later';
      const baseServiceAmount = Math.max(0, bookedService.price - bookedService.discount);
      const expectedAmountDue = verifiedPaymentMode === 'deposit_required'
        ? calculateDepositAmount(baseServiceAmount, paymentSettings)
        : baseServiceAmount;`,
  'authoritative deposit calculation',
);
replaceRequired(
  'apps/api/src/routes/public/booking.ts',
  /      const amountDue = verifiedPaymentMode === 'deposit_required'\n        \? Math\.ceil\(quotedAmount \* \(depositPercentage > 0 \? depositPercentage : 100\) \/ 100\)\n        : quotedAmount;/,
  `      const amountDue = verifiedPaymentMode === 'deposit_required'
        ? calculateDepositAmount(quotedAmount, paymentSettings)
        : quotedAmount;`,
  'Stripe deposit amount calculation',
);

replaceRequired(
  'apps/web/src/pages/settings/BookingPageSettings.tsx',
  /function normalisePage\(settings: BookingPageResponse\): BookingPageResponse \{[\s\S]*?\n\}/,
  `function normalisePage(settings: BookingPageResponse): BookingPageResponse {
  const percentage = Number(settings.paymentSettings.depositPercentage);
  const fixedAmount = Number(settings.paymentSettings.depositFixedAmount);
  return {
    ...settings,
    bookingRules: {
      ...settings.bookingRules,
      maximumFutureDays: Math.max(minimumCustomerWindowDays, settings.bookingRules.maximumFutureDays || minimumCustomerWindowDays),
      enabledBookingChannels: settings.bookingRules.enabledBookingChannels?.length ? settings.bookingRules.enabledBookingChannels : ['in_shop'],
    },
    paymentSettings: {
      ...settings.paymentSettings,
      mode: settings.paymentSettings.mode === 'FULL' ? 'FULL' : 'DEPOSIT',
      depositType: settings.paymentSettings.depositType === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
      depositPercentage: Number.isFinite(percentage) && percentage >= 1 && percentage <= 99 ? Math.round(percentage) : 20,
      depositFixedAmount: Number.isFinite(fixedAmount) && fixedAmount >= 1 ? Math.round(fixedAmount) : 1_000,
    },
  };
}`,
  'booking settings normalisation',
);
replaceRequired(
  'apps/web/src/pages/settings/BookingPageSettings.tsx',
  /            <label className="text-sm font-bold">Payment requirement<select[\s\S]*?            <label className="text-sm font-bold">Deposit %<input[\s\S]*?<\/label>/,
  `            <label className="text-sm font-bold">Payment for paid services<select value={page.paymentSettings.mode} onChange={event => update('paymentSettings', { ...page.paymentSettings, mode: event.target.value as BookingPageResponse['paymentSettings']['mode'] })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="DEPOSIT">Deposit first</option><option value="FULL">Full payment upfront</option></select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Free services skip payment automatically. Paid services use Stripe before confirmation.</span></label>
            {page.paymentSettings.mode === 'DEPOSIT' && <>
              <label className="text-sm font-bold">Deposit calculation<select value={page.paymentSettings.depositType || 'PERCENTAGE'} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositType: event.target.value as 'PERCENTAGE' | 'FIXED' })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="PERCENTAGE">Percentage of service price</option><option value="FIXED">Fixed amount in pounds</option></select><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Choose whether every service uses the same percentage or the same pound amount.</span></label>
              {(page.paymentSettings.depositType || 'PERCENTAGE') === 'PERCENTAGE'
                ? <label className="text-sm font-bold">Deposit percentage<input type="number" min={1} max={99} step={1} value={page.paymentSettings.depositPercentage} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositPercentage: Number(event.target.value) })} className="mt-1 w-full rounded-xl border p-3" /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Customers pay this percentage online and the balance at the appointment.</span></label>
                : <label className="text-sm font-bold">Fixed deposit (£)<input type="number" min={0.01} step={0.01} value={(page.paymentSettings.depositFixedAmount ?? 1_000) / 100} onChange={event => update('paymentSettings', { ...page.paymentSettings, depositFixedAmount: Math.max(1, Math.round(Number(event.target.value) * 100)) })} className="mt-1 w-full rounded-xl border p-3" /><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">For example, enter 10 for a £10 deposit. Cheaper services are capped at their full price.</span></label>}
            </>}`,
  'fixed deposit settings controls',
);

replaceRequired(
  'apps/web/src/features/bookings/PublicBookingFlow.tsx',
  "import { EmailAddressInput } from './EmailAddressInput.js';\n",
  "import { EmailAddressInput } from './EmailAddressInput.js';\nimport { calculateDepositAmount, normaliseDepositPercentage, normaliseDepositType } from './booking-payment-policy.js';\n",
  'public booking deposit helpers',
);
replaceRequired(
  'apps/web/src/features/bookings/PublicBookingFlow.tsx',
  '    paymentSettings: { mode: string; depositPercentage: number };',
  "    paymentSettings: { mode: string; depositType?: 'PERCENTAGE' | 'FIXED'; depositPercentage: number; depositFixedAmount?: number };",
  'public catalog deposit fields',
);
replaceRequired(
  'apps/web/src/features/bookings/PublicBookingFlow.tsx',
  /  const effectivePaymentMode = service\?\.requiresDeposit[\s\S]*?  const currency = \(amount: number\) => new Intl\.NumberFormat\('en-GB', \{ style: 'currency', currency: tenant\.currency \}\)\.format\(amount \/ 100\);/,
  `  const effectivePaymentMode = service?.requiresDeposit ? 'deposit_required' : page?.paymentSettings.mode === 'FULL' ? 'pay_now' : page?.paymentSettings.mode === 'DEPOSIT' ? 'deposit_required' : page?.paymentSettings.mode === 'CUSTOMER_CHOICE' ? paymentChoice : 'pay_later';
  const depositType = normaliseDepositType(page?.paymentSettings.depositType);
  const depositPercentage = normaliseDepositPercentage(page?.paymentSettings.depositPercentage);
  const quotedPrice = slot?.price ?? service?.price ?? 0;
  const amountDueNow = effectivePaymentMode === 'deposit_required'
    ? calculateDepositAmount(quotedPrice, page?.paymentSettings || {})
    : effectivePaymentMode === 'pay_now' ? quotedPrice : 0;
  const currency = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(amount / 100);
  const depositChoiceLabel = depositType === 'FIXED' ? currency(amountDueNow) : `${depositPercentage}%`;`,
  'public booking fixed deposit calculation',
);
replaceRequired(
  'apps/web/src/features/bookings/PublicBookingFlow.tsx',
  /\{depositPercentage > 0 && <ChoiceCard selected=\{paymentChoice === 'deposit_required'\} onClick=\{\(\) => setPaymentChoice\('deposit_required'\)\} primary=\{primary\} ariaLabel=\{`Pay a \$\{depositPercentage\}% deposit`\} className="sm:col-span-2"><ShieldCheck className="h-5 w-5" style=\{\{ color: primary \}\} \/><p className="mt-3 pr-7 font-black text-slate-950">Pay a \{depositPercentage\}% deposit<\/p>/,
  `{amountDueNow > 0 && <ChoiceCard selected={paymentChoice === 'deposit_required'} onClick={() => setPaymentChoice('deposit_required')} primary={primary} ariaLabel={\`Pay a ${depositChoiceLabel} deposit\`} className="sm:col-span-2"><ShieldCheck className="h-5 w-5" style={{ color: primary }} /><p className="mt-3 pr-7 font-black text-slate-950">Pay a {depositChoiceLabel} deposit</p>`,
  'customer choice deposit label',
);
replaceRequired(
  'apps/web/src/features/bookings/PublicBookingFlow.tsx',
  "{effectivePaymentMode === 'deposit_required' ? `Deposit due now${depositPercentage > 0 ? ` (${depositPercentage}%)` : ''}` : 'Payment due now'}",
  "{effectivePaymentMode === 'deposit_required' ? `Deposit due now (${depositType === 'FIXED' ? 'fixed amount' : `${depositPercentage}%`})` : 'Payment due now'}",
  'deposit review label',
);

write('apps/web/src/features/bookings/booking-payment-policy.ts', `export {
  calculateDepositAmount,
  DEFAULT_DEPOSIT_PERCENTAGE,
  DEFAULT_FIXED_DEPOSIT_AMOUNT,
  normaliseDepositPercentage,
  normaliseDepositType,
  normaliseFixedDepositAmount,
} from '@ks-os/contracts';

export type CommitmentPaymentMode = 'DEPOSIT' | 'FULL';

export function normaliseCommitmentPaymentMode(value: string | null | undefined): CommitmentPaymentMode {
  return value === 'FULL' ? 'FULL' : 'DEPOSIT';
}

export function calculateOutstandingBalance(total: number, dueNow: number): number {
  return Math.max(0, Math.round((total - dueNow) * 100) / 100);
}
`);

write('apps/web/src/features/bookings/BookingPaymentExperienceEnhancer.tsx', `import { useEffect } from 'react';
import { calculateOutstandingBalance } from './booking-payment-policy.js';

function parseDisplayedMoney(value: string): number | null {
  const cleaned = value.replace(/[^0-9,.-]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDisplayedMoney(source: string, amount: number): string {
  const prefix = source.match(/^[^0-9-]*/)?.[0] || '';
  const suffix = source.match(/[^0-9]*$/)?.[0] || '';
  return `${prefix}${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function enhanceDepositBalanceSummary(root: ParentNode = document) {
  for (const list of root.querySelectorAll<HTMLDListElement>('dl')) {
    const rows = [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
    const totalRow = rows.find(row => row.querySelector('dt')?.textContent?.trim() === 'Total');
    const depositRow = rows.find(row => row.querySelector('dt')?.textContent?.trim().startsWith('Deposit due now'));
    if (!totalRow || !depositRow) continue;

    const totalText = totalRow.querySelector('dd')?.textContent?.trim() || '';
    const depositText = depositRow.querySelector('dd')?.textContent?.trim() || '';
    const total = parseDisplayedMoney(totalText);
    const deposit = parseDisplayedMoney(depositText);
    const existing = list.querySelector<HTMLElement>('[data-booking-balance-row="true"]');
    if (total === null || deposit === null || deposit <= 0 || deposit >= total) {
      existing?.remove();
      continue;
    }

    let balanceRow = existing;
    if (!balanceRow) {
      balanceRow = document.createElement('div');
      balanceRow.dataset.bookingBalanceRow = 'true';
      balanceRow.className = 'flex justify-between gap-4 bg-indigo-50 px-5 py-4';
      balanceRow.innerHTML = '<dt class="font-black text-slate-700">Balance due at appointment</dt><dd class="font-black text-slate-950"></dd>';
      depositRow.after(balanceRow);
    }
    const nextValue = formatDisplayedMoney(totalText, calculateOutstandingBalance(total, deposit));
    const output = balanceRow.querySelector('dd');
    if (output && output.textContent !== nextValue) output.textContent = nextValue;
  }
}

export function BookingPaymentExperienceEnhancer() {
  useEffect(() => {
    const enhance = () => enhanceDepositBalanceSummary(document);
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

export default BookingPaymentExperienceEnhancer;
`);

write('apps/web/src/features/bookings/BookingPaymentExperienceEnhancer.test.ts', `import { describe, expect, it } from 'vitest';
import {
  calculateDepositAmount,
  calculateOutstandingBalance,
  DEFAULT_DEPOSIT_PERCENTAGE,
  DEFAULT_FIXED_DEPOSIT_AMOUNT,
  normaliseCommitmentPaymentMode,
  normaliseDepositPercentage,
  normaliseDepositType,
  normaliseFixedDepositAmount,
} from './booking-payment-policy.js';

describe('booking payment experience', () => {
  it('keeps only commitment-first payment modes', () => {
    expect(normaliseCommitmentPaymentMode('FULL')).toBe('FULL');
    expect(normaliseCommitmentPaymentMode('DEPOSIT')).toBe('DEPOSIT');
    expect(normaliseCommitmentPaymentMode('PAY_LATER')).toBe('DEPOSIT');
  });

  it('normalises percentage and fixed deposit settings safely', () => {
    expect(normaliseDepositType('FIXED')).toBe('FIXED');
    expect(normaliseDepositType('unknown')).toBe('PERCENTAGE');
    expect(normaliseDepositPercentage('35')).toBe(35);
    expect(normaliseDepositPercentage(0)).toBe(DEFAULT_DEPOSIT_PERCENTAGE);
    expect(normaliseFixedDepositAmount(1_500)).toBe(1_500);
    expect(normaliseFixedDepositAmount(0)).toBe(DEFAULT_FIXED_DEPOSIT_AMOUNT);
  });

  it('calculates percentage deposits in minor currency units', () => {
    expect(calculateDepositAmount(5_000, { depositType: 'PERCENTAGE', depositPercentage: 20 })).toBe(1_000);
    expect(calculateDepositAmount(4_999, { depositType: 'PERCENTAGE', depositPercentage: 20 })).toBe(1_000);
  });

  it('supports a fixed £10 deposit without charging more than the service total', () => {
    expect(calculateDepositAmount(5_000, { depositType: 'FIXED', depositFixedAmount: 1_000 })).toBe(1_000);
    expect(calculateDepositAmount(750, { depositType: 'FIXED', depositFixedAmount: 1_000 })).toBe(750);
  });

  it('calculates the remaining appointment balance without going negative', () => {
    expect(calculateOutstandingBalance(100, 20)).toBe(80);
    expect(calculateOutstandingBalance(49.99, 10)).toBe(39.99);
    expect(calculateOutstandingBalance(20, 25)).toBe(0);
  });
});
`);

write('packages/database/migrations/20260805161000_fixed_booking_deposit_amount.sql', `-- Booking pages may calculate a deposit as either a percentage of the service
-- price or a fixed amount stored in the tenant currency's minor unit.

ALTER TABLE booking_pages
  ALTER COLUMN payment_settings
  SET DEFAULT '{"mode":"DEPOSIT","depositType":"PERCENTAGE","depositPercentage":20,"depositFixedAmount":1000,"promotionCodesEnabled":false,"giftCardsEnabled":false}'::jsonb;

UPDATE booking_pages
SET payment_settings = jsonb_set(
  jsonb_set(
    COALESCE(payment_settings, '{}'::jsonb),
    '{depositType}',
    to_jsonb((CASE WHEN payment_settings->>'depositType' = 'FIXED' THEN 'FIXED' ELSE 'PERCENTAGE' END)::text),
    true
  ),
  '{depositFixedAmount}',
  to_jsonb(CASE
    WHEN COALESCE(payment_settings->>'depositFixedAmount', '') ~ '^[0-9]+$'
      AND (payment_settings->>'depositFixedAmount')::numeric BETWEEN 1 AND 100000000
      THEN round((payment_settings->>'depositFixedAmount')::numeric)::integer
    ELSE 1000
  END),
  true
);

COMMENT ON COLUMN booking_pages.payment_settings IS
  'Public paid bookings use DEPOSIT or FULL. Deposits may be PERCENTAGE (1-99) or FIXED in tenant-currency minor units and are capped at the service total.';
`);

replaceRequired(
  'packages/database/src/manifest.ts',
  "  { filename: '20260805144500_allow_appointments_past_closing_time.sql', order: 67, description: 'Allow tenant-controlled appointment starts before closing when service duration or buffer extends beyond the schedule end' },\n];",
  "  { filename: '20260805144500_allow_appointments_past_closing_time.sql', order: 67, description: 'Allow tenant-controlled appointment starts before closing when service duration or buffer extends beyond the schedule end' },\n  { filename: '20260805161000_fixed_booking_deposit_amount.sql', order: 68, description: 'Allow booking deposits to use either a percentage or a tenant-currency fixed amount capped at the service total' },\n];",
  'fixed deposit migration manifest entry',
);

for (const path of [
  'scripts/apply-fixed-deposit-option.mjs',
  '.github/workflows/agent-fixed-deposit.yml',
]) {
  const target = join(root, path);
  if (existsSync(target)) rmSync(target);
}
