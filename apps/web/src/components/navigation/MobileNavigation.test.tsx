import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from './MobileNavigation';

describe('MobileNavigation', () => {
  it('locks page scrolling, layers above calendar chrome, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    const triggerRef = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    const { rerender } = render(<><button ref={triggerRef}>Open menu</button><MobileNavigation open title="Business navigation" onClose={onClose} triggerRef={triggerRef}><nav><a href="/app/calendar">Calendar</a><button>Last action</button></nav></MobileNavigation></>);
    const dialog = screen.getByRole('dialog', { name: 'Business navigation' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('z-[200]');
    expect(dialog).toHaveAttribute('data-mobile-navigation-layer');
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<><button ref={triggerRef}>Open menu</button><MobileNavigation open={false} title="Business navigation" onClose={onClose} triggerRef={triggerRef}><nav /></MobileNavigation></>);
    expect(document.body.style.overflow).toBe('');
    expect(triggerRef.current).toHaveFocus();
  });

  it('wraps focus inside the drawer', async () => {
    const user = userEvent.setup();
    const triggerRef = createRef<HTMLButtonElement>();
    render(<><button ref={triggerRef}>Open menu</button><MobileNavigation open title="Agency navigation" onClose={() => undefined} triggerRef={triggerRef}><nav><a href="/agency/overview">Overview</a><button>Last action</button></nav></MobileNavigation></>);
    const lastAction = screen.getByRole('button', { name: 'Last action' });
    lastAction.focus();
    await user.tab();
    expect(screen.getAllByRole('button', { name: 'Close navigation' })[1]).toHaveFocus();
  });
});
