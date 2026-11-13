// Fitness: log workouts and body stats, see weekly totals, streaks and trends.
import { h, icon, uid, num, plural, fmtNum, add } from '../util.js';
import { today, addDays, weekStart, fmt, dayName, isKey } from '../dates.js';
import * as db from '../db.js';
import { sheet, confirmDialog, toast, card, empty } from '../ui.js';
import { columnChart, heatmap, heatLegend, lineChart, tableView } from '../charts.js';
import * as F from '../fitlib.js';

export const title = 'Fitness';
let historyLimit = 15;

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'field-hint' }, hint));

function statTile(label, value, sub) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub && h('span', { class: 'stat-sub' }, sub));
}

export function render(root, [param, arg], ctx) {
  const t = today();
  const ws = weekStart(t);
  const prefs = db.prefs();
  const cur = F.weekStats(ws);
  const prev = F.weekStats(addDays(ws, -7));
  const streak = F.streak();
  const all = F.workouts();
  const delta = cur.minutes - prev.minutes;

  add(root, 
    h('div', { class: 'actions-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => workoutSheet(null, ctx) }, icon('plus'), 'Log workout'),
      h('button', { class: 'btn', type: 'button', onClick: () => bodySheet(t, ctx) }, icon('plus'), 'Body stats')),
    h('div', { class: 'stats' },
      statTile('Workouts this week', `${cur.count}`, `goal ${prefs.weeklyGoal}`),
      statTile('Active minutes', fmtNum(cur.minutes), prev.minutes || cur.minutes ? `${delta >= 0 ? '+' : '−'}${fmtNum(Math.abs(delta))} vs last week` : null),
      statTile('Distance', `${fmtNum(cur.km, 1)} km`, 'this week'),
      statTile('Streak', plural(streak, 'day'), streak ? 'keep it going' : 'log one today')),
    goalMeter(cur.count, prefs.weeklyGoal),
  );

  if (!all.length) {
    add(root, empty('No workouts yet. Log your first one — a walk counts!',
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => workoutSheet(null, ctx) }, 'Log a workout')));
  } else {
    const series = F.weeklySeries(12);
    add(root, 
      card('Active minutes per week', {},
        columnChart(series.map(d => ({
          label: fmt(d.ws, { day: 'numeric', month: 'short' }),
          value: d.minutes,
          tip: d.ws === ws ? 'This week' : `Week of ${fmt(d.ws, { day: 'numeric', month: 'short' })}`,
        })), { unit: 'min', describe: `Active minutes per week, last 12 weeks. This week: ${cur.minutes} minutes.` }),
        tableView(['Week of', 'Minutes', 'Workouts', 'km'], [...series].reverse().map(d => [fmt(d.ws, { day: 'numeric', month: 'short' }), fmtNum(d.minutes), d.count, fmtNum(d.km, 1)]))),
      card('Activity', {},
        heatmap(F.minutesByDay(), {
          end: t,
          describe: 'Daily activity calendar. Use arrow keys to move between days.',
          tipFor: (day, v) => {
            const ws_ = F.workoutsOn(day);
            return {
              value: v === undefined ? 'Rest day' : `${fmtNum(v)} min`,
              label: `${fmt(day, { weekday: 'short', day: 'numeric', month: 'short' })}${ws_.length ? ' · ' + ws_.map(F.workoutName).join(', ') : ''}`,
            };
          },
        }),
        heatLegend()),
    );
  }

  add(root, bodyCard(ctx));
  const pbs = F.personalBests();
  if (pbs.length) {
    add(root, card('Personal bests', {},
      h('ul', { class: 'pb-list' }, pbs.slice(0, 10).map(p =>
        h('li', null, h('span', null, p.name), h('strong', null, `${fmtNum(p.weight, 1)} kg${p.reps ? ` × ${p.reps}` : ''}`), h('span', { class: 'muted' }, fmt(p.date, { day: 'numeric', month: 'short' })))))));
  }
  if (all.length) add(root, historyCard(all, ctx));

  if (param === 'new') queueMicrotask(() => workoutSheet(null, ctx, { date: isKey(arg) ? arg : t }));
  if (param === 'body') queueMicrotask(() => bodySheet(isKey(arg) ? arg : t, ctx));
  if (param === 'edit' && db.get(arg)) queueMicrotask(() => workoutSheet(db.get(arg), ctx));
}

function goalMeter(count, goal) {
  if (!goal) return null;
  const pct = Math.min(100, Math.round((count / goal) * 100));
  const met = count >= goal;
  return h('div', { class: `meter-row${met ? ' complete' : ''}` },
    h('div', { class: 'meter-text' },
      met ? h('span', { class: 'meter-status' }, icon('check', 'sm'), 'Weekly goal reached') : h('span', null, `${count} of ${goal} workouts this week`),
      h('span', { class: 'meter-pct' }, `${pct}%`)),
    h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(count), 'aria-label': 'Weekly workout goal' },
      h('div', { class: 'meter-fill', style: { width: `${pct}%` } })));
}

