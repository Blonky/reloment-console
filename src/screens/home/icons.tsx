// Inline 16px icons, stroke 1.5 — no icon pack (DESIGN.md §7). Drawn as needed
// for the command-channel reply-card headers and the composer.

interface IconProps {
  size?: number;
}

function svg(size: number, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconList({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6" r="0.5" />
      <circle cx="4" cy="12" r="0.5" />
      <circle cx="4" cy="18" r="0.5" />
    </>
  ));
}

export function IconEnroll({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </>
  ));
}

export function IconCampaign({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M3 11l18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ));
}

export function IconBrief({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>
  ));
}

export function IconSearch({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ));
}

export function IconPause({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="10" y1="9" x2="10" y2="15" />
      <line x1="14" y1="9" x2="14" y2="15" />
    </>
  ));
}

export function IconResume({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </>
  ));
}

export function IconHelp({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </>
  ));
}

export function IconPhone({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </>
  ));
}

// Missed call — a phone with a small "down/away" slash marker.
export function IconMissedCall({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M20.5 17.5v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 .62 3.79 2 2 0 0 1 2.61 1.6h2a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L6.09 9.51a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7a2 2 0 0 1 1.72 2z" />
      <path d="M23 1l-6 6M17 1l6 6" />
    </>
  ));
}

// Research / enrichment — a magnifier with a small spark (first-party dig).
export function IconResearch({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="10" cy="10" r="6" />
      <line x1="20.5" y1="20.5" x2="14.5" y2="14.5" />
      <path d="M10 6.5v7M6.5 10h7" />
    </>
  ));
}

// Navigate — an arrow leaving toward a corner (jump to a destination).
export function IconNavigate({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </>
  ));
}

// History — a clock, for the session rail's chat log.
export function IconHistory({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ));
}

// Plus — the "New chat" affordance.
export function IconPlus({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ));
}

// Close / delete affordance.
export function IconClose({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ));
}

// Small check — confirm delete + waterfall "hit" rows.
export function IconCheck({ size = 16 }: IconProps) {
  return svg(size, <polyline points="4 12 9 17 20 6" />);
}

// Teach — a graduation cap (learning / training the agent).
export function IconTeach({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <path d="M12 4 2 9l10 5 10-5-10-5z" />
      <path d="M6 11.5V16c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-4.5" />
      <path d="M22 9v4" />
    </>
  ));
}

export function IconSend({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ));
}
