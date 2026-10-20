/*
 * Biome Base Finder
 * Renders the overworld biome map for a seed (cubiomes compiled to wasm, run in
 * web workers), and narrows a search area down by biome / water colour.
 */
'use strict';
(function () {

// ───────────────────────── biome data ─────────────────────────

// [cubiomes id, java name, map colour] for every biome the 1.18+ overworld
// generates. Colours are cubiomes' own palette (util.c initBiomeColors).
const BIOME_LIST = [
  [0, 'ocean', 0x000070], [1, 'plains', 0x8db360], [2, 'desert', 0xfa9418],
  [3, 'windswept_hills', 0x606060], [4, 'forest', 0x056621], [5, 'taiga', 0x0b6a5f],
  [6, 'swamp', 0x07f9b2], [7, 'river', 0x0000ff], [10, 'frozen_ocean', 0x7070d6],
  [11, 'frozen_river', 0xa0a0ff], [12, 'snowy_plains', 0xffffff], [14, 'mushroom_fields', 0xff00ff],
  [16, 'beach', 0xfade55], [21, 'jungle', 0x507b0a], [23, 'sparse_jungle', 0x60930f],
  [24, 'deep_ocean', 0x000030], [25, 'stony_shore', 0xa2a284], [26, 'snowy_beach', 0xfaf0c0],
  [27, 'birch_forest', 0x307444], [29, 'dark_forest', 0x40511a], [30, 'snowy_taiga', 0x31554a],
  [32, 'old_growth_pine_taiga', 0x596651], [34, 'windswept_forest', 0x5b7352], [35, 'savanna', 0xbdb25f],
  [36, 'savanna_plateau', 0xa79d64], [37, 'badlands', 0xd94515], [38, 'wooded_badlands', 0xb09765],
  [44, 'warm_ocean', 0x0000ac], [45, 'lukewarm_ocean', 0x000090], [46, 'cold_ocean', 0x202070],
  [48, 'deep_lukewarm_ocean', 0x000040], [49, 'deep_cold_ocean', 0x202038], [50, 'deep_frozen_ocean', 0x404090],
  [129, 'sunflower_plains', 0xb5db88], [131, 'windswept_gravelly_hills', 0x888888], [132, 'flower_forest', 0x2d8e49],
  [140, 'ice_spikes', 0xb4dcdc], [155, 'old_growth_birch_forest', 0x589c6c], [160, 'old_growth_spruce_taiga', 0x818e79],
  [163, 'windswept_savanna', 0xe5da87], [165, 'eroded_badlands', 0xff6d3d], [168, 'bamboo_jungle', 0x849500],
  [174, 'dripstone_caves', 0x4e3012], [175, 'lush_caves', 0x283c00], [177, 'meadow', 0x60a445],
  [178, 'grove', 0x47726c], [179, 'snowy_slopes', 0xc4c4c4], [180, 'jagged_peaks', 0xdcdcc8],
  [181, 'frozen_peaks', 0xb0b3ce], [182, 'stony_peaks', 0x7b8f74], [183, 'deep_dark', 0x031f29],
  [184, 'mangrove_swamp', 0x2ccc8e], [185, 'cherry_grove', 0xff91c8], [186, 'pale_garden', 0x696d95],
];

// Java Edition water colours (biome "water_color"); everything else is 0x3F76E4.
const WATER_DEFAULT = 0x3f76e4;
const WATER_SPECIAL = {
  swamp: 0x617b64, mangrove_swamp: 0x3a7a6a,
  warm_ocean: 0x43d5ee, lukewarm_ocean: 0x45adf2, deep_lukewarm_ocean: 0x45adf2,
  cold_ocean: 0x3d57d6, deep_cold_ocean: 0x3d57d6, snowy_taiga: 0x3d57d6, snowy_beach: 0x3d57d6,
  frozen_ocean: 0x3938c9, deep_frozen_ocean: 0x3938c9, frozen_river: 0x3938c9,
  meadow: 0x0e4ecf, cherry_grove: 0x5db7ef, pale_garden: 0x76889d,
};

const WATER_GROUPS = [
  { c: 0x3f76e4, name: 'Normal blue', who: 'Most biomes' },
  { c: 0x617b64, name: 'Swamp green', who: 'Swamp' },
  { c: 0x3a7a6a, name: 'Mangrove teal', who: 'Mangrove swamp' },
  { c: 0x43d5ee, name: 'Turquoise', who: 'Warm ocean' },
  { c: 0x45adf2, name: 'Light blue', who: 'Lukewarm ocean' },
  { c: 0x5db7ef, name: 'Sky blue', who: 'Cherry grove' },
  { c: 0x0e4ecf, name: 'Royal blue', who: 'Meadow' },
  { c: 0x3d57d6, name: 'Cold blue', who: 'Cold ocean, snowy taiga & beach' },
  { c: 0x3938c9, name: 'Frozen violet', who: 'Frozen ocean & river' },
  { c: 0x76889d, name: 'Grey-blue', who: 'Pale garden' },
];

const QUICK = [
  ['Oceans', ['ocean', 'deep_ocean', 'warm_ocean', 'lukewarm_ocean', 'deep_lukewarm_ocean', 'cold_ocean', 'deep_cold_ocean', 'frozen_ocean', 'deep_frozen_ocean']],
  ['Rivers', ['river', 'frozen_river']],
  ['Beaches', ['beach', 'snowy_beach', 'stony_shore']],
  ['Snowy', ['snowy_plains', 'ice_spikes', 'snowy_taiga', 'snowy_beach', 'snowy_slopes', 'frozen_peaks', 'jagged_peaks', 'grove', 'frozen_river', 'frozen_ocean', 'deep_frozen_ocean']],
  ['Mountains', ['windswept_hills', 'windswept_gravelly_hills', 'windswept_forest', 'windswept_savanna', 'meadow', 'cherry_grove', 'grove', 'snowy_slopes', 'jagged_peaks', 'frozen_peaks', 'stony_peaks']],
  ['Caves', ['dripstone_caves', 'lush_caves', 'deep_dark']],
];

const BIOMES = BIOME_LIST.map(([id, key, color]) => ({
  id, key, color,
  water: WATER_SPECIAL[key] || WATER_DEFAULT,
  label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
}));
const BIOME_BY_ID = new Map(BIOMES.map(b => [b.id, b]));
const BIOME_BY_KEY = new Map(BIOMES.map(b => [b.key, b]));
for (const g of WATER_GROUPS) g.ids = BIOMES.filter(b => b.water === g.c).map(b => b.id);

// ───────────────────────── helpers ─────────────────────────

const $ = (s) => document.querySelector(s);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const WORLD_LIMIT = 30000000;

function fmtArea(blocks2) {
  if (blocks2 >= 1e9) return (blocks2 / 1e9).toFixed(2) + 'B blocks²';
  if (blocks2 >= 1e6) return (blocks2 / 1e6).toFixed(1) + 'M blocks²';
  if (blocks2 >= 1e4) return Math.round(blocks2 / 1e3) + 'k blocks²';
  return fmtInt(blocks2) + ' blocks²';
}
function fmtPct(p) {
  if (p <= 0) return '0%';
  if (p < 0.1) return '<0.1%';
  if (p < 10) return p.toFixed(1) + '%';
  return Math.round(p) + '%';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Same rules as Minecraft: a number that fits in a long is used as-is,
// anything else becomes String.hashCode().
function parseSeed(text) {
  const t = text.trim();
  if (!t) return null;
  if (/^[+-]?\d+$/.test(t)) {
    const v = BigInt(t);
    if (v >= -(1n << 63n) && v < (1n << 63n)) return { value: v, fromText: false };
  }
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  return { value: BigInt(h), fromText: true };
}

// ───────────────────────── state ─────────────────────────

const EXAMPLE_SEED = '-6261216306932733651';
const STORE_KEY = 'biome-base-finder.v1';

const state = {
  seed: EXAMPLE_SEED,
  mc: 28,
  large: false,
  heightMode: 'surface',
  y: 64,
  area: { x1: -12500, z1: -25000, x2: 12499, z2: 24999 },
  sel: new Uint8Array(256),
  zones: [],
  mode: 'biomes',
  tool: 'pan',
  res: 16,
  minPatch: 0,
  probe: { x: 0, y: 64, z: 0 },
  view: null,
  samples: [],
};
for (const b of BIOMES) state.sel[b.id] = 1;
let world = null; // { mc, large, lo, hi } for the workers
let autoModeSwitched = false;

function loadSaved() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') return;
  if (typeof s.seed === 'string') state.seed = s.seed;
  if ([22, 23, 24, 25, 26, 27, 28].includes(s.mc)) state.mc = s.mc;
  state.large = !!s.large;
  if (s.heightMode === 'y' || s.heightMode === 'surface') state.heightMode = s.heightMode;
  if (Number.isFinite(s.y)) state.y = s.y;
  if (s.area && ['x1', 'z1', 'x2', 'z2'].every(k => Number.isFinite(s.area[k]))) state.area = s.area;
  if (Array.isArray(s.sel)) {
    state.sel.fill(0);
    for (const id of s.sel) if (BIOME_BY_ID.has(id)) state.sel[id] = 1;
  }
  if (Array.isArray(s.zones)) state.zones = s.zones.filter(z => z && ['x1', 'z1', 'x2', 'z2'].every(k => Number.isFinite(z[k])));
  if (['biomes', 'candidates', 'water'].includes(s.mode)) state.mode = s.mode;
  if ([4, 8, 16, 32, 64].includes(s.res)) state.res = s.res;
  if (Number.isFinite(s.minPatch)) state.minPatch = s.minPatch;
  if (s.probe && Number.isFinite(s.probe.x)) state.probe = s.probe;
  if (s.view && Number.isFinite(s.view.cx) && Number.isFinite(s.view.bpp)) state.view = s.view;
  if (Array.isArray(s.samples)) {
    state.samples = s.samples.filter(x => x && Array.isArray(x.rgb) && x.rgb.length === 3 && x.rgb.every(Number.isFinite) &&
      (x.role === 'base' || (x.role === 'ref' && BIOME_BY_KEY.has(x.biome))));
  }
  if (typeof s.markRole === 'string' && (s.markRole === 'base' || BIOME_BY_KEY.has(s.markRole.slice(4)))) markRole = s.markRole;
  autoModeSwitched = true;
}

let saveTimer = 0;
let booted = false;
function saveSoon() {
  if (!booted) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const sel = [];
    for (const b of BIOMES) if (state.sel[b.id]) sel.push(b.id);
    const data = {
      seed: state.seed, mc: state.mc, large: state.large, heightMode: state.heightMode, y: state.y,
      area: state.area, sel, zones: state.zones, mode: state.mode, res: state.res,
      minPatch: state.minPatch, probe: state.probe, view: { cx: view.cx, cz: view.cz, bpp: view.bpp },
      samples: state.samples.map(x => ({ role: x.role, rgb: x.rgb, biome: x.biome, px: x.px, uneven: x.uneven })),
      markRole,
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }, 300);
}

// ───────────────────────── workers ─────────────────────────

// Runs inside each worker (and on the main thread if workers are unavailable).
function workerMain(scope) {
  let ex = null;
  let key = '';
  scope.onmessage = function (e) {
    const m = e.data;
    if (m.type === 'load') {
      WebAssembly.instantiate(m.bytes, {}).then(
        (r) => { ex = r.instance.exports; scope.postMessage({ type: 'ready' }); },
        (err) => scope.postMessage({ type: 'fail', message: String((err && err.message) || err) }));
      return;
    }
    const w = m.world;
    const k = w.mc + ':' + w.large + ':' + w.lo + ':' + w.hi;
    if (k !== key) {
      ex.bf_init(w.mc, w.large, w.lo, w.hi);
      key = k;
    }
    if (m.type === 'gen') {
      ex.bf_gen(m.x, m.z, m.w, m.h, m.step, m.y, m.surface);
      const ids = new Uint8Array(ex.memory.buffer, ex.bf_out(), m.w * m.h).slice();
      scope.postMessage({ type: 'done', id: m.id, ids }, [ids.buffer]);
    } else if (m.type === 'probe') {
      scope.postMessage({ type: 'done', id: m.id, biome: ex.bf_probe(m.x, m.y, m.z, 0) });
    }
  };
}

function inlineWorker() {
  const outer = { onmessage: null, postMessage(msg) { setTimeout(() => inner.onmessage({ data: msg }), 0); } };
  const inner = { onmessage: null, postMessage(msg) { setTimeout(() => outer.onmessage({ data: msg }), 0); } };
  workerMain(inner);
  return outer;
}

const pool = {
  slots: [],
  probeQ: [],
  tileQ: [],
  scanQ: [],
  nextId: 1,
  failed: false,

  start(bytes) {
    let url = null;
    try {
      url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')(self);'], { type: 'text/javascript' }));
    } catch (e) { url = null; }
    const n = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 12);
    for (let i = 0; i < n; i++) {
      let w = null;
      if (url) { try { w = new Worker(url); } catch (e) { w = null; } }
      if (!w) {
        if (i === 0) this.add(inlineWorker(), bytes);
        break;
      }
      this.add(w, bytes);
    }
  },

  add(w, bytes) {
    const slot = { w, ready: false, job: null };
    this.slots.push(slot);
    w.onmessage = (e) => this.onMessage(slot, e.data);
    if ('onerror' in w) w.onerror = () => this.onFail(slot, 'The worker script was blocked.');
    const copy = bytes.slice();
    w.postMessage({ type: 'load', bytes: copy.buffer }, w instanceof Worker ? [copy.buffer] : undefined);
  },

  onMessage(slot, m) {
    if (m.type === 'ready') {
      slot.ready = true;
      this.pump();
    } else if (m.type === 'fail') {
      this.onFail(slot, m.message);
    } else if (m.type === 'done') {
      const job = slot.job;
      slot.job = null;
      if (job) job.done(m);
      this.pump();
      updateBusy();
    }
  },

  onFail(slot, message) {
    this.slots = this.slots.filter(s => s !== slot);
    if (slot.job) { const j = slot.job; slot.job = null; (j.tile ? this.tileQ : this.scanQ).unshift(j); }
    if (!this.slots.length && !this.failed) {
      this.failed = true;
      showMapError('The biome generator could not start in this browser (' + message + '). Try a current Chrome, Edge or Firefox.');
    }
    this.pump();
  },

  pump() {
    for (const slot of this.slots) {
      if (!slot.ready || slot.job) continue;
      const job = this.probeQ.shift() || this.tileQ.shift() || this.scanQ.shift();
      if (!job) return;
      if (job.tile) job.tile.inflight = true;
      job.msg.id = this.nextId++;
      slot.job = job;
      slot.w.postMessage(job.msg);
    }
  },

  busyTiles() {
    let n = this.tileQ.length;
    for (const s of this.slots) if (s.job && s.job.tile) n++;
    return n;
  },
};

