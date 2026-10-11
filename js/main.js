import * as db from './db.js';
import { state } from './db.js';
import * as timer from './timer.js';
import { lineChart } from './chart.js';
import {
  TYPES, WEIGHT_UNIT, DISTANCE_UNIT, METRICS,
  todayISO, addDays, addMonths, isISODate, formatDayLong, formatMonth, monthGrid,
  fmtNum, formatDuration, formatSet, formatMetric, validateSet,
  prSetIds, computeRecords, metricSeries, groupByDate, toCSV,
} from './logic.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const app = {
  header: null, main: null, tabs: null, timerBar: null,
  dayEditMode: false,
  graphMetric: {}, // exerciseId -> metric key
  graphRange: 'all',
};

// ---------- shell ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => t.classList.remove('show'), 2200);
}

function renderShell({ title, back, actions = '', body, tab }) {
  app.header.innerHTML = `
    ${back ? `<a class="hbtn back" href="${back}" aria-label="Back">‹</a>` : '<span class="hbtn"></span>'}
    <h1>${title}</h1>
    <div class="hactions">${actions}</div>`;
  app.main.innerHTML = body;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  app.main.scrollTop = 0;
}

const catOf = (ex) => state.categories.get(ex?.categoryId);
const colourOf = (ex) => catOf(ex)?.colour || '#888';

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

function viewDay(date) {
  const exercises = db.exercisesOn(date);
  const edit = app.dayEditMode && exercises.length > 0;
  const note = state.days.get(date)?.note || '';
  const cards = exercises.map((ex, i) => {
    const sets = db.setsOnFor(date, ex.id);
    const prs = prSetIds(db.setsFor(ex.id), ex.type);
    return `
      <div class="card ex-card" style="--cat:${esc(colourOf(ex))}">
        <a class="ex-card-main" href="#/ex/${ex.id}/${date}/track">
          <div class="ex-name">${esc(ex.name)}</div>
          <ol class="setlist">
            ${sets.map((s) => `<li>${esc(formatSet(s, ex.type))}${prs.has(s.id) ? ' <span class="pr" title="Personal record">🏆</span>' : ''}${s.comment ? ' <span class="cm" title="Comment">💬</span>' : ''}</li>`).join('')}
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
    </div>`;

  renderShell({
    title: `<button class="datebtn" id="pick-date">${esc(formatDayLong(date))}</button>`,
    tab: 'log',
    actions: `
      ${exercises.length ? `<button class="hbtn" id="toggle-edit">${edit ? 'Done' : 'Edit'}</button>` : ''}
      <a class="hbtn plus" href="#/add/${date}" aria-label="Add exercise">+</a>`,
    body: `
      <div class="daynav">
        <a class="btn ghost" href="#/day/${addDays(date, -1)}" aria-label="Previous day">‹ ${esc(formatDayLong(addDays(date, -1)))}</a>
        ${date !== todayISO() ? `<a class="btn ghost" href="#/day/${todayISO()}">Today</a>` : ''}
        <a class="btn ghost" href="#/day/${addDays(date, 1)}" aria-label="Next day">${esc(formatDayLong(addDays(date, 1)))} ›</a>
      </div>
      ${needsBackupNudge() ? '<a class="banner" href="#/settings">It has been a while since your last backup. Tap to back up.</a>' : ''}
      <div id="day" class="day">${exercises.length ? cards : empty}</div>
      ${exercises.length ? `
        <label class="field note"><span>Workout note</span>
          <textarea id="day-note" rows="2" placeholder="How did it go?">${esc(note)}</textarea>
        </label>` : ''}
      <input type="date" id="date-input" class="visually-hidden" value="${date}">`,
  });

  $('#toggle-edit')?.addEventListener('click', () => { app.dayEditMode = !app.dayEditMode; route(); });
  $$('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    await db.moveExerciseInDay(date, b.dataset.move, Number(b.dataset.delta));
    route();
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const ex = state.exercises.get(b.dataset.remove);
    if (!confirm(`Remove ${ex.name} and its sets from this day?`)) return;
    await db.deleteExerciseFromDay(date, ex.id);
    route();
  }));
  $('#copy-prev')?.addEventListener('click', async () => {
    await db.copyDay(prev, date);
    toast('Workout copied');
    route();
  });
  $('#day-note')?.addEventListener('change', async (e) => {
    const day = state.days.get(date) || { date, exerciseOrder: [] };
    await db.saveDay({ ...day, note: e.target.value.trim() });
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

function addSwipe(node, onSwipe) {
  let sx = 0; let sy = 0; let tracking = false;
  node.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
  });
}

// ---------- pick exercise ----------

function viewPickCategory(date) {
  const cats = db.categoryList();
  renderShell({
    title: 'Add exercise',
    back: `#/day/${date}`,
    tab: 'log',
    body: `
      <input type="search" id="search" class="search" placeholder="Search exercises" autocomplete="off">
      <div id="results"></div>
      <ul class="list" id="cats">
        ${cats.map((c) => `<li><a href="#/add/${date}/${c.id}"><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}<span class="count">${db.exercisesIn(c.id).length}</span></a></li>`).join('')}
      </ul>
      <a class="btn" href="#/exercise-edit/new?return=${encodeURIComponent(`#/add/${date}`)}">+ New exercise</a>`,
  });
  const search = $('#search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    $('#cats').hidden = !!q;
    if (!q) { $('#results').innerHTML = ''; return; }
    const hits = [...state.exercises.values()].filter((e) => e.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    $('#results').innerHTML = hits.length
      ? `<ul class="list">${hits.map((e) => exerciseLink(e, `#/ex/${e.id}/${date}/track`)).join('')}</ul>`
      : '<p class="empty">No matches.</p>';
  });
}

