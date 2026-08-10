import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SiteDesignTokensV2Schema } from '@ks-os/site-schema';
import { z } from 'zod';
import {
  renderSiteThemePresentation,
  SITE_DESIGN_TOKEN_V2_BINDINGS,
  SITE_DESIGN_TOKEN_V2_PATHS,
} from '../src/lib/design-tokens.js';

function leafPaths(schema: z.ZodTypeAny, prefix = ''): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, value]) =>
      leafPaths(value as z.ZodTypeAny, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

const designTokens = SiteDesignTokensV2Schema.parse({
  designVersion: 2,
  typography: {
    displayFont: 'EDITORIAL_SERIF', headingFont: 'SYSTEM_SERIF', bodyFont: 'SYSTEM_SANS',
    displayScale: 'DRAMATIC', headingScale: 'EXPRESSIVE', bodyScale: 'GENEROUS',
    headingWeight: 'SEMIBOLD', bodyWeight: 'REGULAR', displayTracking: 'TIGHT',
    headingTracking: 'NORMAL', headingLineHeight: 'TIGHT', bodyLineHeight: 'RELAXED',
  },
  layout: {
    containerWidths: 'EXPANSIVE_RANGE', pageGutter: 'GENEROUS', sectionSpacing: 'EXPANSIVE',
    contentSpacing: 'RELAXED', gridColumns: 'SIXTEEN', gridGap: 'GENEROUS', textMeasure: 'READABLE',
  },
  shape: { radiusScale: 'SOFT', cardRadius: 'LARGE', buttonRadius: 'PILL', imageRadius: 'MEDIUM' },
  surface: { background: '#f6f2ed', surface: '#ffffff', surfaceAlt: '#eee7df', border: '#cbc1b7', mutedSurface: '#e7ded5' },
  elevation: 'MEDIUM',
  buttons: { height: 'LARGE', padding: 'GENEROUS', weight: 'SEMIBOLD', primaryStyle: 'HIGH_CONTRAST', secondaryStyle: 'SOFT' },
  imagery: { defaultAspectRatio: 'FOUR_THREE', portraitAspectRatio: 'FOUR_FIVE', serviceAspectRatio: 'THREE_TWO', cropMode: 'COVER', focalBehaviour: 'ASSET_FOCAL_POINT', imageTreatment: 'EDITORIAL' },
  sectionRhythm: 'SOFT_LUXURY',
});

test('all 42 V2 design-token leaves have a live renderer and CSS binding', async () => {
  const schemaPaths = leafPaths(SiteDesignTokensV2Schema).sort();
  assert.equal(schemaPaths.length, 42);
  assert.deepEqual([...SITE_DESIGN_TOKEN_V2_PATHS].sort(), schemaPaths);

  const presentation = renderSiteThemePresentation({
    primaryColour: '#243329', secondaryColour: '#596f61', accentColour: '#a65f42',
    backgroundColour: '#f7f4ee', surfaceColour: '#ffffff', textColour: '#172025', mutedTextColour: '#5d6962', borderColour: '#d7ddd8',
    headingFontKey: 'SYSTEM_SERIF', bodyFontKey: 'SYSTEM_SANS', radiusScale: 'MEDIUM', spacingDensity: 'COMFORTABLE',
    containerWidth: 'STANDARD', buttonStyle: 'SOLID', imageStyle: 'ROUNDED', motionPreference: 'REDUCED', designTokens,
  });
  const css = `${await readFile(new URL('../public/site.css', import.meta.url), 'utf8')}\n${await readFile(new URL('../public/design-library.css', import.meta.url), 'utf8')}`;

  for (const binding of Object.values(SITE_DESIGN_TOKEN_V2_BINDINGS)) {
    if ('cssVariables' in binding) {
      for (const variable of binding.cssVariables) {
        assert.ok(presentation.style.includes(`${variable}:`), `${variable} was not emitted`);
        assert.ok(css.includes(`var(${variable}`), `${variable} was not consumed by CSS`);
      }
    }
    if ('attributes' in binding) {
      for (const attribute of binding.attributes) assert.ok(presentation.bodyAttributes.includes(attribute));
    }
  }
});
