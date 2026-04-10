/**
 * datetime.ts — Shared UTC date parsing utility.
 *
 * Backend stores naive UTC datetimes (no 'Z' suffix). Browsers interpret
 * naive ISO strings inconsistently (some as local, some as UTC).
 * This utility ensures consistent UTC interpretation everywhere.
 */

/**
 * Parse an ISO datetime string as UTC. Appends 'Z' to naive strings
 * (those without a timezone indicator) so browsers always interpret as UTC.
 */
export function parseUTCDate(iso: string): Date {
  if (iso.endsWith('Z') || iso.includes('+') || /T\d{2}:\d{2}:\d{2}-/.test(iso)) {
    return new Date(iso)
  }
  return new Date(iso + 'Z')
}

/**
 * Format a Date as a datetime-local input value (YYYY-MM-DDTHH:mm) in local time.
 * Use this instead of `date.toISOString().slice(0, 16)` which outputs UTC.
 */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
