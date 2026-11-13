// Dates are local calendar days stored as 'YYYY-MM-DD'. Weeks start on Monday.
// "Today" rolls over at `dayStart` o'clock (default 3am) so a late night still counts as the same day.
let dayStart = 3;
export const setDayStart = hour => { dayStart = Number(hour) || 0; };

const pad = n => String(n).padStart(2, '0');
export const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(fromKey(k).getTime());

/** The calendar day a timestamp belongs to, honouring the day-start hour. */
export const dayOf = ts => toKey(new Date(ts - dayStart * 3600e3));
export const today = () => dayOf(Date.now());

export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
export const weekStart = k => { const d = fromKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toKey(d); };
export const dayDiff = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
export const monthOf = k => k.slice(0, 7);
export const addMonths = (mk, n) => { const d = fromKey(mk + '-01'); d.setMonth(d.getMonth() + n); return toKey(d).slice(0, 7); };
export const daysInMonth = mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };

export const fmt = (k, o) => fromKey(k).toLocaleDateString(undefined, o);
export const fmtShort = k => fmt(k, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtLong = k => fmt(k, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtMonth = mk => fmt(mk + '-01', { month: 'long', year: 'numeric' });
export const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function relDay(k) {
  const d = dayDiff(today(), k);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : null;
}
/** "Today", "Tomorrow", or "Tue 17 Nov". */
export const dayName = k => relDay(k) ?? fmtShort(k);

export function weekLabel(ws) {
  const a = fromKey(ws), b = fromKey(addDays(ws, 6));
  try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).formatRange(a, b); } catch { /* older browsers */ }
  const left = a.toLocaleDateString(undefined, a.getMonth() === b.getMonth() ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  return `${left} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
export function relWeek(ws) {
  const d = Math.round(dayDiff(weekStart(today()), ws) / 7);
  return d === 0 ? 'This week' : d === 1 ? 'Next week' : d === -1 ? 'Last week' : null;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Resolve route aliases like "today" / "tomorrow" to a day key. */
export function resolveDay(p) {
  if (p === 'today') return today();
  if (p === 'tomorrow') return addDays(today(), 1);
  if (p === 'yesterday') return addDays(today(), -1);
  return isKey(p) ? p : null;
}
