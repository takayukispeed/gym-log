// Bodyweight tracker: one entry per day, stored in lbs, shown in the chosen unit.
import * as db from '../db.js';
import { state } from '../db.js';
import { lineChart } from '../chart.js';
import {
  todayISO, addDays, isISODate, formatDayLong, fmtNum, weightOut, weightIn, wUnit,
  BODY_STEP, bodyStats, formatChange,
} from '../logic.js';
import { $, $$, esc, toast, renderShell, stepper, bindSteppers, rangeChips, RANGES, nav } from '../ui.js';

let range = '3m';

export function viewBody(editDate) {
  const entries = db.bodyList();
  const today = todayISO();
  const date = isISODate(editDate) ? editDate : today;
  const existing = state.body.get(date);
  const last = entries[entries.length - 1];
  const value = existing?.weight ?? last?.weight;
  const stats = bodyStats(entries, today);

  renderShell({
    title: 'Bodyweight',
    tab: 'body',
    body: `
      <form id="body-form" class="card track" autocomplete="off">
        <label class="field"><span>Date</span><input id="b-date" type="date" value="${date}" max="${addDays(today, 1)}"></label>
        ${stepper('b-weight', `Weight (${wUnit()})`, value ? fmtNum(weightOut(value), 1) : '', { step: BODY_STEP[wUnit()] })}
        <label class="field"><span>Note (optional)</span><input id="b-note" type="text" value="${esc(existing?.note)}" placeholder="e.g. morning, after coffee"></label>
        <div class="row">
          <button type="submit" class="btn primary">${existing ? 'Update' : 'Save'}</button>
          ${existing ? '<button type="button" class="btn danger" id="b-del">Delete</button>' : ''}
        </div>
      </form>
      ${stats ? `
        <div class="stats">
          <div class="stat"><span>Current</span><strong>${fmtNum(stats.latest, 1)}</strong><small>${wUnit()}</small></div>
          <div class="stat"><span>7 days</span><strong>${formatChange(stats.change7).replace(` ${wUnit()}`, '')}</strong><small>${wUnit()}</small></div>
          <div class="stat"><span>30 days</span><strong>${formatChange(stats.change30).replace(` ${wUnit()}`, '')}</strong><small>${wUnit()}</small></div>
        </div>
        ${rangeChips(range)}
        <div class="card"><h2 class="chart-title">Bodyweight (${wUnit()})</h2><div id="chart"></div>
          <p class="hint">Range: ${fmtNum(stats.min, 1)}–${fmtNum(stats.max, 1)} ${wUnit()} across ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.</p></div>
        <ol class="setlist big" id="b-list">
          ${[...entries].reverse().map((e, i, arr) => {
            const prev = arr[i + 1];
            const delta = prev ? weightOut(e.weight) - weightOut(prev.weight) : null;
            return `<li data-date="${e.date}" class="${e.date === date && existing ? 'selected' : ''}">
              <span class="v">${fmtNum(weightOut(e.weight), 1)} ${wUnit()}</span>
              <span class="muted">${esc(formatDayLong(e.date))}</span>
              ${delta != null ? `<span class="delta">${formatChange(delta)}</span>` : ''}
              ${e.note ? `<span class="cm">${esc(e.note)}</span>` : ''}
            </li>`;
          }).join('')}
        </ol>` : '<p class="empty">Log your weight above to start tracking the trend.</p>'}`,
  });

  const root = $('#main');
  bindSteppers(root);
  $('#b-date').addEventListener('change', (e) => { if (isISODate(e.target.value)) viewBody(e.target.value); });
  $('#body-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = $('#b-date').value;
    const v = Number($('#b-weight').value);
    if (!isISODate(d)) return toast('Pick a date.');
    if (!(v > 0) || v > 1500) return toast('Enter a valid weight.');
    await db.saveBody({ date: d, weight: weightIn(v), note: $('#b-note').value.trim() });
    toast('Bodyweight saved');
    viewBody(d);
  });
  $('#b-del')?.addEventListener('click', async () => {
    if (!confirm(`Delete the entry for ${formatDayLong(date)}?`)) return;
    await db.deleteBody(date);
    toast('Entry deleted');
    viewBody(today);
  });
  $$('#b-list li').forEach((li) => li.addEventListener('click', () => viewBody(li.dataset.date)));
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; nav.route(); }));

  if (stats) {
    const days = RANGES.find((r) => r[0] === range)?.[2];
    const cutoff = days ? addDays(today, -days) : '';
    const points = entries.filter((e) => e.date >= cutoff).map((e) => ({ date: e.date, value: weightOut(e.weight) }));
    lineChart($('#chart'), points, { format: (v) => `${fmtNum(v, 1)} ${wUnit()}`, tickFormat: (v) => fmtNum(v, 1) });
  }
}