function heightArgs() {
  return state.heightMode === 'surface' ? { y: 64, surface: 1 } : { y: state.y, surface: 0 };
}

// ───────────────────────── map ─────────────────────────

const TILE = 256;
const MAX_TILES = 320;
const MIN_BPP = 1 / 8;
const MAX_BPP = 1024;

const mapwrap = $('#mapwrap');
const canvas = $('#map');
const ctx = canvas.getContext('2d');
const view = { cx: 0, cz: 0, bpp: 32 };
let cssW = 1, cssH = 1, dpr = 1;
const tiles = new Map();
let epoch = 0;
let colorStamp = 1;
let frame = 0;
let drawQueued = false;
let rubber = null; // block-space rectangle being drawn
let focus = null;  // highlighted spot { x1, z1, x2, z2, x, z }
let probeMark = null;

const scratchImg = new ImageData(TILE, TILE);
const scratch32 = new Uint32Array(scratchImg.data.buffer);
const lutBiome = new Uint32Array(256);
const lutWater = new Uint32Array(256);
const lutDim = new Uint32Array(256);
const lutCand = new Uint32Array(256);
const COLORS = {};

function abgr(c) { return (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0; }
function mix(a, b, t) {
  const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
  const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
  const bl = (a & 255) * (1 - t) + (b & 255) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function buildLuts() {
  const accent = parseInt(COLORS.area.slice(1), 16);
  lutBiome.fill(abgr(0xff00ff));
  lutWater.fill(abgr(0xff00ff));
  lutDim.fill(abgr(0x202020));
  for (const b of BIOMES) {
    lutBiome[b.id] = abgr(b.color);
    lutWater[b.id] = abgr(b.water);
    const r = (b.color >> 16) & 255, g = (b.color >> 8) & 255, bl = b.color & 255;
    const grey = Math.round(14 + (0.3 * r + 0.59 * g + 0.11 * bl) * 0.22);
    lutDim[b.id] = abgr((grey << 16) | (grey << 8) | (grey + 3));
  }
  for (let i = 0; i < 256; i++) {
    const b = BIOME_BY_ID.get(i);
    lutCand[i] = b && state.sel[i] ? abgr(mix(b.color, accent, 0.78)) : lutDim[i];
  }
}

function levelFor(bpp) {
  let s = 4;
  while (s * 2 <= bpp && s < 1024) s *= 2;
  return s;
}

function toScreenX(x) { return (x - view.cx) / view.bpp + cssW / 2; }
function toScreenZ(z) { return (z - view.cz) / view.bpp + cssH / 2; }
function toBlock(p) { return { x: view.cx + (p.x - cssW / 2) * view.bpp, z: view.cz + (p.y - cssH / 2) * view.bpp }; }

function resize() {
  const r = mapwrap.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cssW = Math.max(1, r.width);
  cssH = Math.max(1, r.height);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  draw();
}

function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

function paintTile(t) {
  if (!t.canvas) {
    t.canvas = document.createElement('canvas');
    t.canvas.width = t.canvas.height = TILE;
    t.ctx = t.canvas.getContext('2d');
  }
  const ids = t.ids;
  const px = scratch32;
  if (state.mode !== 'candidates') {
    const lut = state.mode === 'water' ? lutWater : lutBiome;
    for (let k = 0; k < ids.length; k++) px[k] = lut[ids[k]];
  } else {
    // A cell is possible when its biome is ticked, it is inside the search
    // area and not inside a ruled-out zone. Cell centres decide.
    const s = t.s, half = s >> 1;
    const x0 = t.tx * TILE * s + half, z0 = t.tz * TILE * s + half;
    const a = state.area;
    const ci0 = clamp(Math.ceil((a.x1 - x0) / s), 0, TILE);
    const ci1 = clamp(Math.floor((a.x2 - x0) / s), -1, TILE - 1);
    const xEnd = x0 + (TILE - 1) * s, zEnd = z0 + (TILE - 1) * s;
    const zones = state.zones.filter(zn => zn.x2 >= x0 && zn.x1 <= xEnd && zn.z2 >= z0 && zn.z1 <= zEnd);
    for (let j = 0; j < TILE; j++) {
      const row = j * TILE;
      for (let i = 0; i < TILE; i++) px[row + i] = lutDim[ids[row + i]];
      const bz = z0 + j * s;
      if (bz < a.z1 || bz > a.z2 || ci0 > ci1) continue;
      for (let i = ci0; i <= ci1; i++) px[row + i] = lutCand[ids[row + i]];
      for (const zn of zones) {
        if (bz < zn.z1 || bz > zn.z2) continue;
        const i0 = Math.max(ci0, Math.ceil((zn.x1 - x0) / s));
        const i1 = Math.min(ci1, Math.floor((zn.x2 - x0) / s));
        for (let i = i0; i <= i1; i++) px[row + i] = lutDim[ids[row + i]];
      }
    }
  }
  t.ctx.putImageData(scratchImg, 0, 0);
  t.stamp = colorStamp;
}

function loadedTile(s, tx, tz) {
  const t = tiles.get(s + '/' + tx + '/' + tz);
  if (!t || !t.ids) return null;
  if (t.stamp !== colorStamp) paintTile(t);
  t.used = frame;
  return t;
}

function drawFallback(s, tx, tz, dx, dy, dw, dh) {
  const bx = tx * TILE * s, bz = tz * TILE * s;
  // a coarser tile, scaled up
  for (let ps = s * 2, n = 0; ps <= 1024 && n < 4; ps *= 2, n++) {
    const span = TILE * ps;
    const ptx = Math.floor(bx / span), ptz = Math.floor(bz / span);
    const p = loadedTile(ps, ptx, ptz);
    if (!p) continue;
    const sz = (TILE * s) / ps;
    ctx.drawImage(p.canvas, (bx - ptx * span) / ps, (bz - ptz * span) / ps, sz, sz, dx, dy, dw, dh);
    break;
  }
  // finer tiles drawn on top, e.g. right after zooming out
  if (s > 4) {
    const cs = s / 2;
    for (let k = 0; k < 4; k++) {
      const c = loadedTile(cs, tx * 2 + (k & 1), tz * 2 + (k >> 1));
      if (!c) continue;
      ctx.drawImage(c.canvas, dx + (k & 1) * dw / 2, dy + (k >> 1) * dh / 2, dw / 2, dh / 2);
    }
  }
}

function draw() {
  drawQueued = false;
  frame++;
  const W = cssW, H = cssH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.mapBg;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  const s = levelFor(view.bpp);
  const span = TILE * s;
  const left = view.cx - (W / 2) * view.bpp, top = view.cz - (H / 2) * view.bpp;
  const tx0 = Math.floor(left / span), tx1 = Math.floor((left + W * view.bpp) / span);
  const tz0 = Math.floor(top / span), tz1 = Math.floor((top + H * view.bpp) / span);
  const want = [];
  if (world) {
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const sx = Math.round((tx * span - left) / view.bpp), sx2 = Math.round(((tx + 1) * span - left) / view.bpp);
        const sy = Math.round((tz * span - top) / view.bpp), sy2 = Math.round(((tz + 1) * span - top) / view.bpp);
        const t = loadedTile(s, tx, tz);
        if (t) {
          ctx.drawImage(t.canvas, sx, sy, sx2 - sx, sy2 - sy);
        } else {
          drawFallback(s, tx, tz, sx, sy, sx2 - sx, sy2 - sy);
          const dx = (tx + 0.5) * span - view.cx, dz = (tz + 0.5) * span - view.cz;
          want.push({ tx, tz, d: dx * dx + dz * dz });
        }
      }
    }
  }
  drawOverlays(W, H);
  requestTiles(s, want);
  evictTiles();
  updateBusy();
}

