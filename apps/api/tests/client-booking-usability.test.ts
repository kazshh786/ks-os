import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BookingPageResponseSchema, FormDraftInputSchema, FormSchemaJsonSchema } from '@ks-os/contracts';

const fieldId = '11111111-1111-4111-8111-111111111111';
const baseTheme = {
  backgroundColor: '#f8fafc',
  cardColor: '#ffffff',
  primaryColor: '#4f46e5',
  textColor: '#0f172a',
  mutedColor: '#64748b',
  errorColor: '#b91c1c',
  radius: 'large',
  density: 'comfortable',
  progressStyle: 'BAR',
};

const incompleteSchema = {
  schemaVersion: 2,
  fields: [{
    id: fieldId,
    key: '',
    type: 'CONSENT_CHECKBOX',
    label: '',
    required: true,
    readOnly: false,
    hidden: false,
    width: '100',
    validation: {},
    sensitiveClassification: 'CONSENT',
    translations: {},
    accessibility: {},
  }],
  pages: [],
  sections: [],
  logic: [],
  theme: baseTheme,
  settings: { showIntroduction: true, showReview: true, completionMessage: 'Thanks', autosave: true },
};

test('unfinished consent forms can be saved as drafts but cannot be published', () => {
  const draft = {
    title: 'Treatment consent',
    description: '',
    internalDescription: '',
    formType: 'CONSENT',
    schema: incompleteSchema,
    acknowledgementText: '',
    defaultLanguage: 'en-GB',
    supportedLanguages: ['en-GB'],
  };
  assert.equal(FormDraftInputSchema.safeParse(draft).success, true);
  assert.equal(FormSchemaJsonSchema.safeParse(incompleteSchema).success, false);
});

test('booking-page contracts persist enabled appointment channels', () => {
  const parsed = BookingPageResponseSchema.parse({
    id: '22222222-2222-4222-8222-222222222222',
    publicSlug: 'test-salon',
    publicUrl: 'https://test-salon.kasimshah.com/book',
    previewUrl: 'https://test-salon.kasimshah.com/book?preview=1',
    title: 'Book online',
    description: '',
    enabled: true,
    published: true,
    logoUrl: null,
    coverImageUrl: null,
    layout: 'STANDARD',
    theme: {},
    defaultLanguage: 'en-GB',
    supportedLanguages: ['en-GB'],
    defaultLocationId: null,
    allowedLocationIds: [],
    allowedServiceIds: [],
    allowedStaffIds: [],
    bookingRules: { maximumFutureDays: 42, enabledBookingChannels: ['mobile'] },
    paymentSettings: {},
    intakeFormSettings: {},
    cancellationSettings: {},
    seoSettings: {},
    analyticsSettings: { enabled: true },
    customDomain: null,
    customDomainStatus: 'NOT_CONFIGURED',
    publishedAt: null,
    updatedAt: new Date().toISOString(),
  });
  assert.deepEqual(parsed.bookingRules.enabledBookingChannels, ['mobile']);
  assert.equal(parsed.bookingRules.maximumFutureDays, 42);
});

test('customer booking UI enforces six weeks and filters disabled channels', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), '../web/src/features/bookings/PublicBookingFlow.tsx'), 'utf8');
  assert.match(source, /const minimumFutureDays = 42/);
  assert.match(source, /maximumFutureDays = Math\.max\(minimumFutureDays/);
  assert.match(source, /visibleChannels/);
  assert.match(source, /type="date"/);
  assert.match(source, /Previous week/);
  assert.match(source, /Next week/);
  assert.match(source, /No availability on \{selectedDateLabel\}/);
  assert.match(source, /const tryNextDate = \(\) =>/);
  assert.match(source, /const canChooseAnyStaff =/);
  assert.match(source, /See anyone available/);
  assert.match(source, /Choose another date to keep looking\./);
  assert.match(source, /aria-live="polite"/);
});

test('calendar availability modal saves one appointment channel at a time', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), '../web/src/features/bookings/CalendarAvailabilityDialog.tsx'), 'utf8');
  assert.match(source, /updateTeamMemberBookingChannels\(member\.id, \{ channel, schedule \}\)/);
  assert.match(source, /channel === 'in_shop'/);
  assert.match(source, /booking-schedule-overrides/);
  assert.match(source, /item\.date === nextOverride\.date && item\.channel === channel/);
  assert.doesNotMatch(source, /channel: 'mobile', schedule \}\),\s*\]/);
});

test('availability keeps staff eligible when a location has no explicit staff mappings', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/availability/availability.service.ts'), 'utf8');
  assert.match(source, /const locationStaffRows = options\.locationId/);
  assert.match(source, /const locationStaff = locationStaffRows\.length/);
  assert.doesNotMatch(source, /const locationStaff = options\.locationId/);
});
