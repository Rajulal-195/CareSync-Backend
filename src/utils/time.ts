export interface Interval { start: string; end: string }
export interface Slot { startTime: string; endTime: string }

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function isValidTimezone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
export function isValidDateString(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** Day of week (0=Sun) of a calendar date string; independent of server timezone. */
export const dayOfWeek = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();

export function nowInTimezone(tz: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

export function generateSlots(
  s: { workingDays: number[]; sessions: Interval[]; slotDuration: number; breaks: Interval[] },
  date: string,
): Slot[] {
  if (!s.workingDays.includes(dayOfWeek(date))) return [];
  const out: Slot[] = [];
  for (const sess of s.sessions) {
    const end = toMinutes(sess.end);
    for (let t = toMinutes(sess.start); t + s.slotDuration <= end; t += s.slotDuration) {
      const e = t + s.slotDuration;
      const inBreak = s.breaks.some((b) => t < toMinutes(b.end) && e > toMinutes(b.start));
      if (!inBreak) out.push({ startTime: fromMinutes(t), endTime: fromMinutes(e) });
    }
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** "15m" | "7d" | "12h" | "30s" -> seconds. Returns NaN for anything else (callers validate first). */
export function parseDuration(v: string): number {
  const m = /^(\d+)([smhd])$/.exec(v);
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'] : NaN;
}
