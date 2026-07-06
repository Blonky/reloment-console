// Tiny shared formatting helpers. Deterministic, locale-pinned to en-US so the
// demo renders identically everywhere.

/** Cents → "$4,120" (whole dollars; the console's money is renewal-sized). */
export function money(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

/** ISO → "Jul 7". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** ISO → "Jul 7, 1:45 PM". */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** snake_case → "Snake case". */
export function humanize(s: string): string {
  const words = s.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
