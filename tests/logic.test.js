import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, monthGrid, isISODate, formatDuration, parseDuration, estimate1RM,
  formatSet, validateSet, prSetIds, computeRecords, metricSeries, toCSV, checkBackup,
  BACKUP_FORMAT, BACKUP_VERSION, setUnits, weightIn, weightOut, distIn, distOut, formatPace,
  describeTarget, bodyStats, formatChange, formatMetric, fmtNum, distUnitOf, paceUnit,
  displayOf, setSplit, formatPaceValue, wattsFromPace, workoutSpan, formatMinutes,
} from '../js/logic.js';

// Most tests below are written in lbs/mi; withUnits switches temporarily.
setUnits({ weight: 'lbs', distance: 'mi' });
function withUnits(u, fn) {
  setUnits(u);
  try { fn(); } finally { setUnits({ weight: 'lbs', distance: 'mi' }); }
}

let n = 0;
const set = (date, fields) => ({ id: `s${++n}`, date, order: n, exerciseId: 'e1', ...fields });

test('date helpers', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addMonths('2025-12', 1), '2026-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.ok(isISODate('2026-10-11'));
  assert.ok(!isISODate('2026-02-30'));
  assert.ok(!isISODate('garbage'));
});

test('monthGrid pads to whole weeks and covers every day', () => {
  const weeks = monthGrid('2026-10'); // Oct 1 2026 is a Thursday
  assert.equal(weeks[0].indexOf('2026-10-01'), 4);
  assert.equal(weeks.flat().filter(Boolean).length, 31);
  assert.ok(weeks.every((w) => w.length === 7));
});

test('durations', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(parseDuration('1:02:05'), 3725);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('a:b'), null);
});

test('estimate1RM (Epley)', () => {
  assert.equal(estimate1RM(200, 1), 200);
  assert.equal(estimate1RM(150, 10), 200);
  assert.equal(estimate1RM(0, 5), 0);
});

test('formatSet', () => {
  assert.equal(formatSet({ weight: 135, reps: 5 }, 'weight_reps'), '135 lbs × 5');
  assert.equal(formatSet({ distance: 3.1, seconds: 1500 }, 'distance_time'), '3.1 mi in 25:00');
  assert.equal(formatSet({ seconds: 60 }, 'time'), '1:00');
});

test('validateSet', () => {
  assert.equal(validateSet({ weight: 100, reps: 0 }, 'weight_reps'), 'Enter at least 1 rep.');
  assert.equal(validateSet({ weight: 0, reps: 10 }, 'weight_reps'), null);
  assert.equal(validateSet({ distance: 0, seconds: 0 }, 'distance_time'), 'Enter a distance or a time.');
  assert.equal(validateSet({ weight: -5, reps: 5 }, 'weight_reps'), 'Values must be zero or more.');
  assert.equal(validateSet({ weight: NaN, reps: 5 }, 'weight_reps'), 'Values must be zero or more.');
});

test('prSetIds: weight & reps uses rep-max dominance', () => {
  const a = set('2026-01-01', { weight: 135, reps: 5 });
  const b = set('2026-01-01', { weight: 135, reps: 5 }); // equal: not a PR
  const c = set('2026-01-03', { weight: 145, reps: 3 }); // heavier: PR
  const d = set('2026-01-05', { weight: 135, reps: 8 }); // more reps: PR
  const e = set('2026-01-07', { weight: 140, reps: 3 }); // dominated by c: not a PR
  const prs = prSetIds([e, d, c, b, a], 'weight_reps');
  assert.deepEqual([...prs].sort(), [a.id, c.id, d.id].sort());
});

test('prSetIds: cardio uses distance', () => {
  const a = set('2026-01-01', { distance: 3, seconds: 1800 });
  const b = set('2026-01-02', { distance: 2, seconds: 900 });
  const c = set('2026-01-03', { distance: 5, seconds: 3000 });
  assert.deepEqual([...prSetIds([a, b, c], 'distance_time')], [a.id, c.id]);
});

test('computeRecords for weight & reps', () => {
  const sets = [
    set('2026-02-01', { weight: 200, reps: 1 }),
    set('2026-02-01', { weight: 150, reps: 10 }),
    set('2026-02-08', { weight: 185, reps: 5 }),
  ];
  const { rows, repMaxes } = computeRecords(sets, 'weight_reps');
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.match(byLabel['Estimated 1RM'].value, /^215\.8 lbs/); // 185 × (1 + 5/30)
  assert.equal(byLabel['Heaviest weight'].value, '200 lbs × 1');
  assert.equal(byLabel['Most volume (day)'].value, '1700 lbs');
  assert.equal(byLabel['Most volume (day)'].date, '2026-02-01');
  assert.deepEqual(repMaxes.slice(0, 6).map((r) => r.weight), [200, 185, 185, 185, 185, 150]);
});

