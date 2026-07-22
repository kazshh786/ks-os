import { Resend } from 'resend';

let resendInstance: Resend | null = null;

export const getResend = (): Resend => {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is missing');
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
};