function requestTiles(s, want) {
  for (const job of pool.tileQ) job.tile.pending = false;
  pool.tileQ = [];
  want.sort((a, b) => a.d - b.d);
  const { y, surface } = heightArgs();
  for (const w of want) {
    const key = s + '/' + w.tx + '/' + w.tz;
    let t = tiles.get(key);
    if (!t) {
      t = { key, s, tx: w.tx, tz: w.tz, ids: null, canvas: null, stamp: 0, used: frame, pending: false, inflight: false };
      tiles.set(key, t);
    }
    if (t.inflight) continue;
    t.pending = true;
    t.used = frame;
    const myEpoch = epoch;
    pool.tileQ.push({
      tile: t,
      msg: { type: 'gen', world, x: w.tx * TILE * s, z: w.tz * TILE * s, w: TILE, h: TILE, step: s, y, surface },
      done(m) {
        t.inflight = false;
        t.pending = false;
        if (myEpoch !== epoch) return;
        t.ids = m.ids;
        t.stamp = 0;
        scheduleDraw();
      },
    });
  }
  pool.pump();
}

function evictTiles() {
  if (tiles.size <= MAX_TILES) return;
  const list = [...tiles.values()].filter(t => !t.inflight && !t.pending && t.used !== frame);
  list.sort((a, b) => a.used - b.used);
  for (const t of list) {
    if (tiles.size <= MAX_TILES) break;
    tiles.delete(t.key);
  }
}

function clearTiles() {
  epoch++;
  for (const job of pool.tileQ) job.tile.pending = false;
  pool.tileQ = [];
  tiles.clear();
}

let hatch = null;
function drawOverlays(W, H) {
  const a = state.area;
  const ax = toScreenX(a.x1), az = toScreenZ(a.z1);
  const aw = (a.x2 + 1 - a.x1) / view.bpp, ah = (a.z2 + 1 - a.z1) / view.bpp;

  drawGrid(W, H);

  // shade outside the search area
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(ax, az, aw, ah);
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fill('evenodd');
  ctx.restore();

  // ruled-out zones
  if (!hatch) {
    const hc = document.createElement('canvas');
    hc.width = hc.height = 10;
    const h = hc.getContext('2d');
    h.strokeStyle = COLORS.cut;
    h.globalAlpha = 0.7;
    h.lineWidth = 1.5;
    h.beginPath();
    h.moveTo(-1, 11); h.lineTo(11, -1);
    h.stroke();
    hatch = ctx.createPattern(hc, 'repeat');
  }
  for (const zn of state.zones) {
    const zx = toScreenX(zn.x1), zz = toScreenZ(zn.z1);
    const zw = (zn.x2 + 1 - zn.x1) / view.bpp, zh = (zn.z2 + 1 - zn.z1) / view.bpp;
    if (zx > W || zz > H || zx + zw < 0 || zz + zh < 0) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(zx, zz, zw, zh);
    ctx.fillStyle = hatch;
    ctx.fillRect(zx, zz, zw, zh);
    ctx.strokeStyle = COLORS.cut;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(zx) + 0.5, Math.round(zz) + 0.5, Math.max(1, Math.round(zw) - 1), Math.max(1, Math.round(zh) - 1));
  }

  // search area outline
  ctx.strokeStyle = COLORS.area;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(ax), Math.round(az), Math.round(aw), Math.round(ah));

  // world origin
  const ox = toScreenX(0), oz = toScreenZ(0);
  if (ox > -10 && ox < W + 10 && oz > -10 && oz < H + 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - 6, oz); ctx.lineTo(ox + 6, oz);
    ctx.moveTo(ox, oz - 6); ctx.lineTo(ox, oz + 6);
    ctx.stroke();
  }

  if (focus) {
    const fx = toScreenX(focus.x1), fz = toScreenZ(focus.z1);
    const fw = Math.max(6, (focus.x2 + 1 - focus.x1) / view.bpp), fh = Math.max(6, (focus.z2 + 1 - focus.z1) / view.bpp);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx, fz, fw, fh);
    ctx.setLineDash([]);
    marker(toScreenX(focus.x + 0.5), toScreenZ(focus.z + 0.5), '#ffffff');
  }
  if (probeMark) marker(toScreenX(probeMark.x + 0.5), toScreenZ(probeMark.z + 0.5), COLORS.area);

  if (rubber) {
    const x1 = Math.min(rubber.x0, rubber.x1), x2 = Math.max(rubber.x0, rubber.x1);
    const z1 = Math.min(rubber.z0, rubber.z1), z2 = Math.max(rubber.z0, rubber.z1);
    const col = state.tool === 'exclude' ? COLORS.cut : COLORS.area;
    ctx.fillStyle = col + '22';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(toScreenX(x1), toScreenZ(z1), (x2 - x1) / view.bpp, (z2 - z1) / view.bpp);
    ctx.strokeRect(toScreenX(x1), toScreenZ(z1), (x2 - x1) / view.bpp, (z2 - z1) / view.bpp);
    ctx.setLineDash([]);
    ctx.font = '12px ' + COLORS.mono;
    ctx.fillStyle = col;
    ctx.textBaseline = 'top';
    ctx.fillText(Math.round(x2 - x1) + ' × ' + Math.round(z2 - z1), toScreenX(x2) + 6, toScreenZ(z2) + 4);
  }
}

function marker(x, y, color) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
  ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
  ctx.stroke();
}

const GRID_STEPS = [16, 32, 64, 128, 256, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
function drawGrid(W, H) {
  let step = GRID_STEPS[GRID_STEPS.length - 1];
  for (const g of GRID_STEPS) if (g / view.bpp >= 110) { step = g; break; }
  const left = view.cx - (W / 2) * view.bpp, top = view.cz - (H / 2) * view.bpp;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(left / step) * step; x <= left + W * view.bpp; x += step) {
    const sx = Math.round(toScreenX(x)) + 0.5;
    ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
  }
  for (let z = Math.ceil(top / step) * step; z <= top + H * view.bpp; z += step) {
    const sz = Math.round(toScreenZ(z)) + 0.5;
    ctx.moveTo(0, sz); ctx.lineTo(W, sz);
  }
  ctx.stroke();
  ctx.font = '11px ' + COLORS.mono;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(232,232,230,0.6)';
  const labelTop = 48;
  for (let x = Math.ceil(left / step) * step; x <= left + W * view.bpp; x += step) {
    ctx.fillText('x ' + x, Math.round(toScreenX(x)) + 4, labelTop);
  }
  for (let z = Math.ceil(top / step) * step; z <= top + H * view.bpp; z += step) {
    const sz = Math.round(toScreenZ(z));
    if (sz < labelTop + 16 || sz > H - 48) continue;
    ctx.fillText('z ' + z, 6, sz + 3);
  }
}

// readout under the pointer
let hoverPoint = null;
let readoutQueued = false;
function biomeAtBlock(x, z) {
  for (let s = levelFor(view.bpp); s <= 1024; s *= 2) {
    const span = TILE * s;
    const tx = Math.floor(x / span), tz = Math.floor(z / span);
    const t = tiles.get(s + '/' + tx + '/' + tz);
    if (!t || !t.ids) continue;
    const i = Math.floor((x - tx * span) / s), j = Math.floor((z - tz * span) / s);
    return t.ids[j * TILE + i];
  }
  return -1;
}
function insideArea(x, z) {
  const a = state.area;
  return x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
}
function inZone(x, z) {
  return state.zones.find(zn => x >= zn.x1 && x <= zn.x2 && z >= zn.z1 && z <= zn.z2) || null;
}
function statusFor(id, x, z) {
  if (!insideArea(x, z)) return 'outside the area';
  if (inZone(x, z)) return 'ruled out';
  return state.sel[id] ? 'possible' : 'biome ruled out';
}
function updateReadout() {
  readoutQueued = false;
  const el = $('#readout');
  const busy = pool.busyTiles();
  const busyHtml = busy ? '<span class="busy">loading ' + busy + ' tile' + (busy === 1 ? '' : 's') + '</span>' : '';
  if (!hoverPoint) {
    el.innerHTML = '<span>Drag to move · pinch or scroll to zoom · tap for biome</span>' + busyHtml;
    return;
  }
  const b = toBlock(hoverPoint);
  const x = Math.floor(b.x), z = Math.floor(b.z);
  const id = biomeAtBlock(x, z);
  const bio = BIOME_BY_ID.get(id);
  let html = '<span>X <b>' + x + '</b></span><span>Z <b>' + z + '</b></span>';
  if (bio) {
    html += '<span><i class="sw" style="background:' + hex(bio.color) + '"></i><b>' + esc(bio.label) + '</b></span>';
    html += '<span><i class="sw" style="background:' + hex(bio.water) + '"></i>water ' + hex(bio.water).toUpperCase() + '</span>';
    html += '<span>' + statusFor(id, x, z) + '</span>';
  }
  el.innerHTML = html + busyHtml;
}
function scheduleReadout() {
  if (readoutQueued) return;
  readoutQueued = true;
  requestAnimationFrame(updateReadout);
}
function updateBusy() { scheduleReadout(); }

function showMapError(text) {
  $('#map-error-text').textContent = text;
  $('#map-error').hidden = false;
}

// ── map interaction ──
const pointers = new Map();
let drag = null;

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function zoomAt(p, f) {
  const b = toBlock(p);
  view.bpp = clamp(view.bpp * f, MIN_BPP, MAX_BPP);
  view.cx = b.x - (p.x - cssW / 2) * view.bpp;
  view.cz = b.z - (p.y - cssH / 2) * view.bpp;
  scheduleDraw();
  scheduleReadout();
  saveSoon();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    rubber = null;
    drag = {
      type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, bpp0: view.bpp, cx0: view.cx, cz0: view.cz,
    };
    return;
  }
  if (pointers.size > 2) return;
  if (state.tool !== 'pan' && e.button === 0) {
    const b = toBlock(p);
    rubber = { x0: b.x, z0: b.z, x1: b.x, z1: b.z };
    drag = { type: 'rect' };
  } else {
    drag = { type: 'pan', x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false };
    canvas.classList.add('dragging');
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = localPoint(e);
  if (e.pointerType === 'mouse' || pointers.has(e.pointerId)) {
    hoverPoint = p;
    scheduleReadout();
  }
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, p);
  if (!drag) return;
  if (drag.type === 'pan') {
    view.cx -= (p.x - drag.x) * view.bpp;
    view.cz -= (p.y - drag.y) * view.bpp;
    drag.x = p.x; drag.y = p.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5) drag.moved = true;
    scheduleDraw();
  } else if (drag.type === 'rect') {
    const b = toBlock(p);
    rubber.x1 = b.x; rubber.z1 = b.z;
    scheduleDraw();
  } else if (drag.type === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bx = drag.cx0 + (drag.mid0.x - cssW / 2) * drag.bpp0;
    const bz = drag.cz0 + (drag.mid0.y - cssH / 2) * drag.bpp0;
    view.bpp = clamp(drag.bpp0 * drag.d0 / d, MIN_BPP, MAX_BPP);
    view.cx = bx - (mid.x - cssW / 2) * view.bpp;
    view.cz = bz - (mid.y - cssH / 2) * view.bpp;
    scheduleDraw();
  }
});

