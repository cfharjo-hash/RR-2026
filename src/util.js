
// Map number -> generator seeds. Map 0 is the original hand-checked map (terrain 7, world 11, classic river);
// any other number builds a different landscape, river, town layout and set of town names.
// Saves on generated maps rebuild the map from these seeds, so the generator for maps 1+ must not change
// (seeds, riverFor, TOWN_POOL order, the siting rules in World.generate). If it ever has to, bump MAP_GEN:
// saves record it, and a save from another generator version is refused instead of replaying on the wrong map.
// Generator 2 (2026-11-23): the sim's sin, cos and pow are its own (src/dmath.js), the same in every browser and in
// the C# port. Saves from generator 1 still load: they replay with the engine's Math functions (setup.js).
export const MAP_GEN = 2;
export const MAP_GENS = [1, 2]; // generators a save may come from
export const MAP_MAX = 99999;
export function mapSeeds(map) {
  map = Math.max(0, Math.min(MAP_MAX, Math.floor(+map || 0)));
  if (!map) return { map: 0, terrain: 7, world: 11 };
  return { map, terrain: (Math.imul(map, 2654435761) ^ 0x5bd1e995) >>> 0, world: (Math.imul(map, 40503) + 0x27d4eb2f) >>> 0 };
}

export function mulberry32(a) {
  const f = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.fork = () => mulberry32(a); // a copy that continues from here without advancing this stream
  return f;
}

// 2D simplex noise (seeded)
export function makeNoise2D(rand) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[1,0],[-1,0],[0,1],[0,-1],[0,1],[0,-1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const gi = g[pm12[ii + perm[jj]]]; t0 *= t0; n0 = t0 * t0 * (gi[0] * x0 + gi[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const gi = g[pm12[ii + i1 + perm[jj + j1]]]; t1 *= t1; n1 = t1 * t1 * (gi[0] * x1 + gi[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const gi = g[pm12[ii + 1 + perm[jj + 1]]]; t2 *= t2; n2 = t2 * t2 * (gi[0] * x2 + gi[1] * y2); }
    return 70 * (n0 + n1 + n2);
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function money(v) {
  const s = Math.round(Math.abs(v)).toLocaleString('en-US');
  return (v < 0 ? '-$' : '$') + s;
}
export function moneyShort(v) {
  const a = Math.abs(v), sign = v < 0 ? '-' : '';
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'k';
  return sign + '$' + Math.round(a);
}

// ---------- vertex-coloured part merging ----------
// Build complex low-poly models from primitives with one draw call each.
