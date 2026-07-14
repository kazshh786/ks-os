export const PAYMENT_MODES = ['no_payment','pay_later','deposit','full_payment','customer_choice'] as const;
export type PaymentMode = typeof PAYMENT_MODES[number];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === 'string' && (PAYMENT_MODES as readonly string[]).includes(value);
}

export function requiresPayment(mode: PaymentMode, payNow: boolean): boolean {
  return mode === 'deposit' || mode === 'full_payment' || (mode === 'customer_choice' && payNow);
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year,month,day] = date.split('-').map(Number);
  const [hour,minute] = time.split(':').map(Number);
  let guess = Date.UTC(year,month-1,day,hour,minute,0);
  for (let i=0;i<2;i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const represented = Date.UTC(values.year,values.month-1,values.day,values.hour,values.minute,values.second);
    guess -= represented - Date.UTC(year,month-1,day,hour,minute,0);
  }
  return new Date(guess);
}

export function publicError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
