// End-to-end smoke test in an iPhone-sized Chromium.
// Usage: npm run test:e2e   (set SCREENSHOTS=dir to save screenshots)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const shotsDir = process.env.SCREENSHOTS;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(root, path.endsWith('/') ? `${path}index.html` : path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || (path.endsWith('/') ? 'text/html' : 'application/octet-stream') });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = async (name) => { if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true }); };
const step = (name) => console.log(`• ${name}`);

try {
  step('loads an empty day');
  await page.goto(base);
  await page.waitForSelector('.empty-day');
  assert.equal(await page.textContent('#pick-date'), 'Today');
  await shot('01-empty-day');

  step('adds a lift via category picker');
  await page.click('.empty-day >> text=Add exercise');
  await page.click('text=Chest');
  await page.click('text=Flat Barbell Bench Press');
  await page.waitForSelector('#set-form');
  await page.fill('#f-weight', '135');
  await page.fill('#f-reps', '5');
  await page.click('#set-form button[type=submit]');
  await page.waitForSelector('#sets li');
  assert.ok(await page.isVisible('#timer'), 'rest timer starts after saving');
  await page.click('#timer button[data-t="15"]');
  await page.click('[data-step="f-weight"][data-delta="5"]');
  await page.click('[data-step="f-weight"][data-delta="5"]');
  await page.fill('#f-reps', '3');
  await page.click('#set-form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('#sets li').length === 2);
  assert.equal(await page.textContent('#sets li:nth-child(2) .v'), '145 lbs × 3');
  assert.equal(await page.locator('#sets .pr').count(), 2, 'both first sets are PRs');

  step('rejects an invalid set');
  await page.fill('#f-reps', '0');
  await page.click('#set-form button[type=submit]');
  await page.waitForSelector('.toast.show');
  assert.equal(await page.locator('#sets li').count(), 2);

  step('edits a set with a comment');
  await page.click('#sets li:first-child');
  await page.fill('#f-reps', '6');
  await page.fill('#f-comment', 'paused reps');
  await page.click('#set-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#sets li:first-child .v')?.textContent === '135 lbs × 6');
  assert.equal(await page.textContent('#sets li:first-child .cm'), 'paused reps');
  await shot('02-track');

  step('graph and records tabs');
  await page.click('.seg >> text=Graph');
  await page.waitForSelector('svg.chart circle.dot');
  await page.click('.chip >> text=Volume');
  await page.waitForSelector('svg.chart');
  await shot('03-graph');
  await page.click('.seg >> text=Records');
  const records = await page.textContent('.records');
  assert.match(records, /Estimated 1RM/);
  assert.match(records, /162 lbs/); // 135 × (1 + 6/30)
  await shot('04-records');

  step('adds cardio via search');
  await page.click('.header .back');
  await page.click('.header .plus');
  await page.fill('#search', 'runn');
  await page.click('#results >> text=Running');
  assert.match(await page.textContent('#set-form'), /Distance \(m\)/, 'cardio defaults to metres');
  await page.fill('#f-distance', '5000');
  await page.fill('#f-m', '25');
  await page.fill('#f-s', '30');
  await page.click('#set-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#sets li .v')?.textContent === '5000 m in 25:30');
  await page.click('#timer button[data-t="stop"]');
  assert.ok(await page.isHidden('#timer'));

  step('rowing shows a 500 m split, watts and best times');
  await page.click('.header .back');
  await page.click('.header .plus');
  await page.fill('#search', 'rowing');
  await page.click('#results >> text=Rowing Machine');
  await page.fill('#f-distance', '2000');
  await page.fill('#f-m', '7');
  await page.fill('#f-s', '30');
  await page.click('#set-form button[type=submit]');
  await page.waitForSelector('#sets .split');
  assert.equal(await page.textContent('#sets .split'), '1:52.5 /500m · 246 W');
  await page.click('#timer button[data-t="stop"]');
  await page.click('.seg >> text=Records');
  await page.waitForSelector('.records');
  assert.match(await page.textContent('#tab-body'), /Best times[\s\S]*2000 m[\s\S]*7:30/);
  assert.match(await page.textContent('#tab-body'), /Fastest pace[\s\S]*1:52\.5 \/500m/);
  await page.click('.seg >> text=Graph');
  await page.click('.chip >> text=Pace');
  await page.waitForSelector('svg.chart circle.dot');
  assert.match(await page.textContent('.chart-title'), /\/500m, faster is higher/);
  await shot('03b-rowing');
  // Remove it again so later steps see the same day as before.
  await page.click('.seg >> text=Track');
  await page.click('#sets li');
  await page.click('#del');
  await page.waitForSelector('.toast.show >> text=Set deleted');

  step('day view lists both exercises and reorders');
  await page.click('.header .back');
  await page.waitForSelector('.ex-card');
  let names = await page.locator('.ex-name').allTextContents();
  assert.deepEqual(names, ['Flat Barbell Bench Press', 'Running']);
  await page.click('#toggle-edit');
  await page.click('[data-move][data-delta="1"]:not([disabled])');
  await page.waitForFunction(() => document.querySelector('.ex-name')?.textContent === 'Running');
  names = await page.locator('.ex-name').allTextContents();
  assert.deepEqual(names, ['Running', 'Flat Barbell Bench Press']);
  await page.click('#toggle-edit');
  await page.fill('#day-note', 'Good session');
  await page.locator('#day-note').blur();
  await shot('05-day');

  step('copies a workout to the next day');
  await page.click('.daynav a:last-child');
  await page.waitForSelector('#copy-prev');
  await page.click('#copy-prev');
  await page.waitForSelector('.ex-card');
  assert.equal(await page.locator('.ex-card').count(), 2);

  step('calendar marks workout days');
  await page.click('#tabs >> text=Calendar');
  await page.waitForSelector('.cal');
  assert.equal(await page.locator('.cal a.has').count() >= 1, true);
  await shot('06-calendar');

  step('sample 5×5 routine is present');
  await page.click('#tabs >> text=Routines');
  await page.waitForSelector('.routine');
  const routinesText = await page.textContent('#main');
  for (const t of ['5×5', 'Workout A', 'Workout B', 'Flat Barbell Bench Press', 'Barbell Squat', 'Overhead Press', 'Deadlift', 'Barbell Row', 'Dumbbell Lunge', '3 × 10']) {
    assert.ok(routinesText.includes(t), `routines page shows ${t}`);
  }
  await shot('08-routines');

  step('loads Workout A onto an empty day');
  const d = new Date(); d.setDate(d.getDate() + 3);
  const planDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.goto(`${base}#/day/${planDate}`);
  await page.click('.list a.stack >> text=Workout A');
  await page.waitForFunction(() => document.querySelectorAll('.ex-card').length === 3);
  assert.deepEqual(await page.locator('.progress-pill').allTextContents(), ['0/5 sets', '0/5 sets', '0/5 sets']);
  assert.equal(await page.textContent('.workout-label'), 'Workout A');

  step('tracks planned sets to completion');
  await page.click('.ex-card >> text=Flat Barbell Bench Press');
  await page.waitForSelector('.plan-bar');
  assert.equal(await page.inputValue('#f-reps'), '5', 'reps prefilled from target');
  assert.equal(await page.inputValue('#f-weight'), '145', 'weight prefilled from last session');
  for (let i = 1; i <= 5; i++) {
    await page.click('#set-form button[type=submit]');
    await page.waitForFunction((n) => document.querySelectorAll('#sets li').length === n, i);
  }
  await page.waitForSelector('.plan-bar.done');
  assert.match(await page.textContent('#next-ex'), /Barbell Squat/);
  await page.click('#timer button[data-t="stop"]');
  await page.click('.header .back');
  await page.waitForSelector('.progress-pill.done');
  await shot('09-planned-day');

  step('edits a workout: target weight and an extra exercise');
  await page.click('#tabs >> text=Routines');
  await page.click('.workout-info >> text=Workout B');
  await page.waitForSelector('#items');
  await page.fill('input[data-idx="0"][data-field="weight"]', '225');
  await page.press('input[data-idx="0"][data-field="weight"]', 'Tab');
  await page.click('text=+ Add exercise');
  await page.fill('#search', 'plank');
  await page.click('#results >> text=Plank');
  await page.waitForFunction(() => document.querySelectorAll('#items .item').length === 4);
  await shot('10-workout-edit');
  await page.click('.header .back');
  await page.waitForSelector('#r-name'); // routine editor
  await page.click('.header .back');
  await page.waitForSelector('.routine'); // routines list
  assert.match(await page.textContent('#main'), /5 × 5 @ 225 lbs/);

  step('switching to kg/km converts everything');
  await page.click('#tabs >> text=Settings');
  await page.click('text=Kilograms (kg)');
  await page.waitForSelector('.toast.show >> text=Showing kg');
  await page.click('#units >> text=Kilometres');
  await page.waitForSelector('.toast.show >> text=Showing kg and km');
  await page.goto(`${base}#/day/${planDate}`);
  await page.waitForSelector('.ex-card');
  assert.match(await page.textContent('.ex-card'), /65\.77 kg × 5/); // 145 lb
  await page.click('#tabs >> text=Log');
  await page.waitForSelector('#day:not(:has(.progress-pill))');
  assert.match(await page.textContent('#day'), /5 km in 25:30/); // 5000 m
  await page.click('#tabs >> text=Routines');
  await page.waitForSelector('.routine');
  assert.match(await page.textContent('#main'), /5 × 5 @ 102\.06 kg/);

  step('bodyweight in kg, shown in lbs after switching back');
  await page.click('#tabs >> text=Body');
  await page.fill('#b-weight', '84');
  await page.click('#body-form button[type=submit]');
  await page.waitForSelector('.stats');
  assert.equal(await page.textContent('.stat strong'), '84');
  await page.click('#tabs >> text=Settings');
  await page.click('text=Pounds (lbs)');
  await page.waitForSelector('.toast.show >> text=Showing lbs');
  await page.click('#tabs >> text=Body');
  await page.waitForSelector('.stats');
  assert.equal(await page.textContent('.stat strong'), '185.2'); // 84 kg
  await shot('11-body');
  await page.click('#tabs >> text=Settings');
  await page.click('#units >> text=Metres');
  await page.waitForSelector('.toast.show >> text=Showing lbs and m');

  step('a cardio exercise can use its own distance unit');
  await page.click('text=Exercises & categories');
  await page.fill('#search', 'Running');
  await page.click('#list a:visible >> text=Running');
  await page.selectOption('#du', 'mi');
  await page.click('#ex-form button[type=submit]');
  await page.waitForSelector('.toast.show >> text=Exercise saved');
  await page.click('#tabs >> text=Log');
  await page.waitForSelector('#day:not(:has(.progress-pill))');
  assert.match(await page.textContent('#day'), /3\.11 mi in 25:30/);
  await page.click('#tabs >> text=Settings');

  step('creates a custom exercise');
  await page.click('text=Exercises & categories');
  await page.click('.header .plus');
  await page.fill('#name', 'Landmine Press');
  await page.selectOption('#cat', { label: 'Shoulders' });
  await page.click('#ex-form button[type=submit]');
  await page.waitForSelector('text=Landmine Press');

  step('data survives a reload');
  await page.reload();
  await page.click('#tabs >> text=Log');
  await page.waitForSelector('.ex-card');
  assert.equal(await page.inputValue('#day-note'), 'Good session');

  step('backup, wipe-by-restore, and CSV export');
  await page.click('#tabs >> text=Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
  const backupPath = join(root, 'test-results', 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.format, 'gymlog-backup');
  assert.equal(backup.sets.length, 11);
  assert.equal(backup.body.length, 1);
  assert.equal(backup.routines[0].workouts[1].items.length, 4);
  await page.waitForFunction(() => !document.body.textContent.includes('Last backup: never'));
  page.once('dialog', (d) => d.accept());
  await page.setInputFiles('#restore-file', backupPath);
  await page.waitForSelector('.toast.show >> text=Backup restored');
  assert.match(await page.textContent('#main'), /1 bodyweight entries · 1 routines/);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const csvPath = join(root, 'test-results', 'export.csv');
  await csv.saveAs(csvPath);
  const lines = (await readFile(csvPath, 'utf8')).trim().split('\r\n');
  assert.equal(lines.length, 12);
  await shot('07-settings');

  step('works offline after first load');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the service worker control the page
  await context.setOffline(true);
  await page.reload();
  await page.click('#tabs >> text=Log');
  await page.waitForSelector('.ex-card');
  await context.setOffline(false);

  assert.deepEqual(errors, [], `console errors: ${errors.join('\n')}`);
  console.log('\nAll e2e checks passed.');
} catch (err) {
  await shot('failure').catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
