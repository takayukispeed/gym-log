import * as db from './db.js';
import { state } from './db.js';
import * as timer from './timer.js';
import { lineChart } from './chart.js';
import {
  TYPES, METRICS, DEFAULT_WEIGHT_STEP, LB_PER_KG, KM_PER_MI, DISTANCE_UNITS, DISTANCE_STEP,
  todayISO, addDays, addMonths, isISODate, formatDayLong, formatDayCompact, formatMonth, monthGrid,
  fmtNum, formatDuration, formatSet, formatMetric, kindUnit, validateSet, describeTarget,
  prSetIds, computeRecords, metricSeries, groupByDate, toCSV,
  weightOut, weightIn, distOut, distIn, wUnit, dUnit, fmtBody, workoutSpan, formatMinutes, formatClock, distUnitOf, paceUnit, displayOf, setSplit, paceLabel,
  PACE_UNITS,
} from './logic.js';
import {
  $, $$, esc, nav, go, toast, renderShell, colourOf, exerciseLink, stepper, bindSteppers,
  durationInputs, readNumber, readDuration, addSwipe, rangeChips, RANGES, shareOrDownload,
} from './ui.js';
import { viewBody } from './views/body.js';
import {
  viewRoutines, viewRoutineEdit, viewWorkoutEdit, viewRoutinePick, addToWorkout, startFromRoute, workoutButtons,
} from './views/routines.js';

const app = {
  dayEditMode: false,
  graphMetric: {}, // exerciseId -> metric key
  graphRange: 'all',
};

// ---------- day view ----------

function previousWorkoutDate(date) {
  const dates = [...new Set([...state.sets.values()].map((s) => s.date))].filter((d) => d < date).sort();
  return dates[dates.length - 1] || null;
}

function needsBackupNudge() {
  if (state.sets.size < 10) return false;
  if (!state.lastBackup) return true;
  return Date.now() - new Date(state.lastBackup).getTime() > 14 * 864e5;
}

// "Start 6:02 pm · End 7:10 pm   ≈ 1 h 8 min", from the first to the last saved set.
function spanHtml(sets) {
  const span = workoutSpan(sets, sets[0]?.date);
  if (!span) return '';
  const single = span.end === span.start;
  return `<div class="span-bar" id="span">
    <span>Start <strong>${esc(formatClock(span.start))}</strong>${single ? '' : ` · End <strong>${esc(formatClock(span.end))}</strong>`}</span>
    ${single ? '' : `<span>≈ <strong>${esc(formatMinutes(span.minutes))}</strong></span>`}
  </div>`;
}

function viewDay(date) {
  const exercises = db.exercisesOn(date);
  const edit = app.dayEditMode && exercises.length > 0;
  const day = state.days.get(date);
  const note = day?.note || '';
  const body = state.body.get(date);
  const cards = exercises.map((ex, i) => {
    const sets = db.setsOnFor(date, ex.id);
    const plan = db.planFor(date, ex.id);
    const prs = prSetIds(db.setsFor(ex.id), ex.type);
    const done = plan && sets.length >= (plan.sets || 1);
    return `
      <div class="card ex-card" style="--cat:${esc(colourOf(ex))}">
        <a class="ex-card-main" href="#/ex/${ex.id}/${date}/track">
          <div class="ex-name">${esc(ex.name)}${plan ? `<span class="progress-pill ${done ? 'done' : ''}">${done ? '✓ ' : ''}${sets.length}/${plan.sets || 1} sets</span>` : ''}</div>
          ${plan ? `<div class="target">Target ${esc(describeTarget(plan, ex.type, distUnitOf(ex)))}</div>` : ''}
          <ol class="setlist">
            ${sets.map((s) => `<li>${esc(formatSet(s, ex.type, distUnitOf(ex)))}${prs.has(s.id) ? ' <span class="pr" title="Personal record">🏆</span>' : ''}${s.comment ? ' <span class="cm" title="Comment">💬</span>' : ''}</li>`).join('')}
          </ol>
        </a>
        ${edit ? `<div class="reorder">
          <button data-move="${ex.id}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button data-move="${ex.id}" data-delta="1" ${i === exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button data-remove="${ex.id}" class="danger" aria-label="Remove from workout">✕</button>
        </div>` : ''}
      </div>`;
  }).join('');

  const prev = previousWorkoutDate(date);
  const empty = `
    <div class="empty-day">
      <p>No workout logged.</p>
      <a class="btn primary" href="#/add/${date}">Add exercise</a>
      ${prev ? `<button class="btn" id="copy-prev">Copy workout from ${esc(formatDayLong(prev))}</button>` : ''}
    </div>
    ${workoutButtons(date) ? `<h2 class="section">Start a routine workout</h2>${workoutButtons(date)}` : ''}`;

  renderShell({
    title: `<button class="datebtn" id="pick-date">${esc(formatDayLong(date))}</button>`,
    tab: 'log',
    actions: `
      ${exercises.length ? `<button class="hbtn" id="toggle-edit">${edit ? 'Done' : 'Edit'}</button>` : ''}
      <a class="hbtn plus" href="#/add/${date}" aria-label="Add exercise or workout">+</a>`,
    body: `
      <div class="daynav">
        <a class="btn ghost" href="#/day/${addDays(date, -1)}" aria-label="Previous day">‹ ${esc(formatDayCompact(addDays(date, -1)))}</a>
        ${date !== todayISO() ? `<a class="btn ghost" href="#/day/${todayISO()}">Today</a>` : ''}
        <a class="btn ghost" href="#/day/${addDays(date, 1)}" aria-label="Next day">${esc(formatDayCompact(addDays(date, 1)))} ›</a>
      </div>
      ${needsBackupNudge() ? '<a class="banner" href="#/settings">It has been a while since your last backup. Tap to back up.</a>' : ''}
      ${day?.workoutName && day.plan?.length ? `<div class="workout-label">${esc(day.workoutName)}</div>` : ''}
      ${spanHtml(db.setsOn(date))}
      <div id="day" class="day">${exercises.length ? cards : empty}</div>
      <a class="chip-link" href="#/body/${date}">⚖ ${body ? `Bodyweight ${fmtBody(weightOut(body.weight))} ${wUnit()}` : 'Log bodyweight'}</a>
      ${exercises.length ? `
        <label class="field note"><span>Workout note</span>
          <textarea id="day-note" rows="2" placeholder="How did it go?">${esc(note)}</textarea>
        </label>` : ''}
      <input type="date" id="date-input" class="visually-hidden" value="${date}">`,
  });

  $('#toggle-edit')?.addEventListener('click', () => { app.dayEditMode = !app.dayEditMode; nav.route(); });
  $$('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    await db.moveExerciseInDay(date, b.dataset.move, Number(b.dataset.delta));
    nav.route();
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const ex = state.exercises.get(b.dataset.remove);
    if (!confirm(`Remove ${ex.name} and its sets from this day?`)) return;
    await db.deleteExerciseFromDay(date, ex.id);
    nav.route();
  }));
  $('#copy-prev')?.addEventListener('click', async () => {
    await db.copyDay(prev, date);
    toast('Workout copied');
    nav.route();
  });
  $('#day-note')?.addEventListener('change', async (e) => {
    const d = state.days.get(date) || { date, exerciseOrder: [] };
    await db.saveDay({ ...d, note: e.target.value.trim() });
    toast('Note saved');
  });
  const dateInput = $('#date-input');
  $('#pick-date').addEventListener('click', () => {
    if (dateInput.showPicker) { try { dateInput.showPicker(); return; } catch { /* fall through */ } }
    location.hash = `#/calendar/${date.slice(0, 7)}`;
  });
  dateInput.addEventListener('change', () => { if (isISODate(dateInput.value)) location.hash = `#/day/${dateInput.value}`; });

  addSwipe($('#day'), (dir) => { location.hash = `#/day/${addDays(date, dir)}`; });
}

