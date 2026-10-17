// Pure helpers: units, dates, formatting, records, chart series, CSV.
// No DOM or storage access here so this module can be unit-tested in Node.

export const TYPES = {
  weight_reps: { label: 'Weight & reps', fields: ['weight', 'reps'] },
  reps: { label: 'Reps only', fields: ['reps'] },
  distance_time: { label: 'Distance & time', fields: ['distance', 'seconds'] },
  time: { label: 'Time only', fields: ['seconds'] },
};

// ---------- units ----------
// Values are always STORED in pounds and miles. They are converted only when
// shown or typed in, so switching units never alters or loses data.
// Distance has a default unit (metres unless changed) that any distance
// exercise can override with its own `distanceUnit`.

export const LB_PER_KG = 2.20462262185;
export const KM_PER_MI = 1.609344;

// Display units per stored mile.
export const PER_MILE = { m: 1609.344, km: 1.609344, mi: 1 };
export const DISTANCE_UNITS = { m: 'Metres (m)', km: 'Kilometres (km)', mi: 'Miles (mi)' };
export const DISTANCE_STEP = { m: 100, km: 0.1, mi: 0.1 };

const units = { weight: 'lbs', distance: 'm' };

export function setUnits({ weight, distance } = {}) {
  if (weight === 'lbs' || weight === 'kg') units.weight = weight;
  if (PER_MILE[distance]) units.distance = distance;
}
export const wUnit = () => units.weight;
export const dUnit = () => units.distance;

export const weightOut = (lbs) => (units.weight === 'kg' ? lbs / LB_PER_KG : lbs);
export const weightIn = (v) => (units.weight === 'kg' ? v * LB_PER_KG : v);
export const distOut = (mi, u = units.distance) => mi * PER_MILE[u];
export const distIn = (v, u = units.distance) => v / PER_MILE[u];
// The distance unit an exercise is displayed in.
export const distUnitOf = (ex) => (PER_MILE[ex?.distanceUnit] ? ex.distanceUnit : units.distance);
// Pace (seconds per mile when computed) is shown per 500 m, per km or per mile.
export const PACE_UNITS = { '500m': 'Per 500 m (rowing split)', km: 'Per km', mi: 'Per mile' };
const MILES_PER_PACE_UNIT = { '500m': 500 / 1609.344, km: 1 / KM_PER_MI, mi: 1 };
// Default pace unit for a distance unit: metres and km use per km.
export const paceUnit = (u = units.distance) => (u === 'mi' ? 'mi' : 'km');

// How a distance exercise is displayed: distance unit, pace unit, and watts.
export function displayOf(ex) {
  const du = distUnitOf(ex);
  const pu = MILES_PER_PACE_UNIT[ex?.paceUnit] ? ex.paceUnit : paceUnit(du);
  return { du, pu, watts: !!ex?.showWatts };
}

// Accepts a display object from displayOf() or a bare distance unit ('m', 'km', 'mi').
export function disp(d) {
  if (d && typeof d === 'object') return d;
  const du = PER_MILE[d] ? d : units.distance;
  return { du, pu: paceUnit(du), watts: false };
}

export const paceOut = (secPerMile, d) => secPerMile * MILES_PER_PACE_UNIT[disp(d).pu];
export const paceLabel = (pu) => (pu === '500m' ? '/500m' : `/${pu}`);