function endPointer(e, cancelled) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (!drag) return;
  if (drag.type === 'rect' && !cancelled && rubber) {
    finishRect(rubber);
  } else if (drag.type === 'pan' && !drag.moved && !cancelled) {
    const b = toBlock(localPoint(e));
    probeAt(Math.floor(b.x), state.probe.y, Math.floor(b.z), false);
  }
  if (drag.type !== 'pinch' || pointers.size === 0) {
    drag = null;
    rubber = null;
  }
  saveSoon();
  scheduleDraw();
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !pointers.size) { hoverPoint = null; scheduleReadout(); }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
  zoomAt(localPoint(e), Math.exp(e.deltaY * k));
}, { passive: false });
canvas.addEventListener('dblclick', (e) => zoomAt(localPoint(e), 0.5));
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'Biome map. Arrow keys move, plus and minus zoom.');
canvas.addEventListener('keydown', (e) => {
  const stepPx = 80;
  if (e.key === 'ArrowLeft') view.cx -= stepPx * view.bpp;
  else if (e.key === 'ArrowRight') view.cx += stepPx * view.bpp;
  else if (e.key === 'ArrowUp') view.cz -= stepPx * view.bpp;
  else if (e.key === 'ArrowDown') view.cz += stepPx * view.bpp;
  else if (e.key === '+' || e.key === '=') { zoomAt({ x: cssW / 2, y: cssH / 2 }, 0.5); return; }
  else if (e.key === '-') { zoomAt({ x: cssW / 2, y: cssH / 2 }, 2); return; }
  else return;
  e.preventDefault();
  scheduleDraw();
  saveSoon();
});

function finishRect(r) {
  const x1 = Math.floor(Math.min(r.x0, r.x1)), x2 = Math.floor(Math.max(r.x0, r.x1));
  const z1 = Math.floor(Math.min(r.z0, r.z1)), z2 = Math.floor(Math.max(r.z0, r.z1));
  if (x2 - x1 < 2 || z2 - z1 < 2) return;
  if (state.tool === 'area') {
    setArea({ x1, z1, x2, z2 });
    setTool('pan');
  } else if (state.tool === 'exclude') {
    addZone({ x1, z1, x2, z2, label: 'Drawn zone' });
  }
}

function fitBox(x1, z1, x2, z2, pad) {
  const w = Math.max(16, x2 - x1 + 1), h = Math.max(16, z2 - z1 + 1);
  view.bpp = clamp(Math.max(w / cssW, h / cssH) * pad, MIN_BPP, MAX_BPP);
  view.cx = (x1 + x2 + 1) / 2;
  view.cz = (z1 + z2 + 1) / 2;
  scheduleDraw();
  saveSoon();
}
function fitArea() {
  const a = state.area;
  fitBox(a.x1, a.z1, a.x2, a.z2, 1.12);
}

// ───────────────────────── world / area / selection ─────────────────────────

function worldKey() {
  return world ? [world.mc, world.large, world.lo, world.hi, state.heightMode, state.heightMode === 'y' ? state.y : ''].join(',') : '';
}

let appliedKey = '';
function applyWorld() {
  const parsed = parseSeed(state.seed);
  const note = $('#seed-note');
  if (!parsed) {
    note.innerHTML = 'Type the world seed (the number from <b>/seed</b>, or the text the server used).';
    world = null;
    appliedKey = '';
    clearTiles();
    invalidateScan();
    scheduleDraw();
    return;
  }
  const u = BigInt.asUintN(64, parsed.value);
  const next = { mc: state.mc, large: state.large ? 1 : 0, lo: Number(u & 0xffffffffn), hi: Number(u >> 32n) };
  world = next;
  let html = parsed.fromText ? 'Text seed → number <b>' + parsed.value + '</b>' : 'Seed <b>' + parsed.value + '</b>';
  if (state.seed.trim() === EXAMPLE_SEED) html += ' <span class="example">· example seed, paste the server\'s seed here</span>';
  note.innerHTML = html;
  if (worldKey() !== appliedKey) {
    appliedKey = worldKey();
    clearTiles();
    scheduleScan();
    scheduleDraw();
    if (probeMark) probeAt(probeMark.x, probeMark.y, probeMark.z, false);
  }
}

function normArea(a) {
  const n = (v) => clamp(Math.round(Number(v) || 0), -WORLD_LIMIT, WORLD_LIMIT - 1);
  const x1 = n(a.x1), x2 = n(a.x2), z1 = n(a.z1), z2 = n(a.z2);
  return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), z1: Math.min(z1, z2), z2: Math.max(z1, z2) };
}

function setArea(a) {
  state.area = normArea(a);
  syncAreaInputs();
  colorStamp++;
  scheduleScan();
  scheduleDraw();
  saveSoon();
}

function syncAreaInputs() {
  const a = state.area;
  $('#ax1').value = a.x1; $('#ax2').value = a.x2;
  $('#az1').value = a.z1; $('#az2').value = a.z2;
  $('#area-size').textContent = fmtInt(a.x2 - a.x1 + 1) + ' × ' + fmtInt(a.z2 - a.z1 + 1) + ' blocks';
}

function selectionChanged() {
  buildLuts();
  colorStamp++;
  if (!autoModeSwitched && state.mode === 'biomes' && !allSelected()) {
    autoModeSwitched = true;
    setMode('candidates');
  }
  syncSelectionUi();
  if (scan.complete) computeStats();
  if (probeMark && probeMark.biome != null) showProbe(probeMark);
  scheduleDraw();
  saveSoon();
}

function allSelected() {
  return BIOMES.every(b => state.sel[b.id]);
}

function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  colorStamp++;
  scheduleDraw();
  saveSoon();
}

function setTool(tool) {
  state.tool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  canvas.classList.toggle('drawing', tool !== 'pan');
}

function addZone(z) {
  state.zones.push(z);
  zonesChanged();
}

function zonesChanged() {
  colorStamp++;
  renderZones();
  if (scan.complete) computeStats();
  if (probeMark && probeMark.biome != null) showProbe(probeMark);
  scheduleDraw();
  saveSoon();
}

// ───────────────────────── panel UI ─────────────────────────

function renderWaters() {
  const box = $('#waters');
  box.innerHTML = WATER_GROUPS.map((g, i) => {
    const names = g.ids.map(id => BIOME_BY_ID.get(id).label).join(', ');
    return '<button type="button" class="water" id="water-' + i + '" data-i="' + i + '" aria-pressed="false" title="' +
      esc(hex(g.c).toUpperCase() + ' · ' + names) + '" style="--c:' + hex(g.c) + '">' +
      '<canvas class="chip" width="48" height="24" data-c="' + g.c + '"></canvas><span class="t"><b>' + esc(g.name) + '</b><i>' + esc(g.who) + ' · ' + hex(g.c).toUpperCase() + '</i></span></button>';
  }).join('');
  drawWaterTiles(box);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.water');
    if (!btn) return;
    const ids = WATER_GROUPS[+btn.dataset.i].ids;
    if (allSelected()) {
      state.sel.fill(0);
      for (const id of ids) state.sel[id] = 1;
    } else {
      const on = ids.every(id => state.sel[id]);
      for (const id of ids) state.sel[id] = on ? 0 : 1;
    }
    selectionChanged();
  });
}

function renderQuick() {
  const box = $('#quick');
  box.innerHTML = QUICK.map(([name], i) =>
    '<button type="button" class="btn small" id="quick-' + i + '" data-i="' + i + '" aria-pressed="true">' + esc(name) + '</button>').join('');
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const ids = QUICK[+btn.dataset.i][1].map(k => BIOME_BY_KEY.get(k).id);
    const on = ids.every(id => state.sel[id]);
    for (const id of ids) state.sel[id] = on ? 0 : 1;
    selectionChanged();
  });
}

function renderBiomes() {
  const counts = scan.complete ? scan.counts : null;
  const total = scan.complete ? scan.Wc * scan.Hc : 0;
  const list = BIOMES.slice();
  if (counts) list.sort((a, b) => counts[b.id] - counts[a.id] || a.label.localeCompare(b.label));
  else list.sort((a, b) => a.label.localeCompare(b.label));
  $('#biomes').innerHTML = list.map(b => {
    const pc = counts ? (counts[b.id] ? fmtPct(100 * counts[b.id] / total) : '—') : '';
    return '<label class="biome" data-id="' + b.id + '">' +
      '<input type="checkbox" id="biome-' + b.key + '" data-id="' + b.id + '">' +
      '<span class="bc" style="background:' + hex(b.color) + '"></span>' +
      '<span class="nm">' + esc(b.label) + '</span>' +
      '<span class="wc" style="background:' + hex(b.water) + '" title="Water ' + hex(b.water).toUpperCase() + '"></span>' +
      '<span class="pc">' + pc + '</span></label>';
  }).join('');
  syncSelectionUi();
}

function syncSelectionUi() {
  for (const el of document.querySelectorAll('#biomes .biome')) {
    const on = !!state.sel[+el.dataset.id];
    el.classList.toggle('off', !on);
    el.querySelector('input').checked = on;
  }
  const all = allSelected();
  for (const btn of document.querySelectorAll('#waters .water')) {
    const ids = WATER_GROUPS[+btn.dataset.i].ids;
    const n = ids.filter(id => state.sel[id]).length;
    btn.setAttribute('aria-pressed', all ? 'false' : n === ids.length ? 'true' : n ? 'mixed' : 'false');
  }
  for (const btn of document.querySelectorAll('#quick button')) {
    const ids = QUICK[+btn.dataset.i][1].map(k => BIOME_BY_KEY.get(k).id);
    btn.setAttribute('aria-pressed', String(ids.every(id => state.sel[id])));
    btn.style.opacity = ids.every(id => state.sel[id]) ? '' : '0.55';
  }
  const n = BIOMES.filter(b => state.sel[b.id]).length;
  $('#biome-count').textContent = n + ' of ' + BIOMES.length + ' ticked';
}

function renderZones() {
  const box = $('#zones');
  $('#zone-count').textContent = state.zones.length ? state.zones.length + ' zone' + (state.zones.length === 1 ? '' : 's') : '';
  if (!state.zones.length) {
    box.innerHTML = '<div class="empty">Nothing ruled out yet. Use “Rule out” on the map, a spot below, or a point and radius.</div>';
    return;
  }
  box.innerHTML = state.zones.map((z, i) =>
    '<div class="zone"><div><b>' + esc(z.label || 'Zone') + '</b><div class="meta">X ' + z.x1 + ' … ' + z.x2 + ' · Z ' + z.z1 + ' … ' + z.z2 + '</div></div>' +
    '<div class="btns"><button type="button" class="btn small" data-go="' + i + '">Show</button>' +
    '<button type="button" class="btn small cut" data-del="' + i + '">Remove</button></div></div>').join('');
}

$('#zones').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  const del = e.target.closest('[data-del]');
  if (go) {
    const z = state.zones[+go.dataset.go];
    fitBox(z.x1, z.z1, z.x2, z.z2, 2.5);
  } else if (del) {
    state.zones.splice(+del.dataset.del, 1);
    zonesChanged();
  }
});

// ───────────────────────── scan + stats ─────────────────────────

const MAX_SCAN_CELLS = 80e6;
const scan = { key: '', gen: 0, W: 0, H: 0, r: 16, x1: 0, z1: 0, ids: null, rows: 0, complete: false, counts: null, error: '' };
let scanTimer = 0;
let stats = null;

function scanKey() {
  const a = state.area;
  return [worldKey(), a.x1, a.z1, a.x2, a.z2, state.res].join('|');
}

function invalidateScan() {
  scan.gen++;
  scan.key = '';
  scan.complete = false;
  scan.ids = null;
  pool.scanQ = [];
  stats = null;
  renderSummary();
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(startScan, 350);
  scan.complete = false;
  renderSummary();
}

