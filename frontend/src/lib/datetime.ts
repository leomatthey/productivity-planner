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
