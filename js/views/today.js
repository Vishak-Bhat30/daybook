// Home: today's plan at a glance, plus quick links into every section.
import { h, icon, plural, fmtNum, add } from '../util.js';
import { today, addDays, weekStart, fmt, fromKey, toKey } from '../dates.js';
import * as db from '../db.js';
import { meter, card, toast } from '../ui.js';
import * as tasks from '../tasks.js';
import * as F from '../fitlib.js';
import { getEntry, MOODS } from './diary.js';
import { photoImg } from '../photos.js';
import { workoutSheet } from './fitness.js';

export const title = 'Today';

function miniTask(task, onChange) {
  return h('li', { class: `task ${task.status}` },
    h('label', { class: 'task-main' },
      h('input', { type: 'checkbox', class: 'check', checked: task.status === 'done', onChange: e => { tasks.toggle(task, e.target.checked); onChange(); } }),
      h('span', { class: 'task-body' }, h('span', { class: 'task-text' }, task.important && icon('star', 'star sm'), task.text))));
}

export function render(root, _params, ctx) {
  const t = today();
  const tomorrow = addDays(t, 1);
  const prefs = db.prefs();
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const evening = hour >= 18 || hour < 5;

  const dayList = tasks.forDay(t).filter(x => x.status !== 'moved');
  const dc = tasks.counts(dayList);
  const tmr = tasks.counts(tasks.forDay(tomorrow));
  const ws = weekStart(t);
  const wc = tasks.counts(tasks.forWeek(ws));
  const entry = getEntry(t);
  const todaysWorkouts = F.workoutsOn(t);
  const week = F.weekStats(ws);
  const streak = F.streak();

  const planCard = card("Today's plan", { action: h('a', { class: 'link', href: `#/plan/${t}` }, 'Open', icon('right', 'xs')) },
    dc.total
      ? [meter(dc.done, dc.total), h('ul', { class: 'tasks compact' }, dayList.map(x => miniTask(x, ctx.refresh)))]
      : h('p', { class: 'muted' }, 'Nothing planned for today. ', h('a', { class: 'link', href: `#/plan/${t}` }, 'Add a task')),
    evening && dc.open.length > 0 && h('a', { class: 'btn btn-wide', href: `#/plan/${t}` }, icon('check'), 'Review your day'));

  const tomorrowCard = card('Tomorrow', {},
    h('p', { class: 'muted' }, tmr.total ? `${plural(tmr.total, 'task')} planned for ${fmt(tomorrow, { weekday: 'long' })}.` : 'Nothing planned yet.'),
    h('a', { class: `btn ${!tmr.total && evening ? 'btn-primary' : ''} btn-wide`, href: `#/plan/${tomorrow}` }, icon('plan'), tmr.total ? "Edit tomorrow's plan" : 'Plan tomorrow'));

  const openWeek = tasks.forWeek(ws).filter(x => x.status === 'open').sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
  const weekCard = card('This week', { action: h('a', { class: 'link', href: '#/week' }, 'Open', icon('right', 'xs')) },
    wc.total
      ? [meter(wc.done, wc.total), openWeek.length > 0 && h('ul', { class: 'tasks compact' }, openWeek.slice(0, 4).map(x => miniTask(x, ctx.refresh))),
        openWeek.length > 4 && h('p', { class: 'muted small' }, `and ${openWeek.length - 4} more`)]
      : h('p', { class: 'muted' }, 'No week goals yet. ', h('a', { class: 'link', href: '#/week' }, 'Add some')));

  const hasEntry = !!(entry && (entry.text?.trim() || entry.mood || entry.photos?.length));
  const diaryCard = card('Diary', { action: hasEntry && h('a', { class: 'link', href: `#/diary/${t}` }, 'Open', icon('right', 'xs')) },
    hasEntry
      ? h('a', { class: 'entry-item', href: `#/diary/${t}` },
        entry.mood && h('span', { class: 'entry-mood' }, MOODS[entry.mood - 1][0], ' ', MOODS[entry.mood - 1][1]),
        entry.text && h('p', { class: 'entry-snippet' }, entry.text.trim().slice(0, 160) + (entry.text.trim().length > 160 ? '…' : '')),
        entry.photos?.length > 0 && h('div', { class: 'thumb-row' }, entry.photos.slice(0, 4).map(id => photoImg(id, t, { cls: 'thumb' }))))
      : h('a', { class: 'btn btn-wide', href: `#/diary/${t}` }, '✍️ Write about today'));

  const fitCard = card('Fitness', { action: h('a', { class: 'link', href: '#/fitness' }, 'Open', icon('right', 'xs')) },
    h('div', { class: 'stats stats-3' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'This week'), h('span', { class: 'stat-value' }, `${week.count}/${prefs.weeklyGoal}`), h('span', { class: 'stat-sub' }, 'workouts')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Minutes'), h('span', { class: 'stat-value' }, fmtNum(week.minutes)), h('span', { class: 'stat-sub' }, 'this week')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Streak'), h('span', { class: 'stat-value' }, String(streak)), h('span', { class: 'stat-sub' }, streak === 1 ? 'day' : 'days'))),
    todaysWorkouts.length
      ? h('ul', { class: 'plain-list' }, todaysWorkouts.map(w => h('li', null, `${F.kindOf(w).emoji} ${F.workoutName(w)}`, h('span', { class: 'muted' }, F.summary(w) && ` · ${F.summary(w)}`))))
      : null,
    h('button', { class: 'btn btn-wide', type: 'button', onClick: () => workoutSheet(null, ctx) }, icon('plus'), todaysWorkouts.length ? 'Log another workout' : 'Log a workout'));

  add(root, 
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, fmt(t, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h2', { class: 'hello' }, prefs.name ? `${greet}, ${prefs.name}` : greet)),
    h('div', { class: 'dash' }, planCard, tomorrowCard, weekCard, diaryCard, fitCard, memories(t)),
  );

  // First visit: nudge towards setting a name.
  if (!prefs.name && !db.list('task').length && !localStorage.getItem('daybook.welcomed')) {
    localStorage.setItem('daybook.welcomed', '1');
    toast('Welcome to Daybook! Set your name in Settings.', { action: 'Settings', onAction: () => ctx.go('#/settings'), ms: 7000 });
  }
}

/** Diary entries from a week, a month and a year ago. */
function memories(t) {
  const monthAgo = fromKey(t); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const yearAgo = fromKey(t); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const found = [['A week ago', addDays(t, -7)], ['A month ago', toKey(monthAgo)], ['A year ago', toKey(yearAgo)]]
    .map(([label, day]) => [label, day, getEntry(day)])
    .filter(([, , e]) => e && (e.text?.trim() || e.photos?.length));
  if (!found.length) return null;
  return card('On this day', { cls: 'memories' },
    h('ul', { class: 'entry-list' }, found.map(([label, day, e]) => h('li', null,
      h('a', { class: 'entry-item', href: `#/diary/${day}` },
        h('div', { class: 'entry-top' }, h('strong', null, label), h('span', { class: 'muted small' }, fmt(day, { day: 'numeric', month: 'short', year: 'numeric' }))),
        e.text && h('p', { class: 'entry-snippet' }, e.text.trim().slice(0, 120) + (e.text.trim().length > 120 ? '…' : '')),
        e.photos?.length > 0 && h('div', { class: 'thumb-row' }, e.photos.slice(0, 3).map(id => photoImg(id, day, { cls: 'thumb' }))))))));
}
