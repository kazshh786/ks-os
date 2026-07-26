import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ override: true });

const EnvSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DEV_AUTH_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),
  FORM_ASSIGNMENT_EXPIRY_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  FORM_DRAFT_EXPIRY_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  FORM_UPLOAD_BUCKET: z.string().regex(/^[a-z0-9-]{3,63}$/).default('form-uploads'),
  FORM_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(10_485_760),
  FORM_UPLOAD_SCAN_WEBHOOK: z.string().url().optional(),
  BOOKING_SLOT_HOLD_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  BOOKING_RATE_LIMIT_SALT: z.string().min(32).optional(),
  CUSTOMER_CLAIM_EXPIRY_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_STATUS_CALLBACK_URL: z.string().url().optional(),
  TWILIO_INBOUND_WEBHOOK_URL: z.string().url().optional(),
  SMS_DEFAULT_COUNTRY: z.string().default('GB'),
  SMS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  SMS_DEFAULT_VALIDITY_SECONDS: z.coerce.number().int().min(1).max(36000).default(3600),
  SMS_DAILY_SPEND_LIMIT_MINOR: z.coerce.number().int().nonnegative().optional(),
  SMS_WORKER_SECRET: z.string().min(32).optional(),
  PUBLIC_APP_ORIGIN: z.string().url().optional()
  ,FRONTEND_ORIGIN: z.string().url().optional()
  ,TRUST_PROXY: z.enum(['true','false']).default('false').transform(v=>v==='true')
  ,PRIVACY_WORKER_SECRET: z.string().min(32).optional()
  ,RELEASE_VERSION: z.string().max(120).default('development')
  ,LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')
  ,SUPABASE_URL: z.string().url().optional()
  ,SUPABASE_PUBLISHABLE_KEY: z.string().optional()
  ,SUPABASE_SERVICE_ROLE_KEY: z.string().optional()
  ,SUPABASE_SECRET_KEY: z.string().optional()
  ,TENANT_INVITE_REDIRECT_URL: z.string().url().optional()
  ,TENANT_PASSWORD_RESET_REDIRECT_URL: z.string().url().optional()
  ,AGENCY_PASSWORD_RESET_REDIRECT_URL: z.string().url().optional()
  ,CUSTOMER_PASSWORD_RESET_REDIRECT_URL: z.string().url().optional()
  ,TENANT_SESSION_HARD_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24)
  ,CUSTOMER_SESSION_HARD_TTL_HOURS: z.coerce.number().int().min(1).max(2160).default(720)
  ,INTEGRATION_ENCRYPTION_KEY: z.string().optional()
  ,INTEGRATION_WORKER_SECRET: z.string().min(32).optional()
  ,GOOGLE_CALENDAR_CLIENT_ID: z.string().optional()
  ,GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional()
  ,GOOGLE_CALENDAR_REDIRECT_URI: z.string().url().optional()
  ,MICROSOFT_CALENDAR_CLIENT_ID: z.string().optional()
  ,MICROSOFT_CALENDAR_CLIENT_SECRET: z.string().optional()
  ,MICROSOFT_CALENDAR_REDIRECT_URI: z.string().url().optional()
  ,XERO_CLIENT_ID: z.string().optional()
  ,XERO_CLIENT_SECRET: z.string().optional()
  ,XERO_REDIRECT_URI: z.string().url().optional()
  ,QUICKBOOKS_CLIENT_ID: z.string().optional()
  ,QUICKBOOKS_CLIENT_SECRET: z.string().optional()
  ,QUICKBOOKS_REDIRECT_URI: z.string().url().optional()
  ,PUBLIC_API_ENABLED: z.enum(['true','false']).default('true').transform(v=>v==='true')
  ,WIDGET_PUBLIC_URL: z.string().url().optional()
  ,WIDGET_ALLOWED_ORIGINS: z.string().default('')
  ,STRIPE_TERMINAL_ENABLED: z.enum(['true','false']).default('false').transform(v=>v==='true')
  ,REVIEW_INVITATION_TOKEN_SECRET: z.string().min(32).optional()
  ,GOOGLE_BUSINESS_PROFILE_CLIENT_ID: z.string().optional()
  ,GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET: z.string().optional()
  ,GOOGLE_BUSINESS_PROFILE_REDIRECT_URI: z.string().url().optional()
  ,GOCARDLESS_ENVIRONMENT: z.enum(['sandbox','live']).default('sandbox')
  ,GOCARDLESS_ACCESS_TOKEN: z.string().optional()
  ,GOCARDLESS_WEBHOOK_SECRET: z.string().min(16).optional()
  ,AGENCY_INVITE_REDIRECT_URL: z.string().url().optional()
  ,AUDIT_IP_HASH_SECRET: z.string().min(32).optional()
  ,AGENCY_WORKER_SECRET: z.string().min(32).optional()
  ,EMAIL_FROM_DOMAIN: z.string().default('notify.kasimshah.com')
  ,EMAIL_AUTH_FROM: z.string().email().optional()
  ,EMAIL_BOOKINGS_FROM: z.string().email().optional()
  ,EMAIL_PAYMENTS_FROM: z.string().email().optional()
  ,EMAIL_FORMS_FROM: z.string().email().optional()
  ,EMAIL_SUPPORT_REPLY_TO: z.string().email().optional()
  ,RESEND_API_KEY: z.string().optional()
  ,RESEND_WEBHOOK_SECRET: z.string().optional()
  ,SITE_REVIEW_INVITATION_SECRET: z.string().min(32).optional()
  ,SITE_PREVIEW_TOKEN_SECRET: z.string().min(32).optional()
  ,PUBLIC_SITES_PREVIEW_ORIGIN: z.string().url().optional()
  ,FACT_FINDING_INVITATION_SECRET: z.string().min(32).optional()
  ,FACT_FINDING_CLIENT_ORIGIN: z.string().url().optional()
  ,FACT_FINDING_STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/).default('private-fact-finding')
}).superRefine((value, ctx) => {
  const domain = value.EMAIL_FROM_DOMAIN?.toLowerCase();
  if (!domain) return;
  for (const key of ['EMAIL_AUTH_FROM','EMAIL_BOOKINGS_FROM','EMAIL_PAYMENTS_FROM','EMAIL_FORMS_FROM'] as const) {
    const address = value[key];
    if (address && !address.toLowerCase().endsWith(`@${domain}`)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} must use the verified email domain ${domain}` });
    }
  }
  if(value.NODE_ENV==='production'){
    if(value.DEV_AUTH_ENABLED)ctx.addIssue({code:z.ZodIssueCode.custom,path:['DEV_AUTH_ENABLED'],message:'Development authentication cannot be enabled in production'});
    const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','AUDIT_IP_HASH_SECRET','PRIVACY_WORKER_SECRET','FRONTEND_ORIGIN','PUBLIC_APP_ORIGIN','INTEGRATION_ENCRYPTION_KEY','BOOKING_RATE_LIMIT_SALT','SITE_REVIEW_INVITATION_SECRET','SITE_PREVIEW_TOKEN_SECRET','PUBLIC_SITES_PREVIEW_ORIGIN','FACT_FINDING_INVITATION_SECRET','FACT_FINDING_CLIENT_ORIGIN'] as const;
    for(const key of required)if(!value[key])ctx.addIssue({code:z.ZodIssueCode.custom,path:[key],message:`${key} is required in production`});
    for(const key of ['SUPABASE_URL','FRONTEND_ORIGIN','PUBLIC_APP_ORIGIN','PUBLIC_SITES_PREVIEW_ORIGIN','FACT_FINDING_CLIENT_ORIGIN'] as const){const configured=value[key];if(configured&&!configured.startsWith('https://'))ctx.addIssue({code:z.ZodIssueCode.custom,path:[key],message:`${key} must use HTTPS in production`});}
    const raw=process.env.DATABASE_URL||'';if(!raw)ctx.addIssue({code:z.ZodIssueCode.custom,path:['DATABASE_URL'],message:'DATABASE_URL is required in production'});
    const placeholders=/your-|example\.com|generate-|\[YOUR-|\.\.\./i;for(const key of required){const configured=value[key];if(typeof configured==='string'&&placeholders.test(configured))ctx.addIssue({code:z.ZodIssueCode.custom,path:[key],message:`${key} contains a placeholder value`});}
  }
});

export const env = EnvSchema.parse(process.env);
