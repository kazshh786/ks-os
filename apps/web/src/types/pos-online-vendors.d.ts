declare module '@stripe/stripe-js' {
  export type Stripe = unknown;

  export function loadStripe(
    publishableKey: string,
    options?: { stripeAccount?: string },
  ): Promise<Stripe | null>;
}

declare module '@stripe/react-stripe-js' {
  import type { ComponentType, ReactNode } from 'react';

  export const EmbeddedCheckout: ComponentType;
  export const EmbeddedCheckoutProvider: ComponentType<{
    stripe: Promise<unknown | null> | unknown | null;
    options: { clientSecret: string };
    children?: ReactNode;
  }>;
}

declare module 'qrcode' {
  type QrOptions = {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  };

  const QRCode: {
    toDataURL(value: string, options?: QrOptions): Promise<string>;
  };

  export default QRCode;
}
