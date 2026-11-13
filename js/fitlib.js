// Fitness data helpers.
//
// workout: { id, type:'workout', date, kind, title?, duration (min), distance (km)?, effort 1-5,
//            exercises?: [{ name, sets, reps, weight }], notes? }
// metric:  { id:'metric-<date>', type:'metric', date, weight (kg)?, steps?, sleep (h)? }
import * as db from './db.js';
import { addDays, today, weekStart } from './dates.js';

export const KINDS = {
  run: { label: 'Run', emoji: '🏃', distance: true },
  walk: { label: 'Walk', emoji: '🚶', distance: true },
  cycle: { label: 'Cycle', emoji: '🚴', distance: true },
  gym: { label: 'Strength', emoji: '🏋️', exercises: true },
  yoga: { label: 'Yoga', emoji: '🧘' },
  swim: { label: 'Swim', emoji: '🏊', distance: true },
  sport: { label: 'Sport', emoji: '🏸' },
  hiit: { label: 'HIIT', emoji: '🔥', exercises: true },
  other: { label: 'Other', emoji: '✨', exercises: true },
};
export const EFFORT = ['Easy', 'Light', 'Moderate', 'Hard', 'All out'];
export const kindOf = w => KINDS[w.kind] || KINDS.other;
export const workoutName = w => w.title || kindOf(w).label;

export const workouts = () => db.list('workout').sort((a, b) => (a.date === b.date ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : a.date < b.date ? 1 : -1));
export const workoutsOn = day => workouts().filter(w => w.date === day);
export const metrics = () => db.list('metric').sort((a, b) => (a.date < b.date ? -1 : 1));
export const metricOn = day => db.get(`metric-${day}`);

/** Minutes per day, as a Map day -> minutes (days with any workout appear even at 0 min). */
export function minutesByDay() {
  const m = new Map();
  for (const w of db.list('workout')) m.set(w.date, (m.get(w.date) || 0) + (Number(w.duration) || 0));
  return m;
}

export function rangeStats(from, to) {
  const ws = db.list('workout', w => w.date >= from && w.date <= to);
  return {
    count: ws.length,
    minutes: ws.reduce((s, w) => s + (Number(w.duration) || 0), 0),
    km: ws.reduce((s, w) => s + (Number(w.distance) || 0), 0),
    days: new Set(ws.map(w => w.date)).size,
  };
}
export const weekStats = ws => rangeStats(ws, addDays(ws, 6));

/** Consecutive days with a workout, ending today (or yesterday, if today isn't logged yet). */
export function streak() {
  const days = new Set(db.list('workout').map(w => w.date));
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

/** Last `n` weeks (oldest first): [{ ws, minutes, count }]. */
export function weeklySeries(n = 12) {
  const cur = weekStart(today());
  return Array.from({ length: n }, (_, i) => {
    const ws = addDays(cur, -7 * (n - 1 - i));
    return { ws, ...weekStats(ws) };
  });
}

/** Heaviest weight lifted per exercise (case-insensitive name). */
export function personalBests() {
  const best = new Map();
  for (const w of db.list('workout')) {
    for (const ex of w.exercises || []) {
      const wt = Number(ex.weight);
      if (!ex.name || !wt) continue;
      const key = ex.name.trim().toLowerCase();
      const cur = best.get(key);
      if (!cur || wt > cur.weight || (wt === cur.weight && w.date < cur.date)) best.set(key, { name: ex.name.trim(), weight: wt, reps: ex.reps, date: w.date });
    }
  }
  return [...best.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function exerciseNames() {
  const names = new Map();
  for (const w of db.list('workout')) for (const ex of w.exercises || []) if (ex.name) names.set(ex.name.trim().toLowerCase(), ex.name.trim());
  return [...names.values()].sort();
}

export function summary(w) {
  const bits = [];
  if (w.duration) bits.push(`${w.duration} min`);
  if (w.distance) bits.push(`${Number(w.distance).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`);
  if (w.exercises?.length) bits.push(`${w.exercises.length} exercise${w.exercises.length > 1 ? 's' : ''}`);
  return bits.join(' · ');
}
