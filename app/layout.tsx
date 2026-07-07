import React from 'react';
import './globals.css';

export const metadata = {
  title: 'Lean Salon Growth OS',
  description: 'Enterprise Booking, POS, CRM, and Loyalty Ledger for local clinics and salon groups.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