function exerciseLink(ex, href) {
  return `<li><a href="${href}"><span class="swatch" style="background:${esc(colourOf(ex))}"></span>${esc(ex.name)}<span class="meta">${esc(TYPES[ex.type]?.label)}</span></a></li>`;
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

// ---------- exercise: track / history / graph / records ----------

function viewExercise(exerciseId, date, tab) {
  const ex = state.exercises.get(exerciseId);
  if (!ex) return go(`#/day/${date}`);
  const tabs = [['track', 'Track'], ['history', 'History'], ['graph', 'Graph'], ['records', 'Records']];
  renderShell({
    title: esc(ex.name),
    back: `#/day/${date}`,
    tab: 'log',
    actions: `<button class="hbtn" id="start-timer" aria-label="Start rest timer">⏱</button>`,
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

function stepper(id, label, value, { step, inputmode = 'decimal' }) {
  return `
    <div class="stepper">
      <span class="label">${label}</span>
      <button type="button" data-step="${id}" data-delta="${-step}" aria-label="Decrease ${label}">−</button>
      <input id="${id}" type="text" inputmode="${inputmode}" value="${esc(value)}" autocomplete="off">
      <button type="button" data-step="${id}" data-delta="${step}" aria-label="Increase ${label}">+</button>
    </div>`;
}

function durationInputs(seconds) {
  const s = Math.round(seconds || 0);
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return `
    <div class="stepper duration">
      <span class="label">Time</span>
      <div class="hms">
        <input id="f-h" type="text" inputmode="numeric" value="${parts[0] || ''}" placeholder="h" aria-label="Hours">:
        <input id="f-m" type="text" inputmode="numeric" value="${parts[1] || ''}" placeholder="mm" aria-label="Minutes">:
        <input id="f-s" type="text" inputmode="numeric" value="${parts[2] || ''}" placeholder="ss" aria-label="Seconds">
      </div>
    </div>`;
}

function renderTrack(body, ex, date) {
  const fields = TYPES[ex.type].fields;
  let selectedId = null;

  // Prefill from the last set today, else the last time this exercise was done.
  const history = db.setsFor(ex.id);
  const today = db.setsOnFor(date, ex.id);
  const template = today[today.length - 1] || history.filter((s) => s.date < date).pop() || {};

  function formHtml(values) {
    const parts = [];
    if (fields.includes('weight')) parts.push(stepper('f-weight', `Weight (${WEIGHT_UNIT})`, fmtNum(values.weight ?? 0), { step: state.settings.weightStep }));
    if (fields.includes('reps')) parts.push(stepper('f-reps', 'Reps', values.reps ?? 0, { step: 1, inputmode: 'numeric' }));
    if (fields.includes('distance')) parts.push(stepper('f-distance', `Distance (${DISTANCE_UNIT})`, fmtNum(values.distance ?? 0), { step: state.settings.distanceStep }));
    if (fields.includes('seconds')) parts.push(durationInputs(values.seconds));
    return parts.join('');
  }

  function readForm() {
    const num = (id) => {
      const v = $(`#${id}`)?.value.trim();
      return v ? Number(v) : 0;
    };
    const out = {};
    if (fields.includes('weight')) out.weight = num('f-weight');
    if (fields.includes('reps')) out.reps = Math.round(num('f-reps'));
    if (fields.includes('distance')) out.distance = num('f-distance');
    if (fields.includes('seconds')) out.seconds = num('f-h') * 3600 + num('f-m') * 60 + num('f-s');
    return out;
  }

  function draw(values = template) {
    const sets = db.setsOnFor(date, ex.id);
    const prs = prSetIds(db.setsFor(ex.id), ex.type);
    const selected = sets.find((s) => s.id === selectedId);
    body.innerHTML = `
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
            <span class="v">${esc(formatSet(s, ex.type))}</span>
            ${prs.has(s.id) ? '<span class="pr" title="Personal record">🏆</span>' : ''}
            ${s.comment ? `<span class="cm">${esc(s.comment)}</span>` : ''}
          </li>`).join('')}
      </ol>
      ${sets.length === 0 ? '<p class="empty">No sets yet today. Enter values and tap Save.</p>' : ''}`;

    $$('[data-step]', body).forEach((b) => b.addEventListener('click', () => {
      const input = $(`#${b.dataset.step}`);
      const next = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.delta));
      input.value = fmtNum(next);
    }));
    $$('#set-form input[inputmode]', body).forEach((i) => i.addEventListener('focus', () => i.select()));

    $('#set-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = readForm();
      const err = validateSet(values, ex.type);
      if (err) return toast(err);
      if (selected) {
        await db.updateSet({ ...selected, ...values, comment: $('#f-comment').value.trim() });
        selectedId = null;
        toast('Set updated');
      } else {
        await db.addSet({ date, exerciseId: ex.id, ...values });
        if (state.settings.autoStartTimer) timer.start(state.settings.restSeconds);
      }
      draw(values);
    });
    $('#clear', body)?.addEventListener('click', () => draw({}));
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
      <ol class="setlist">${daySets.map((s) => `<li>${esc(formatSet(s, ex.type))}${prs.has(s.id) ? ' <span class="pr">🏆</span>' : ''}${s.comment ? ` <span class="cm">${esc(s.comment)}</span>` : ''}</li>`).join('')}</ol>
    </div>`).join('') : '<p class="empty">No history for this exercise yet.</p>';
}

const RANGES = [['1m', '1M', 31], ['3m', '3M', 92], ['1y', '1Y', 366], ['all', 'All', null]];

function renderGraph(body, ex) {
  const metrics = METRICS[ex.type];
  const key = app.graphMetric[ex.id] || metrics[0].key;
  const metric = metrics.find((m) => m.key === key) || metrics[0];
  const range = RANGES.find((r) => r[0] === app.graphRange) || RANGES[3];
  let points = metricSeries(db.setsFor(ex.id), ex.type, metric.key);
  if (range[2]) {
    const cutoff = addDays(todayISO(), -range[2]);
    points = points.filter((p) => p.date >= cutoff);
  }
  body.innerHTML = `
    <div class="chips">${metrics.map((m) => `<button class="chip ${m.key === metric.key ? 'active' : ''}" data-metric="${m.key}">${m.label}</button>`).join('')}</div>
    <div class="chips">${RANGES.map(([k, l]) => `<button class="chip small ${k === range[0] ? 'active' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
    <div class="card"><h2 class="chart-title">${esc(metric.label)}${['duration', 'pace'].includes(metric.unit) ? '' : ` (${metric.unit})`}</h2><div id="chart"></div></div>`;
  const tickFormat = metric.unit === 'duration' || metric.unit === 'pace'
    ? (v) => formatDuration(v)
    : (v) => fmtNum(v, 1);
  lineChart($('#chart', body), points, { format: (v) => formatMetric(v, metric.unit), tickFormat });
  $$('[data-metric]', body).forEach((b) => b.addEventListener('click', () => { app.graphMetric[ex.id] = b.dataset.metric; renderGraph(body, ex); }));
  $$('[data-range]', body).forEach((b) => b.addEventListener('click', () => { app.graphRange = b.dataset.range; renderGraph(body, ex); }));
}

function renderRecords(body, ex) {
  const { rows, repMaxes } = computeRecords(db.setsFor(ex.id), ex.type);
  if (!rows.length) { body.innerHTML = '<p class="empty">No records yet.</p>'; return; }
  body.innerHTML = `
    <div class="card"><table class="records">
      ${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}<a class="date" href="#/day/${r.date}">${esc(formatDayLong(r.date))}</a></td></tr>`).join('')}
    </table></div>
    ${repMaxes.length ? `
      <div class="card"><h2 class="chart-title">Rep maxes</h2>
        <p class="hint">Heaviest weight lifted for at least this many reps.</p>
        <table class="records">
          <tr><th>Reps</th><th>Best</th><th>Date</th></tr>
          ${repMaxes.map((r) => `<tr><td>${r.reps}</td><td>${fmtNum(r.weight)} ${WEIGHT_UNIT}${r.actualReps !== r.reps ? ` <span class="muted">(× ${r.actualReps})</span>` : ''}</td><td><a href="#/day/${r.date}">${esc(formatDayLong(r.date))}</a></td></tr>`).join('')}
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
    tab: 'exercises',
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
    tab: 'exercises',
    body: `
      <form id="ex-form" class="card form">
        <label class="field"><span>Name</span><input id="name" required value="${esc(ex.name)}" autocomplete="off"></label>
        <label class="field"><span>Category</span>
          <select id="cat">${db.categoryList().map((c) => `<option value="${c.id}" ${c.id === ex.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Type</span>
          <select id="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === ex.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
        </label>
        ${setCount ? '<p class="hint">Changing the type of an exercise with logged sets hides values the new type does not use.</p>' : ''}
        <label class="field"><span>Notes</span><textarea id="notes" rows="2" placeholder="Seat height, grip, cues…">${esc(ex.notes)}</textarea></label>
        <button class="btn primary" type="submit">Save</button>
      </form>
      ${isNew ? '' : `<button class="btn danger" id="delete">Delete exercise${setCount ? ` and its ${setCount} set${setCount === 1 ? '' : 's'}` : ''}</button>`}`,
  });
  $('#ex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return toast('Enter a name.');
    const dupe = [...state.exercises.values()].find((x) => x.id !== ex.id && x.name.toLowerCase() === name.toLowerCase());
    if (dupe) return toast('An exercise with that name already exists.');
    await db.saveExercise({ ...ex, name, categoryId: $('#cat').value, type: $('#type').value, notes: $('#notes').value.trim() });
    toast('Exercise saved');
    go(returnTo);
  });
  $('#delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${ex.name}${setCount ? ` and all ${setCount} logged sets` : ''}? This cannot be undone.`)) return;
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
    tab: 'exercises',
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
        route();
      } catch (err) { toast(err.message); }
    });
  });
  $('#add-cat').addEventListener('click', async () => {
    const sort = Math.max(-1, ...cats.map((c) => c.sort)) + 1;
    await db.saveCategory({ id: db.uid(), name: 'New category', colour: '#607d8b', sort });
    route();
  });
}