// ---------- pick exercise ----------

function viewPickCategory(date) {
  const cats = db.categoryList();
  const workouts = workoutButtons(date);
  renderShell({
    title: 'Add to workout',
    back: `#/day/${date}`,
    tab: 'log',
    body: `
      <input type="search" id="search" class="search" placeholder="Search exercises" autocomplete="off">
      <div id="results"></div>
      <div id="browse">
        <ul class="list">
          ${cats.map((c) => `<li><a href="#/add/${date}/${c.id}"><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}<span class="count">${db.exercisesIn(c.id).length}</span></a></li>`).join('')}
        </ul>
        <a class="btn" href="#/exercise-edit/new?return=${encodeURIComponent(`#/add/${date}`)}">+ New exercise</a>
        ${workouts ? `<h2 class="section">Or load a routine workout</h2>${workouts}` : ''}
      </div>`,
  });
  const search = $('#search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    $('#browse').hidden = !!q;
    if (!q) { $('#results').innerHTML = ''; return; }
    const hits = [...state.exercises.values()].filter((e) => e.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    $('#results').innerHTML = hits.length
      ? `<ul class="list">${hits.map((e) => exerciseLink(e, `#/ex/${e.id}/${date}/track`)).join('')}</ul>`
      : '<p class="empty">No matches.</p>';
  });
}

function viewPickExercise(date, categoryId) {
  const cat = state.categories.get(categoryId);
  if (!cat) return go(`#/add/${date}`);
  const exs = db.exercisesIn(categoryId);
  renderShell({
    title: esc(cat.name),
    back: `#/add/${date}`,
    tab: 'log',
    body: `
      <ul class="list">${exs.map((e) => exerciseLink(e, `#/ex/${e.id}/${date}/track`)).join('') || '<li class="empty">No exercises in this category.</li>'}</ul>
      <a class="btn" href="#/exercise-edit/new?cat=${cat.id}&return=${encodeURIComponent(`#/add/${date}/${cat.id}`)}">+ New exercise</a>`,
  });
}

// Picker for swapping a planned exercise: #/swap/date/fromId[/categoryId]
function viewSwapPick(date, fromId, categoryId) {
  const from = state.exercises.get(fromId);
  if (!from || !db.planFor(date, fromId)) return go(`#/day/${date}`);
  const base = `#/swap/${date}/${fromId}`;
  const link = (e) => exerciseLink(e, `#/swap-do/${date}/${fromId}/${e.id}`);
  const others = (list) => list.filter((e) => e.id !== fromId);
  if (categoryId) {
    const cat = state.categories.get(categoryId);
    if (!cat) return go(base);
    renderShell({
      title: esc(cat.name),
      back: base,
      tab: 'log',
      body: `<ul class="list">${others(db.exercisesIn(categoryId)).map(link).join('') || '<li class="empty">No exercises.</li>'}</ul>`,
    });
    return;
  }
  renderShell({
    title: `Swap ${esc(from.name)}`,
    back: `#/ex/${fromId}/${date}/track`,
    tab: 'log',
    body: `
      <p class="hint">Pick a replacement for today only. It keeps the target (${esc(describeTarget(db.planFor(date, fromId), from.type, distUnitOf(from)))}); your routine is unchanged.</p>
      <input type="search" id="search" class="search" placeholder="Search exercises" autocomplete="off">
      <div id="results"></div>
      <ul class="list" id="cats">
        ${db.categoryList().map((c) => `<li><a href="${base}/${c.id}"><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}<span class="count">${db.exercisesIn(c.id).length}</span></a></li>`).join('')}
      </ul>`,
  });
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $('#cats').hidden = !!q;
    const hits = q ? others([...state.exercises.values()]).filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)) : [];
    $('#results').innerHTML = !q ? '' : hits.length ? `<ul class="list">${hits.map(link).join('')}</ul>` : '<p class="empty">No matches.</p>';
  });
}

