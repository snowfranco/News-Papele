// Time helpers. America/Toronto is the project's canonical timezone
// everywhere schedules and stamps exist (AGENTS.md constraints).

/** ISO-8601 with the America/Toronto offset. State entries and routing
 * records carry this so a future overseer reading the outputs sees local
 * time, not UTC. (Moved verbatim from the Mission Control queues writer,
 * which no longer exists here; outbox routing now records into manifold
 * state, src/outbox.ts.) */
export function torontoIso(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offsetRaw = get('timeZoneName'); // e.g. "GMT-04:00"
  const offset = offsetRaw.replace('GMT', '') || '-05:00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/** The current hour (0..23) in America/Toronto. The edition workflow's
 * DST-safe gate uses this: GitHub Actions cron is UTC, so the workflow fires
 * at both candidate UTC hours and only the one that is 07:00 in Toronto
 * proceeds (.github/workflows/manifold-edition.yml). */
export function torontoHour(date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hour) % 24;
}
