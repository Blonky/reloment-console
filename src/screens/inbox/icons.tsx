// Inline 16px icons, stroke 1.5 — the console ships no icon pack (DESIGN.md §7).
// Screen-private to the Inbox. Currentcolor so callers control the tone.

interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function CheckIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

// Up-arrow — the composer's circular accent send glyph (iMessage family).
export function ArrowUpIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export function PencilIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// Sparkle — the conversation-brief affordance (summary + ask-the-thread).
export function SparkleIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
      <path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </svg>
  );
}

// Plus — the composer's circular menu trigger (attach / send a link).
export function PlusIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

// Document — request a document (dec page, license, damage photos).
export function DocumentIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

// Calendar — send a booking link.
export function CalendarIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}

// Card — send a payment link.
export function CardIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </svg>
  );
}

// Link glyph — the rich link-preview card's small corner mark.
export function LinkIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 15l6-6" />
      <path d="M11 6l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13 18l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </svg>
  );
}

// Chevron-right — the "Request a document ▸" submenu affordance.
export function ChevronRightIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
