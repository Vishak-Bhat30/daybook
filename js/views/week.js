// Week list: a longer to-do list for the whole week, with carry-over to next week.
import { h, icon, plural, add, fill } from '../util.js';
import { today, addDays, weekStart, weekLabel, relWeek, dayDiff, dayName, isKey, fmt } from '../dates.js';
import { dateNav, meter, taskRow, inlineEdit, addForm, empty, toast } from '../ui.js';
import * as tasks from '../tasks.js';

export const title = 'Week';

export function render(root, [param], ctx) {
  const t = today();
  const thisWeek = weekStart(t);
  const ws = isKey(param) ? weekStart(param) : thisWeek;
  const diff = dayDiff(thisWeek, ws) / 7; // weeks from now
  const nextWs = addDays(ws, 7);
  const target = diff >= 0 ? nextWs : thisWeek; // where unfinished tasks go
  const targetName = diff >= 0 ? 'next week' : 'this week';
  const daysLeft = diff === 0 ? 7 - dayDiff(ws, t) : null;

  const body = h('div', { class: 'stack' });
  let showDone = true;

  add(root, 
    dateNav({
      title: relWeek(ws) ?? `Week of ${fmt(ws, { day: 'numeric', month: 'short' })}`,
      sub: weekLabel(ws) + (daysLeft ? ` · ${plural(daysLeft, 'day')} left` : ''),
      prev: `#/week/${addDays(ws, -7)}`, next: `#/week/${nextWs}`,
      prevLabel: 'Previous week', nextLabel: 'Next week',
    }),
    diff !== 0 && h('div', { class: 'seg' }, h('a', { class: 'seg-btn', href: '#/week' }, 'Back to this week')),
    addForm({ placeholder: diff > 0 ? 'Add something for that week…' : 'Add something to get done this week…', onAdd: text => { tasks.add('week', ws, text); paint(); } }),
    body,
  );

  function row(task) {
    const meta = task.status === 'moved' ? [icon('arrow', 'xs'), ' Moved to next week']
      : task.plannedFor && task.status === 'open' ? [icon('calendar', 'xs'), ` Planned for ${dayName(task.plannedFor).toLowerCase()}`]
      : task.carriedFrom ? `Carried over from week of ${fmt(task.carriedFrom, { day: 'numeric', month: 'short' })}`
      : null;
    return taskRow(task, {
      meta,
      onToggle: done => { tasks.toggle(task, done); paint(); },
      menuItems: li => task.status === 'moved' ? [del(task)] : [
        { label: 'Edit', icon: 'pencil', run: () => inlineEdit(li, task.text, text => { tasks.update(task, { text }); paint(); }) },
        { label: task.important ? 'Remove star' : 'Star (important)', icon: 'star', run: () => { tasks.update(task, { important: !task.important }); paint(); } },
        task.status === 'open' && diff <= 0 && { label: "Add to today's plan", icon: 'plan', run: () => { tasks.planFromWeek(task, t); paint(); toast("Added to today's plan", { action: 'View', onAction: () => ctx.go(`#/plan/${t}`) }); } },
        task.status === 'open' && diff <= 0 && { label: "Add to tomorrow's plan", icon: 'plan', run: () => { const d = addDays(t, 1); tasks.planFromWeek(task, d); paint(); toast("Added to tomorrow's plan", { action: 'View', onAction: () => ctx.go(`#/plan/${d}`) }); } },
        task.status === 'open' && { label: `Move to ${targetName}`, icon: 'arrow', run: () => { tasks.move(task, target); paint(); toast(`Moved to ${targetName}`); } },
        del(task),
      ],
    });
  }
  const del = task => ({
    label: 'Delete', icon: 'trash', danger: true,
    run: () => { tasks.del(task); paint(); toast('Task deleted', { action: 'Undo', onAction: () => { tasks.restore(task); paint(); } }); },
  });

  function paint() {
    const list = tasks.forWeek(ws);
    const { total, done, open } = tasks.counts(list);
    const openSorted = [...open].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
    const doneList = list.filter(x => x.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    const moved = list.filter(x => x.status === 'moved');
    fill(body, 
      total > 0 && h('div', { class: 'summary' }, meter(done, total)),
      !list.length && empty(diff < 0 ? 'Nothing was on the list this week.' : 'Your week list is empty. Add the bigger things you want to get through this week.'),
      openSorted.length > 0 && h('ul', { class: 'tasks', 'aria-label': 'To do' }, openSorted.map(row)),
      diff <= 0 && open.length > 0 && h('button', {
        class: 'btn btn-wide', type: 'button',
        onClick: () => {
          open.forEach(task => tasks.move(task, target));
          paint();
          toast(`Moved ${plural(open.length, 'task')} to ${targetName}`, { action: 'View', onAction: () => ctx.go(`#/week/${target}`) });
        },
      }, icon('arrow'), `Move ${plural(open.length, 'unfinished task')} to ${targetName}`),
      doneList.length > 0 && h('div', null,
        h('button', { class: 'section-toggle', type: 'button', 'aria-expanded': String(showDone), onClick: () => { showDone = !showDone; paint(); } },
          icon('right', 'sm chev'), `Done (${doneList.length})`),
        showDone && h('ul', { class: 'tasks', 'aria-label': 'Done' }, doneList.map(row))),
      moved.length > 0 && h('details', { class: 'moved-list' },
        h('summary', null, `Moved to another week (${moved.length})`),
        h('ul', { class: 'tasks' }, moved.map(row))),
    );
  }

  paint();
  return { refresh: paint };
}
