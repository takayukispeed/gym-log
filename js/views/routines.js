// Routines: named programmes containing workouts, each a list of exercises with
// target sets × reps (and optional weight). A workout can be loaded onto any day.
import * as db from '../db.js';
import { state } from '../db.js';
import {
  todayISO, isISODate, formatDayLong, fmtNum, weightOut, weightIn, distOut, distIn, wUnit, distUnitOf, describeTarget,
} from '../logic.js';
import { $, $$, esc, toast, renderShell, go, nav, colourOf, exerciseLink } from '../ui.js';

const findWorkout = (rid, wid) => {
  const routine = state.routines.get(rid);
  return { routine, workout: routine?.workouts.find((w) => w.id === wid) };
};

export function workoutSummary(workout) {
  return workout.items
    .map((i) => state.exercises.get(i.exerciseId))
    .filter(Boolean)
    .map((e) => e.name)
    .join(' · ') || 'No exercises yet';
}

export async function startWorkout(date, rid, wid) {
  const { workout } = findWorkout(rid, wid);
  if (!workout) return;
  if (!workout.items.length) return toast('Add exercises to this workout first.');
  await db.loadWorkout(date, workout);
  toast(`${workout.name} loaded`);
  go(`#/day/${date}`);
}

// Buttons for loading any workout onto a date (used on empty days and the add screen).
export function workoutButtons(date) {
  const routines = db.routineList().filter((r) => r.workouts.some((w) => w.items.length));
  if (!routines.length) return '';
  return routines.map((r) => `
    <h2 class="group">${esc(r.name)}</h2>
    <ul class="list">
      ${r.workouts.filter((w) => w.items.length).map((w) => `
        <li><a href="#/start/${date}/${r.id}/${w.id}" class="stack">
          <strong>${esc(w.name)}</strong><span class="meta">${esc(workoutSummary(w))}</span>
        </a></li>`).join('')}
    </ul>`).join('');
}

export function viewRoutines() {
  const routines = db.routineList();
  const today = todayISO();
  renderShell({
    title: 'Routines',
    tab: 'routines',
    actions: '<button class="hbtn plus" id="new-routine" aria-label="New routine">+</button>',
    body: routines.length ? routines.map((r) => `
      <div class="card routine">
        <div class="routine-head">
          <h2>${esc(r.name)}</h2>
          <a class="btn ghost" href="#/routine/${r.id}">Edit</a>
        </div>
        ${r.workouts.map((w) => `
          <div class="workout-row">
            <a class="workout-info" href="#/workout/${r.id}/${w.id}">
              <strong>${esc(w.name)}</strong>
              <ul class="targets">${w.items.map((i) => {
                const ex = state.exercises.get(i.exerciseId);
                return ex ? `<li><span class="swatch" style="background:${esc(colourOf(ex))}"></span>${esc(ex.name)} <span class="muted">${esc(describeTarget(i, ex.type, distUnitOf(ex)))}</span></li>` : '';
              }).join('') || '<li class="muted">No exercises yet</li>'}</ul>
            </a>
            ${w.items.length ? `<a class="btn primary small" href="#/start/${today}/${r.id}/${w.id}">Start</a>` : ''}
          </div>`).join('') || '<p class="muted">No workouts yet.</p>'}
      </div>`).join('') : '<p class="empty">No routines yet. Tap + to create one.</p>',
  });
  $('#new-routine').addEventListener('click', async () => {
    const sort = Math.max(-1, ...routines.map((r) => r.sort ?? 0)) + 1;
    const r = { id: db.uid(), name: 'New routine', sort, workouts: [{ id: db.uid(), name: 'Workout A', items: [] }] };
    await db.saveRoutine(r);
    go(`#/routine/${r.id}`);
  });
}

