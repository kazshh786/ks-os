import twilio from 'twilio';
import { env } from '../config/env.js';
import { randomUUID } from 'node:crypto';

let mockTwilioClient: any = null;

export const setMockTwilioClient = (mock: any) => {
  mockTwilioClient = mock;
};

export const isSmsConfigured = () => {
  if (mockTwilioClient || process.env.TWILIO_FAKE_MODE === 'true' || process.env.NODE_ENV === 'test') return true;
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_MESSAGING_SERVICE_SID && env.TWILIO_STATUS_CALLBACK_URL && ((env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) || env.TWILIO_AUTH_TOKEN));
};

export function getTwilioClient(): any {
  if (mockTwilioClient) return mockTwilioClient;
  if (!isSmsConfigured()) throw new Error('SMS_NOT_CONFIGURED');
  if (process.env.TWILIO_FAKE_MODE === 'true' || process.env.NODE_ENV === 'test' || env.TWILIO_ACCOUNT_SID === 'fake') {
    return {
      messages: {
        create: async (params: any) => {
          if (process.env.SIMULATE_TWILIO_FAILURE === 'terminal') {
            const err = new Error('SMS_RECIPIENT_INVALID');
            (err as any).code = '21211';
            throw err;
          }
          if (process.env.SIMULATE_TWILIO_FAILURE === 'temporary') {
            const err = new Error('TEMPORARY_PROVIDER_FAILURE');
            (err as any).code = '50000';
            throw err;
          }
          return { sid: `SM_fake_${randomUUID()}`, status: 'queued', to: params.to, body: params.body };
        },
      },
    };
  }
  return env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET ? twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, { accountSid: env.TWILIO_ACCOUNT_SID }) : twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

export const validateTwilioSignature = (signature: string | undefined, url: string, params: Record<string,string>) => Boolean(signature && env.TWILIO_AUTH_TOKEN && twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params));
