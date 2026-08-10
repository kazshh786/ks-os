import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('V2 components have deterministic mobile collapse, touch targets and safe media behavior', async () => {
  const [baseCss, libraryCss] = await Promise.all([
    readFile(new URL('../public/site.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/design-library.css', import.meta.url), 'utf8'),
  ]);
  assert.match(baseCss, /@media \(max-width: 52rem\)/);
  assert.match(baseCss, /min-height:\s*2\.75rem/);
  assert.match(baseCss, /\.desktop-navigation\s*,\s*\n\s*\.header-booking\s*\{\s*\n\s*display:\s*none/);
  assert.match(baseCss, /\.mobile-navigation\s*\{\s*\n\s*display:\s*block/);
  assert.match(baseCss, /\.mobile-navigation-children/);
  assert.match(libraryCss, /@media \(max-width: 768px\)/);
  assert.match(libraryCss, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(libraryCss, /object-fit:\s*var\(--site-image-fit/);
  assert.match(libraryCss, /overflow-x:\s*auto/);
  assert.match(libraryCss, /prefers-reduced-motion:\s*reduce/);
});
