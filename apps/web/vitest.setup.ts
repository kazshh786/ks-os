import '@testing-library/jest-dom';
import { vi } from 'vitest';

if (!process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
}
if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'mock-pub-key-for-vitest';
}

Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => '12345678-1234-1234-1234-123456789abc'
  }
});
