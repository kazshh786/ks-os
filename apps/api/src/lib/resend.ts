import { Resend } from 'resend';
import { randomUUID } from 'node:crypto';

let resendInstance: any = null;

export const getResend = (): any => {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === 'fake' || apiKey === 'mock' || process.env.NODE_ENV === 'test') {
      resendInstance = {
        emails: {
          send: async (_payload: any, _options?: any) => {
            if (process.env.SIMULATE_RESEND_FAILURE === 'terminal') {
              return { data: null, error: { name: 'INVALID_RECIPIENT', message: 'Invalid recipient address' } };
            }
            if (process.env.SIMULATE_RESEND_FAILURE === 'temporary') {
              return { data: null, error: { name: 'RATE_LIMIT_EXCEEDED', message: 'Temporary rate limit' } };
            }
            return { data: { id: `msg_fake_${randomUUID()}` }, error: null };
          },
        },
      };
    } else {
      resendInstance = new Resend(apiKey);
    }
  }
  return resendInstance;
};

export const setMockResend = (mock: any) => {
  resendInstance = mock;
};
