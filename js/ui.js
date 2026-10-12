// Shared UI helpers used by every screen.
import { state } from './db.js';
import { TYPES, fmtNum } from './logic.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Set by main.js so screens can re-render without importing the router.
export const nav = { route: () => {} };

export function go(hash) {
  if (location.hash === hash) nav.route();
  else location.hash = hash;
}

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => t.classList.remove('show'), 2200);
}

export function renderShell({ title, back, actions = '', body, tab }) {
  $('#header').innerHTML = `
    ${back ? `<a class="hbtn back" href="${back}" aria-label="Back">‹</a>` : '<span class="hbtn"></span>'}
    <h1>${title}</h1>
    <div class="hactions">${actions}</div>`;
  const main = $('#main');
  main.innerHTML = body;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  main.scrollTop = 0;
}

export const colourOf = (ex) => state.categories.get(ex?.categoryId)?.colour || '#888';

export function exerciseLink(ex, href, meta = TYPES[ex.type]?.label) {
  return `<li><a href="${href}"><span class="swatch" style="background:${esc(colourOf(ex))}"></span>${esc(ex.name)}<span class="meta">${esc(meta)}</span></a></li>`;
}

// Numeric field with −/+ buttons. Wire up with bindSteppers().
export function stepper(id, label, value, { step, inputmode = 'decimal' }) {
  return `
    <div class="stepper">
      <span class="label">${label}</span>
      <button type="button" data-step="${id}" data-delta="${-step}" aria-label="Decrease ${label}">−</button>
      <input id="${id}" type="text" inputmode="${inputmode}" value="${esc(value)}" autocomplete="off">
      <button type="button" data-step="${id}" data-delta="${step}" aria-label="Increase ${label}">+</button>
    </div>`;
}

export function bindSteppers(root) {
  $$('[data-step]', root).forEach((b) => b.addEventListener('click', () => {
    const input = $(`#${b.dataset.step}`, root);
    const next = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.delta));
    input.value = fmtNum(next);
  }));
  $$('input[inputmode]', root).forEach((i) => i.addEventListener('focus', () => i.select()));
}

// h:mm:ss entry using three numeric fields (the iOS number pad has no colon).
export function durationInputs(seconds, label = 'Time') {
  const s = Math.round(seconds || 0);
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return `
    <div class="stepper duration">
      <span class="label">${label}</span>
      <div class="hms">
        <input id="f-h" type="text" inputmode="numeric" value="${parts[0] || ''}" placeholder="h" aria-label="Hours">:
        <input id="f-m" type="text" inputmode="numeric" value="${parts[1] || ''}" placeholder="mm" aria-label="Minutes">:
        <input id="f-s" type="text" inputmode="numeric" value="${parts[2] || ''}" placeholder="ss" aria-label="Seconds">
      </div>
    </div>`;
}

export function readNumber(root, id) {
  const v = $(`#${id}`, root)?.value.trim();
  return v ? Number(v) : 0;
}

export function readDuration(root) {
  return readNumber(root, 'f-h') * 3600 + readNumber(root, 'f-m') * 60 + readNumber(root, 'f-s');
}

export function addSwipe(node, onSwipe) {
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

export const RANGES = [['1m', '1M', 31], ['3m', '3M', 92], ['1y', '1Y', 366], ['all', 'All', null]];

export function rangeChips(active) {
  return `<div class="chips">${RANGES.map(([k, l]) => `<button class="chip small ${k === active ? 'active' : ''}" data-range="${k}">${l}</button>`).join('')}</div>`;
}

export async function shareOrDownload(filename, text, mime) {
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
