import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focus trap, Escape handling and opener restoration for modal dialogs. */
export function useAccessibleDialog(isOpen: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Capture before React commits children with `autoFocus`.
  if (isOpen && !wasOpenRef.current && typeof document !== 'undefined') {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = isOpen;

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog?.contains(document.activeElement)) {
        dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      const opener = openerRef.current;
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, [isOpen]);

  return dialogRef;
}