async function doSwap(date, fromId, toId) {
  const from = state.exercises.get(fromId);
  const to = state.exercises.get(toId);
  await db.swapPlanned(date, fromId, toId);
  if (from && to) toast(`${from.name} → ${to.name}`);
  // replace so Back from the new exercise doesn't re-run the swap
  location.replace(`#/ex/${toId}/${date}/track`);
}

// ---------- exercise: track / history / graph / records ----------

function viewExercise(exerciseId, date, tab) {
  const ex = state.exercises.get(exerciseId);
  if (!ex) return go(`#/day/${date}`);
  const tabs = [['track', 'Track'], ['history', 'History'], ['graph', 'Graph'], ['records', 'Records']];
  renderShell({
    title: esc(ex.name),
    back: `#/day/${date}`,
    tab: 'log',
    actions: '<button class="hbtn" id="start-timer" aria-label="Start rest timer">⏱</button>',
    body: `
      <nav class="seg">${tabs.map(([k, l]) => `<a href="#/ex/${ex.id}/${date}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
      <div id="tab-body"></div>`,
  });
  $('#start-timer').addEventListener('click', () => timer.start(state.settings.restSeconds));
  const body = $('#tab-body');
  if (tab === 'history') renderHistory(body, ex, date);
  else if (tab === 'graph') renderGraph(body, ex);
  else if (tab === 'records') renderRecords(body, ex);
  else renderTrack(body, ex, date);
}

function renderTrack(body, ex, date) {
  const fields = TYPES[ex.type].fields;
  const du = distUnitOf(ex);
  const plan = db.planFor(date, ex.id);
  let selectedId = null;

  // Prefill: last set today, else the routine target, else last time this exercise was done.
  const history = db.setsFor(ex.id);
  const today = db.setsOnFor(date, ex.id);
  const lastTime = history.filter((s) => s.date < date).pop() || {};
  const template = today[today.length - 1] || (plan ? {
    weight: plan.weight || lastTime.weight,
    reps: plan.reps || lastTime.reps,
    distance: plan.distance || lastTime.distance,
    seconds: plan.seconds || lastTime.seconds,
  } : lastTime);

  const order = db.exercisesOn(date);
  const next = order[order.findIndex((e) => e.id === ex.id) + 1];

  // Values held by the form are canonical (lbs, miles); conversion happens at the edges.
  function formHtml(values) {
    const parts = [];
    if (fields.includes('weight')) parts.push(stepper('f-weight', `Weight (${wUnit()})`, fmtNum(weightOut(values.weight ?? 0)), { step: state.settings.weightStep }));
    if (fields.includes('reps')) parts.push(stepper('f-reps', 'Reps', values.reps ?? 0, { step: 1, inputmode: 'numeric' }));
    if (fields.includes('distance')) parts.push(stepper('f-distance', `Distance (${du})`, fmtNum(distOut(values.distance ?? 0, du), du === 'm' ? 0 : 2), { step: DISTANCE_STEP[du] }));
    if (fields.includes('seconds')) parts.push(durationInputs(values.seconds));
    return parts.join('');
  }

  function readForm() {
    const out = {};
    if (fields.includes('weight')) out.weight = weightIn(readNumber(body, 'f-weight'));
    if (fields.includes('reps')) out.reps = Math.round(readNumber(body, 'f-reps'));
    if (fields.includes('distance')) out.distance = distIn(readNumber(body, 'f-distance'), du);
    if (fields.includes('seconds')) out.seconds = readDuration(body);
    return out;
  }

  function draw(values = template) {
    const sets = db.setsOnFor(date, ex.id);
    const prs = prSetIds(db.setsFor(ex.id), ex.type);
    const selected = sets.find((s) => s.id === selectedId);
    const target = plan ? plan.sets || 1 : 0;
    const complete = plan && sets.length >= target;
    body.innerHTML = `
      ${plan ? `<div class="plan-bar ${complete ? 'done' : ''}">
        <span>Target <strong>${esc(describeTarget(plan, ex.type, distUnitOf(ex)))}</strong></span>
        <span>${complete ? '✓ ' : ''}${sets.length}/${target} sets</span>
      </div>
      ${sets.length === 0 ? `<div class="plan-actions">
        <a class="btn ghost" href="#/swap/${date}/${ex.id}">⇄ Swap exercise</a>
        <button type="button" class="btn ghost danger" id="skip">Skip today</button>
      </div>` : ''}` : ''}
      <form id="set-form" class="card track" autocomplete="off">
        ${formHtml(values)}
        <div class="row">
          <button type="submit" class="btn primary">${selected ? 'Update' : 'Save'}</button>
          ${selected
            ? '<button type="button" class="btn danger" id="del">Delete</button>'
            : '<button type="button" class="btn" id="clear">Clear</button>'}
        </div>
        ${selected ? `
          <label class="field"><span>Comment</span>
            <input id="f-comment" type="text" value="${esc(selected.comment)}" placeholder="e.g. felt easy, paused reps">
          </label>
          <button type="button" class="btn ghost" id="deselect">Cancel editing</button>` : ''}
      </form>
      ${ex.notes ? `<p class="ex-notes">${esc(ex.notes)}</p>` : ''}
      <ol class="setlist big" id="sets">
        ${sets.map((s, i) => `
          <li class="${s.id === selectedId ? 'selected' : ''}" data-id="${s.id}">
            <span class="n">${i + 1}</span>
            <span class="v">${esc(formatSet(s, ex.type, distUnitOf(ex)))}</span>
            ${setSplit(s, displayOf(ex)) ? `<span class="split">${esc(setSplit(s, displayOf(ex)))}</span>` : ''}
            ${prs.has(s.id) ? '<span class="pr" title="Personal record">🏆</span>' : ''}
            ${s.comment ? `<span class="cm">${esc(s.comment)}</span>` : ''}
          </li>`).join('')}
      </ol>
      ${sets.length === 0 ? '<p class="empty">No sets yet today. Enter values and tap Save.</p>' : ''}
      ${next ? `<a class="btn ${complete ? 'primary' : ''}" id="next-ex" href="#/ex/${next.id}/${date}/track">Next: ${esc(next.name)} ›</a>` : ''}`;

    bindSteppers(body);
    $('#set-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = readForm();
      const err = validateSet(vals, ex.type);
      if (err) return toast(err);
      if (selected) {
        await db.updateSet({ ...selected, ...vals, comment: $('#f-comment').value.trim() });
        selectedId = null;
        toast('Set updated');
      } else {
        await db.addSet({ date, exerciseId: ex.id, ...vals });
        const nowDone = plan && db.setsOnFor(date, ex.id).length === target;
        if (nowDone) toast(`${ex.name} done`);
        if (state.settings.autoStartTimer) timer.start(state.settings.restSeconds);
      }
      draw(vals);
    });
    $('#clear', body)?.addEventListener('click', () => draw({}));
    $('#skip', body)?.addEventListener('click', async () => {
      await db.deleteExerciseFromDay(date, ex.id);
      toast(`${ex.name} skipped today`);
      go(`#/day/${date}`);
    });
    $('#deselect', body)?.addEventListener('click', () => { selectedId = null; draw(readForm()); });
    $('#del', body)?.addEventListener('click', async () => {
      await db.deleteSet(selected.id);
      selectedId = null;
      toast('Set deleted');
      draw(readForm());
    });
    $$('#sets li', body).forEach((li) => li.addEventListener('click', () => {
      const s = sets.find((x) => x.id === li.dataset.id);
      if (selectedId === s.id) { selectedId = null; draw(readForm()); return; }
      selectedId = s.id;
      draw(s);
    }));
  }
  draw();
}