// Rowing splits are conventionally shown to a tenth of a second (1:52.5).
export function formatPaceValue(sec, pu) {
  if (pu !== '500m') return formatDuration(sec);
  const t = Math.round(sec * 10) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

// Concept2's formula: watts = 2.80 / (seconds per metre)^3.
export const wattsFromPace = (secPerMile) => 2.8 / (secPerMile / 1609.344) ** 3;

// "1:52.5 /500m · 205 W" for a set with both distance and time, else ''.
export function setSplit(set, d) {
  if (!(set.distance > 0 && set.seconds > 0)) return '';
  const { pu, watts } = disp(d);
  const secPerMile = set.seconds / set.distance;
  const split = `${formatPaceValue(paceOut(secPerMile, { pu }), pu)} ${paceLabel(pu)}`;
  return watts ? `${split} · ${Math.round(wattsFromPace(secPerMile))} W` : split;
}

export const DEFAULT_WEIGHT_STEP = { lbs: 5, kg: 2.5 };
// Bodyweight is entered and shown in whole pounds, or to 0.1 kg.
export const BODY_STEP = { lbs: 1, kg: 0.1 };
export const bodyDecimals = () => (units.weight === 'kg' ? 1 : 0);
export const fmtBody = (displayValue) => fmtNum(displayValue, bodyDecimals());

export const fmtWeight = (lbs, decimals = 2) => `${fmtNum(weightOut(lbs), decimals)} ${units.weight}`;
export const fmtDistance = (mi, u = units.distance) => `${fmtNum(distOut(mi, u), u === 'm' ? 0 : 2)} ${u}`;

// ---------- dates (ISO yyyy-mm-dd, local time) ----------

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(fromISO(s)) === s;
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatDayLong(iso, today = todayISO()) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// Short label for day navigation: relative when near today, else "Tue, Oct 13".
export function formatDayCompact(iso, today = todayISO()) {
  const rel = formatDayLong(iso, today);
  if (['Today', 'Yesterday', 'Tomorrow'].includes(rel)) return rel;
  return fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDayShort(iso) {
  return fromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

export function formatMonth(ym) {
  return fromISO(`${ym}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Weeks (Sun-first) covering the month; days outside the month are null.
export function monthGrid(ym) {
  const first = fromISO(`${ym}-01`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array(first.getDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------- numbers & durations ----------

export function fmtNum(n, maxDecimals = 2) {
  if (n == null || Number.isNaN(n)) return '';
  return String(Number(Number(n).toFixed(maxDecimals)));
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Accepts "ss", "m:ss" or "h:mm:ss". Returns seconds, or null if invalid.
export function parseDuration(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return Math.round(parts.reduce((acc, p) => acc * 60 + Number(p), 0));
}

// Epley estimate. A single rep is the 1RM itself.
export function estimate1RM(weight, reps) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function formatSet(set, type, d) {
  const { du } = disp(d);
  switch (type) {
    case 'weight_reps':
      return `${fmtWeight(set.weight || 0)} × ${set.reps ?? 0}`;
    case 'reps':
      return `${set.reps ?? 0} reps`;
    case 'distance_time': {
      const parts = [];
      if (set.distance) parts.push(fmtDistance(set.distance, du));
      if (set.seconds) parts.push(formatDuration(set.seconds));
      return parts.join(' in ') || '—';
    }
    case 'time':
      return formatDuration(set.seconds);
    default:
      return '';
  }
}

export function formatPace(secondsPerMile, d) {
  const { pu } = disp(d);
  return secondsPerMile ? `${formatPaceValue(paceOut(secondsPerMile, { pu }), pu)} ${paceLabel(pu)}` : '';
}

// ---------- set validation ----------

// Returns an error string, or null when the set has something worth saving.
export function validateSet(set, type) {
  const nonNeg = (v) => v == null || (Number.isFinite(v) && v >= 0);
  if (!['weight', 'reps', 'distance', 'seconds'].every((k) => nonNeg(set[k]))) {
    return 'Values must be zero or more.';
  }
  switch (type) {
    case 'weight_reps':
    case 'reps':
      return set.reps > 0 ? null : 'Enter at least 1 rep.';
    case 'distance_time':
      return set.distance > 0 || set.seconds > 0 ? null : 'Enter a distance or a time.';
    case 'time':
      return set.seconds > 0 ? null : 'Enter a time.';
    default:
      return 'Unknown exercise type.';
  }
}

// ---------- history, records, series ----------

export function compareSets(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order ?? 0) - (b.order ?? 0);
}

export function groupByDate(sets) {
  const map = new Map();
  for (const s of [...sets].sort(compareSets)) {
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push(s);
  }
  return map;
}

// IDs of sets that were a personal record when they were performed.
// Weight & reps: no earlier set lifted at least as much for at least as many reps.
// Other types: strictly beat the best earlier value of the primary measure.
export function prSetIds(sets, type) {
  const ids = new Set();
  const sorted = [...sets].sort(compareSets);
  if (type === 'weight_reps') {
    const seen = [];
    for (const s of sorted) {
      if (!(s.weight > 0 && s.reps > 0)) continue;
      if (!seen.some((p) => p.weight >= s.weight && p.reps >= s.reps)) ids.add(s.id);
      seen.push(s);
    }
    return ids;
  }
  const key = { reps: 'reps', distance_time: 'distance', time: 'seconds' }[type];
  let best = 0;
  for (const s of sorted) {
    const v = s[key] || 0;
    if (v > best) { ids.add(s.id); best = v; }
  }
  return ids;
}

function maxBy(sets, fn) {
  let best = null;
  let bestVal = 0;
  for (const s of sets) {
    const v = fn(s);
    if (v > bestVal) { bestVal = v; best = s; }
  }
  return best ? { value: bestVal, set: best } : null;
}

function bestDay(sets, fn) {
  let best = null;
  for (const [date, daySets] of groupByDate(sets)) {
    const v = daySets.reduce((a, s) => a + fn(s), 0);
    if (v > 0 && (!best || v > best.value)) best = { value: v, date };
  }
  return best;
}

// Summary records. Each entry: { label, value (display string), date }.
// Standard distances (metres) for "best time" records.
const ROWING_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000];
const RUNNING_DISTANCES = [1000, 1609.344, 5000, 10000, 21097.5, 42195];
const NAMED_DISTANCES = { 1609.344: '1 mile', 21097.5: 'Half marathon', 42195: 'Marathon' };

function distanceLabel(metres, du) {
  if (NAMED_DISTANCES[metres]) return NAMED_DISTANCES[metres];
  return du === 'm' ? `${metres} m` : `${fmtNum(metres / 1000)} km`;
}

// Fastest time for sets of (almost exactly) each standard distance.
function bestTimes(sets, d) {
  const { du, pu } = disp(d);
  const targets = pu === '500m' ? ROWING_DISTANCES : RUNNING_DISTANCES.filter((m) => du !== 'mi' || m !== 1000);
  const out = [];
  for (const metres of targets) {
    const miles = metres / 1609.344;
    let best = null;
    for (const s of sets) {
      if (!(s.seconds > 0) || Math.abs(s.distance - miles) / miles > 0.002) continue;
      if (!best || s.seconds < best.seconds) best = s;
    }
    if (best) out.push({ label: distanceLabel(metres, du), seconds: best.seconds, date: best.date, split: setSplit(best, d) });
  }
  return out;
}

export function computeRecords(sets, type, d) {
  const { du } = disp(d);
  const sorted = [...sets].sort(compareSets);
  const rows = [];
  const push = (label, rec, fmt) => {
    if (rec) rows.push({ label, value: fmt(rec.value, rec.set), date: rec.set ? rec.set.date : rec.date });
  };
  const wr = (s) => `${fmtNum(weightOut(s.weight))} × ${s.reps}`;
  const repMaxes = [];
  if (type === 'weight_reps') {
    push('Estimated 1RM', maxBy(sorted, (s) => estimate1RM(s.weight, s.reps)), (v, s) => `${fmtWeight(v, 1)} (${wr(s)})`);
    push('Heaviest weight', maxBy(sorted, (s) => (s.reps > 0 ? s.weight : 0)), (v, s) => `${fmtWeight(v)} × ${s.reps}`);
    push('Most reps', maxBy(sorted, (s) => s.reps), (v, s) => `${v} @ ${fmtWeight(s.weight)}`);
    push('Most volume (set)', maxBy(sorted, (s) => s.weight * s.reps), (v, s) => `${fmtWeight(v)} (${wr(s)})`);
    push('Most volume (day)', bestDay(sorted, (s) => s.weight * s.reps), (v) => fmtWeight(v));
    // Best weight lifted for at least N reps (weights in display units).
    for (let n = 1; n <= 15; n++) {
      const rec = maxBy(sorted, (s) => (s.reps >= n ? s.weight : 0));
      if (rec) repMaxes.push({ reps: n, weight: weightOut(rec.value), actualReps: rec.set.reps, date: rec.set.date });
    }
  } else if (type === 'reps') {
    push('Most reps (set)', maxBy(sorted, (s) => s.reps), (v) => `${v} reps`);
    push('Most reps (day)', bestDay(sorted, (s) => s.reps || 0), (v) => `${v} reps`);
  } else if (type === 'distance_time') {
    push('Longest distance', maxBy(sorted, (s) => s.distance || 0), (v) => fmtDistance(v, du));
    push('Longest time', maxBy(sorted, (s) => s.seconds || 0), (v) => formatDuration(v));
    // Fastest pace is a minimum, so maximise its inverse.
    push('Fastest pace', maxBy(sorted, (s) => (s.distance > 0 && s.seconds > 0 ? s.distance / s.seconds : 0)),
      (v) => formatPace(1 / v, d));
    push('Most distance (day)', bestDay(sorted, (s) => s.distance || 0), (v) => fmtDistance(v, du));
  } else if (type === 'time') {
    push('Longest time', maxBy(sorted, (s) => s.seconds || 0), (v) => formatDuration(v));
    push('Most time (day)', bestDay(sorted, (s) => s.seconds || 0), (v) => formatDuration(v));
  }
  return { rows, repMaxes, bestTimes: type === 'distance_time' ? bestTimes(sorted, d) : [] };
}

const sum = (arr, fn) => arr.reduce((a, s) => a + (fn(s) || 0), 0);
const max = (arr, fn) => arr.reduce((a, s) => Math.max(a, fn(s) || 0), 0);

// kind: how a stored value converts for display (weight, distance, pace, duration, reps).
export const METRICS = {
  weight_reps: [
    { key: 'e1rm', label: 'Estimated 1RM', kind: 'weight', day: (d) => max(d, (s) => estimate1RM(s.weight, s.reps)) },
    { key: 'maxWeight', label: 'Max weight', kind: 'weight', day: (d) => max(d, (s) => (s.reps > 0 ? s.weight : 0)) },
    { key: 'volume', label: 'Volume', kind: 'weight', day: (d) => sum(d, (s) => s.weight * s.reps) },
    { key: 'maxReps', label: 'Max reps', kind: 'reps', day: (d) => max(d, (s) => s.reps) },
  ],
  reps: [
    { key: 'maxReps', label: 'Max reps', kind: 'reps', day: (d) => max(d, (s) => s.reps) },
    { key: 'totalReps', label: 'Total reps', kind: 'reps', day: (d) => sum(d, (s) => s.reps) },
  ],
  distance_time: [
    { key: 'distance', label: 'Distance', kind: 'distance', day: (d) => sum(d, (s) => s.distance) },
    { key: 'time', label: 'Time', kind: 'duration', day: (d) => sum(d, (s) => s.seconds) },
    {
      key: 'pace', label: 'Pace', kind: 'pace',
      day: (d) => {
        const timed = d.filter((s) => s.distance > 0 && s.seconds > 0);
        const dist = sum(timed, (s) => s.distance);
        return dist ? sum(timed, (s) => s.seconds) / dist : 0;
      },
    },
  ],
  time: [
    { key: 'maxTime', label: 'Longest set', kind: 'duration', day: (d) => max(d, (s) => s.seconds) },
    { key: 'totalTime', label: 'Total time', kind: 'duration', day: (d) => sum(d, (s) => s.seconds) },
  ],
};

const TO_DISPLAY = {
  weight: weightOut,
  distance: (v, d) => distOut(v, disp(d).du),
  pace: paceOut,
  duration: (v) => v,
  reps: (v) => v,
};

// Unit label for a metric kind in the current units ('' for time-like kinds).
export function kindUnit(kind, d) {
  const { du } = disp(d);
  return { weight: units.weight, distance: du, reps: 'reps' }[kind] || '';
}

// Formats a value that is already in display units.
export function formatMetric(value, kind, d) {
  const { du, pu } = disp(d);
  if (kind === 'duration') return formatDuration(value);
  if (kind === 'pace') return `${formatPaceValue(value, pu)} ${paceLabel(pu)}`;
  return `${fmtNum(value, kind === 'distance' && du === 'm' ? 0 : 1)} ${kindUnit(kind, d)}`;
}

// One point per workout day (display units), skipping days where the metric is zero.
export function metricSeries(sets, type, metricKey, d) {
  const metric = (METRICS[type] || []).find((m) => m.key === metricKey);
  if (!metric) return [];
  const out = [];
  for (const [date, daySets] of groupByDate(sets)) {
    const value = metric.day(daySets);
    if (value > 0) out.push({ date, value: TO_DISPLAY[metric.kind](value, d) });
  }
  return out;
}

// ---------- routines & plans ----------

// A routine item: { exerciseId, sets, reps, weight (lbs, optional), distance (mi), seconds }.
export function describeTarget(item, type, d) {
  const { du } = disp(d);
  const sets = item.sets || 1;
  switch (type) {
    case 'weight_reps':
      return `${sets} × ${item.reps || 0}${item.weight ? ` @ ${fmtWeight(item.weight)}` : ''}`;
    case 'reps':
      return `${sets} × ${item.reps || 0}`;
    case 'distance_time': {
      const parts = [];
      if (item.distance) parts.push(fmtDistance(item.distance, du));
      if (item.seconds) parts.push(formatDuration(item.seconds));
      return `${sets > 1 ? `${sets} × ` : ''}${parts.join(' in ') || 'cardio'}`;
    }
    case 'time':
      return `${sets} × ${item.seconds ? formatDuration(item.seconds) : 'time'}`;
    default:
      return '';
  }
}

// ---------- bodyweight ----------

// entries: [{ date, weight (lbs) }]. Returns display-unit stats or null if empty.
export function bodyStats(entries, today = todayISO()) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted[sorted.length - 1];
  // Change versus the most recent entry on or before N days before the latest one.
  const changeOver = (days) => {
    const cutoff = addDays(latest.date, -days);
    const base = [...sorted].reverse().find((e) => e.date <= cutoff);
    return base ? weightOut(latest.weight) - weightOut(base.weight) : null;
  };
  const weights = sorted.map((e) => e.weight);
  return {
    latest: weightOut(latest.weight),
    latestDate: latest.date,
    change7: changeOver(7),
    change30: changeOver(30),
    min: weightOut(Math.min(...weights)),
    max: weightOut(Math.max(...weights)),
    daysSinceLatest: Math.round((fromISO(today) - fromISO(latest.date)) / 864e5),
  };
}

export function formatChange(v) {
  if (v == null) return '—';
  const r = Number(v.toFixed(bodyDecimals()));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${fmtBody(Math.abs(r))} ${units.weight}`;
}

// ---------- export ----------

const CSV_HEADER = ['Date', 'Exercise', 'Category', 'Weight', 'Weight Unit', 'Reps', 'Distance', 'Distance Unit', 'Time', 'Comment'];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Column layout follows FitNotes' CSV export so the data stays portable.
// Values are written in the currently selected units.
export function toCSV(sets, exercisesById, categoriesById) {
  const lines = [CSV_HEADER.join(',')];
  for (const s of [...sets].sort(compareSets)) {
    const ex = exercisesById.get(s.exerciseId);
    const cat = ex ? categoriesById.get(ex.categoryId) : null;
    const hasWeight = ex?.type === 'weight_reps';
    const hasDistance = ex?.type === 'distance_time' && s.distance;
    const du = distUnitOf(ex);
    lines.push([
      s.date,
      ex?.name ?? 'Unknown',
      cat?.name ?? '',
      hasWeight ? fmtNum(weightOut(s.weight)) : '',
      hasWeight ? units.weight : '',
      s.reps || '',
      hasDistance ? fmtNum(distOut(s.distance, du), du === 'm' ? 0 : 2) : '',
      hasDistance ? du : '',
      s.seconds ? formatDuration(s.seconds) : '',
      s.comment ?? '',
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export const BACKUP_FORMAT = 'gymlog-backup';
export const BACKUP_VERSION = 2;

// Throws with a readable message when a parsed backup file is not usable.
// Version 1 backups (no bodyweight or routines) are still accepted.
export function checkBackup(obj) {
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('This file is not a backup from this app.');
  if (obj.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  for (const key of ['categories', 'exercises', 'sets']) {
    if (!Array.isArray(obj[key])) throw new Error(`Backup is missing "${key}".`);
  }
  for (const key of ['days', 'body', 'routines']) {
    if (obj[key] != null && !Array.isArray(obj[key])) throw new Error(`Backup has an invalid "${key}".`);
  }
  const exIds = new Set(obj.exercises.map((e) => e.id));
  const bad = obj.sets.find((s) => !isISODate(s.date) || !exIds.has(s.exerciseId));
  if (bad) throw new Error('Backup contains sets with an invalid date or exercise.');
  if ((obj.body || []).some((b) => !isISODate(b.date) || !(b.weight > 0))) {
    throw new Error('Backup contains an invalid bodyweight entry.');
  }
  return obj;
}
