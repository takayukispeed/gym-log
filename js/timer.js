// Rest timer. Stores an absolute end time so it stays correct if iOS suspends
// the page while you're between sets; it simply catches up when you return.

const KEY = 'gymlog.timerEnd';
const listeners = new Set();
let endAt = null;
let total = 0;
let interval = null;
let audioCtx = null;
let soundOn = true;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && saved.endAt > Date.now()) ({ endAt, total } = saved);
} catch { /* storage unavailable: timer just won't survive reloads */ }

function persist() {
  try {
    if (endAt) localStorage.setItem(KEY, JSON.stringify({ endAt, total }));
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

// iOS only allows audio after a user gesture, so unlock on the first tap.
export function unlockAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.01);
  } catch { audioCtx = null; }
}

function beep() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (!soundOn || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  [0, 0.25, 0.5].forEach((offset) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    const t = audioCtx.currentTime + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

function emit() {
  const s = status();
  listeners.forEach((fn) => fn(s));
}

function tick() {
  if (endAt && Date.now() >= endAt) {
    endAt = null;
    persist();
    clearInterval(interval);
    interval = null;
    beep();
  }
  emit();
}

function ensureTicking() {
  if (!interval && endAt) interval = setInterval(tick, 250);
}

export function status() {
  if (!endAt) return { running: false, remaining: 0, total };
  return { running: true, remaining: Math.max(0, Math.ceil((endAt - Date.now()) / 1000)), total };
}

export function start(seconds) {
  total = seconds;
  endAt = Date.now() + seconds * 1000;
  persist();
  ensureTicking();
  emit();
}

export function adjust(deltaSeconds) {
  if (!endAt) return;
  endAt = Math.max(Date.now() + 1000, endAt + deltaSeconds * 1000);
  total = Math.max(total + deltaSeconds, 1);
  persist();
  emit();
}

export function stop() {
  endAt = null;
  persist();
  clearInterval(interval);
  interval = null;
  emit();
}

export function setSound(on) { soundOn = on; }

export function subscribe(fn) {
  listeners.add(fn);
  fn(status());
  return () => listeners.delete(fn);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
ensureTicking();
