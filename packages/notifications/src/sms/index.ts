export type SmsTemplateKey =
  | 'booking-confirmed' | 'booking-rescheduled' | 'booking-cancelled'
  | 'appointment-reminder' | 'form-assigned' | 'form-reminder'
  | 'payment-confirmed' | 'refund-updated' | 'review-invitation';

export type SmsTemplateData = {
  salonName: string;
  appointmentDateTime?: string;
  formTitle?: string;
  secureUrl?: string;
  contactPhone?: string;
  paymentImpact?: string;
};

const clean = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const link = (data: SmsTemplateData) => data.secureUrl ? ` ${data.secureUrl}` : '';

const templates: Record<SmsTemplateKey, (data: SmsTemplateData) => string> = {
  'booking-confirmed': d => `Your appointment is confirmed${d.appointmentDateTime ? ` for ${d.appointmentDateTime}` : ''}.${link(d)}`,
  'booking-rescheduled': d => `Your appointment has been moved${d.appointmentDateTime ? ` to ${d.appointmentDateTime}` : ''}.${link(d)}`,
  'booking-cancelled': d => `Your appointment${d.appointmentDateTime ? ` on ${d.appointmentDateTime}` : ''} has been cancelled.${d.paymentImpact ? ` ${d.paymentImpact}` : ''}${d.contactPhone ? ` Contact: ${d.contactPhone}.` : ''}${link(d)}`,
  'appointment-reminder': d => `Reminder: your appointment is ${d.appointmentDateTime ?? 'coming up'}.${link(d)}`,
  'form-assigned': d => `Please complete ${d.formTitle ? `${d.formTitle}:` : 'your form:'}${link(d)}`,
  'form-reminder': d => `Reminder: please complete ${d.formTitle ? `${d.formTitle}:` : 'your form:'}${link(d)}`,
  'payment-confirmed': d => `Your payment has been confirmed.${link(d)}`,
  'refund-updated': d => `Your refund status has been updated.${link(d)}`,
  'review-invitation': d => `We'd value your honest feedback about your experience.${link(d)} There is no obligation to leave a review.`,
};

const GSM_BASIC = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ]*$/;

export function analyseSms(body: string) {
  const encoding = GSM_BASIC.test(body) ? 'GSM-7' as const : 'UCS-2' as const;
  const single = encoding === 'GSM-7' ? 160 : 70;
  const concat = encoding === 'GSM-7' ? 153 : 67;
  const characterCount = [...body].length;
  return { encoding, characterCount, segmentCount: characterCount <= single ? 1 : Math.ceil(characterCount / concat) };
}

export function renderSms(key: SmsTemplateKey, data: SmsTemplateData, maxSegments = 2) {
  const renderer = templates[key];
  if (!renderer) throw new Error('SMS_TEMPLATE_NOT_FOUND');
  const body = clean(`${data.salonName} via KS OS: ${renderer(data)} Reply STOP to opt out.`);
  const analysis = analyseSms(body);
  if (analysis.segmentCount > maxSegments) throw new Error('SMS_TEMPLATE_TOO_LONG');
  return { body, ...analysis };
}
