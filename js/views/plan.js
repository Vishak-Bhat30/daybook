// Daily plan: write tomorrow's tasks, tick them off, review at the end of the day.
import { h, icon, plural, add, fill } from '../util.js';
import { today, addDays, dayDiff, fmt, relDay, dayName, resolveDay } from '../dates.js';
import { dateNav, meter, taskRow, inlineEdit, addForm, empty, toast, card } from '../ui.js';
import * as tasks from '../tasks.js';

export const title = 'Plan';

export function render(root, [param], ctx) {
  const t = today();
  const date = resolveDay(param) ?? t;
  const diff = dayDiff(t, date); // > 0: future, 0: today, < 0: past
  const rel = relDay(date);
  const nextDay = diff >= 0 ? addDays(date, 1) : t;

  const body = h('div', { class: 'stack' });
  add(root, 
    dateNav({
      title: rel ?? fmt(date, { weekday: 'long' }),
      sub: fmt(date, { day: 'numeric', month: 'long', year: 'numeric' }),
      value: date,
      prev: `#/plan/${addDays(date, -1)}`, next: `#/plan/${addDays(date, 1)}`,
      prevLabel: 'Previous day', nextLabel: 'Next day',
      onPick: k => ctx.go(`#/plan/${k}`),
    }),
    h('div', { class: 'seg' },
      [['Today', t], ['Tomorrow', addDays(t, 1)]].map(([label, k]) =>
        h('a', { class: 'seg-btn', href: `#/plan/${k}`, 'aria-current': k === date ? 'page' : null }, label))),
    diff >= 0 && addForm({
      placeholder: diff > 0 ? `What's the plan for ${rel ? rel.toLowerCase() : fmt(date, { weekday: 'long' })}?` : 'Add a task for today…',
      onAdd: text => { tasks.add('day', date, text); paint(); },
    }),
    body,
  );

  function row(task) {
    const meta = task.status === 'moved' ? [icon('arrow', 'xs'), ` Moved to ${dayName(task.movedTo).toLowerCase()}`]
      : task.carriedFrom ? `Carried over from ${fmt(task.carriedFrom, { weekday: 'short', day: 'numeric', month: 'short' })}`
      : task.linkId ? 'From your week list' : null;
    return taskRow(task, {
      meta,
      onToggle: done => { tasks.toggle(task, done); paint(); },
      menuItems: li => [
        task.status !== 'moved' && { label: 'Edit', icon: 'pencil', run: () => inlineEdit(li, task.text, text => { tasks.update(task, { text }); paint(); }) },
        task.status === 'open' && { label: `Move to ${dayName(nextDay).toLowerCase()}`, icon: 'arrow', run: () => { tasks.move(task, nextDay); paint(); toast(`Moved to ${dayName(nextDay).toLowerCase()}`); } },
        { label: task.important ? 'Remove star' : 'Star', icon: 'star', run: () => { tasks.update(task, { important: !task.important }); paint(); } },
        {
          label: 'Delete', icon: 'trash', danger: true,
          run: () => { tasks.del(task); paint(); toast('Task deleted', { action: 'Undo', onAction: () => { tasks.restore(task); paint(); } }); },
        },
      ],
    });
  }

  function paint() {
    const list = tasks.forDay(date);
    const { total, done, open } = tasks.counts(list);
    const reviewing = diff <= 0 && total > 0;
    fill(body, 
      total > 0 && h('div', { class: 'summary' },
        reviewing && h('p', { class: 'eyebrow' }, diff === 0 ? 'End-of-day review' : 'How the day went'),
        meter(done, total, { label: diff > 0 ? plural(total, 'task') + ' planned' : undefined })),
      list.length
        ? h('ul', { class: 'tasks', 'aria-label': 'Tasks' }, list.map(row))
        : empty(diff > 0 ? 'Nothing planned yet. Add the first thing you want to get done.'
          : diff === 0 ? 'No tasks for today yet.'
          : 'Nothing was planned for this day.',
          diff === 0 ? h('a', { class: 'btn', href: `#/plan/${addDays(t, 1)}` }, 'Plan tomorrow instead') : null),
      diff <= 0 && open.length > 0 && h('button', {
        class: 'btn btn-wide', type: 'button',
        onClick: () => {
          open.forEach(task => tasks.move(task, nextDay));
          paint();
          toast(`Moved ${plural(open.length, 'task')} to ${dayName(nextDay).toLowerCase()}`, { action: 'View', onAction: () => ctx.go(`#/plan/${nextDay}`) });
        },
      }, icon('arrow'), `Move ${plural(open.length, 'unfinished task')} to ${dayName(nextDay).toLowerCase()}`),
      history(),
    );
  }

  function history() {
    const byDay = new Map();
    for (const task of tasks.allDay()) {
      if (task.bucket >= t || task.status === 'moved') continue;
      const d = byDay.get(task.bucket) || { done: 0, total: 0 };
      d.total++; if (task.status === 'done') d.done++;
      byDay.set(task.bucket, d);
    }
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);
    if (!days.length) return null;
    return card('Recent days', {},
      h('ul', { class: 'history' }, days.map(([k, d]) =>
        h('li', null, h('a', { href: `#/plan/${k}`, 'aria-current': k === date ? 'page' : null },
          h('span', { class: 'history-day' }, dayName(k)),
          h('span', { class: 'mini-meter', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.round((d.done / d.total) * 100)}%` } })),
          h('span', { class: 'history-count' }, `${d.done}/${d.total}`))))));
  }

  paint();
  return { refresh: paint };
}
