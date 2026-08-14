import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface MobileNavigationProps {
  open: boolean;
  title: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}

const focusableSelector = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const MobileNavigation: React.FC<MobileNavigationProps> = ({ open, title, onClose, triggerRef, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const focusables = Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusables[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, onClose, triggerRef]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" aria-label="Close navigation" onClick={onClose} className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
    <div ref={panelRef} className="relative h-dvh w-[min(90vw,320px)] pt-[env(safe-area-inset-top)] shadow-2xl">
      <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 grid h-11 w-11 place-items-center rounded-xl bg-slate-800 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><X aria-hidden="true" className="h-5 w-5" /></button>
      {children}
    </div>
  </div>;
};
