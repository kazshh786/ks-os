import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/features/bookings/PublicBookingFlow.tsx';
const before = readFileSync(path, 'utf8');
let source = before;

source = source.replace(
  /  const quotedPrice = slot\?\.price \?\? service\?\.price \?\? 0;\n  const amountDueNow = effectivePaymentMode === 'deposit_required'[\s\S]*?  const depositChoiceLabel = depositType === 'FIXED' \? currency\(amountDueNow\) : String\(depositPercentage\) \+ '%';\n/,
  `  const quotedPrice = slot?.price ?? service?.price ?? 0;
  const depositAmount = calculateDepositAmount(quotedPrice, page?.paymentSettings || {});
  const amountDueNow = effectivePaymentMode === 'deposit_required'
    ? depositAmount
    : effectivePaymentMode === 'pay_now' ? quotedPrice : 0;
  const currency = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: tenant.currency }).format(amount / 100);
  const depositChoiceLabel = depositType === 'FIXED' ? currency(depositAmount) : String(depositPercentage) + '%';
`,
);
source = source.replace(
  '{amountDueNow > 0 && <ChoiceCard',
  '{depositAmount > 0 && <ChoiceCard',
);

if (source === before) throw new Error('The public booking fixed-deposit follow-up patch did not apply.');
writeFileSync(path, source);
