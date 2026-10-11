// Minimal single-series SVG line chart on a time axis, with a tap/hover readout.
import { fromISO, formatDayShort } from './logic.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, maxV, count = 4) {
  if (min === maxV) {
    // A flat series gets a small band so ticks stay meaningful.
    const pad = Math.max(Math.abs(min) * 0.02, 1);
    min -= pad; maxV += pad;
  }
  const raw = (maxV - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(maxV / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

// points: [{date, value}], format: value -> string, tickFormat: value -> short string
// invert: draw smaller values higher (for pace, where lower is better).
export function lineChart(container, points, { format, tickFormat = format, invert = false }) {
  container.innerHTML = '';
  if (points.length === 0) {
    container.innerHTML = '<p class="empty">No data yet for this measure.</p>';
    return;
  }
  const W = container.clientWidth || 340;
  const H = 220;
  const m = { top: 16, right: 16, bottom: 28, left: 48 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const xs = points.map((p) => fromISO(p.date).getTime());
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (t) => m.left + (xMax === xMin ? iw / 2 : ((t - xMin) / (xMax - xMin)) * iw);
  const frac = (v) => (v - yMin) / (yMax - yMin);
  const y = (v) => (invert ? m.top + frac(v) * ih : m.top + ih - frac(v) * ih);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img' });
  for (const t of ticks) {
    el('line', { x1: m.left, x2: W - m.right, y1: y(t), y2: y(t), class: 'grid' }, svg);
    const label = el('text', { x: m.left - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis' }, svg);
    label.textContent = tickFormat(t);
  }
  const first = el('text', { x: m.left, y: H - 8, 'text-anchor': 'start', class: 'axis' }, svg);
  first.textContent = formatDayShort(points[0].date);
  if (points.length > 1) {
    const last = el('text', { x: W - m.right, y: H - 8, 'text-anchor': 'end', class: 'axis' }, svg);
    last.textContent = formatDayShort(points[points.length - 1].date);
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  el('path', { d, class: 'line' }, svg);
  if (points.length <= 60) {
    points.forEach((p, i) => el('circle', { cx: x(xs[i]), cy: y(p.value), r: 3.5, class: 'dot' }, svg));
  }

  const cross = el('line', { y1: m.top, y2: m.top + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const focus = el('circle', { r: 5, class: 'focus', visibility: 'hidden' }, svg);
  const readout = document.createElement('div');
  readout.className = 'chart-readout';
  readout.textContent = `Latest: ${format(points[points.length - 1].value)} · ${formatDayShort(points[points.length - 1].date)}`;

  function show(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(xs[best]) - px)) best = i; });
    const p = points[best];
    cross.setAttribute('x1', x(xs[best]));
    cross.setAttribute('x2', x(xs[best]));
    focus.setAttribute('cx', x(xs[best]));
    focus.setAttribute('cy', y(p.value));
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('visibility', 'visible');
    readout.textContent = `${format(p.value)} · ${formatDayShort(p.date)}`;
  }
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);

  container.append(svg, readout);
}
