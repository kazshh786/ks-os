import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { env } from '../../config/env.js';
export function normalizeSmsPhone(input: string, country = env.SMS_DEFAULT_COUNTRY as CountryCode) {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  if (!parsed?.isValid()) throw new Error('SMS_RECIPIENT_INVALID');
  if (country === 'GB' && parsed.country === 'GB' && parsed.getType() !== 'MOBILE') throw new Error('SMS_RECIPIENT_INVALID');
  return parsed.number;
}
export const maskPhone = (phone: string) => `${phone.slice(0, 3)} •••• ••• ${phone.slice(-3)}`;