function startScan() {
  if (!world) return;
  const key = scanKey();
  if (key === scan.key && (scan.complete || scan.ids)) {
    if (scan.complete) computeStats();
    return;
  }
  scan.gen++;
  pool.scanQ = [];
  const gen = scan.gen;
  const a = state.area, r = state.res;
  const W = Math.ceil((a.x2 - a.x1 + 1) / r), H = Math.ceil((a.z2 - a.z1 + 1) / r);
  scan.key = key;
  scan.complete = false;
  scan.counts = null;
  scan.error = '';
  stats = null;
  if (W * H > MAX_SCAN_CELLS || W > 1048576) {
    scan.ids = null;
    scan.error = 'That is ' + fmtInt(W * H) + ' samples, too many to scan. Pick a coarser scan detail or a smaller area.';
    renderSummary();
    renderResults();
    return;
  }
  Object.assign(scan, { W, H, r, x1: a.x1, z1: a.z1, ids: new Uint8Array(W * H), rows: 0 });
  const { y, surface } = heightArgs();
  const rowsPerJob = clamp(Math.floor(65536 / W), 1, H);
  for (let j0 = 0; j0 < H; j0 += rowsPerJob) {
    const h = Math.min(rowsPerJob, H - j0);
    pool.scanQ.push({
      msg: { type: 'gen', world, x: a.x1, z: a.z1 + j0 * r, w: W, h, step: r, y, surface },
      done(m) {
        if (gen !== scan.gen) return;
        scan.ids.set(m.ids, j0 * W);
        scan.rows += h;
        renderProgress();
        if (scan.rows === H) finishScan();
      },
    });
  }
  renderSummary();
  renderResults();
  pool.pump();
}

function finishScan() {
  const counts = new Uint32Array(256);
  const { ids, W, r } = scan;
  const a = state.area, half = r >> 1;
  scan.Wc = Math.min(W, Math.floor((a.x2 - scan.x1 - half) / r) + 1);
  scan.Hc = Math.min(scan.H, Math.floor((a.z2 - scan.z1 - half) / r) + 1);
  for (let j = 0; j < scan.Hc; j++) {
    for (let i = 0, k = j * W; i < scan.Wc; i++, k++) counts[ids[k]]++;
  }
  scan.counts = counts;
  scan.complete = true;
  renderBiomes();
  computeStats();
}

// Connected possible spots, found with run-length union-find so even a
// 20M-sample grid only needs memory per run, not per cell.
function computeStats() {
  const { W, H, r, x1, z1, ids } = scan;
  const sel = state.sel;
  const half = r >> 1;
  const a = state.area;
  const zones = state.zones;
  const excl = new Uint8Array(W);

  let cap = 1 << 16;
  let rs = new Int32Array(cap), re = new Int32Array(cap), rr = new Int32Array(cap), parent = new Int32Array(cap);
  let n = 0;
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  let prevStart = 0, prevEnd = 0;
  let possible = 0;

  for (let j = 0; j < H; j++) {
    const bz = z1 + j * r + half;
    const rowStart = n;
    if (bz <= a.z2) {
      let hasExcl = false;
      for (const zn of zones) {
        if (bz < zn.z1 || bz > zn.z2) continue;
        const i0 = Math.max(0, Math.ceil((zn.x1 - x1 - half) / r));
        const i1 = Math.min(W - 1, Math.floor((zn.x2 - x1 - half) / r));
        if (i0 > i1) continue;
        if (!hasExcl) { excl.fill(0); hasExcl = true; }
        excl.fill(1, i0, i1 + 1);
      }
      const iMax = Math.min(W, Math.floor((a.x2 - x1 - half) / r) + 1);
      const base = j * W;
      let i = 0;
      while (i < iMax) {
        if (!sel[ids[base + i]] || (hasExcl && excl[i])) { i++; continue; }
        const s = i;
        while (i < iMax && sel[ids[base + i]] && !(hasExcl && excl[i])) i++;
        if (n === cap) {
          cap *= 2;
          const grow = (arr) => { const b = new Int32Array(cap); b.set(arr); return b; };
          rs = grow(rs); re = grow(re); rr = grow(rr); parent = grow(parent);
        }
        rs[n] = s; re[n] = i; rr[n] = j; parent[n] = n;
        possible += i - s;
        n++;
      }
    }
    // join with overlapping runs in the row above (4-connected)
    let p = prevStart;
    for (let c = rowStart; c < n; c++) {
      while (p < prevEnd && re[p] <= rs[c]) p++;
      for (let q = p; q < prevEnd && rs[q] < re[c]; q++) {
        const ra = find(q), rb = find(c);
        if (ra !== rb) parent[rb] = ra;
      }
    }
    prevStart = rowStart;
    prevEnd = n;
  }

  // aggregate per spot
  const compOf = new Int32Array(n);
  const comps = [];
  const idxOfRoot = new Map();
  for (let k = 0; k < n; k++) {
    const root = find(k);
    let ci = idxOfRoot.get(root);
    if (ci === undefined) {
      ci = comps.length;
      idxOfRoot.set(root, ci);
      comps.push({ cells: 0, i0: Infinity, i1: -Infinity, j0: Infinity, j1: -Infinity, si: 0, sj: 0 });
    }
    compOf[k] = ci;
    const c = comps[ci], len = re[k] - rs[k];
    c.cells += len;
    c.si += (rs[k] + re[k] - 1) * len / 2;
    c.sj += rr[k] * len;
    if (rs[k] < c.i0) c.i0 = rs[k];
    if (re[k] - 1 > c.i1) c.i1 = re[k] - 1;
    if (rr[k] < c.j0) c.j0 = rr[k];
    if (rr[k] > c.j1) c.j1 = rr[k];
  }
  comps.forEach((c, i) => { c.index = i; });
  const order = comps.slice().sort((p, q) => q.cells - p.cells);
  const minCells = Math.ceil(state.minPatch * 256 / (r * r));
  const shown = order.filter(c => c.cells >= Math.max(1, minCells)).slice(0, 100);

  // biome mix and a representative cell (the possible cell nearest the centroid)
  const top = new Map(shown.map((c, k) => [c.index, k]));
  const mixCounts = new Uint32Array(shown.length * 256);
  for (const c of shown) { c.ci = c.si / c.cells; c.cj = c.sj / c.cells; c.best = Infinity; }
  for (let k = 0; k < n; k++) {
    const t = top.get(compOf[k]);
    if (t === undefined) continue;
    const c = shown[t];
    const off = t * 256;
    const base = rr[k] * W;
    for (let i = rs[k]; i < re[k]; i++) mixCounts[off + ids[base + i]]++;
    const ci = clamp(Math.round(c.ci), rs[k], re[k] - 1);
    const d = (ci - c.ci) ** 2 + (rr[k] - c.cj) ** 2;
    if (d < c.best) { c.best = d; c.pi = ci; c.pj = rr[k]; }
  }
  const cellArea = r * r;
  stats = {
    possible,
    total: scan.Wc * scan.Hc,
    possibleArea: possible * cellArea,
    spots: comps.length,
    hidden: order.length - order.filter(c => c.cells >= Math.max(1, minCells)).length,
    list: shown.map((c, k) => ({
      rank: k + 1,
      area: c.cells * cellArea,
      x1: x1 + c.i0 * r, x2: x1 + (c.i1 + 1) * r - 1,
      z1: z1 + c.j0 * r, z2: z1 + (c.j1 + 1) * r - 1,
      x: x1 + c.pi * r + half, z: z1 + c.pj * r + half,
      mix: mixOf(mixCounts.subarray(k * 256, k * 256 + 256), c.cells),
    })),
  };
  renderSummary();
  renderResults();
}

function mixOf(counts, cells) {
  const out = [];
  for (let id = 0; id < 256; id++) if (counts[id]) out.push({ id, pct: 100 * counts[id] / cells });
  return out.sort((p, q) => q.pct - p.pct);
}

function renderProgress() {
  const bar = $('#sum-progress');
  if (scan.ids && !scan.complete && scan.H) bar.style.width = (100 * scan.rows / scan.H).toFixed(1) + '%';
  else bar.style.width = scan.complete ? '100%' : '0%';
  if (scan.ids && !scan.complete) {
    $('#sum-line').textContent = 'Scanning the area… ' + Math.floor(100 * scan.rows / scan.H) + '%';
  }
}

function renderSummary() {
  const a = state.area;
  const big = $('#sum-pct'), line = $('#sum-line'), sub = $('#sum-sub');
  const areaText = fmtInt(a.x2 - a.x1 + 1) + ' × ' + fmtInt(a.z2 - a.z1 + 1) + ' search area';
  if (!world) {
    big.textContent = '—';
    line.textContent = 'No seed loaded';
    sub.textContent = 'Type the seed to start';
  } else if (scan.error) {
    big.textContent = '—';
    line.textContent = 'Scan skipped';
    sub.textContent = 'Too many samples, see “Possible spots”';
  } else if (!scan.complete || !stats) {
    big.textContent = '…';
    line.textContent = 'Scanning the area…';
    sub.textContent = 'of the ' + areaText;
  } else {
    const pct = 100 * stats.possible / stats.total;
    big.textContent = fmtPct(pct);
    const all = pct >= 99.95;
    line.textContent = fmtArea(stats.possibleArea) + ' · ' + fmtInt(stats.possibleArea / 256) + ' chunks' +
      (all ? '' : ' · ' + fmtInt(stats.spots) + ' spot' + (stats.spots === 1 ? '' : 's'));
    sub.textContent = (all ? 'Nothing ruled out yet in the ' : 'still possible in the ') + areaText;
  }
  renderProgress();
}

function renderResults() {
  const box = $('#patches');
  const note = $('#scan-note');
  const nWorkers = Math.max(1, pool.slots.length);
  if (scan.error) {
    note.textContent = scan.error;
    box.innerHTML = '<div class="empty">No scan yet.</div>';
    $('#patch-count').textContent = '';
    return;
  }
  if (scan.ids || scan.complete) {
    const secs = Math.max(1, Math.round(scan.W * scan.H * 6e-6 / nWorkers));
    note.textContent = 'Sampled every ' + scan.r + ' blocks: ' + fmtInt(scan.W) + ' × ' + fmtInt(scan.H) + ' samples (about ' + secs + ' s on ' + nWorkers + ' thread' + (nWorkers === 1 ? '' : 's') + ').';
  }
  if (!scan.complete || !stats) {
    box.innerHTML = '<div class="empty">Spots appear here when the scan finishes.</div>';
    $('#patch-count').textContent = '';
    return;
  }
  $('#patch-count').textContent = fmtInt(stats.spots) + ' total' + (stats.hidden ? ', ' + fmtInt(stats.hidden) + ' hidden' : '');
  if (!stats.list.length) {
    box.innerHTML = '<div class="empty">' + (stats.possible ? 'Every spot is smaller than the size limit.' : 'Nothing left. Tick more biomes or check the seed and area.') + '</div>';
    return;
  }
  box.innerHTML = stats.list.map((p, k) => {
    const mixText = p.mix.slice(0, 3).map(m => BIOME_BY_ID.get(m.id).label + ' ' + fmtPct(m.pct)).join(', ');
    const isFocus = focus && focus.rank === p.rank && focus.x === p.x && focus.z === p.z;
    return '<div class="patch' + (isFocus ? ' focus' : '') + '" data-k="' + k + '" role="button" tabindex="0">' +
      '<span class="n">#' + p.rank + '</span>' +
      '<div style="min-width:0"><div class="xy">X ' + p.x + ' · Z ' + p.z + '</div>' +
      '<div class="meta">' + fmtArea(p.area) + ' · ' + esc(mixText) + '</div></div>' +
      '<button type="button" class="btn small cut" data-cut="' + k + '">Rule out</button></div>';
  }).join('');
}