function bodyCard(ctx) {
  const ms = F.metrics();
  const weights = ms.filter(m => m.weight).map(m => ({ day: m.date, value: Number(m.weight) }));
  const latest = [...ms].reverse();
  const lastOf = k => latest.find(m => m[k] != null && m[k] !== '');
  const lw = lastOf('weight'), ls = lastOf('steps'), lsl = lastOf('sleep');
  const recent = weights.filter(p => p.day >= addDays(today(), -120));
  return card('Body', { action: h('button', { class: 'btn btn-sm', type: 'button', onClick: () => bodySheet(today(), ctx) }, icon('plus', 'sm'), 'Add') },
    !ms.length ? h('p', { class: 'muted' }, 'Track weight, steps and sleep to see trends here.')
      : h('div', { class: 'stats stats-3' },
        statTile('Weight', lw ? `${fmtNum(lw.weight, 1)} kg` : '—', lw && dayName(lw.date)),
        statTile('Steps', ls ? fmtNum(ls.steps) : '—', ls && dayName(ls.date)),
        statTile('Sleep', lsl ? `${fmtNum(lsl.sleep, 1)} h` : '—', lsl && dayName(lsl.date))),
    recent.length >= 2 && h('div', null,
      h('p', { class: 'chart-title' }, 'Weight, last 4 months (kg)'),
      lineChart(recent, { unit: 'kg', describe: `Body weight trend. Latest ${recent[recent.length - 1].value} kg.` }),
      tableView(['Date', 'Weight (kg)', 'Steps', 'Sleep (h)'], latest.slice(0, 60).map(m => [fmt(m.date, { day: 'numeric', month: 'short', year: 'numeric' }), m.weight ?? '—', m.steps != null ? fmtNum(m.steps) : '—', m.sleep ?? '—']))),
  );
}

function historyCard(all, ctx) {
  const shown = all.slice(0, historyLimit);
  const groups = new Map();
  shown.forEach(w => { if (!groups.has(w.date)) groups.set(w.date, []); groups.get(w.date).push(w); });
  return card('History', {},
    h('div', { class: 'history-groups' }, [...groups.entries()].map(([day, ws]) =>
      h('div', { class: 'wk-group' },
        h('h4', null, dayName(day)),
        h('ul', { class: 'wk-list' }, ws.map(w => h('li', null,
          h('button', { class: 'wk-item', type: 'button', onClick: () => workoutSheet(w, ctx) },
            h('span', { class: 'wk-emoji', 'aria-hidden': 'true' }, F.kindOf(w).emoji),
            h('span', { class: 'wk-main' },
              h('strong', null, F.workoutName(w)),
              h('span', { class: 'muted' }, [F.summary(w), w.effort ? F.EFFORT[w.effort - 1] : null].filter(Boolean).join(' · '))),
            icon('right', 'sm muted')))))))),
    all.length > historyLimit && h('button', { class: 'btn btn-wide', type: 'button', onClick: () => { historyLimit += 20; ctx.refresh(); } }, 'Show more'));
}