function renderHistory(body, ex, currentDate) {
  const sets = db.setsFor(ex.id);
  const prs = prSetIds(sets, ex.type);
  const days = [...groupByDate(sets)].reverse();
  body.innerHTML = days.length ? days.map(([date, daySets]) => `
    <div class="card history-day ${date === currentDate ? 'current' : ''}">
      <a class="history-date" href="#/day/${date}">${esc(formatDayLong(date))}</a>
      <ol class="setlist">${daySets.map((s) => `<li>${esc(formatSet(s, ex.type, distUnitOf(ex)))}${setSplit(s, displayOf(ex)) ? ` <span class="split">${esc(setSplit(s, displayOf(ex)))}</span>` : ''}${prs.has(s.id) ? ' <span class="pr">🏆</span>' : ''}${s.comment ? ` <span class="cm">${esc(s.comment)}</span>` : ''}</li>`).join('')}</ol>
    </div>`).join('') : '<p class="empty">No history for this exercise yet.</p>';
}

function renderGraph(body, ex) {
  const du = displayOf(ex);
  const metrics = METRICS[ex.type];
  const key = app.graphMetric[ex.id] || metrics[0].key;
  const metric = metrics.find((m) => m.key === key) || metrics[0];
  const range = RANGES.find((r) => r[0] === app.graphRange) || RANGES[3];
  let points = metricSeries(db.setsFor(ex.id), ex.type, metric.key, du);
  if (range[2]) {
    const cutoff = addDays(todayISO(), -range[2]);
    points = points.filter((p) => p.date >= cutoff);
  }
  const unit = kindUnit(metric.kind, du);
  body.innerHTML = `
    <div class="chips">${metrics.map((m) => `<button class="chip ${m.key === metric.key ? 'active' : ''}" data-metric="${m.key}">${m.label}</button>`).join('')}</div>
    ${rangeChips(range[0])}
    <div class="card"><h2 class="chart-title">${esc(metric.label)}${unit ? ` (${unit})` : metric.kind === 'pace' ? ` (${paceLabel(du.pu)}, faster is higher)` : ''}</h2><div id="chart"></div></div>`;
  const timeLike = metric.kind === 'duration' || metric.kind === 'pace';
  lineChart($('#chart', body), points, {
    format: (v) => formatMetric(v, metric.kind, du),
    tickFormat: timeLike ? (v) => formatDuration(v) : (v) => fmtNum(v, 1),
    invert: metric.kind === 'pace',
  });
  $$('[data-metric]', body).forEach((b) => b.addEventListener('click', () => { app.graphMetric[ex.id] = b.dataset.metric; renderGraph(body, ex); }));
  $$('[data-range]', body).forEach((b) => b.addEventListener('click', () => { app.graphRange = b.dataset.range; renderGraph(body, ex); }));
}