function onPatchActivate(e) {
  if (!stats) return;
  const cut = e.target.closest('[data-cut]');
  if (cut) {
    const p = stats.list[+cut.dataset.cut];
    addZone({ x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2, label: 'Spot near ' + p.x + ', ' + p.z });
    return;
  }
  const row = e.target.closest('.patch');
  if (!row) return;
  const p = stats.list[+row.dataset.k];
  focus = p;
  for (const el of document.querySelectorAll('.patch')) el.classList.toggle('focus', el === row);
  fitBox(p.x1, p.z1, p.x2, p.z2, 2.2);
}
$('#patches').addEventListener('click', onPatchActivate);
$('#patches').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('patch')) { e.preventDefault(); onPatchActivate(e); }
});

$('#copy-patches').addEventListener('click', () => {
  if (!stats || !stats.list.length) return;
  const lines = ['rank\tx\tz\tarea_blocks2\tchunks\tbiomes'];
  for (const p of stats.list) {
    lines.push([p.rank, p.x, p.z, p.area, Math.round(p.area / 256),
      p.mix.slice(0, 3).map(m => BIOME_BY_ID.get(m.id).key + ' ' + m.pct.toFixed(0) + '%').join(', ')].join('\t'));
  }
  const text = lines.join('\n');
  const btn = $('#copy-patches');
  const done = (ok) => { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = 'Copy list'; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  else done(fallbackCopy(text));
});
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

// ───────────────────────── check a spot ─────────────────────────

function probeAt(x, y, z, fly) {
  state.probe = { x, y, z };
  $('#px').value = x; $('#py').value = y; $('#pz').value = z;
  probeMark = { x, y, z, biome: null };
  if (fly) { view.cx = x + 0.5; view.cz = z + 0.5; view.bpp = Math.min(view.bpp, 4); }
  scheduleDraw();
  saveSoon();
  if (!world) return;
  const mark = probeMark;
  pool.probeQ.push({
    msg: { type: 'probe', world, x, y, z },
    done(m) {
      if (mark !== probeMark) return;
      mark.biome = m.biome;
      showProbe(mark);
    },
  });
  pool.pump();
  $('#probe-out').innerHTML = '<span class="hint">Checking…</span>';
}

function showProbe(mark) {
  const b = BIOME_BY_ID.get(mark.biome);
  const out = $('#probe-out');
  if (!b) { out.innerHTML = '<span class="hint">Unknown biome id ' + mark.biome + '</span>'; return; }
  const status = statusFor(b.id, mark.x, mark.z);
  out.innerHTML = '<span class="sw" style="background:' + hex(b.color) + '"></span>' +
    '<div><div><b style="font-weight:normal">' + esc(b.label) + '</b> at ' + mark.x + ' ' + mark.y + ' ' + mark.z + '</div>' +
    '<div class="hint">minecraft:' + b.key + ' · water ' + hex(b.water).toUpperCase() + ' · ' + status + '</div></div>';
}

// ───────────────────────── water pictures ─────────────────────────

// Stand-in for the vanilla water texture (which can't be shipped): light grey
// 16×16 ripples. Water is drawn the way Java renders it from above: the tinted
// surface, partly see-through, over a seabed that gets darker with depth.
const WATER_TEX = (() => {
  const t = new Float32Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wave = 0.5 * Math.sin((x + y * 0.5) * Math.PI / 4) + 0.5 * Math.sin((x * 2 - y) * Math.PI / 8);
      let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const noise = (((h ^ (h >>> 16)) & 255) / 255) - 0.5;
      t[y * 16 + x] = 0.8 + 0.06 * wave + 0.04 * noise;
    }
  }
  return t;
})();
const WATER_ALPHA = 0.72;
const SEABED_SHALLOW = [219, 207, 163]; // sand
const SEABED_DEEP = [120, 112, 96];     // gravel / dirt

function rgbOf(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
function skyLight(level) { const f = level / 15; return f / (4 - 3 * f); }

// One block per 16 texels, depth going from d0 (left block) to d1 (right block).
function drawWater(canvas, tint, d0, d1) {
  const W = canvas.width, H = canvas.height;
  const c2 = canvas.getContext('2d');
  const img = c2.createImageData(W, H);
  const t = rgbOf(tint);
  const blocks = Math.max(1, Math.ceil(W / 16));
  for (let x = 0; x < W; x++) {
    const b = Math.floor(x / 16);
    const depth = Math.round(blocks > 1 ? d0 + (d1 - d0) * b / (blocks - 1) : d0);
    const lf = skyLight(Math.max(0, 15 - depth));
    const k = clamp((depth - 2) / 6, 0, 1);
    for (let y = 0; y < H; y++) {
      const g = WATER_TEX[(y & 15) * 16 + (x & 15)];
      const o = (y * W + x) * 4;
      for (let i = 0; i < 3; i++) {
        const floor = SEABED_SHALLOW[i] * (1 - k) + SEABED_DEEP[i] * k;
        img.data[o + i] = clamp(Math.round(WATER_ALPHA * g * t[i] + (1 - WATER_ALPHA) * floor * lf), 0, 255);
      }
      img.data[o + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
}

function drawWaterTiles(root) {
  for (const cv of root.querySelectorAll('canvas[data-c]')) drawWater(cv, +cv.dataset.c, 1, 10);
}

// ───────────────────────── match from the stream ─────────────────────────

// Colours are compared as log ratios R/B and G/B. Brightness from depth,
// shadow or time of day scales all three channels together and cancels out;
// a stream's colour shift becomes a constant offset, which water from a
// biome you know measures and removes. With known water of different colours
// a scale is fitted too (haze, seabed showing through, contrast), pulled
// towards 1 so that similar references don't overfit it. Tuned on simulated
// frames with random lighting, depth, colour grading, gamma and black level.
const MATCH_E = 1;
const MATCH_RIDGE = 0.03;
const MATCH_CLEAR = 0.16;
const MATCH_POSSIBLE = 0.3;
const MATCH_TIE = 0.08;

function waterFeat(rgb) {
  return [Math.log((rgb[0] + MATCH_E) / (rgb[2] + MATCH_E)), Math.log((rgb[1] + MATCH_E) / (rgb[2] + MATCH_E))];
}
function rgbHex(rgb) { return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(); }
function closeness(d) {
  return d < 0.08 ? 'very close' : d < MATCH_CLEAR ? 'close' : d < MATCH_POSSIBLE ? 'possible' : 'unlikely';
}

const shots = [];
let shotSeq = 0;
let markRole = 'base';

function sampleLabel(s) {
  if (s.role === 'base') return 'Base water';
  const b = BIOME_BY_KEY.get(s.biome);
  return 'Known: ' + (b ? b.label : 'biome');
}

function roleOptions() {
  let html = '<option value="base">Base water</option>';
  for (const g of WATER_GROUPS) {
    html += '<optgroup label="Known biome · ' + esc(g.name) + ' water">';
    for (const id of g.ids) {
      const b = BIOME_BY_ID.get(id);
      html += '<option value="ref:' + b.key + '">' + esc(b.label) + '</option>';
    }
    html += '</optgroup>';
  }
  return html;
}

function addSample(rgb, role, extra) {
  const s = Object.assign({ role: role === 'base' ? 'base' : 'ref', rgb }, extra || {});
  if (s.role === 'ref') {
    s.biome = role.slice(4);
    if (!BIOME_BY_KEY.has(s.biome)) return;
  }
  state.samples.push(s);
  samplesChanged();
}

function samplesChanged() {
  renderSamples();
  renderMatch();
  if (!viewer.el.hidden) drawViewer();
  saveSoon();
}

function computeMatch() {
  const base = state.samples.filter(s => s.role === 'base');
  const refs = state.samples.filter(s => s.role === 'ref');
  if (!base.length) return null;
  // observed = scale * true + offset, per axis offset, shared scale
  const n = refs.length;
  const ft = refs.map(r => waterFeat(rgbOf(BIOME_BY_KEY.get(r.biome).water)));
  const fo = refs.map(r => waterFeat(r.rgb));
  const mt = [0, 0], mo = [0, 0];
  for (let k = 0; k < n; k++) for (let a = 0; a < 2; a++) { mt[a] += ft[k][a] / n; mo[a] += fo[k][a] / n; }
  let num = MATCH_RIDGE * n, den = MATCH_RIDGE * n;
  for (let k = 0; k < n; k++) {
    for (let a = 0; a < 2; a++) {
      num += (ft[k][a] - mt[a]) * (fo[k][a] - mo[a]);
      den += (ft[k][a] - mt[a]) ** 2;
    }
  }
  const scale = n ? clamp(num / den, 0.5, 1.5) : 1;
  const off = n ? [mo[0] - scale * mt[0], mo[1] - scale * mt[1]] : [0, 0];
  let spread = null;
  if (n >= 2) {
    let ss = 0;
    for (let k = 0; k < n; k++) for (let a = 0; a < 2; a++) ss += (fo[k][a] - scale * ft[k][a] - off[a]) ** 2;
    spread = Math.sqrt(ss / n);
  }
  const mixed = new Set(refs.map(r => BIOME_BY_KEY.get(r.biome).water)).size > 1;
  const est = [0, 0];
  for (const s of base) {
    const f = waterFeat(s.rgb);
    est[0] += (f[0] - off[0]) / scale / base.length;
    est[1] += (f[1] - off[1]) / scale / base.length;
  }
  const ranked = WATER_GROUPS.map((g, i) => {
    const f = waterFeat(rgbOf(g.c));
    return { i, g, d: Math.hypot(est[0] - f[0], est[1] - f[1]) };
  }).sort((a, b) => a.d - b.d);
  // the tint those ratios imply, as bright as the closest real water colour
  const best = ranked[0];
  const luma = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  let est3 = [Math.exp(est[0]), Math.exp(est[1]), 1];
  const k = luma(rgbOf(best.g.c)) / luma(est3);
  est3 = est3.map(v => v * k);
  const mx = Math.max(...est3);
  if (mx > 255) est3 = est3.map(v => v * 255 / mx);
  est3 = est3.map(v => clamp(Math.round(v), 0, 255));
  const contenders = ranked.filter(r => r.d < MATCH_POSSIBLE && r.d <= best.d + MATCH_TIE);
  return { ranked, est3, refs: n, mixed, spread, base: base.length, contenders };
}

function renderSamples() {
  const box = $('#samples');
  const nb = state.samples.filter(s => s.role === 'base').length;
  const nr = state.samples.length - nb;
  $('#match-count').textContent = state.samples.length ? nb + ' base · ' + nr + ' known' : '';
  $('#samples-clear').hidden = !state.samples.length;
  if (!state.samples.length) {
    box.innerHTML = '<div class="empty">No water marked yet.</div>';
    return;
  }
  box.innerHTML = state.samples.map((s, k) => {
    const pic = s.crop ? '<img class="crop" src="' + s.crop + '" alt="">' : '<span class="crop" style="background:' + rgbHex(s.rgb) + '"></span>';
    const meta = [rgbHex(s.rgb)];
    if (s.px) meta.push(fmtInt(s.px) + ' px');
    if (s.uneven) meta.push('uneven area, try plain open water');
    return '<div class="sample">' + pic + '<span class="sw" style="background:' + rgbHex(s.rgb) + '"></span>' +
      '<div style="min-width:0"><b>' + esc(sampleLabel(s)) + '</b><div class="meta">' + esc(meta.join(' · ')) + '</div></div>' +
      '<button type="button" class="btn small cut" data-del="' + k + '">Remove</button></div>';
  }).join('');
}

function renderMatch() {
  const m = computeMatch();
  const verdict = $('#verdict'), list = $('#matches'), apply = $('#match-apply'), calib = $('#calib-note');
  apply.hidden = true;
  if (!m) {
    verdict.textContent = state.samples.length ? 'Now mark the water at the base.' : 'Mark the water at the base to get a match.';
    verdict.className = 'verdict';
    calib.textContent = '';
    list.innerHTML = '';
    return;
  }
  const best = m.ranked[0];
  const who = ' <span>(' + esc(best.g.who) + ')</span>';
  if (best.d < MATCH_CLEAR && m.contenders.length === 1) {
    verdict.innerHTML = (m.refs ? 'Best match: ' : 'Looks most like: ') + '<b>' + esc(best.g.name) + '</b>' + who;
    verdict.className = m.refs ? 'verdict good' : 'verdict maybe';
  } else if (m.contenders.length === 1) {
    verdict.innerHTML = 'Closest: <b>' + esc(best.g.name) + '</b>' + who + ' <span>but not a clean match</span>';
    verdict.className = 'verdict maybe';
  } else if (m.contenders.length) {
    verdict.innerHTML = 'Close call: <b>' + m.contenders.map(r => esc(r.g.name)).join('</b> or <b>') + '</b>';
    verdict.className = 'verdict maybe';
  } else {
    verdict.textContent = 'Nothing matches well. Mark water in a biome you know (same stream) so the colours can be corrected.';
    verdict.className = 'verdict bad';
  }
  if (!m.refs) {
    calib.textContent = 'Not corrected yet: add water from a biome you know the player was in, from the same stream. Without it, stream colour and lighting can push the result one colour over.';
  } else {
    let t = 'Corrected using ' + m.refs + ' known water sample' + (m.refs === 1 ? '' : 's');
    if (m.spread != null) {
      const word = m.spread < 0.06 ? 'they agree well' : m.spread < 0.15 ? 'they roughly agree' : "they don't agree, so lighting differs between them; use ones from the same scene as the base";
      t += ' (' + word + ', ±' + m.spread.toFixed(2) + ')';
    }
    t += '.';
    if (!m.mixed) t += ' Add one with a different water colour (a swamp, an ocean) to also correct for haze, contrast and seabed showing through.';
    calib.textContent = t;
  }
  const baseSample = state.samples.find(s => s.role === 'base');
  const seen = baseSample.crop ? '<img class="crop" src="' + baseSample.crop + '" alt="">' : '<span class="crop" style="background:' + rgbHex(baseSample.rgb) + '"></span>';
  let html = '<div class="match head-row"><div class="pair">' + seen + '<span class="crop" style="background:' + rgbHex(m.est3) + '"></span></div>' +
    '<div><b>Your base water</b><div class="meta">as seen · ' + (m.refs ? 'corrected' : 'implied') + ' tint ' + rgbHex(m.est3) + '</div></div><span></span></div>';
  html += m.ranked.map((r, k) => {
    const w = clamp(1 - r.d / 0.6, 0.02, 1);
    const isC = m.contenders.includes(r);
    return '<div class="match' + (isC ? ' best' : '') + '">' +
      '<div class="pair"><canvas class="wtile" width="48" height="32" data-c="' + r.g.c + '"></canvas><span class="crop" style="background:' + hex(r.g.c) + '"></span></div>' +
      '<div style="min-width:0"><b>' + esc(r.g.name) + '</b><div class="meta">' + esc(r.g.who) + ' · ' + hex(r.g.c).toUpperCase() + '</div>' +
      '<div class="bar"><i style="width:' + (w * 100).toFixed(0) + '%"></i></div></div>' +
      '<span class="word">' + closeness(r.d) + '</span></div>';
  }).join('');
  list.innerHTML = html;
  drawWaterTiles(list);
  if (m.contenders.length) {
    apply.hidden = false;
    apply.textContent = 'Tick only ' + m.contenders.map(r => r.g.name.toLowerCase()).join(' + ') + ' biomes';
    apply.dataset.groups = m.contenders.map(r => r.i).join(',');
  }
}

// ── screenshots ──

const viewer = {
  el: $('#viewer'), stage: $('#viewer-stage'), canvas: $('#viewer-canvas'), ctx: null,
  shot: null, scale: 1, ox: 0, oy: 0, tool: 'mark', drag: null, rubber: null, pointers: new Map(), w: 1, h: 1, dpr: 1,
};
viewer.ctx = viewer.canvas.getContext('2d');

function loadImageFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const sc = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * sc));
    c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const t = document.createElement('canvas');
    const ts = 120 / Math.max(c.width, c.height);
    t.width = Math.max(1, Math.round(c.width * ts));
    t.height = Math.max(1, Math.round(c.height * ts));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    const shot = { id: ++shotSeq, name: file.name || 'Pasted screenshot', canvas: c, ctx: cx, thumb: t.toDataURL() };
    shots.push(shot);
    renderShots();
    openShot(shot);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    $('#shots-note').textContent = 'That file could not be opened as an image.';
  };
  img.src = url;
}

