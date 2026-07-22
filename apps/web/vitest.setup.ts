import '@testing-library/jest-dom';
import { vi } from 'vitest';

Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => '12345678-1234-1234-1234-123456789abc'
  }
});