// ---------- settings & backup ----------

async function shareOrDownload(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
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
      <form class="card form" id="settings">
        <h2>Rest timer</h2>
        <label class="field"><span>Default rest (seconds)</span><input id="rest" type="number" inputmode="numeric" min="5" max="1800" value="${s.restSeconds}"></label>
        <label class="toggle"><input id="auto" type="checkbox" ${s.autoStartTimer ? 'checked' : ''}> Start automatically after saving a set</label>
        <label class="toggle"><input id="sound" type="checkbox" ${s.timerSound ? 'checked' : ''}> Beep when rest is over</label>
        <h2>Entry</h2>
        <label class="field"><span>Weight increment (${WEIGHT_UNIT})</span><input id="wstep" type="number" inputmode="decimal" min="0.5" step="0.5" value="${s.weightStep}"></label>
        <label class="field"><span>Distance increment (${DISTANCE_UNIT})</span><input id="dstep" type="number" inputmode="decimal" min="0.01" step="0.01" value="${s.distanceStep}"></label>
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
        <p class="hint">${state.sets.size} sets · ${state.exercises.size} exercises · ${state.categories.size} categories</p>
      </div>
      <p class="hint center">Gym Log · weights in ${WEIGHT_UNIT}, distances in ${DISTANCE_UNIT}</p>`,
  });

  const num = (id, min, max) => Math.min(max, Math.max(min, Number($(id).value) || min));
  $('#settings').addEventListener('change', async () => {
    await db.saveSettings({
      restSeconds: Math.round(num('#rest', 5, 1800)),
      autoStartTimer: $('#auto').checked,
      timerSound: $('#sound').checked,
      weightStep: num('#wstep', 0.5, 100),
      distanceStep: num('#dstep', 0.01, 10),
    });
    timer.setSound(state.settings.timerSound);
    toast('Settings saved');
  });
  $('#backup').addEventListener('click', async () => {
    const name = `gymlog-backup-${todayISO()}.json`;
    if (await shareOrDownload(name, JSON.stringify(db.exportBackup()), 'application/json')) {
      await db.markBackedUp();
      route();
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
      route();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
    } finally {
      fileInput.value = '';
    }
  });
}

// ---------- timer bar ----------

function initTimerBar() {
  const bar = app.timerBar;
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

// ---------- router ----------

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
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
    case 'exercises': return viewExercises();
    case 'exercise-edit': return viewExerciseEdit(a, params);
    case 'categories': return viewCategories();
    case 'settings': return viewSettings();
    default: return viewDay(today);
  }
}

async function main() {
  app.header = $('#header');
  app.main = $('#main');
  app.timerBar = $('#timer');
  try {
    await db.init();
  } catch (err) {
    app.main.innerHTML = `<p class="empty">Could not open storage: ${esc(err.message)}. Private Browsing can block it.</p>`;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  initTimerBar();
  document.addEventListener('pointerdown', timer.unlockAudio, { once: true });
  // The "Log" tab always returns to today.
  $('#tab-log').addEventListener('click', (e) => { e.preventDefault(); go(`#/day/${todayISO()}`); });
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();
