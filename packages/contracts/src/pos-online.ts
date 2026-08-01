import { z } from 'zod';

export const PosOnlinePaymentPresentationSchema = z.enum(['EMBEDDED', 'HOSTED']);
export type PosOnlinePaymentPresentation = z.infer<typeof PosOnlinePaymentPresentationSchema>;
