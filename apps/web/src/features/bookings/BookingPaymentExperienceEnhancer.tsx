import { useEffect } from 'react';
import { calculateOutstandingBalance } from './booking-payment-policy.js';

function parseDisplayedMoney(value: string): number | null {
  const cleaned = value.replace(/[^0-9,.-]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDisplayedMoney(source: string, amount: number): string {
  const prefix = source.match(/^[^0-9-]*/)?.[0] || '';
  const suffix = source.match(/[^0-9]*$/)?.[0] || '';
  return prefix + amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
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
