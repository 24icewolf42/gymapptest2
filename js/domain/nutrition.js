// Food and drink around a training session (before and after). Stored with
// the session, so it syncs and shows in history. No calories or targets on
// purpose: the app is used by teenagers. Pure functions.
import { cut } from '../core/text.js';

export const ITEMS = [
  ['meal', 'Meal'],
  ['snack', 'Snack'],
  ['shake', 'Shake'],
  ['fruit', 'Fruit'],
  ['drink', 'Drink'],
  ['nothing', 'Nothing'],
];

export const TIMES = {
  pre: [['lt30', 'Up to 30 min before'], ['30-60', '30–60 min before'], ['1-2h', '1–2 h before'], ['gt2h', 'More than 2 h before']],
  post: [['lt30', 'Within 30 min after'], ['30-60', '30–60 min after'], ['1-2h', '1–2 h after'], ['gt2h', 'Later']],
};

export const NOTE_MAX = 80;
const WATER_MAX = 5000; // ml
const PROTEIN_MAX = 300; // g

// Only numbers or numeric text count (not true, not blanks); `places` decimals are kept.
const amount = (v, max, places = 0) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v))) return null;
  const f = 10 ** places;
  const n = Math.round(Number(String(v).replace(',', '.')) * f) / f;
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

/** One before/after entry from any source (form, sync, backup file), or null when empty. */
export function sanitizeEntry(e, side) {
  if (!e || typeof e !== 'object') return null;
  const known = new Set(ITEMS.map(([id]) => id));
  let items = [...new Set(Array.isArray(e.items) ? e.items.filter((x) => known.has(x)) : [])];
  if (items.length > 1) items = items.filter((x) => x !== 'nothing'); // "Nothing" only on its own
  const note = typeof e.note === 'string' ? cut(e.note.trim(), NOTE_MAX) : '';
  const when = TIMES[side].some(([id]) => id === e.when) ? e.when : '';
  const water = amount(e.water, WATER_MAX), protein = amount(e.protein, PROTEIN_MAX, 1);
  if (!items.length && !note && !when && water == null && protein == null) return null;
  const out = { items, note, when };
  if (water != null) out.water = water;
  if (protein != null) out.protein = protein;
  return out;
}

/** { pre?, post? } or null when nothing was logged. */
export function sanitizeNutrition(n) {
  if (!n || typeof n !== 'object') return null;
  const pre = sanitizeEntry(n.pre, 'pre'), post = sanitizeEntry(n.post, 'post');
  if (!pre && !post) return null;
  return { ...(pre ? { pre } : {}), ...(post ? { post } : {}) };
}

/** Short text for one entry, e.g. "Shake, Fruit · Within 30 min after · 500 ml · 25 g protein". */
export function entrySummary(e, side) {
  if (!e) return '';
  const label = (id) => ITEMS.find(([x]) => x === id)?.[1] || id;
  const what = [e.items.map(label).join(', '), e.note].filter(Boolean).join(': ');
  return [
    what,
    TIMES[side].find(([x]) => x === e.when)?.[1] || '',
    e.water != null ? e.water + ' ml water' : '',
    e.protein != null ? e.protein + ' g protein' : '',
  ].filter(Boolean).join(' · ');
}
