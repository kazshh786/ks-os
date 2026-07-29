import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSectionVariant } from '../src/native-design-finalization.js';

test('native design presets choose purposeful component variations', () => {
  assert.equal(nativeSectionVariant('LUXURY', 'HERO'), 'split');
  assert.equal(nativeSectionVariant('LUXURY', 'FEATURED_SERVICES'), 'editorial');
  assert.equal(nativeSectionVariant('MODERN', 'SERVICE_GRID'), 'grid');
  assert.equal(nativeSectionVariant('MODERN', 'FAQ'), 'compact');
  assert.equal(nativeSectionVariant('BOLD', 'HERO'), 'featured');
  assert.equal(nativeSectionVariant('WELLNESS', 'BOOKING_CTA'), 'featured');
});

test('native design preserves the selected fallback for neutral sections', () => {
  assert.equal(nativeSectionVariant('NORTHLIGHT', 'INTRODUCTION', 'quiet'), 'quiet');
  assert.equal(nativeSectionVariant('CLINICAL', 'HEADER', 'compact'), 'standard');
});