export function viewRoutineEdit(rid) {
  const routine = state.routines.get(rid);
  if (!routine) return go('#/routines');
  renderShell({
    title: 'Edit routine',
    back: '#/routines',
    tab: 'routines',
    body: `
      <div class="card form">
        <label class="field"><span>Routine name</span><input id="r-name" value="${esc(routine.name)}" autocomplete="off"></label>
      </div>
      <h2 class="group">Workouts</h2>
      <ul class="list reorderable">
        ${routine.workouts.map((w, i) => `
          <li>
            <a href="#/workout/${rid}/${w.id}" class="stack"><strong>${esc(w.name)}</strong><span class="meta">${esc(workoutSummary(w))}</span></a>
            <span class="row-actions">
              <button data-move="${i}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
              <button data-move="${i}" data-delta="1" ${i === routine.workouts.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
              <button data-del="${i}" class="danger" aria-label="Delete workout">✕</button>
            </span>
          </li>`).join('') || '<li class="empty">No workouts yet.</li>'}
      </ul>
      <button class="btn" id="add-workout">+ Add workout</button>
      <button class="btn danger" id="del-routine">Delete routine</button>`,
  });
  const save = () => db.saveRoutine(routine);
  $('#r-name').addEventListener('change', async (e) => {
    routine.name = e.target.value.trim() || routine.name;
    await save();
    toast('Saved');
  });
  $$('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.move);
    const j = i + Number(b.dataset.delta);
    [routine.workouts[i], routine.workouts[j]] = [routine.workouts[j], routine.workouts[i]];
    await save();
    nav.route();
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const w = routine.workouts[Number(b.dataset.del)];
    if (!confirm(`Delete workout "${w.name}"?`)) return;
    routine.workouts.splice(Number(b.dataset.del), 1);
    await save();
    nav.route();
  }));
  $('#add-workout').addEventListener('click', async () => {
    const letter = String.fromCharCode(65 + routine.workouts.length);
    const w = { id: db.uid(), name: `Workout ${letter}`, items: [] };
    routine.workouts.push(w);
    await save();
    go(`#/workout/${rid}/${w.id}`);
  });
  $('#del-routine').addEventListener('click', async () => {
    if (!confirm(`Delete routine "${routine.name}"? Your logged workouts are kept.`)) return;
    await db.deleteRoutine(rid);
    toast('Routine deleted');
    go('#/routines');
  });
}

function itemFields(item, ex, idx) {
  const num = (field, label, value, mode = 'decimal', placeholder = '') => `
    <label class="mini"><span>${label}</span>
      <input data-idx="${idx}" data-field="${field}" type="text" inputmode="${mode}" value="${esc(value)}" placeholder="${placeholder}">
    </label>`;
  const parts = [num('sets', 'Sets', item.sets || 1, 'numeric')];
  if (ex.type === 'weight_reps' || ex.type === 'reps') parts.push(num('reps', 'Reps', item.reps || '', 'numeric'));
  if (ex.type === 'weight_reps') parts.push(num('weight', wUnit(), item.weight ? fmtNum(weightOut(item.weight)) : '', 'decimal', 'any'));
  if (ex.type === 'distance_time') {
    const du = distUnitOf(ex);
    parts.push(num('distance', du, item.distance ? fmtNum(distOut(item.distance, du), du === 'm' ? 0 : 2) : '', 'decimal', 'any'));
    parts.push(num('minutes', 'min', item.seconds ? fmtNum(item.seconds / 60) : '', 'decimal', 'any'));
  }
  if (ex.type === 'time') parts.push(num('secs', 'sec', item.seconds || '', 'numeric', 'any'));
  return parts.join('');
}

export function viewWorkoutEdit(rid, wid) {
  const { routine, workout } = findWorkout(rid, wid);
  if (!workout) return go('#/routines');
  const today = todayISO();
  renderShell({
    title: esc(workout.name),
    back: `#/routine/${rid}`,
    tab: 'routines',
    body: `
      <div class="card form">
        <label class="field"><span>Workout name</span><input id="w-name" value="${esc(workout.name)}" autocomplete="off"></label>
        <p class="hint">Part of ${esc(routine.name)}. Leave the weight blank to start from what you lifted last time.</p>
      </div>
      <div id="items">
        ${workout.items.map((item, i) => {
          const ex = state.exercises.get(item.exerciseId);
          if (!ex) return '';
          return `
            <div class="card item" style="--cat:${esc(colourOf(ex))}">
              <div class="item-head">
                <strong>${esc(ex.name)}</strong>
                <span class="row-actions">
                  <button data-move="${i}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                  <button data-move="${i}" data-delta="1" ${i === workout.items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                  <button data-del="${i}" class="danger" aria-label="Remove">✕</button>
                </span>
              </div>
              <div class="item-fields">${itemFields(item, ex, i)}</div>
            </div>`;
        }).join('') || '<p class="empty">No exercises yet.</p>'}
      </div>
      <a class="btn" href="#/radd/${rid}/${wid}">+ Add exercise</a>
      ${workout.items.length ? `
        <div class="card form start">
          <label class="field"><span>Load this workout on</span><input id="w-date" type="date" value="${today}"></label>
          <button class="btn primary" id="w-start">Start ${esc(workout.name)}</button>
        </div>` : ''}`,
  });

  const save = () => db.saveRoutine(routine);
  $('#w-name').addEventListener('change', async (e) => {
    workout.name = e.target.value.trim() || workout.name;
    await save();
    nav.route();
  });
  $$('#items input[data-field]').forEach((input) => input.addEventListener('change', async () => {
    const item = workout.items[Number(input.dataset.idx)];
    const raw = input.value.trim();
    const v = raw === '' ? null : Number(raw);
    if (v != null && !(Number.isFinite(v) && v >= 0)) { toast('Enter a number.'); input.value = ''; return; }
    switch (input.dataset.field) {
      case 'sets': item.sets = Math.max(1, Math.round(v || 1)); input.value = item.sets; break;
      case 'reps': item.reps = v ? Math.round(v) : 0; break;
      case 'weight': item.weight = v ? weightIn(v) : null; break;
      case 'distance': item.distance = v ? distIn(v, distUnitOf(state.exercises.get(item.exerciseId))) : null; break;
      case 'minutes': item.seconds = v ? Math.round(v * 60) : null; break;
      case 'secs': item.seconds = v ? Math.round(v) : null; break;
      default: break;
    }
    await save();
  }));
  $$('#items [data-move]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.move);
    const j = i + Number(b.dataset.delta);
    [workout.items[i], workout.items[j]] = [workout.items[j], workout.items[i]];
    await save();
    nav.route();
  }));
  $$('#items [data-del]').forEach((b) => b.addEventListener('click', async () => {
    workout.items.splice(Number(b.dataset.del), 1);
    await save();
    nav.route();
  }));
  $('#w-start')?.addEventListener('click', () => {
    const d = $('#w-date').value;
    if (!isISODate(d)) return toast('Pick a date.');
    startWorkout(d, rid, wid);
  });
}

