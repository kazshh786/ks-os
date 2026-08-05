import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-fixed-deposit-option.mjs';
const before = readFileSync(path, 'utf8');
let source = before;

source = source.replace(
  "  const depositChoiceLabel = depositType === 'FIXED' ? currency(amountDueNow) : `${depositPercentage}%`;`,",
  "  const depositChoiceLabel = depositType === 'FIXED' ? currency(amountDueNow) : String(depositPercentage) + '%';`,",
);
source = source.replace(
  "ariaLabel={\\`Pay a ${depositChoiceLabel} deposit\\`}",
  "ariaLabel={'Pay a ' + depositChoiceLabel + ' deposit'}",
);
source = source.replace(
  "  return `${prefix}${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;",
  "  return prefix + amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;",
);

if (source === before) throw new Error('The fixed-deposit implementation script did not need or accept the expected syntax repair.');
writeFileSync(path, source);
