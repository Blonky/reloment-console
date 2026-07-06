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

export function IconSend({ size = 16 }: IconProps) {
  return svg(size, (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ));
}