// Exercise picker for adding to a workout: #/radd/rid/wid[/categoryId]
export function viewRoutinePick(rid, wid, categoryId) {
  const { workout } = findWorkout(rid, wid);
  if (!workout) return go('#/routines');
  const base = `#/radd/${rid}/${wid}`;
  const pickHref = (ex) => `#/radd-do/${rid}/${wid}/${ex.id}`;
  const used = new Set(workout.items.map((i) => i.exerciseId));
  const link = (e) => exerciseLink(e, pickHref(e), used.has(e.id) ? 'In workout' : undefined);
  if (categoryId) {
    const cat = state.categories.get(categoryId);
    if (!cat) return go(base);
    renderShell({
      title: esc(cat.name),
      back: base,
      tab: 'routines',
      body: `<ul class="list">${db.exercisesIn(categoryId).map(link).join('') || '<li class="empty">No exercises.</li>'}</ul>`,
    });
    return;
  }
  renderShell({
    title: `Add to ${esc(workout.name)}`,
    back: `#/workout/${rid}/${wid}`,
    tab: 'routines',
    body: `
      <input type="search" id="search" class="search" placeholder="Search exercises" autocomplete="off">
      <div id="results"></div>
      <ul class="list" id="cats">
        ${db.categoryList().map((c) => `<li><a href="${base}/${c.id}"><span class="swatch" style="background:${esc(c.colour)}"></span>${esc(c.name)}<span class="count">${db.exercisesIn(c.id).length}</span></a></li>`).join('')}
      </ul>
      <a class="btn" href="#/exercise-edit/new?return=${encodeURIComponent(base)}">+ New exercise</a>`,
  });
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $('#cats').hidden = !!q;
    const hits = q ? [...state.exercises.values()].filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)) : [];
    $('#results').innerHTML = !q ? '' : hits.length ? `<ul class="list">${hits.map(link).join('')}</ul>` : '<p class="empty">No matches.</p>';
  });
}

export async function addToWorkout(rid, wid, exerciseId) {
  const { routine, workout } = findWorkout(rid, wid);
  const ex = state.exercises.get(exerciseId);
  if (!workout || !ex) return go('#/routines');
  const cardio = ex.type === 'distance_time' || ex.type === 'time';
  workout.items.push({ exerciseId, sets: cardio ? 1 : 3, reps: ex.type === 'weight_reps' || ex.type === 'reps' ? 10 : 0 });
  await db.saveRoutine(routine);
  toast(`${ex.name} added`);
  // replace so Back from the editor doesn't re-add the exercise
  location.replace(`#/workout/${rid}/${wid}`);
}

export function startFromRoute(date, rid, wid) {
  // replace so Back from the day doesn't re-load the workout
  const d = isISODate(date) ? date : todayISO();
  const { workout } = findWorkout(rid, wid);
  if (!workout) return go('#/routines');
  db.loadWorkout(d, workout).then(() => {
    toast(`${workout.name} loaded for ${formatDayLong(d).toLowerCase() === 'today' ? 'today' : formatDayLong(d)}`);
    location.replace(`#/day/${d}`);
  });
}
