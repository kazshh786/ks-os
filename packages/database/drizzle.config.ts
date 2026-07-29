import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/schema.ts',
    './src/design-library-schema.ts',
    './src/booking-schedule-overrides.ts',
  ],
  out: './migrations',
  dialect: 'postgresql',
});