function renderShots() {
  $('#shots').innerHTML = shots.map(s =>
    '<button type="button" class="shot" data-shot="' + s.id + '" title="Open ' + esc(s.name) + '"><img src="' + s.thumb + '" alt=""><span>' + esc(s.name) + '</span></button>').join('');
  $('#shots-note').textContent = shots.length ? 'Screenshots stay on this device and are gone after a reload; your marked colours are kept.' : '';
}

function openShot(shot) {
  viewer.shot = shot;
  viewer.el.hidden = false;
  $('#viewer-role').value = markRole;
  layoutViewer();
  fitViewer();
}

function closeViewer() {
  viewer.el.hidden = true;
  viewer.drag = null;
  viewer.rubber = null;
  viewer.pointers.clear();
}

function layoutViewer() {
  const r = viewer.stage.getBoundingClientRect();
  viewer.dpr = window.devicePixelRatio || 1;
  viewer.w = Math.max(1, r.width);
  viewer.h = Math.max(1, r.height);
  viewer.canvas.width = Math.round(viewer.w * viewer.dpr);
  viewer.canvas.height = Math.round(viewer.h * viewer.dpr);
  viewer.canvas.style.width = viewer.w + 'px';
  viewer.canvas.style.height = viewer.h + 'px';
}

function fitViewer() {
  const s = viewer.shot;
  if (!s) return;
  viewer.scale = Math.min(viewer.w / s.canvas.width, viewer.h / s.canvas.height) * 0.98;
  viewer.ox = (viewer.w - s.canvas.width * viewer.scale) / 2;
  viewer.oy = (viewer.h - s.canvas.height * viewer.scale) / 2;
  drawViewer();
}

function drawViewer() {
  const { ctx, shot } = viewer;
  ctx.setTransform(viewer.dpr, 0, 0, viewer.dpr, 0, 0);
  ctx.fillStyle = COLORS.mapBg;
  ctx.fillRect(0, 0, viewer.w, viewer.h);
  if (!shot) return;
  ctx.imageSmoothingEnabled = viewer.scale < 2;
  ctx.drawImage(shot.canvas, viewer.ox, viewer.oy, shot.canvas.width * viewer.scale, shot.canvas.height * viewer.scale);
  ctx.font = '12px ' + COLORS.mono;
  ctx.textBaseline = 'bottom';
  for (const s of state.samples) {
    if (s.shot !== shot.id || !s.box) continue;
    const x = viewer.ox + s.box.x * viewer.scale, y = viewer.oy + s.box.y * viewer.scale;
    const w = s.box.w * viewer.scale, h = s.box.h * viewer.scale;
    const col = s.role === 'base' ? '#ffffff' : COLORS.area;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.strokeRect(x, y, w, h);
    const label = sampleLabel(s);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y - 18, tw + 8, 17);
    ctx.fillStyle = col;
    ctx.fillText(label, x + 4, y - 3);
  }
  if (viewer.rubber) {
    const r = normBox(viewer.rubber);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = markRole === 'base' ? '#ffffff' : COLORS.area;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(viewer.ox + r.x * viewer.scale, viewer.oy + r.y * viewer.scale, r.w * viewer.scale, r.h * viewer.scale);
    ctx.setLineDash([]);
  }
}

function normBox(r) {
  return { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
}

function viewerPoint(e) {
  const r = viewer.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function toImage(p) {
  return { x: (p.x - viewer.ox) / viewer.scale, y: (p.y - viewer.oy) / viewer.scale };
}

// Median of each channel over the box, so stray pixels (text, lily pads)
// don't move the result. Also flags boxes that mix very different colours.
function sampleShot(shot, box) {
  let { x, y, w, h } = box;
  if (w < 3 || h < 3) { x -= 4; y -= 4; w = 9; h = 9; }
  x = clamp(Math.round(x), 0, shot.canvas.width - 1);
  y = clamp(Math.round(y), 0, shot.canvas.height - 1);
  w = clamp(Math.round(w), 1, shot.canvas.width - x);
  h = clamp(Math.round(h), 1, shot.canvas.height - y);
  const data = shot.ctx.getImageData(x, y, w, h).data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0, sl = 0, sl2 = 0;
  for (let k = 0; k < data.length; k += 4) {
    hist[0][data[k]]++; hist[1][data[k + 1]]++; hist[2][data[k + 2]]++;
    const l = 0.3 * data[k] + 0.59 * data[k + 1] + 0.11 * data[k + 2];
    sl += l; sl2 += l * l;
    n++;
  }
  const rgb = hist.map(hc => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hc[v]; if (acc * 2 >= n) return v; }
    return 255;
  });
  const sd = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
  const crop = document.createElement('canvas');
  crop.width = crop.height = 40;
  const cc = crop.getContext('2d');
  cc.imageSmoothingEnabled = false;
  const side = Math.min(w, h, 40);
  cc.drawImage(shot.canvas, x + (w - side) / 2, y + (h - side) / 2, side, side, 0, 0, 40, 40);
  return { rgb, px: n, uneven: sd > 22, box: { x, y, w, h }, crop: crop.toDataURL() };
}

function zoomViewer(p, f) {
  const ip = toImage(p);
  viewer.scale = clamp(viewer.scale * f, 0.05, 40);
  viewer.ox = p.x - ip.x * viewer.scale;
  viewer.oy = p.y - ip.y * viewer.scale;
  drawViewer();
}