test('computeRecords fastest pace', () => {
  const sets = [
    set('2026-03-01', { distance: 3, seconds: 1800 }), // 10:00/mi
    set('2026-03-02', { distance: 1, seconds: 480 }), // 8:00/mi
  ];
  const pace = computeRecords(sets, 'distance_time').rows.find((r) => r.label === 'Fastest pace');
  assert.equal(pace.value, '8:00 /mi');
  assert.equal(pace.date, '2026-03-02');
});

test('metricSeries aggregates per day', () => {
  const sets = [
    set('2026-04-01', { weight: 100, reps: 10 }),
    set('2026-04-01', { weight: 110, reps: 8 }),
    set('2026-04-03', { weight: 120, reps: 5 }),
  ];
  assert.deepEqual(metricSeries(sets, 'weight_reps', 'volume'), [
    { date: '2026-04-01', value: 1880 },
    { date: '2026-04-03', value: 600 },
  ]);
  assert.deepEqual(metricSeries(sets, 'weight_reps', 'maxWeight').map((p) => p.value), [110, 120]);
});

test('toCSV uses FitNotes-style columns and escapes text', () => {
  const exercises = new Map([['e1', { id: 'e1', name: 'Bench, Flat', categoryId: 'c1', type: 'weight_reps' }]]);
  const categories = new Map([['c1', { id: 'c1', name: 'Chest' }]]);
  const csv = toCSV([set('2026-05-01', { weight: 135, reps: 5, comment: 'said "easy"' })], exercises, categories);
  const [header, row] = csv.trim().split('\r\n');
  assert.equal(header, 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment');
  assert.equal(row, '2026-05-01,"Bench, Flat",Chest,135,lbs,5,,,,"said ""easy"""');
});

test('checkBackup rejects bad files', () => {
  assert.throws(() => checkBackup({}), /not a backup/);
  assert.throws(() => checkBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }), /newer version/);
  // A version 1 backup (no bodyweight/routines) is still accepted.
  const ok = { format: BACKUP_FORMAT, version: 1, categories: [], exercises: [{ id: 'e1' }], sets: [{ date: '2026-01-01', exerciseId: 'e1' }] };
  assert.equal(checkBackup(ok), ok);
  assert.throws(() => checkBackup({ ...ok, sets: [{ date: '2026-01-01', exerciseId: 'nope' }] }), /invalid/);
  assert.throws(() => checkBackup({ ...ok, version: 2, body: [{ date: '2026-01-01', weight: 0 }] }), /bodyweight/);
  assert.throws(() => checkBackup({ ...ok, routines: 'x' }), /routines/);
});

test('unit conversion round-trips exactly enough for display', () => {
  withUnits({ weight: 'kg', distance: 'km' }, () => {
    assert.equal(fmtNum(weightOut(weightIn(102.5))), '102.5');
    assert.equal(fmtNum(distOut(distIn(5))), '5');
    assert.equal(fmtNum(weightOut(225)), '102.06');
    assert.equal(fmtNum(distOut(3.1)), '4.99');
  });
  assert.equal(weightOut(225), 225); // lbs mode is the identity
});

test('formatting follows the selected units', () => {
  const lift = { weight: 220.462262185, reps: 5 }; // stored in lbs = 100 kg
  withUnits({ weight: 'kg' }, () => {
    assert.equal(formatSet(lift, 'weight_reps'), '100 kg × 5');
    const rec = computeRecords([set('2026-01-01', lift)], 'weight_reps');
    assert.equal(rec.rows.find((r) => r.label === 'Heaviest weight').value, '100 kg × 5');
    assert.equal(rec.repMaxes[0].weight.toFixed(2), '100.00');
  });
  withUnits({ distance: 'km' }, () => {
    assert.equal(formatSet({ distance: 1, seconds: 360 }, 'distance_time'), '1.61 km in 6:00');
    // 8:00 per mile is 4:58 per km
    assert.equal(formatPace(480), '4:58 /km');
  });
});

test('metricSeries returns display units', () => {
  const sets = [set('2026-06-01', { weight: 220.462262185, reps: 5 })];
  withUnits({ weight: 'kg' }, () => {
    assert.equal(fmtNum(metricSeries(sets, 'weight_reps', 'maxWeight')[0].value), '100');
    assert.equal(formatMetric(100, 'weight'), '100 kg');
  });
  const runs = [set('2026-06-01', { distance: 2, seconds: 960 })]; // 8:00 /mi
  withUnits({ distance: 'km' }, () => {
    const pace = metricSeries(runs, 'distance_time', 'pace')[0].value;
    assert.equal(formatMetric(pace, 'pace'), '4:58 /km');
    assert.equal(fmtNum(metricSeries(runs, 'distance_time', 'distance')[0].value), '3.22');
  });
});

