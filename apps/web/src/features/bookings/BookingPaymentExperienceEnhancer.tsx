import { useEffect } from 'react';

export type CommitmentPaymentMode = 'DEPOSIT' | 'FULL';

export const DEFAULT_DEPOSIT_PERCENTAGE = 20;

export function normaliseCommitmentPaymentMode(value: string | null | undefined): CommitmentPaymentMode {
  return value === 'FULL' ? 'FULL' : 'DEPOSIT';
}

export function normaliseDepositPercentage(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 99
    ? Math.round(parsed)
    : DEFAULT_DEPOSIT_PERCENTAGE;
}

export function calculateOutstandingBalance(total: number, dueNow: number): number {
  return Math.max(0, Math.round((total - dueNow) * 100) / 100);
}

function setControlledValue(element: HTMLSelectElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function replaceLeadingLabelText(label: HTMLLabelElement, nextText: string) {
  const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
  if (textNode) {
    if (textNode.textContent !== nextText) textNode.textContent = nextText;
    return;
  }
  label.prepend(document.createTextNode(nextText));
}

function upsertHelper(label: HTMLLabelElement, key: string, text: string) {
  let helper = label.querySelector<HTMLSpanElement>(`[data-booking-payment-helper="${key}"]`);
  if (!helper) {
    helper = document.createElement('span');
    helper.dataset.bookingPaymentHelper = key;
    helper.className = 'mt-1 block text-xs font-normal leading-5 text-slate-500';
    label.append(helper);
  }
  if (helper.textContent !== text) helper.textContent = text;
}

function enhanceBookingPaymentSettings(root: ParentNode = document) {
  const sections = [...root.querySelectorAll<HTMLElement>('section')];
  const section = sections.find(item => item.querySelector('h2')?.textContent?.trim() === 'Booking and payment rules');
  if (!section) return;

  const paymentSelect = [...section.querySelectorAll<HTMLSelectElement>('select')]
    .find(select => [...select.options].some(option => option.value === 'DEPOSIT') && [...select.options].some(option => option.value === 'FULL'));
  if (!paymentSelect) return;

  const nextMode = normaliseCommitmentPaymentMode(paymentSelect.value);
  if (paymentSelect.value !== nextMode) setControlledValue(paymentSelect, nextMode);

  for (const option of [...paymentSelect.options]) {
    const supported = option.value === 'DEPOSIT' || option.value === 'FULL';
    option.hidden = !supported;
    option.disabled = !supported;
    const nextLabel = option.value === 'DEPOSIT'
      ? 'Deposit first'
      : option.value === 'FULL'
        ? 'Full payment upfront'
        : option.textContent;
    if (option.textContent !== nextLabel) option.textContent = nextLabel;
  }

  const paymentLabel = paymentSelect.closest('label');
  if (paymentLabel) {
    replaceLeadingLabelText(paymentLabel, 'Payment for paid services');
    upsertHelper(
      paymentLabel,
      'mode',
      'Free services skip payment automatically. Paid services must pay either a deposit or the full price through Stripe before the booking is confirmed.',
    );
  }

  const depositInput = [...section.querySelectorAll<HTMLInputElement>('input[type="number"]')]
    .find(input => input.closest('label')?.textContent?.toLowerCase().includes('deposit'));
  const depositLabel = depositInput?.closest('label');
  if (!depositInput || !depositLabel) return;

  const mode = normaliseCommitmentPaymentMode(paymentSelect.value);
  depositLabel.hidden = mode !== 'DEPOSIT';
  depositInput.min = '1';
  depositInput.max = '99';
  depositInput.step = '1';

  if (mode === 'DEPOSIT') {
    const percentage = normaliseDepositPercentage(depositInput.value);
    if (String(percentage) !== depositInput.value) setControlledValue(depositInput, String(percentage));
    replaceLeadingLabelText(depositLabel, 'Deposit percentage');
    upsertHelper(depositLabel, 'deposit', 'Customers pay this amount online. The remaining balance is due at the appointment.');
  }

  if (paymentSelect.dataset.commitmentPaymentListener !== 'true') {
    paymentSelect.dataset.commitmentPaymentListener = 'true';
    paymentSelect.addEventListener('change', () => queueMicrotask(() => enhanceBookingPaymentSettings(document)));
  }
}

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
    if (total === null || deposit === null || deposit <= 0 || deposit >= total) continue;

    let balanceRow = list.querySelector<HTMLElement>('[data-booking-balance-row="true"]');
    if (!balanceRow) {
      balanceRow = document.createElement('div');
      balanceRow.dataset.bookingBalanceRow = 'true';
      balanceRow.className = 'flex justify-between gap-4 bg-indigo-50 px-5 py-4';
      balanceRow.innerHTML = '<dt class="font-black text-slate-700">Balance due at appointment</dt><dd class="font-black text-slate-950"></dd>';
      depositRow.after(balanceRow);
    }
    const value = calculateOutstandingBalance(total, deposit);
    const nextValue = formatDisplayedMoney(totalText, value);
    const output = balanceRow.querySelector('dd');
    if (output && output.textContent !== nextValue) output.textContent = nextValue;
  }
}

export function BookingPaymentExperienceEnhancer() {
  useEffect(() => {
    const enhanceAll = () => {
      enhanceBookingPaymentSettings(document);
      enhanceDepositBalanceSummary(document);
    };

    enhanceAll();
    const observer = new MutationObserver(enhanceAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

export default BookingPaymentExperienceEnhancer;
