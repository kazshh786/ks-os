#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const emailModulePath = path.resolve(process.cwd(), 'packages/email/dist/index.js');
const futureIso = '2026-08-10T10:00:00.000Z';
const expiryIso = '2026-08-11T10:00:00.000Z';
const secureUrl = 'https://app.kasimshah.com/example';

const probes = [
  ['booking-confirmed', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', bookingTime: '11:00', bookingDate: '10 August 2026', serviceName: 'Consultation' }],
  ['booking-rescheduled', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', serviceName: 'Consultation', newDateTime: '10 August 2026 at 11:00' }],
  ['booking-cancelled', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', serviceName: 'Consultation' }],
  ['appointment-reminder', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', bookingTime: '11:00', bookingDate: '10 August 2026', serviceName: 'Consultation' }],
  ['payment-confirmed', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', clientName: 'Test Customer', amount: '25.00', currency: 'GBP' }],
  ['refund-updated', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', clientName: 'Test Customer', status: 'SUCCEEDED' }],
  ['form-assigned', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', formName: 'Consultation form', formLink: secureUrl }],
  ['form-reminder', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', formName: 'Consultation form', formLink: secureUrl }],
  ['staff-operational-notification', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', staffName: 'Deployment check', message: 'Email renderer runtime check.' }],
  ['scheduled-report-ready', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', reportName: 'Daily report', reportType: 'BOOKINGS', downloadPageUrl: secureUrl, expiresAt: expiryIso }],
  ['review-invitation', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', message: 'Thank you for visiting.', appointmentDate: '10 August 2026', reviewUrl: secureUrl, reviewProvider: 'GOOGLE' }],
  ['customer-portal-claim', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', customerName: 'Test Customer', claimUrl: secureUrl, bookingManagementUrl: secureUrl }],
  ['account-access-invitation', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', recipientName: 'Test User', accessLabel: 'KS OS workspace', invitationUrl: secureUrl }],
  ['site-review-invitation', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', participantName: 'Test Reviewer', reviewUrl: secureUrl, expiresAt: expiryIso }],
  ['site-review-notification', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', participantName: 'Test Reviewer', heading: 'Website review update', message: 'A review update is available.', reviewUrl: secureUrl }],
  ['fact-finding-invitation', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', participantName: 'Test Participant', questionnaireUrl: secureUrl, expiresAt: expiryIso }],
  ['fact-finding-notification', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', participantName: 'Test Participant', questionnaireUrl: secureUrl, heading: 'Questionnaire update', message: 'Additional information is required.', expiresAt: expiryIso }],
  ['business-booking-confirmed', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', recipientName: 'Owner', customerName: 'Test Customer', serviceName: 'Consultation', bookingDate: '10 August 2026', bookingTime: '11:00', emailBody: 'A booking has been confirmed.' }],
  ['business-payment-received', { tenantName: 'KS OS', tenantPrimaryColor: '#0f172a', recipientName: 'Owner', customerName: 'Test Customer', serviceName: 'Consultation', amount: '25.00', currency: 'GBP', emailBody: 'A payment has been received.' }],
];

async function renderAll(cacheKey = 'initial') {
  const moduleUrl = `${pathToFileURL(emailModulePath).href}?runtime-check=${encodeURIComponent(cacheKey)}`;
  const { renderEmail } = await import(moduleUrl);
  for (const [templateKey, data] of probes) {
    const rendered = await renderEmail(templateKey, data);
    if (!rendered.html?.trim() || !rendered.text?.trim()) {
      throw new Error(`EMAIL_RENDERER_OUTPUT_INVALID:${templateKey}`);
    }
  }
}

try {
  await renderAll();
  console.log(`✓ Email renderer runtime check passed for all ${probes.length} templates`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const dependencyFailure = /Cannot find package ['\"]react-dom['\"]|ERR_MODULE_NOT_FOUND/i.test(message);
  if (!dependencyFailure) throw error;

  console.warn('Email renderer dependency tree is incomplete; forcing a frozen pnpm reinstall.');
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--force'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  execFileSync('pnpm', ['--filter', '@ks-os/email', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  await renderAll(`repaired-${Date.now()}`);
  console.log(`✓ Email renderer dependency tree repaired and all ${probes.length} templates verified`);
}
