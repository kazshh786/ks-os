import twilio from 'twilio';
import { env } from '../config/env.js';
export const isSmsConfigured = () => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_MESSAGING_SERVICE_SID && env.TWILIO_STATUS_CALLBACK_URL && ((env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) || env.TWILIO_AUTH_TOKEN));
export function getTwilioClient() {
  if (!isSmsConfigured()) throw new Error('SMS_NOT_CONFIGURED');
  return env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET ? twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, { accountSid: env.TWILIO_ACCOUNT_SID }) : twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}
export const validateTwilioSignature = (signature: string | undefined, url: string, params: Record<string,string>) => Boolean(signature && env.TWILIO_AUTH_TOKEN && twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params));
