import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useModalDialog } from './useModalDialog';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useModalDialog<HTMLDivElement>(open, () => setOpen(false));

  return <>
    <button onClick={() => setOpen(true)}>Open dialog</button>
    {open && <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Example dialog" tabIndex={-1}>
      <button onClick={() => setOpen(false)}>Close dialog</button>
      <input aria-label="Dialog field" />
    </div>}
  </>;
}

describe('useModalDialog', () => {
  it('locks background scrolling, traps keyboard focus, and restores the trigger', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab({ shift: true });
    expect(screen.getByLabelText('Dialog field')).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });
});