test('CSV is written in the selected units', () => {
  const exercises = new Map([['e1', { id: 'e1', name: 'Squat', categoryId: 'c1', type: 'weight_reps' }]]);
  const categories = new Map([['c1', { id: 'c1', name: 'Legs' }]]);
  withUnits({ weight: 'kg' }, () => {
    const row = toCSV([set('2026-05-01', { weight: 220.462262185, reps: 5 })], exercises, categories).split('\r\n')[1];
    assert.equal(row, '2026-05-01,Squat,Legs,100,kg,5,,,,');
  });
});

test('describeTarget', () => {
  assert.equal(describeTarget({ sets: 5, reps: 5 }, 'weight_reps'), '5 × 5');
  assert.equal(describeTarget({ sets: 3, reps: 10, weight: 50 }, 'weight_reps'), '3 × 10 @ 50 lbs');
  assert.equal(describeTarget({ sets: 1, distance: 3 }, 'distance_time'), '3 mi');
  assert.equal(describeTarget({ sets: 3, seconds: 60 }, 'time'), '3 × 1:00');
  withUnits({ weight: 'kg' }, () => {
    assert.equal(describeTarget({ sets: 5, reps: 5, weight: 220.462262185 }, 'weight_reps'), '5 × 5 @ 100 kg');
  });
});

test('bodyStats: latest, changes, range', () => {
  assert.equal(bodyStats([]), null);
  const entries = [
    { date: '2026-09-01', weight: 190 },
    { date: '2026-09-25', weight: 186 },
    { date: '2026-10-01', weight: 185.5 },
    { date: '2026-10-08', weight: 184 },
  ];
  const s = bodyStats(entries, '2026-10-11');
  assert.equal(s.latest, 184);
  assert.equal(s.change7, -1.5); // vs Oct 1
  assert.equal(s.change30, -6); // vs Sep 1 (latest entry on/before Sep 8)
  assert.equal(s.min, 184);
  assert.equal(s.max, 190);
  assert.equal(s.daysSinceLatest, 3);
  // Whole pounds; tenths of a kilogram.
  assert.equal(formatChange(-1.4), '−1 lbs');
  assert.equal(formatChange(2.6), '+3 lbs');
  assert.equal(formatChange(0.04), '±0 lbs');
  withUnits({ weight: 'kg' }, () => assert.equal(formatChange(-0.68), '−0.7 kg'));
  assert.equal(bodyStats([{ date: '2026-10-08', weight: 184 }]).change7, null);
});

test('metres: formatting, pace per km, records and targets', () => {
  const run = { distance: 5000 / 1609.344, seconds: 1500 }; // 5 km in 25:00
  withUnits({ distance: 'm' }, () => {
    assert.equal(formatSet(run, 'distance_time'), '5000 m in 25:00');
    assert.equal(paceUnit(), 'km');
    assert.equal(formatPace(run.seconds / run.distance), '5:00 /km');
    const rows = computeRecords([set('2026-07-01', run)], 'distance_time').rows;
    assert.equal(rows.find((r) => r.label === 'Longest distance').value, '5000 m');
    assert.equal(fmtNum(distOut(distIn(2000))), '2000');
    assert.equal(describeTarget({ sets: 1, distance: 2000 / 1609.344, seconds: 480 }, 'distance_time'), '2000 m in 8:00');
    assert.equal(formatMetric(2000, 'distance'), '2000 m');
  });
});

test('per-exercise distance unit overrides the default', () => {
  withUnits({ distance: 'm' }, () => {
    assert.equal(distUnitOf({ type: 'distance_time' }), 'm');
    assert.equal(distUnitOf({ type: 'distance_time', distanceUnit: '' }), 'm');
    assert.equal(distUnitOf({ type: 'distance_time', distanceUnit: 'mi' }), 'mi');
    assert.equal(distUnitOf({ distanceUnit: 'bogus' }), 'm');
    const run = { distance: 3.1, seconds: 1530 };
    assert.equal(formatSet(run, 'distance_time', 'mi'), '3.1 mi in 25:30');
    assert.equal(formatSet(run, 'distance_time', 'km'), '4.99 km in 25:30');
    assert.equal(formatSet(run, 'distance_time'), '4989 m in 25:30');
    const series = metricSeries([set('2026-07-02', run)], 'distance_time', 'distance', 'km');
    assert.equal(fmtNum(series[0].value), '4.99');
  });
});

