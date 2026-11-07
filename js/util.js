'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byId = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const wait = ms => new Promise(r => setTimeout(r, ms));

function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
const pick = arr => arr[randInt(arr.length)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not read image'));
    i.src = src;
  });
}

/** Read an image file, downscale it and return a compact data URL (keeps transparency). */
async function fileToDataURL(file, max = 1600, quality = 0.9) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    const w = img.naturalWidth || 800, h = img.naturalHeight || 800;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/webp', quality);
    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', quality);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nameFromFile(file) {
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, ch => ch.toUpperCase());
}

/** Photo of a contester, or a colourful initials avatar if no photo. */
function avatarFor(c) {
  if (c && c.photo) return c.photo;
  const name = (c && c.name) || '?';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0].toUpperCase()).join('') || '?';
  const hue = ((c && c.num) || 1) * 47 % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},75%,58%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},70%,30%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="128" font-family="Segoe UI,Arial,sans-serif" font-size="84" font-weight="700" fill="white" text-anchor="middle">${esc(initials)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function toast(msg, type = 'ok') {
  const box = byId('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

function download(name, text, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Make an element accept dropped image files. */
function dropZone(el, onFiles) {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) onFiles(files);
  });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
