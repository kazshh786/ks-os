import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarLayerPolish } from './CalendarLayerPolish.js';

describe('CalendarLayerPolish', () => {
  it('keeps toolbar popovers above the sticky dates and emphasises the active day', () => {
    render(<CalendarLayerPolish />);

    const styles = document.querySelector('[data-calendar-layer-polish]')?.textContent || '';

    expect(styles).toContain('.ks-calendar-workspace-frame > main > header');
    expect(styles).toContain('z-index: 70 !important');
    expect(styles).toContain('.ks-calendar-workspace-frame > main > header .absolute');
    expect(styles).toContain('z-index: 80 !important');
    expect(styles).toContain("[data-calendar-column-header='true']");
    expect(styles).toContain('z-index: 40 !important');
    expect(styles).toContain('header:has(.text-indigo-700)');
    expect(styles).toContain("[role='gridcell'][aria-selected='true']");
    expect(styles).toContain('background-color: #eef2ff !important');
  });
});