function renderRecords(body, ex) {
  const { rows, repMaxes, bestTimes } = computeRecords(db.setsFor(ex.id), ex.type, displayOf(ex));
  if (!rows.length) { body.innerHTML = '<p class="empty">No records yet.</p>'; return; }
  body.innerHTML = `
    <div class="card"><table class="records">
      ${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}<a class="date" href="#/day/${r.date}">${esc(formatDayLong(r.date))}</a></td></tr>`).join('')}
    </table></div>
    ${bestTimes.length ? `
      <div class="card"><h2 class="chart-title">Best times</h2>
        <table class="records">
          <tr><th>Distance</th><th>Time</th><th>Date</th></tr>
          ${bestTimes.map((b) => `<tr><td>${esc(b.label)}</td><td>${formatDuration(b.seconds)}<span class="muted date">${esc(b.split)}</span></td><td><a href="#/day/${b.date}">${esc(formatDayLong(b.date))}</a></td></tr>`).join('')}
        </table></div>` : ''}
    ${repMaxes.length ? `
      <div class="card"><h2 class="chart-title">Rep maxes</h2>
        <p class="hint">Heaviest weight lifted for at least this many reps.</p>
        <table class="records">
          <tr><th>Reps</th><th>Best</th><th>Date</th></tr>
          ${repMaxes.map((r) => `<tr><td>${r.reps}</td><td>${fmtNum(r.weight)} ${wUnit()}${r.actualReps !== r.reps ? ` <span class="muted">(× ${r.actualReps})</span>` : ''}</td><td><a href="#/day/${r.date}">${esc(formatDayLong(r.date))}</a></td></tr>`).join('')}
        </table></div>` : ''}`;
}

// ---------- calendar ----------

function viewCalendar(ym) {
  const marks = db.datesWithSets();
  const today = todayISO();
  const weeks = monthGrid(ym);
  const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const inMonth = [...marks.keys()].filter((d) => d.startsWith(ym)).length;
  renderShell({
    title: 'Calendar',
    tab: 'calendar',
    body: `
      <div class="calnav">
        <a class="btn ghost" href="#/calendar/${addMonths(ym, -1)}" aria-label="Previous month">‹</a>
        <h2>${esc(formatMonth(ym))}</h2>
        <a class="btn ghost" href="#/calendar/${addMonths(ym, 1)}" aria-label="Next month">›</a>
      </div>
      <table class="cal" id="cal">
        <tr>${dows.map((d) => `<th>${d}</th>`).join('')}</tr>
        ${weeks.map((w) => `<tr>${w.map((d) => {
          if (!d) return '<td></td>';
          const cats = [...(marks.get(d) || [])].map((id) => state.categories.get(id)).filter(Boolean).sort((x, y) => x.sort - y.sort);
          return `<td><a href="#/day/${d}" class="${d === today ? 'today' : ''} ${cats.length ? 'has' : ''}">
            <span>${Number(d.slice(8))}</span>
            <span class="dots">${cats.slice(0, 4).map((c) => `<i style="background:${esc(c.colour)}"></i>`).join('')}</span>
          </a></td>`;
        }).join('')}</tr>`).join('')}
      </table>
      <p class="hint">${inMonth} workout day${inMonth === 1 ? '' : 's'} this month.</p>
      <ul class="legend">${db.categoryList().map((c) => `<li><i style="background:${esc(c.colour)}"></i>${esc(c.name)}</li>`).join('')}</ul>`,
  });
  addSwipe($('#cal'), (dir) => { location.hash = `#/calendar/${addMonths(ym, dir)}`; });
}

// ---------- exercise & category management ----------

function viewExercises() {
  const cats = db.categoryList();
  renderShell({
    title: 'Exercises',
    back: '#/settings',
    tab: 'settings',
    actions: '<a class="hbtn plus" href="#/exercise-edit/new" aria-label="New exercise">+</a>',
    body: `
      <input type="search" id="search" class="search" placeholder="Search exercises" autocomplete="off">
      <div id="list">
        ${cats.map((c) => `
          <h2 class="group" data-group><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}</h2>
          <ul class="list">${db.exercisesIn(c.id).map((e) => exerciseLink(e, `#/exercise-edit/${e.id}`)).join('') || '<li class="empty">None</li>'}</ul>`).join('')}
      </div>
      <a class="btn" href="#/categories">Edit categories</a>`,
  });
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#list li').forEach((li) => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
    $$('#list [data-group]').forEach((h) => { h.hidden = !!q; });
  });
}

