# Daybook

A personal planner, diary and fitness log. It runs in the browser, installs on a phone like an app, and works offline.

- **Today**: one dashboard with today's tasks, tomorrow's plan, week progress, the diary and fitness stats.
- **Plan**: write tomorrow's tasks the night before, tick them off during the day, then review in the evening. One tap moves unfinished tasks to the next day.
- **Week**: a longer list for the week. Send a task into today's or tomorrow's plan (ticking it there ticks it here too), and carry leftovers into next week.
- **Diary**: one entry per day with a mood, free text and photos. Browse by calendar, search everything, and see a "day at a glance" of what you got done that day.
- **Fitness**: log workouts (run, walk, cycle, strength with sets/reps/kg, yoga, …) and body stats (weight, steps, sleep). Shows weekly minutes, an activity calendar, a weight trend, streaks and personal bests.

## Using it on your phone

Open the site, then:

- **iPhone**: in Safari, tap Share → *Add to Home Screen*.
- **Android**: in Chrome, tap ⋮ → *Install app*.

## Where your data lives

Everything is saved in the browser on each device (IndexedDB). Nothing goes to any server unless you turn on sync.

**Sync (recommended):** Settings → *Sync between devices* connects a **private** GitHub repo (e.g. `daybook-data`) with a fine-grained token that can only read and write that one repo. Data is stored there as monthly JSON files (`data/2026-11.json`) and photos as JPEGs (`photos/2026-11/<id>.jpg`). Sync runs automatically after edits, when the app opens, and every few minutes. If two devices edit at the same time, both sets of changes are merged record by record, and the newest edit wins.

The token is stored only in that device's browser. Use a token that is scoped to the data repo only.

**Backup:** Settings → *Export backup* downloads one JSON file containing everything, including photos.

## Development

No build step: plain HTML, CSS and ES modules.

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

- `js/app.js`: shell, router, service worker registration
- `js/db.js`: local storage (records + photos), change events
- `js/sync.js`: GitHub sync
- `js/views/*.js`: one file per screen
- `js/charts.js`: the SVG charts
- `sw.js`: offline cache. **Bump `VERSION` whenever you change any file**, so installed apps pick up the update. Add new files to `ASSETS`.

Deploys with GitHub Pages from the `main` branch.
