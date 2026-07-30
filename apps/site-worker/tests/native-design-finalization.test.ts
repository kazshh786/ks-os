import assert from 'node:assert/strict';
import test from 'node:test';
import { SITE_DESIGN_PRESETS } from '@ks-os/contracts';
import {
  mergeProvisionedThemeColours,
  nativeSectionVariant,
} from '../src/native-design-finalization.js';

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

test('native design applies accessible per-client palette overrides', () => {
  const base = SITE_DESIGN_PRESETS.find(item => item.key === 'NORTHLIGHT')!.theme;
  const result = mergeProvisionedThemeColours(base, {
    primaryColour: '#123B5D',
    accentColour: '#8A2E52',
  });
  assert.equal(result.theme.primaryColour, '#123B5D');
  assert.equal(result.theme.accentColour, '#8A2E52');
  assert.equal(result.overrideCount, 2);
});

test('native design blocks inaccessible per-client palette overrides', () => {
  const base = SITE_DESIGN_PRESETS.find(item => item.key === 'NORTHLIGHT')!.theme;
  assert.throws(
    () => mergeProvisionedThemeColours(base, {
      backgroundColour: '#FFFFFF',
      surfaceColour: '#FFFFFF',
      textColour: '#FFFFFF',
      mutedTextColour: '#FFFFFF',
    }),
    (error: unknown) => Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'CUSTOM_THEME_ACCESSIBILITY_BLOCKED'
    ),
  );
});