function bindViewer() {
  const cv = viewer.canvas;
  cv.tabIndex = 0;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = viewerPoint(e);
    viewer.pointers.set(e.pointerId, p);
    if (viewer.pointers.size === 2) {
      const [a, b] = [...viewer.pointers.values()];
      viewer.rubber = null;
      viewer.drag = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s0: viewer.scale, ox0: viewer.ox, oy0: viewer.oy };
      return;
    }
    if (viewer.pointers.size > 2) return;
    if (viewer.tool === 'mark' && e.button === 0) {
      const ip = toImage(p);
      viewer.rubber = { x0: ip.x, y0: ip.y, x1: ip.x, y1: ip.y };
      viewer.drag = { type: 'rect' };
    } else {
      viewer.drag = { type: 'pan', x: p.x, y: p.y };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!viewer.pointers.has(e.pointerId)) return;
    const p = viewerPoint(e);
    viewer.pointers.set(e.pointerId, p);
    const d = viewer.drag;
    if (!d) return;
    if (d.type === 'pan') {
      viewer.ox += p.x - d.x; viewer.oy += p.y - d.y;
      d.x = p.x; d.y = p.y;
    } else if (d.type === 'rect') {
      const ip = toImage(p);
      viewer.rubber.x1 = ip.x; viewer.rubber.y1 = ip.y;
    } else if (d.type === 'pinch' && viewer.pointers.size >= 2) {
      const [a, b] = [...viewer.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ix = (d.mid0.x - d.ox0) / d.s0, iy = (d.mid0.y - d.oy0) / d.s0;
      viewer.scale = clamp(d.s0 * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / d.d0, 0.05, 40);
      viewer.ox = mid.x - ix * viewer.scale;
      viewer.oy = mid.y - iy * viewer.scale;
    }
    drawViewer();
  });
  const end = (e, cancelled) => {
    if (!viewer.pointers.has(e.pointerId)) return;
    viewer.pointers.delete(e.pointerId);
    const d = viewer.drag;
    if (d && d.type === 'rect' && viewer.rubber && !cancelled && viewer.shot) {
      const s = sampleShot(viewer.shot, normBox(viewer.rubber));
      viewer.rubber = null;
      addSample(s.rgb, markRole, { px: s.px, uneven: s.uneven, box: s.box, crop: s.crop, shot: viewer.shot.id });
    }
    if (!d || d.type !== 'pinch' || viewer.pointers.size === 0) { viewer.drag = null; viewer.rubber = null; }
    drawViewer();
  };
  cv.addEventListener('pointerup', (e) => end(e, false));
  cv.addEventListener('pointercancel', (e) => end(e, true));
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
    zoomViewer(viewerPoint(e), Math.exp(-e.deltaY * k));
  }, { passive: false });

  for (const b of document.querySelectorAll('[data-vtool]')) {
    b.addEventListener('click', () => {
      viewer.tool = b.dataset.vtool;
      for (const o of document.querySelectorAll('[data-vtool]')) o.setAttribute('aria-pressed', String(o === b));
    });
  }
  $('#viewer-role').innerHTML = roleOptions();
  $('#viewer-role').addEventListener('change', (e) => { markRole = e.target.value; $('#hex-role').value = markRole; saveSoon(); });
  $('#viewer-fit').addEventListener('click', fitViewer);
  $('#viewer-done').addEventListener('click', closeViewer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewer.el.hidden) closeViewer(); });
  new ResizeObserver(() => { if (!viewer.el.hidden) { layoutViewer(); drawViewer(); } }).observe(viewer.stage);
}

function bindMatch() {
  bindViewer();
  const file = $('#shot-file');
  file.addEventListener('change', () => { for (const f of file.files) loadImageFile(f); file.value = ''; });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const img = items.find(it => it.kind === 'file' && /^image\//.test(it.type));
    if (!img) return;
    e.preventDefault();
    loadImageFile(img.getAsFile());
  });
  const drop = $('#sec-match');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dropping'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dropping'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dropping');
    for (const f of e.dataTransfer.files) loadImageFile(f);
  });
  $('#shots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shot]');
    if (b) openShot(shots.find(s => s.id === +b.dataset.shot));
  });
  $('#samples').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    state.samples.splice(+b.dataset.del, 1);
    samplesChanged();
  });
  const clearBtn = $('#samples-clear');
  clearBtn.addEventListener('click', () => {
    if (clearBtn.dataset.armed !== '1') {
      clearBtn.dataset.armed = '1';
      clearBtn.textContent = 'Tap again to clear';
      setTimeout(() => { clearBtn.dataset.armed = ''; clearBtn.textContent = 'Clear marks'; }, 2500);
      return;
    }
    clearBtn.dataset.armed = '';
    clearBtn.textContent = 'Clear marks';
    state.samples = [];
    samplesChanged();
  });

  const role = $('#hex-role');
  role.innerHTML = roleOptions();
  role.value = markRole;
  role.addEventListener('change', () => { markRole = role.value; saveSoon(); });
  $('#hex-add').addEventListener('click', () => {
    const v = $('#hex-in').value.trim().replace(/^#/, '');
    const m = /^([0-9a-f]{6})$/i.exec(v) || /^\s*(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})\s*$/.exec($('#hex-in').value);
    if (!m) { $('#hex-in').focus(); $('#hex-note').textContent = 'Type a colour like #2F4E8C or 47, 78, 140.'; return; }
    const rgb = m.length === 2 ? rgbOf(parseInt(m[1], 16)) : [m[1], m[2], m[3]].map(x => clamp(+x, 0, 255));
    $('#hex-note').textContent = '';
    $('#hex-in').value = '';
    addSample(rgb, role.value);
  });
  $('#hex-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#hex-add').click(); });
  $('#match-apply').addEventListener('click', (e) => {
    const groups = (e.currentTarget.dataset.groups || '').split(',').filter(Boolean).map(Number);
    if (!groups.length) return;
    state.sel.fill(0);
    for (const gi of groups) for (const id of WATER_GROUPS[gi].ids) state.sel[id] = 1;
    selectionChanged();
  });
  renderSamples();
  renderMatch();
}

// ───────────────────────── wiring ─────────────────────────

function bindInputs() {
  const seed = $('#seed');
  seed.value = state.seed;
  seed.addEventListener('change', () => { state.seed = seed.value; applyWorld(); saveSoon(); });
  seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') seed.blur(); });

  const ver = $('#version');
  ver.value = String(state.mc);
  ver.addEventListener('change', () => { state.mc = +ver.value; applyWorld(); saveSoon(); });

  const hm = $('#height-mode'), yf = $('#y-field'), yl = $('#y-level');
  hm.value = state.heightMode;
  yl.value = state.y;
  yf.hidden = state.heightMode !== 'y';
  hm.addEventListener('change', () => { state.heightMode = hm.value; yf.hidden = hm.value !== 'y'; applyWorld(); saveSoon(); });
  yl.addEventListener('change', () => { state.y = clamp(Math.round(+yl.value || 0), -64, 320); yl.value = state.y; applyWorld(); saveSoon(); });

  const lb = $('#large-biomes');
  lb.checked = state.large;
  lb.addEventListener('change', () => { state.large = lb.checked; applyWorld(); saveSoon(); });

  for (const id of ['#ax1', '#ax2', '#az1', '#az2']) {
    $(id).addEventListener('change', () => setArea({ x1: $('#ax1').value, x2: $('#ax2').value, z1: $('#az1').value, z2: $('#az2').value }));
  }
  $('#area-draw').addEventListener('click', () => { setTool('area'); canvas.focus(); });
  $('#area-fit').addEventListener('click', fitArea);
  $('#zoom-fit').addEventListener('click', fitArea);
  $('#zoom-in').addEventListener('click', () => zoomAt({ x: cssW / 2, y: cssH / 2 }, 0.5));
  $('#zoom-out').addEventListener('click', () => zoomAt({ x: cssW / 2, y: cssH / 2 }, 2));

  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { autoModeSwitched = true; setMode(b.dataset.mode); });
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(state.tool === b.dataset.tool ? 'pan' : b.dataset.tool));

  $('#biomes').addEventListener('change', (e) => {
    const id = +e.target.dataset.id;
    if (!Number.isFinite(id)) return;
    state.sel[id] = e.target.checked ? 1 : 0;
    selectionChanged();
  });
  $('#sel-all').addEventListener('click', () => { for (const b of BIOMES) state.sel[b.id] = 1; selectionChanged(); });
  $('#sel-none').addEventListener('click', () => { state.sel.fill(0); selectionChanged(); });
  $('#sel-invert').addEventListener('click', () => { for (const b of BIOMES) state.sel[b.id] = state.sel[b.id] ? 0 : 1; selectionChanged(); });

  const res = $('#res');
  res.value = String(state.res);
  res.addEventListener('change', () => { state.res = +res.value; scheduleScan(); saveSoon(); });
  const mp = $('#min-patch');
  mp.value = state.minPatch;
  mp.addEventListener('change', () => { state.minPatch = Math.max(0, Math.round(+mp.value || 0)); mp.value = state.minPatch; if (scan.complete) computeStats(); saveSoon(); });

  $('#zr').value = 192;
  $('#zone-add').addEventListener('click', () => {
    const x = Math.round(+$('#zx').value), z = Math.round(+$('#zz').value), r = Math.max(1, Math.round(+$('#zr').value || 0));
    if (!Number.isFinite(x) || !Number.isFinite(z) || $('#zx').value === '' || $('#zz').value === '') { $('#zx').focus(); return; }
    addZone({ x1: x - r, z1: z - r, x2: x + r, z2: z + r, label: 'Around ' + x + ', ' + z + ' (r ' + r + ')' });
  });
  $('#zone-draw').addEventListener('click', () => { setTool('exclude'); canvas.focus(); });
  const clearBtn = $('#zone-clear');
  clearBtn.addEventListener('click', () => {
    if (!state.zones.length) return;
    if (clearBtn.dataset.armed !== '1') {
      clearBtn.dataset.armed = '1';
      clearBtn.textContent = 'Tap again to clear';
      setTimeout(() => { clearBtn.dataset.armed = ''; clearBtn.textContent = 'Clear all'; }, 2500);
      return;
    }
    clearBtn.dataset.armed = '';
    clearBtn.textContent = 'Clear all';
    state.zones = [];
    zonesChanged();
  });

  $('#px').value = state.probe.x; $('#py').value = state.probe.y; $('#pz').value = state.probe.z;
  $('#probe-go').addEventListener('click', () => {
    const x = Math.round(+$('#px').value || 0), y = clamp(Math.round(+$('#py').value || 0), -64, 320), z = Math.round(+$('#pz').value || 0);
    probeAt(x, y, z, true);
  });
}

function decodeWasm() {
  const b64 = self.CUBIOMES_WASM_B64;
  if (typeof b64 !== 'string') return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function init() {
  COLORS.area = cssVar('--area') || '#ffc93c';
  COLORS.cut = cssVar('--cut') || '#ff5a4e';
  COLORS.mapBg = cssVar('--map-bg') || '#040505';
  COLORS.mono = cssVar('--font-mono') || 'monospace';

  loadSaved();
  state.area = normArea(state.area);
  buildLuts();
  renderWaters();
  renderQuick();
  renderBiomes();
  renderZones();
  bindInputs();
  bindMatch();
  syncAreaInputs();
  setMode(state.mode);
  setTool('pan');

  new ResizeObserver(resize).observe(mapwrap);
  const r = mapwrap.getBoundingClientRect();
  cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
  if (state.view) Object.assign(view, state.view);
  else fitArea();

  const bytes = decodeWasm();
  if (!bytes) {
    showMapError('cubiomes-wasm.js did not load. Keep it in the same folder as this page.');
    return;
  }
  pool.start(bytes);
  applyWorld();
  renderSummary();
  renderResults();
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleDraw);
  booted = true;
}

init();
})();