function viewExerciseEdit(id, params) {
  const isNew = id === 'new';
  const ex = isNew
    ? { id: db.uid(), name: '', categoryId: params.get('cat') || db.categoryList()[0]?.id, type: 'weight_reps', notes: '' }
    : state.exercises.get(id);
  if (!ex) return go('#/exercises');
  const returnTo = params.get('return') || '#/exercises';
  const setCount = isNew ? 0 : db.setsFor(ex.id).length;
  renderShell({
    title: isNew ? 'New exercise' : 'Edit exercise',
    back: returnTo,
    tab: 'settings',
    body: `
      <form id="ex-form" class="card form">
        <label class="field"><span>Name</span><input id="name" required value="${esc(ex.name)}" autocomplete="off"></label>
        <label class="field"><span>Category</span>
          <select id="cat">${db.categoryList().map((c) => `<option value="${c.id}" ${c.id === ex.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Type</span>
          <select id="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === ex.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
        </label>
        <label class="field" id="du-field" ${ex.type === 'distance_time' ? '' : 'hidden'}><span>Distance unit</span>
          <select id="du">
            <option value="">Default (${dUnit()})</option>
            ${Object.entries(DISTANCE_UNITS).map(([k, l]) => `<option value="${k}" ${ex.distanceUnit === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field" id="pu-field" ${ex.type === 'distance_time' ? '' : 'hidden'}><span>Pace shown</span>
          <select id="pu">
            <option value="">Default (${paceLabel(paceUnit(distUnitOf(ex)))})</option>
            ${Object.entries(PACE_UNITS).map(([k, l]) => `<option value="${k}" ${ex.paceUnit === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="toggle" id="watts-field" ${ex.type === 'distance_time' ? '' : 'hidden'}><input id="watts" type="checkbox" ${ex.showWatts ? 'checked' : ''}> Show watts (rowing machines)</label>
        ${setCount ? '<p class="hint">Changing the type of an exercise with logged sets hides values the new type does not use.</p>' : ''}
        <label class="field"><span>Notes</span><textarea id="notes" rows="2" placeholder="Seat height, grip, cues…">${esc(ex.notes)}</textarea></label>
        <button class="btn primary" type="submit">Save</button>
      </form>
      ${isNew ? '' : `<button class="btn danger" id="delete">Delete exercise${setCount ? ` and its ${setCount} set${setCount === 1 ? '' : 's'}` : ''}</button>`}`,
  });
  $('#type').addEventListener('change', (e) => {
    ['#du-field', '#pu-field', '#watts-field'].forEach((id) => { $(id).hidden = e.target.value !== 'distance_time'; });
  });
  $('#ex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return toast('Enter a name.');
    const dupe = [...state.exercises.values()].find((x) => x.id !== ex.id && x.name.toLowerCase() === name.toLowerCase());
    if (dupe) return toast('An exercise with that name already exists.');
    const type = $('#type').value;
    await db.saveExercise({
      ...ex, name, categoryId: $('#cat').value, type, notes: $('#notes').value.trim(),
      distanceUnit: type === 'distance_time' ? $('#du').value : '',
      paceUnit: type === 'distance_time' ? $('#pu').value : '',
      showWatts: type === 'distance_time' && $('#watts').checked,
    });
    toast('Exercise saved');
    go(returnTo);
  });
  $('#delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${ex.name}${setCount ? ` and all ${setCount} logged sets` : ''}? It is also removed from any routine. This cannot be undone.`)) return;
    await db.deleteExercise(ex.id);
    toast('Exercise deleted');
    go('#/exercises');
  });
}

function viewCategories() {
  const cats = db.categoryList();
  renderShell({
    title: 'Categories',
    back: '#/exercises',
    tab: 'settings',
    body: `
      <ul class="list cats-edit">
        ${cats.map((c) => `
          <li data-id="${c.id}">
            <input type="color" value="${esc(c.colour)}" aria-label="Colour for ${esc(c.name)}">
            <input type="text" value="${esc(c.name)}" aria-label="Category name">
            <button class="danger" data-del aria-label="Delete ${esc(c.name)}">✕</button>
          </li>`).join('')}
      </ul>
      <button class="btn" id="add-cat">+ Add category</button>`,
  });
  $$('.cats-edit li').forEach((li) => {
    const cat = state.categories.get(li.dataset.id);
    const [colour, name] = $$('input', li);
    const save = async () => {
      const n = name.value.trim();
      if (!n) { name.value = cat.name; return; }
      Object.assign(cat, { name: n, colour: colour.value });
      await db.saveCategory(cat);
    };
    colour.addEventListener('change', save);
    name.addEventListener('change', save);
    $('[data-del]', li).addEventListener('click', async () => {
      try {
        if (!confirm(`Delete category ${cat.name}?`)) return;
        await db.deleteCategory(cat.id);
        nav.route();
      } catch (err) { toast(err.message); }
    });
  });
  $('#add-cat').addEventListener('click', async () => {
    const sort = Math.max(-1, ...cats.map((c) => c.sort)) + 1;
    await db.saveCategory({ id: db.uid(), name: 'New category', colour: '#607d8b', sort });
    nav.route();
  });
}

// ---------- settings & backup ----------

function segmented(name, options, value) {
  return `<div class="seg units" role="radiogroup">${options.map(([v, label]) => `
    <label class="${v === value ? 'active' : ''}"><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}>${label}</label>`).join('')}</div>`;
}

async function viewSettings() {
  const s = state.settings;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  renderShell({
    title: 'Settings',
    tab: 'settings',
    body: `
      ${standalone ? '' : `
        <div class="card info">
          <strong>Install on your iPhone</strong>
          <p>In Safari, tap the Share button, then <em>Add to Home Screen</em>. The app then opens full-screen and works offline.</p>
        </div>`}
      <ul class="list">
        <li><a href="#/exercises">Exercises &amp; categories<span class="count">${state.exercises.size}</span></a></li>
      </ul>
      <form class="card form" id="units">
        <h2>Units</h2>
        <p class="hint">Switching converts everything already logged (sets, records, graphs, bodyweight, routine targets). Nothing is lost.</p>
        <div class="field"><span>Weight</span>${segmented('weightUnit', [['lbs', 'Pounds (lbs)'], ['kg', 'Kilograms (kg)']], s.weightUnit)}</div>
        <div class="field"><span>Distance (default)</span>${segmented('distanceUnit', Object.entries(DISTANCE_UNITS).map(([k]) => [k, k === 'm' ? 'Metres' : k === 'km' ? 'Kilometres' : 'Miles']), s.distanceUnit)}</div>
        <p class="hint">Any cardio exercise can use its own unit instead: Settings → Exercises → the exercise → Distance unit.</p>
        <p class="hint">1 kg = ${fmtNum(LB_PER_KG, 4)} lbs · 1 mi = ${fmtNum(KM_PER_MI, 4)} km = ${fmtNum(KM_PER_MI * 1000, 0)} m</p>
      </form>
      <form class="card form" id="settings">
        <h2>Rest timer</h2>
        <label class="field"><span>Default rest (seconds)</span><input id="rest" type="number" inputmode="numeric" min="5" max="1800" value="${s.restSeconds}"></label>
        <label class="toggle"><input id="auto" type="checkbox" ${s.autoStartTimer ? 'checked' : ''}> Start automatically after saving a set</label>
        <label class="toggle"><input id="sound" type="checkbox" ${s.timerSound ? 'checked' : ''}> Beep when rest is over</label>
        <h2>Entry</h2>
        <label class="field"><span>Weight increment (${wUnit()})</span><input id="wstep" type="number" inputmode="decimal" min="0.25" step="0.25" value="${s.weightStep}"></label>
      </form>
      <div class="card form">
        <h2>Your data</h2>
        <p class="hint">Data is stored only on this device. Back up regularly, for example to iCloud Drive via the share sheet.
          Last backup: <strong>${state.lastBackup ? esc(new Date(state.lastBackup).toLocaleString()) : 'never'}</strong>.
          ${persisted === false ? '<br>Storage is not yet marked persistent; installing to the Home Screen helps.' : ''}</p>
        <button class="btn primary" id="backup">Back up (JSON)</button>
        <button class="btn" id="restore">Restore from backup…</button>
        <button class="btn" id="csv">Export CSV (spreadsheet)</button>
        <input type="file" id="restore-file" accept="application/json,.json" hidden>
        <p class="hint">${state.sets.size} sets · ${state.body.size} bodyweight entries · ${state.routines.size} routines · ${state.exercises.size} exercises</p>
      </div>
      <div class="card form">
        <h2>App</h2>
        <p class="hint">Version <strong id="app-version">…</strong>. Updates install automatically when you open the app online.</p>
        <button class="btn" id="check-update">Check for updates</button>
      </div>
      <p class="hint center">Gym Log · weights in ${wUnit()}, distances in ${dUnit()} by default</p>`,
  });

  appVersion().then((v) => { const el = $('#app-version'); if (el) el.textContent = v; });
  $('#check-update').addEventListener('click', checkForUpdate);
  $('#units').addEventListener('change', async () => {
    const weightUnit = $('#units input[name=weightUnit]:checked').value;
    const distanceUnit = $('#units input[name=distanceUnit]:checked').value;
    const patch = { weightUnit, distanceUnit };
    // The step is in display units, so reset it to a sensible default when the unit changes.
    if (weightUnit !== s.weightUnit) patch.weightStep = DEFAULT_WEIGHT_STEP[weightUnit];
    await db.saveSettings(patch);
    toast(`Showing ${wUnit()} and ${dUnit()}`);
    nav.route();
  });
  const num = (id, min, max) => Math.min(max, Math.max(min, Number($(id).value) || min));
  $('#settings').addEventListener('change', async () => {
    await db.saveSettings({
      restSeconds: Math.round(num('#rest', 5, 1800)),
      autoStartTimer: $('#auto').checked,
      timerSound: $('#sound').checked,
      weightStep: num('#wstep', 0.25, 100),
    });
    timer.setSound(state.settings.timerSound);
    toast('Settings saved');
  });
  $('#backup').addEventListener('click', async () => {
    const name = `gymlog-backup-${todayISO()}.json`;
    if (await shareOrDownload(name, JSON.stringify(db.exportBackup()), 'application/json')) {
      await db.markBackedUp();
      nav.route();
    }
  });
  $('#csv').addEventListener('click', () => {
    shareOrDownload(`gymlog-${todayISO()}.csv`, toCSV([...state.sets.values()], state.exercises, state.categories), 'text/csv');
  });
  const fileInput = $('#restore-file');
  $('#restore').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!confirm(`Replace ALL current data with this backup (${obj.sets?.length ?? 0} sets)?`)) return;
      await db.importBackup(obj);
      timer.setSound(state.settings.timerSound);
      toast('Backup restored');
      nav.route();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    } finally {
      fileInput.value = '';
    }
  });
}

