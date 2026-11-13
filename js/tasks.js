// Task data helpers shared by the Plan, Week and Today screens.
//
// task: { id, type:'task', list:'day'|'week', bucket: day key (for weeks: the Monday),
//         text, status:'open'|'done'|'moved', order, important?, doneAt?,
//         movedTo?, carriedFrom?, linkId? (day task planned from a week task), plannedFor? }
import * as db from './db.js';
import { uid } from './util.js';

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);

export const forDay = k => db.list('task', t => t.list === 'day' && t.bucket === k).sort(byOrder);
export const forWeek = k => db.list('task', t => t.list === 'week' && t.bucket === k).sort(byOrder);
export const allDay = () => db.list('task', t => t.list === 'day');

export function counts(list) {
  const active = list.filter(t => t.status !== 'moved');
  return { total: active.length, done: active.filter(t => t.status === 'done').length, open: active.filter(t => t.status === 'open') };
}

export const add = (list, bucket, text, extra = {}) =>
  db.put({ id: uid(), type: 'task', list, bucket, text, status: 'open', order: Date.now(), ...extra });

const fresh = t => db.get(t.id) ?? t;
export const update = (task, patch) => db.put({ ...fresh(task), ...patch });

export function toggle(task, done) {
  const cur = fresh(task);
  update(cur, { status: done ? 'done' : 'open', doneAt: done ? Date.now() : null });
  // A day task planned from the week list completes the week task too.
  if (cur.linkId) {
    const w = db.get(cur.linkId);
    if (w && w.status !== 'moved' && (w.status === 'done') !== done) update(w, { status: done ? 'done' : 'open', doneAt: done ? Date.now() : null });
  }
}

/** Move to another day/week, leaving a "moved" marker behind for the history. */
export function move(task, bucket) {
  const cur = fresh(task);
  update(cur, { status: 'moved', movedTo: bucket });
  const copy = add(cur.list, bucket, cur.text, {
    carriedFrom: cur.carriedFrom ?? cur.bucket, linkId: cur.linkId, important: cur.important, order: cur.order,
  });
  if (cur.linkId && cur.list === 'day') { const w = db.get(cur.linkId); if (w) update(w, { plannedFor: bucket }); }
  return copy;
}

export const del = task => db.remove(task.id);
export const restore = task => db.put(task);

export function planFromWeek(weekTask, day) {
  add('day', day, weekTask.text, { linkId: weekTask.id, important: weekTask.important });
  update(weekTask, { plannedFor: day });
}

/** Tasks completed on a given day (day-list tasks of that day + week tasks ticked that day). */
export function doneOn(day, dayOf) {
  return db.list('task', t => t.status === 'done' && (t.list === 'day' ? t.bucket === day : t.doneAt && dayOf(t.doneAt) === day));
}
