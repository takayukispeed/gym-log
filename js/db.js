// IndexedDB persistence with an in-memory mirror.
// Everything is loaded at startup (a few years of sets is well under a few MB),
// so reads are synchronous and writes go through to IndexedDB.

import { SEED_CATEGORIES, SEED_EXERCISES } from './seed.js';
import { BACKUP_FORMAT, BACKUP_VERSION, checkBackup, compareSets } from './logic.js';

const DB_NAME = 'gymlog';
const DB_VERSION = 1;
const STORES = ['categories', 'exercises', 'sets', 'days', 'meta'];

export const DEFAULT_SETTINGS = {
  restSeconds: 90,
  autoStartTimer: true,
  timerSound: true,
  weightStep: 5,
  distanceStep: 0.1,
};

let idb;

export const state = {
  categories: new Map(),
  exercises: new Map(),
  sets: new Map(),
  days: new Map(), // date -> { date, exerciseOrder: [exerciseId], note }
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
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('exercises', { keyPath: 'id' });
      const sets = db.createObjectStore('sets', { keyPath: 'id' });
      sets.createIndex('date', 'date');
      sets.createIndex('exerciseId', 'exerciseId');
      db.createObjectStore('days', { keyPath: 'date' });
      db.createObjectStore('meta', { keyPath: 'key' });
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
  const [cats, exs, sets, days, meta] = await Promise.all(
    STORES.map((s) => promisify(t.objectStore(s).getAll())),
  );
  cats.forEach((c) => state.categories.set(c.id, c));
  exs.forEach((e) => state.exercises.set(e.id, e));
  sets.forEach((s) => state.sets.set(s.id, s));
  days.forEach((d) => state.days.set(d.date, d));
  for (const m of meta) {
    if (m.key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...m.value };
    if (m.key === 'lastBackup') state.lastBackup = m.value;
  }
  if (!meta.some((m) => m.key === 'seeded')) await seed();
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

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
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

// Exercises performed on a date, in the user's chosen order.
export function exercisesOn(date) {
  const present = new Set(setsOn(date).map((s) => s.exerciseId));
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
  await tx(['sets', 'exercises'], 'readwrite', (t) => {
    setIds.forEach((sid) => t.objectStore('sets').delete(sid));
    t.objectStore('exercises').delete(id);
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
  };
}

// Replaces all data with the backup's contents.
export async function importBackup(obj) {
  checkBackup(obj);
  await tx(STORES, 'readwrite', (t) => {
    for (const s of ['categories', 'exercises', 'sets', 'days']) t.objectStore(s).clear();
    obj.categories.forEach((c) => t.objectStore('categories').put(c));
    obj.exercises.forEach((e) => t.objectStore('exercises').put(e));
    obj.sets.forEach((s) => t.objectStore('sets').put(s));
    (obj.days || []).forEach((d) => t.objectStore('days').put(d));
    t.objectStore('meta').put({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...obj.settings } });
    t.objectStore('meta').put({ key: 'seeded', value: true });
  });
  for (const k of ['categories', 'exercises', 'sets', 'days']) state[k].clear();
  obj.categories.forEach((c) => state.categories.set(c.id, c));
  obj.exercises.forEach((e) => state.exercises.set(e.id, e));
  obj.sets.forEach((s) => state.sets.set(s.id, s));
  (obj.days || []).forEach((d) => state.days.set(d.date, d));
  state.settings = { ...DEFAULT_SETTINGS, ...obj.settings };
}
