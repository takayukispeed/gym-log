// IndexedDB persistence with an in-memory mirror.
// Everything is loaded at startup (a few years of sets is well under a few MB),
// so reads are synchronous and writes go through to IndexedDB.

import { SEED_CATEGORIES, SEED_EXERCISES, SAMPLE_ROUTINE } from './seed.js';
import { BACKUP_FORMAT, BACKUP_VERSION, checkBackup, compareSets, setUnits } from './logic.js';

const DB_NAME = 'gymlog';
const DB_VERSION = 2;
const STORES = ['categories', 'exercises', 'sets', 'days', 'meta', 'body', 'routines'];
const DATA_STORES = ['categories', 'exercises', 'sets', 'days', 'body', 'routines'];

export const DEFAULT_SETTINGS = {
  weightUnit: 'lbs',
  distanceUnit: 'm',
  restSeconds: 90,
  autoStartTimer: true,
  timerSound: true,
  weightStep: 5,
};

let idb;

export const state = {
  categories: new Map(),
  exercises: new Map(),
  sets: new Map(),
  // date -> { date, exerciseOrder: [exerciseId], note, plan: [routine item], workoutName }
  days: new Map(),
  body: new Map(), // date -> { date, weight (lbs), note }
  routines: new Map(), // id -> { id, name, sort, workouts: [{ id, name, items: [routine item] }] }
  settings: { ...DEFAULT_SETTINGS },
  lastBackup: null,
};

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('exercises', { keyPath: 'id' });
        const sets = db.createObjectStore('sets', { keyPath: 'id' });
        sets.createIndex('date', 'date');
        sets.createIndex('exerciseId', 'exerciseId');
        db.createObjectStore('days', { keyPath: 'date' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('body', { keyPath: 'date' });
        db.createObjectStore('routines', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(stores, mode);
    fn(t);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export async function init() {
  idb = await open();
  const t = idb.transaction(STORES, 'readonly');
  const [cats, exs, sets, days, meta, body, routines] = await Promise.all(
    STORES.map((s) => promisify(t.objectStore(s).getAll())),
  );
  cats.forEach((c) => state.categories.set(c.id, c));
  exs.forEach((e) => state.exercises.set(e.id, e));
  sets.forEach((s) => state.sets.set(s.id, s));
  days.forEach((d) => state.days.set(d.date, d));
  body.forEach((b) => state.body.set(b.date, b));
  routines.forEach((r) => state.routines.set(r.id, r));
  for (const m of meta) {
    if (m.key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...m.value };
    if (m.key === 'lastBackup') state.lastBackup = m.value;
  }
  // One-time switch of the default distance unit from miles (the old default) to metres.
  if (!meta.some((m) => m.key === 'metresDefault')) {
    if (state.settings.distanceUnit === 'mi') state.settings.distanceUnit = 'm';
    await tx(['meta'], 'readwrite', (t) => {
      t.objectStore('meta').put({ key: 'settings', value: state.settings });
      t.objectStore('meta').put({ key: 'metresDefault', value: true });
    });
  }
  setUnits({ weight: state.settings.weightUnit, distance: state.settings.distanceUnit });
  if (!meta.some((m) => m.key === 'seeded')) await seed();
  if (!meta.some((m) => m.key === 'seededRoutines')) await seedRoutines();
  if (!meta.some((m) => m.key === 'rowingDefaults')) await applyRowingDefaults();
  if (!meta.some((m) => m.key === 'martialArts')) await addMartialArts();
}

// Adds a Martial Arts category and a time-based Muay Thai exercise for installs
// that predate them. Anything the user already created with those names is kept.
async function addMartialArts() {
  const findCat = (n) => [...state.categories.values()].find((c) => c.name.toLowerCase() === n);
  let cat = findCat('martial arts');
  const newCat = cat ? null : { id: uid(), name: 'Martial Arts', colour: '#8d6e63', sort: Math.max(-1, ...[...state.categories.values()].map((c) => c.sort ?? 0)) + 1 };
  cat = cat || newCat;
  const newEx = findExerciseByName('Muay Thai') ? null : { id: uid(), name: 'Muay Thai', categoryId: cat.id, type: 'time', notes: '' };
  await tx(['categories', 'exercises', 'meta'], 'readwrite', (t) => {
    if (newCat) t.objectStore('categories').put(newCat);
    if (newEx) t.objectStore('exercises').put(newEx);
    t.objectStore('meta').put({ key: 'martialArts', value: true });
  });
  if (newCat) state.categories.set(newCat.id, newCat);
  if (newEx) state.exercises.set(newEx.id, newEx);
}

// Rowing Machine shows splits per 500 m with watts, as on an erg monitor.
async function applyRowingDefaults() {
  const rower = [...state.exercises.values()].find((e) => e.name.toLowerCase() === 'rowing machine');
  const update = rower && rower.paceUnit === undefined ? { ...rower, paceUnit: '500m', showWatts: true } : null;
  await tx(['exercises', 'meta'], 'readwrite', (t) => {
    if (update) t.objectStore('exercises').put(update);
    t.objectStore('meta').put({ key: 'rowingDefaults', value: true });
  });
  if (update) state.exercises.set(update.id, update);
}

async function seed() {
  const byName = {};
  const cats = SEED_CATEGORIES.map((c, i) => {
    const cat = { id: uid(), name: c.name, colour: c.colour, sort: i };
    byName[c.name] = cat.id;
    return cat;
  });
  const exs = SEED_EXERCISES.map(([name, cat, type]) => ({ id: uid(), name, categoryId: byName[cat], type, notes: '' }));
  await tx(['categories', 'exercises', 'meta'], 'readwrite', (t) => {
    cats.forEach((c) => t.objectStore('categories').put(c));
    exs.forEach((e) => t.objectStore('exercises').put(e));
    t.objectStore('meta').put({ key: 'seeded', value: true });
  });
  cats.forEach((c) => state.categories.set(c.id, c));
  exs.forEach((e) => state.exercises.set(e.id, e));
}

function findExerciseByName(name) {
  const n = name.toLowerCase();
  return [...state.exercises.values()].find((e) => e.name.toLowerCase() === n);
}

// Adds the sample 5×5 routine once, creating any exercise it needs.
async function seedRoutines() {
  const newExercises = [];
  const exerciseFor = (name, catName) => {
    let ex = findExerciseByName(name) || newExercises.find((e) => e.name === name);
    if (!ex) {
      const cat = [...state.categories.values()].find((c) => c.name === catName) || categoryList()[0];
      ex = { id: uid(), name, categoryId: cat?.id, type: 'weight_reps', notes: '' };
      newExercises.push(ex);
    }
    return ex;
  };
  const routine = {
    id: uid(),
    name: SAMPLE_ROUTINE.name,
    sort: 0,
    workouts: SAMPLE_ROUTINE.workouts.map((w) => ({
      id: uid(),
      name: w.name,
      items: w.items.map(([name, cat, sets, reps]) => ({ exerciseId: exerciseFor(name, cat).id, sets, reps })),
    })),
  };
  await tx(['exercises', 'routines', 'meta'], 'readwrite', (t) => {
    newExercises.forEach((e) => t.objectStore('exercises').put(e));
    t.objectStore('routines').put(routine);
    t.objectStore('meta').put({ key: 'seededRoutines', value: true });
  });
  newExercises.forEach((e) => state.exercises.set(e.id, e));
  state.routines.set(routine.id, routine);
}

// ---------- generic writes ----------

function putRecord(store, map, keyName, rec) {
  map.set(rec[keyName], rec);
  return tx([store], 'readwrite', (t) => t.objectStore(store).put(rec));
}

function deleteRecord(store, map, key) {
  map.delete(key);
  return tx([store], 'readwrite', (t) => t.objectStore(store).delete(key));
}

export const saveCategory = (c) => putRecord('categories', state.categories, 'id', c);
export const saveExercise = (e) => putRecord('exercises', state.exercises, 'id', e);
export const saveDay = (d) => putRecord('days', state.days, 'date', d);
export const saveRoutine = (r) => putRecord('routines', state.routines, 'id', r);
export const deleteRoutine = (id) => deleteRecord('routines', state.routines, id);
export const saveBody = (b) => putRecord('body', state.body, 'date', b);
export const deleteBody = (date) => deleteRecord('body', state.body, date);

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  setUnits({ weight: state.settings.weightUnit, distance: state.settings.distanceUnit });
  await tx(['meta'], 'readwrite', (t) => t.objectStore('meta').put({ key: 'settings', value: state.settings }));
}

export async function markBackedUp() {
  state.lastBackup = new Date().toISOString();
  await tx(['meta'], 'readwrite', (t) => t.objectStore('meta').put({ key: 'lastBackup', value: state.lastBackup }));
}

// ---------- queries ----------

export const categoryList = () => [...state.categories.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
export const exercisesIn = (categoryId) =>
  [...state.exercises.values()].filter((e) => e.categoryId === categoryId).sort((a, b) => a.name.localeCompare(b.name));
export const setsOn = (date) => [...state.sets.values()].filter((s) => s.date === date).sort(compareSets);
export const setsFor = (exerciseId) => [...state.sets.values()].filter((s) => s.exerciseId === exerciseId).sort(compareSets);
export const setsOnFor = (date, exerciseId) => setsOn(date).filter((s) => s.exerciseId === exerciseId);

export const routineList = () => [...state.routines.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
export const bodyList = () => [...state.body.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
export const planFor = (date, exerciseId) => (state.days.get(date)?.plan || []).find((p) => p.exerciseId === exerciseId) || null;

// Exercises performed or planned on a date, in the user's chosen order.
export function exercisesOn(date) {
  const present = new Set(setsOn(date).map((s) => s.exerciseId));
  (state.days.get(date)?.plan || []).forEach((p) => present.add(p.exerciseId));
  const day = state.days.get(date);
  const ordered = (day?.exerciseOrder || []).filter((id) => present.has(id));
  for (const id of present) if (!ordered.includes(id)) ordered.push(id);
  return ordered.map((id) => state.exercises.get(id)).filter(Boolean);
}

export function datesWithSets() {
  const map = new Map(); // date -> Set(categoryId)
  for (const s of state.sets.values()) {
    const ex = state.exercises.get(s.exerciseId);
    if (!map.has(s.date)) map.set(s.date, new Set());
    if (ex) map.get(s.date).add(ex.categoryId);
  }
  return map;
}

// ---------- sets ----------

export async function addSet(fields) {
  const existing = setsOnFor(fields.date, fields.exerciseId);
  const set = {
    id: uid(),
    order: existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 0,
    comment: '',
    createdAt: Date.now(),
    ...fields,
  };
  await putRecord('sets', state.sets, 'id', set);
  await ensureInDayOrder(set.date, set.exerciseId);
  return set;
}

export const updateSet = (set) => putRecord('sets', state.sets, 'id', set);
export const deleteSet = (id) => deleteRecord('sets', state.sets, id);

async function ensureInDayOrder(date, exerciseId) {
  const day = state.days.get(date) || { date, exerciseOrder: [], note: '' };
  if (!day.exerciseOrder.includes(exerciseId)) {
    await saveDay({ ...day, exerciseOrder: [...day.exerciseOrder, exerciseId] });
  }
}

export async function moveExerciseInDay(date, exerciseId, delta) {
  const order = exercisesOn(date).map((e) => e.id);
  const i = order.indexOf(exerciseId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  const day = state.days.get(date) || { date, note: '' };
  await saveDay({ ...day, exerciseOrder: order });
}

export async function deleteExerciseFromDay(date, exerciseId) {
  const ids = setsOnFor(date, exerciseId).map((s) => s.id);
  ids.forEach((id) => state.sets.delete(id));
  await tx(['sets'], 'readwrite', (t) => ids.forEach((id) => t.objectStore('sets').delete(id)));
  const day = state.days.get(date);
  if (day) {
    await saveDay({
      ...day,
      plan: (day.plan || []).filter((p) => p.exerciseId !== exerciseId),
      exerciseOrder: (day.exerciseOrder || []).filter((id) => id !== exerciseId),
    });
  }
}

// Adds a routine workout's exercises and targets to a day. Re-loading the same
// exercise replaces its target rather than duplicating it.
export async function loadWorkout(date, workout) {
  const day = state.days.get(date) || { date, exerciseOrder: [], note: '' };
  const items = workout.items.filter((i) => state.exercises.has(i.exerciseId));
  const ids = new Set(items.map((i) => i.exerciseId));
  const plan = [...(day.plan || []).filter((p) => !ids.has(p.exerciseId)), ...items.map((i) => ({ ...i }))];
  const order = [...exercisesOn(date).map((e) => e.id)];
  items.forEach((i) => { if (!order.includes(i.exerciseId)) order.push(i.exerciseId); });
  await saveDay({ ...day, plan, exerciseOrder: order, workoutName: workout.name });
}

// Replaces a planned exercise with another for this day only, keeping its
// target sets/reps (a weight target belongs to the old lift, so it is dropped).
// If the old exercise already has sets today it stays, and the new one follows it.
export async function swapPlanned(date, fromId, toId) {
  const day = state.days.get(date);
  const from = day?.plan?.find((p) => p.exerciseId === fromId);
  const toEx = state.exercises.get(toId);
  if (!from || !toEx || fromId === toId) return;
  const counted = toEx.type === 'weight_reps' || toEx.type === 'reps';
  const item = { exerciseId: toId, sets: from.sets || 1, reps: counted ? from.reps || 0 : 0 };
  const plan = [];
  for (const p of day.plan) {
    if (p.exerciseId === toId) continue;
    plan.push(p.exerciseId === fromId ? item : p);
  }
  const keepOld = setsOnFor(date, fromId).length > 0;
  const order = exercisesOn(date).map((e) => e.id).filter((id) => id !== toId);
  const at = order.indexOf(fromId);
  if (at < 0) order.push(toId);
  else if (keepOld) order.splice(at + 1, 0, toId);
  else order[at] = toId;
  await saveDay({ ...day, plan, exerciseOrder: order });
}

export async function clearPlan(date) {
  const day = state.days.get(date);
  if (day) await saveDay({ ...day, plan: [], workoutName: '' });
}

// Copies every set of a past workout onto another date, appended after existing work.
export async function copyDay(fromDate, toDate) {
  const order = exercisesOn(fromDate);
  for (const ex of order) {
    for (const s of setsOnFor(fromDate, ex.id)) {
      const { id, date, order: _o, createdAt, comment, ...values } = s;
      await addSet({ ...values, date: toDate });
    }
  }
}

// ---------- exercises & categories ----------

export async function deleteExercise(id) {
  const setIds = setsFor(id).map((s) => s.id);
  setIds.forEach((sid) => state.sets.delete(sid));
  state.exercises.delete(id);
  // Drop the exercise from any routine that uses it.
  const changed = [];
  for (const r of state.routines.values()) {
    if (r.workouts.some((w) => w.items.some((i) => i.exerciseId === id))) {
      r.workouts = r.workouts.map((w) => ({ ...w, items: w.items.filter((i) => i.exerciseId !== id) }));
      changed.push(r);
    }
  }
  await tx(['sets', 'exercises', 'routines'], 'readwrite', (t) => {
    setIds.forEach((sid) => t.objectStore('sets').delete(sid));
    t.objectStore('exercises').delete(id);
    changed.forEach((r) => t.objectStore('routines').put(r));
  });
}

export async function deleteCategory(id) {
  if (exercisesIn(id).length) throw new Error('Move or delete the exercises in this category first.');
  await deleteRecord('categories', state.categories, id);
}

// ---------- backup ----------

export function exportBackup() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    categories: [...state.categories.values()],
    exercises: [...state.exercises.values()],
    sets: [...state.sets.values()].sort(compareSets),
    days: [...state.days.values()],
    body: bodyList(),
    routines: routineList(),
  };
}

// Replaces all data with the backup's contents.
export async function importBackup(obj) {
  checkBackup(obj);
  const data = {
    categories: obj.categories,
    exercises: obj.exercises,
    sets: obj.sets,
    days: obj.days || [],
    body: obj.body || [],
    routines: obj.routines || [],
  };
  const settings = { ...DEFAULT_SETTINGS, ...obj.settings };
  await tx(STORES, 'readwrite', (t) => {
    for (const s of DATA_STORES) {
      t.objectStore(s).clear();
      data[s].forEach((rec) => t.objectStore(s).put(rec));
    }
    t.objectStore('meta').put({ key: 'settings', value: settings });
    t.objectStore('meta').put({ key: 'seeded', value: true });
    t.objectStore('meta').put({ key: 'seededRoutines', value: true });
    t.objectStore('meta').put({ key: 'metresDefault', value: true });
    t.objectStore('meta').put({ key: 'rowingDefaults', value: true });
  });
  const keyOf = { days: 'date', body: 'date' };
  for (const s of DATA_STORES) {
    state[s].clear();
    data[s].forEach((rec) => state[s].set(rec[keyOf[s] || 'id'], rec));
  }
  state.settings = settings;
  setUnits({ weight: settings.weightUnit, distance: settings.distanceUnit });
}