// ---------- timer bar ----------

function initTimerBar() {
  const bar = $('#timer');
  bar.innerHTML = `
    <div class="progress"><i></i></div>
    <span class="label">Rest</span>
    <strong class="time">0:00</strong>
    <button data-t="-15" aria-label="Subtract 15 seconds">−15</button>
    <button data-t="15" aria-label="Add 15 seconds">+15</button>
    <button data-t="stop" aria-label="Stop timer">✕</button>`;
  $$('button', bar).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.t === 'stop') timer.stop();
    else timer.adjust(Number(b.dataset.t));
  }));
  timer.setSound(state.settings.timerSound);
  timer.subscribe(({ running, remaining, total }) => {
    bar.hidden = !running;
    document.body.classList.toggle('timer-on', running);
    if (!running) return;
    $('.time', bar).textContent = formatDuration(remaining);
    $('.progress i', bar).style.width = `${total ? (100 * remaining) / total : 0}%`;
  });
}

// ---------- updates ----------

const STARTED_AT = Date.now();
let swRegistration = null;

// When a new version takes over: reload straight away if the app was only just
// opened, otherwise offer a banner so a half-typed set is never lost.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (Date.now() - STARTED_AT < 15000) {
      reloading = true;
      location.reload();
      return;
    }
    const bar = $('#update-bar');
    bar.hidden = false;
    bar.onclick = () => { reloading = true; location.reload(); };
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swRegistration = reg;
    // iOS often resumes the app without reloading it, so check whenever it comes back.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

