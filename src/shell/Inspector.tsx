// Inspector — the shared right slide-in panel primitive (DESIGN.md §5).
//
// A portal-rendered, aria-modal dialog: desktop is a 520px right slide-in with a
// square left edge, shadow-float, and a scrim; ≤768px it becomes a full-width
// sheet. Escape, the scrim, and the ✕ button all close it. Focus moves into the
// panel on open and the page scroll is locked while it's up. Motion is a 200ms
// slide, suppressed under prefers-reduced-motion via the global reset.
//
// This is the one overlay-detail shell in the app: the Home artifact cards, the
// Contacts detail panel, and (optionally) the Inbox context all converge here.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Inspector.module.css';

export interface InspectorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Desktop panel width; defaults to 520px per §5. Ignored ≤768px (full-width).
  width?: number;
}

const CloseIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export default function Inspector({
  open,
  onClose,
  title,
  children,
  width = 520,
}: InspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; move focus into the panel on open; lock the body scroll while
  // the panel owns the surface.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            {CloseIcon}
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