// ---- workout form ---------------------------------------------------------
export function workoutSheet(existing, ctx, { date } = {}) {
  const w = existing ? structuredClone(existing) : { id: uid(), type: 'workout', date: date || today(), kind: 'run', effort: 3, exercises: [] };
  const names = h('datalist', { id: 'ex-names' }, F.exerciseNames().map(n => h('option', { value: n })));

  const dateIn = h('input', { class: 'input', type: 'date', value: w.date, required: true });
  const titleIn = h('input', { class: 'input', type: 'text', value: w.title || '', placeholder: 'e.g. Morning run, Leg day', maxlength: 80 });
  const durIn = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 1440, step: 1, value: w.duration ?? '', placeholder: '30' });
  const distIn = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, max: 1000, step: 0.01, value: w.distance ?? '', placeholder: '5' });
  const notesIn = h('textarea', { class: 'input', rows: 2, placeholder: 'How did it feel?', value: w.notes || '' });
  const distField = field('Distance (km)', distIn);

  const kinds = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Workout type' },
    Object.entries(F.KINDS).map(([k, v]) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'wk-kind', value: k, checked: w.kind === k, onChange: () => { w.kind = k; update(); } }),
      h('span', null, `${v.emoji} ${v.label}`))));
  const effort = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Effort' },
    F.EFFORT.map((e, i) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'wk-effort', value: i + 1, checked: w.effort === i + 1, onChange: () => { w.effort = i + 1; } }),
      h('span', null, e))));

  const exRows = h('div', { class: 'ex-rows' });
  const exRow = (ex = {}) => {
    const row = h('div', { class: 'ex-row' },
      h('input', { class: 'input ex-name', type: 'text', list: 'ex-names', placeholder: 'Exercise', value: ex.name || '', 'aria-label': 'Exercise name', maxlength: 60 }),
      h('input', { class: 'input ex-num', type: 'number', inputmode: 'numeric', min: 0, placeholder: 'Sets', value: ex.sets ?? '', 'aria-label': 'Sets' }),
      h('input', { class: 'input ex-num', type: 'number', inputmode: 'numeric', min: 0, placeholder: 'Reps', value: ex.reps ?? '', 'aria-label': 'Reps' }),
      h('input', { class: 'input ex-num', type: 'number', inputmode: 'decimal', min: 0, step: 0.5, placeholder: 'kg', value: ex.weight ?? '', 'aria-label': 'Weight (kg)' }),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove exercise', onClick: () => row.remove() }, icon('x')));
    return row;
  };
  (w.exercises || []).forEach(ex => exRows.append(exRow(ex)));
  const exField = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Exercises'),
    h('div', { class: 'ex-head', 'aria-hidden': 'true' }, h('span', null, 'Name'), h('span', null, 'Sets'), h('span', null, 'Reps'), h('span', null, 'kg'), h('span')),
    exRows,
    h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { const r = exRow(); exRows.append(r); r.querySelector('input').focus(); } }, icon('plus', 'sm'), 'Add exercise'));

  function update() {
    const k = F.KINDS[w.kind] || F.KINDS.other;
    distField.hidden = !k.distance;
    exField.hidden = !k.exercises && !exRows.children.length;
    if (k.exercises && !exRows.children.length) exRows.append(exRow());
  }
  update();

  const form = h('form', {
    class: 'form', id: 'workout-form',
    onSubmit: e => {
      e.preventDefault();
      if (!dateIn.value) return dateIn.focus();
      const exercises = [...exRows.querySelectorAll('.ex-row')].map(r => {
        const [name, sets, reps, weight] = [...r.querySelectorAll('input')].map(i => i.value);
        return { name: name.trim(), sets: num(sets), reps: num(reps), weight: num(weight) };
      }).filter(ex => ex.name);
      const rec = {
        ...w, date: dateIn.value, title: titleIn.value.trim() || null, duration: num(durIn.value),
        distance: F.KINDS[w.kind]?.distance ? num(distIn.value) : null, notes: notesIn.value.trim() || null, exercises,
      };
      db.put(rec);
      s.close();
      ctx.refresh();
      toast(existing ? 'Workout updated' : `${F.kindOf(rec).emoji} Workout logged`);
    },
  },
  names,
  field('Type', kinds),
  h('div', { class: 'grid-2' }, field('Date', dateIn), field('Duration (min)', durIn)),
  distField,
  field('Title (optional)', titleIn),
  field('Effort', effort),
  exField,
  field('Notes', notesIn));

  const s = sheet({
    title: existing ? 'Edit workout' : 'Log workout',
    body: form,
    footer: [
      existing && h('button', {
        class: 'btn btn-ghost danger', type: 'button',
        onClick: async () => { if (await confirmDialog('Delete this workout?')) { db.remove(w.id); s.close(); ctx.refresh(); toast('Workout deleted', { action: 'Undo', onAction: () => { db.put(existing); ctx.refresh(); } }); } },
      }, icon('trash', 'sm'), 'Delete'),
      existing && h('button', {
        class: 'btn btn-ghost', type: 'button',
        onClick: () => { db.put({ ...existing, id: uid(), date: today(), createdAt: undefined }); s.close(); ctx.refresh(); toast('Logged again for today'); },
      }, icon('copy', 'sm'), 'Repeat today'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', type: 'submit', form: 'workout-form' }, 'Save'),
    ],
  });
}

// ---- body stats form ------------------------------------------------------
export function bodySheet(date, ctx) {
  const dateIn = h('input', { class: 'input', type: 'date', value: date, required: true });
  const weightIn = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, max: 500, step: 0.1, placeholder: '70.5' });
  const stepsIn = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 200000, step: 1, placeholder: '8000' });
  const sleepIn = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, max: 24, step: 0.25, placeholder: '7.5' });
  const load = () => {
    const m = F.metricOn(dateIn.value) || {};
    weightIn.value = m.weight ?? ''; stepsIn.value = m.steps ?? ''; sleepIn.value = m.sleep ?? '';
  };
  dateIn.addEventListener('change', load);
  load();
  const form = h('form', {
    class: 'form', id: 'body-form',
    onSubmit: e => {
      e.preventDefault();
      const d = dateIn.value;
      if (!d) return;
      const vals = { weight: num(weightIn.value), steps: num(stepsIn.value), sleep: num(sleepIn.value) };
      const id = `metric-${d}`;
      if (Object.values(vals).every(v => v == null)) { if (db.get(id)) db.remove(id); }
      else db.put({ ...(db.get(id) || {}), id, type: 'metric', date: d, ...vals });
      s.close();
      ctx.refresh();
      toast('Body stats saved');
    },
  },
  field('Date', dateIn),
  h('div', { class: 'grid-3' }, field('Weight (kg)', weightIn), field('Steps', stepsIn), field('Sleep (h)', sleepIn)),
  h('p', { class: 'field-hint' }, 'Leave a box empty to skip it.'));
  const s = sheet({ title: 'Body stats', body: form, footer: [h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary', type: 'submit', form: 'body-form' }, 'Save')] });
}