async function appVersion() {
  try {
    const key = (await caches.keys()).find((k) => k.startsWith('gymlog-'));
    return key ? key.replace('gymlog-', '') : 'unknown';
  } catch { return 'unknown'; }
}

async function checkForUpdate() {
  if (!swRegistration) return toast('Updates are not available in this browser.');
  toast('Checking for updates…');
  try {
    await swRegistration.update();
    const incoming = swRegistration.installing || swRegistration.waiting;
    if (!incoming) toast('You have the latest version.');
    else toast('Downloading update…');
  } catch {
    toast('Could not check for updates (offline?).');
  }
}

// ---------- app-like touch ----------

// iOS ignores user-scalable=no, so block pinch-zoom directly: Safari's gesture
// events, plus any two-finger move (which would otherwise start a zoom).
function preventZoom() {
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}

// ---------- router ----------

const LOG_VIEWS = ['day', 'add', 'ex', 'swap'];
const isLogView = (view) => !view || LOG_VIEWS.includes(view);
const currentView = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
let lastLogHash = null;

function route() {
  if (isLogView(currentView())) lastLogHash = location.hash || `#/day/${todayISO()}`;
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const [view, a, b, c] = parts;
  const today = todayISO();
  if (view !== 'day') app.dayEditMode = false;
  switch (view) {
    case 'day': return viewDay(isISODate(a) ? a : today);
    case 'add':
      if (!isISODate(a)) return go(`#/add/${today}`);
      return b ? viewPickExercise(a, b) : viewPickCategory(a);
    case 'ex': return viewExercise(a, isISODate(b) ? b : today, c || 'track');
    case 'calendar': return viewCalendar(/^\d{4}-\d{2}$/.test(a || '') ? a : today.slice(0, 7));
    case 'routines': return viewRoutines();
    case 'routine': return viewRoutineEdit(a);
    case 'workout': return viewWorkoutEdit(a, b);
    case 'radd': return viewRoutinePick(a, b, c);
    case 'radd-do': return addToWorkout(a, b, c);
    case 'start': return startFromRoute(a, b, c);
    case 'swap': return viewSwapPick(a, b, c);
    case 'swap-do': return doSwap(a, b, c);
    case 'body': return viewBody(a);
    case 'exercises': return viewExercises();
    case 'exercise-edit': return viewExerciseEdit(a, params);
    case 'categories': return viewCategories();
    case 'settings': return viewSettings();
    default: return viewDay(today);
  }
}

async function main() {
  try {
    await db.init();
  } catch (err) {
    $('#main').innerHTML = `<p class="empty">Could not open storage: ${esc(err.message)}. Private Browsing can block it.</p>`;
    return;
  }
  nav.route = route;
  navigator.storage?.persist?.().catch(() => {});
  initTimerBar();
  document.addEventListener('pointerdown', timer.unlockAudio, { once: true });
  preventZoom();
  // iOS can nudge the whole page up to reveal a focused input; put it back afterwards.
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches('input, textarea, select')) window.scrollTo(0, 0);
  }, 100));
  // The "Log" tab always returns to today.
  // The Log tab returns to whatever was last open in it (e.g. a lift) if that was
  // for today; tapping it while already in the Log goes to today's overview.
  $('#tab-log').addEventListener('click', (e) => {
    e.preventDefault();
    const today = todayISO();
    const resume = !isLogView(currentView()) && lastLogHash?.includes(`/${today}`);
    go(resume ? lastLogHash : `#/day/${today}`);
  });
  window.addEventListener('hashchange', route);
  route();

  registerServiceWorker();
}

main();