test('CSV uses each exercise\'s own distance unit', () => {
  const exercises = new Map([
    ['row', { id: 'row', name: 'Rowing Machine', categoryId: 'c', type: 'distance_time' }],
    ['run', { id: 'run', name: 'Running', categoryId: 'c', type: 'distance_time', distanceUnit: 'km' }],
  ]);
  const categories = new Map([['c', { id: 'c', name: 'Cardio' }]]);
  withUnits({ distance: 'm' }, () => {
    const rows = toCSV([
      { id: 'a', date: '2026-07-03', order: 0, exerciseId: 'row', distance: 2000 / 1609.344, seconds: 450 },
      { id: 'b', date: '2026-07-03', order: 1, exerciseId: 'run', distance: 5 / 1.609344, seconds: 1500 },
    ], exercises, categories).trim().split('\r\n');
    assert.equal(rows[1], '2026-07-03,Rowing Machine,Cardio,,,,2000,m,7:30,');
    assert.equal(rows[2], '2026-07-03,Running,Cardio,,,,5,km,25:00,');
  });
});

const M = 1609.344; // metres per mile

test('rowing split formatting to tenths', () => {
  assert.equal(formatPaceValue(112.5, '500m'), '1:52.5');
  assert.equal(formatPaceValue(119.96, '500m'), '2:00.0');
  assert.equal(formatPaceValue(65.04, '500m'), '1:05.0');
  assert.equal(formatPaceValue(300, 'km'), '5:00');
});

test('watts follow the Concept2 formula', () => {
  // 2:00 /500m = 0.24 s/m -> 2.8 / 0.24^3 = 202.5 W
  assert.equal(Math.round(wattsFromPace(0.24 * M)), 203);
});

test('setSplit uses the exercise display options', () => {
  const row = { distance: 2000 / M, seconds: 450 }; // 2000 m in 7:30
  const rower = displayOf({ type: 'distance_time', distanceUnit: 'm', paceUnit: '500m', showWatts: true });
  assert.deepEqual(rower, { du: 'm', pu: '500m', watts: true });
  assert.equal(setSplit(row, rower), '1:52.5 /500m · 246 W');
  assert.equal(setSplit(row, { du: 'm', pu: 'km', watts: false }), '3:45 /km');
  assert.equal(setSplit({ distance: 3, seconds: 0 }, rower), '');
  withUnits({ distance: 'mi' }, () => {
    assert.deepEqual(displayOf({ type: 'distance_time' }), { du: 'mi', pu: 'mi', watts: false });
  });
});

test('pace records and series honour the 500 m split', () => {
  const rower = { du: 'm', pu: '500m', watts: false };
  const sets = [
    set('2026-08-01', { distance: 2000 / M, seconds: 460 }),
    set('2026-08-03', { distance: 2000 / M, seconds: 450 }),
    set('2026-08-05', { distance: 5000 / M, seconds: 1200 }),
  ];
  const rec = computeRecords(sets, 'distance_time', rower);
  assert.equal(rec.rows.find((r) => r.label === 'Fastest pace').value, '1:52.5 /500m');
  assert.deepEqual(rec.bestTimes.map((b) => [b.label, b.seconds, b.date]), [
    ['2000 m', 450, '2026-08-03'],
    ['5000 m', 1200, '2026-08-05'],
  ]);
  const pace = metricSeries(sets, 'distance_time', 'pace', rower);
  assert.equal(formatMetric(pace[1].value, 'pace', rower), '1:52.5 /500m');
});

test('running best times use running distances', () => {
  const run = { du: 'km', pu: 'km', watts: false };
  const sets = [
    set('2026-09-01', { distance: 5 / 1.609344, seconds: 1500 }),
    set('2026-09-02', { distance: 5.5 / 1.609344, seconds: 1600 }), // not a standard distance
    set('2026-09-03', { distance: 21.0975 / 1.609344, seconds: 6600 }),
  ];
  assert.deepEqual(computeRecords(sets, 'distance_time', run).bestTimes.map((b) => b.label), ['5 km', 'Half marathon']);
  assert.deepEqual(computeRecords(sets, 'weight_reps').bestTimes, []);
});

test('workoutSpan uses first and last set saved on that day', () => {
  const at = (h, m) => new Date(2026, 9, 17, h, m).getTime();
  const sets = [
    { date: '2026-10-17', createdAt: at(18, 40) },
    { date: '2026-10-17', createdAt: at(18, 2) },
    { date: '2026-10-17', createdAt: at(19, 10) },
    { date: '2026-10-17' }, // no timestamp (older data) is ignored
  ];
  const span = workoutSpan(sets, '2026-10-17');
  assert.equal(span.start, at(18, 2));
  assert.equal(span.end, at(19, 10));
  assert.equal(span.minutes, 68);
  // Back-filled sets (saved on a later day) do not count.
  assert.equal(workoutSpan([{ date: '2026-10-15', createdAt: at(9, 0) }], '2026-10-15'), null);
  assert.equal(workoutSpan([], '2026-10-17'), null);
  assert.equal(formatMinutes(68), '1 h 8 min');
  assert.equal(formatMinutes(42), '42 min');
  assert.equal(formatMinutes(120), '2 h');
});
