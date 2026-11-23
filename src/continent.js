// The continent (CONTINENT_PLAN.md §1): a stylised North America, hand-drawn as low-resolution layers (coast,
// mountain ranges, rivers, lakes, regions, cities) with generated detail on top. Pure: the terrain asks it for heights,
// the world for regions and cities. Coordinates are normalised: u from -1 (Pacific) to 1 (Atlantic), v from -1 (north)
// to 1 (south). Real geography is the model; every name here is invented.
import { pow as dpow } from './dmath.js';
import { makeNoise2D, mulberry32, smoothstep, clamp, lerp } from './util.js';

export const CONTINENT = { S: 12000, N: 480 };

// the coast, clockwise from the north-west corner (the map runs on north into the far north and south into the far south)
const COAST = [
  [-0.92, -1], [-0.93, -0.62], [-0.95, -0.36], [-0.9, -0.06], [-0.86, 0.18], [-0.79, 0.38], [-0.72, 0.52], [-0.62, 0.74], [-0.46, 1.0],
  [-0.15, 1.0], [-0.19, 0.76], [-0.2, 0.56], [-0.12, 0.46], [0.0, 0.43], [0.06, 0.47], [0.12, 0.43], [0.3, 0.42], [0.38, 0.47],
  [0.42, 0.62], [0.48, 0.75], [0.53, 0.63], [0.52, 0.5], [0.56, 0.37], [0.66, 0.2], [0.72, 0.01], [0.8, -0.14], [0.9, -0.24],
  [0.95, -0.4], [1.0, -0.5], [1.0, -1],
];
// mountain ranges: a line, peak height, half-width (normalised)
const RANGES = [
  { pts: [[-0.56, -1], [-0.5, -0.55], [-0.46, -0.15], [-0.42, 0.2], [-0.44, 0.5], [-0.42, 0.85]], h: 230, w: 0.11 },   // the great western range
  { pts: [[-0.81, -0.95], [-0.79, -0.45], [-0.76, -0.02], [-0.72, 0.32], [-0.66, 0.55]], h: 175, w: 0.055 },           // coastal ranges
  { pts: [[0.33, 0.36], [0.44, 0.12], [0.55, -0.08], [0.67, -0.28], [0.8, -0.5], [0.86, -0.8]], h: 85, w: 0.075 },      // the old eastern range
];
// rivers, source to mouth (normalised), with a channel half-width in m
const RIVERS = [
  { name: 'great', pts: [[0.17, -0.72], [0.15, -0.42], [0.11, -0.12], [0.08, 0.14], [0.05, 0.3], [0.03, 0.45]], w: 26 },
  { name: 'west fork', pts: [[-0.41, -0.6], [-0.27, -0.46], [-0.12, -0.27], [0.0, -0.14], [0.105, -0.11]], w: 18 },
  { name: 'east fork', pts: [[0.6, -0.16], [0.45, -0.08], [0.3, -0.01], [0.18, 0.03], [0.09, 0.06]], w: 18 },
  { name: 'canyon', pts: [[-0.47, -0.08], [-0.55, 0.18], [-0.63, 0.42], [-0.67, 0.58]], w: 14 },
  { name: 'north', pts: [[-0.46, -0.78], [-0.65, -0.68], [-0.8, -0.62], [-0.935, -0.6]], w: 16 },
];
// lakes: centre, radii (normalised), depth below water
const LAKES = [
  { u: 0.2, v: -0.42, ru: 0.13, rv: 0.045 }, { u: 0.29, v: -0.29, ru: 0.035, rv: 0.1 }, { u: 0.4, v: -0.33, ru: 0.06, rv: 0.05 },
  { u: 0.47, v: -0.2, ru: 0.07, rv: 0.025 }, { u: 0.57, v: -0.27, ru: 0.06, rv: 0.022 },
];
// cities (invented names): normalised position and size; `port` = on a coast
export const CITIES = [
  { name: 'Port Haven', u: 0.79, v: -0.16, pop: 11000, port: 'east' }, { name: 'Kingsmouth', u: 0.89, v: -0.28, pop: 7000, port: 'east' },
  { name: 'Bayport', u: 0.7, v: 0.0, pop: 6500, port: 'east' }, { name: 'Carroway', u: 0.63, v: 0.19, pop: 4500, port: 'east' },
  { name: 'Palmetto Bay', u: 0.54, v: 0.36, pop: 3000, port: 'east' }, { name: 'Delta City', u: 0.05, v: 0.4, pop: 7000, port: 'gulf' },
  { name: 'Saltmarsh', u: -0.12, v: 0.42, pop: 3000, port: 'gulf' }, { name: 'Tampora', u: 0.43, v: 0.55, pop: 2000, port: 'gulf' },
  { name: 'Golden Bay', u: -0.84, v: 0.17, pop: 6000, port: 'pacific' }, { name: 'Seaview', u: -0.9, v: -0.52, pop: 2500, port: 'pacific' },
  { name: 'Palmhaven', u: -0.76, v: 0.39, pop: 3000, port: 'pacific' },
  { name: 'Lakeport', u: 0.25, v: -0.18, pop: 7000 }, { name: 'Riverton', u: 0.08, v: -0.06, pop: 5000 }, { name: 'Fallsbury', u: 0.35, v: -0.05, pop: 3500 },
  { name: 'Ironhill', u: 0.57, v: -0.13, pop: 3000 }, { name: 'Prairie Gate', u: -0.12, v: -0.12, pop: 2500 }, { name: 'Highmesa', u: -0.37, v: -0.1, pop: 1800 },
  { name: 'Silver Basin', u: -0.62, v: -0.18, pop: 1200 }, { name: 'Northfork', u: -0.14, v: -0.52, pop: 1500 }, { name: 'Red Canyon', u: -0.52, v: 0.3, pop: 1000 },
  { name: 'Cotton Hill', u: 0.25, v: 0.25, pop: 2200 }, { name: 'Bluegrass', u: 0.33, v: 0.08, pop: 2000 }, { name: 'Cattleford', u: -0.24, v: 0.2, pop: 1400 },
  { name: 'Pine Harbor', u: 0.38, v: -0.48, pop: 1500 }, { name: 'Dry Springs', u: -0.3, v: 0.48, pop: 900 }, { name: 'Timberline', u: -0.66, v: -0.5, pop: 900 },
];
export const REGION_NAMES = { northeast: 'North-east', lakes: 'Great Lakes', midwest: 'Midwest prairies', south: 'South', plains: 'Great Plains', mountains: 'Mountain west', southwest: 'South-west', pacific: 'Pacific coast' };

const segDist = (px, pz, a, b) => {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
  const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / l2, 0, 1);
  return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t);
};
const lineDist = (u, v, pts) => { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(u, v, pts[i], pts[i + 1])); return d; };
// signed distance to the coast (normalised): positive on land
function coastSigned(u, v) {
  let inside = false, d = Infinity;
  for (let i = 0, j = COAST.length - 1; i < COAST.length; j = i++) {
    const [xi, zi] = COAST[i], [xj, zj] = COAST[j];
    if ((zi > v) !== (zj > v) && u < (xj - xi) * (v - zi) / (zj - zi) + xi) inside = !inside;
    // the map's own edges are not coast
    if (!((Math.abs(xi) === 1 && xi === xj) || (Math.abs(zi) === 1 && zi === zj))) d = Math.min(d, segDist(u, v, COAST[i], COAST[j]));
  }
  return inside ? d : -d;
}

export class ContinentShape {
  constructor(seed) {
    const r = mulberry32(seed ^ 0x51ed270b);
    this.n1 = makeNoise2D(r); this.n2 = makeNoise2D(r); this.n3 = makeNoise2D(r);
  }
  fbm(n, x, z, oct) { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, z * f); t += a; a *= 0.5; f *= 2.03; } return s / t; }
  // height in m at normalised (u, v); half = half the map's width in m (for river channels in metres)
  height(u, v, half) {
    const wob = this.n3(u * 3, v * 3) * 0.025;            // a ragged coast
    const sd = coastSigned(u + wob, v + wob * 0.7);
    const land = smoothstep(-0.006, 0.02, sd);
    // the interior: low by the eastern coast and the gulf, rising across the plains, a high basin in the west
    let base = 6 + 55 * smoothstep(0.15, -0.42, u) + 30 * smoothstep(-0.5, -0.62, u) * smoothstep(-0.9, -0.62, u) - 10 * smoothstep(0.1, 0.4, v);
    base += 5 + 9 * this.fbm(this.n1, u * 9, v * 9, 5);
    for (const R of RANGES) {
      const d = lineDist(u, v, R.pts) + this.n2(u * 5, v * 5) * R.w * 0.25;
      if (d < R.w * 1.6) {
        const k = 1 - smoothstep(0, R.w, d);
        let ridge = 1 - Math.abs(this.n1(u * 24 + 7, v * 24 - 3)); ridge *= ridge;
        base += R.h * dpow(k, 1.4) * (0.55 + 0.45 * ridge) + R.h * 0.15 * k * this.fbm(this.n2, u * 30, v * 30, 3);
      }
    }
    let h = lerp(Math.max(-60, -12 + 160 * sd), base, land); // (the sea floor deepens away from the coast)
    if (land > 0.5) {
      for (const L of LAKES) {
        const e = Math.hypot((u - L.u) / L.ru, (v - L.v) / L.rv) + this.n3(u * 12, v * 12) * 0.15;
        if (e < 1.25) h = lerp(h, -10, 1 - smoothstep(0.85, 1.2, e));
      }
      // rivers: a channel below water level in a valley that widens with the height of the land around it
      for (const R of RIVERS) {
        const d = lineDist(u, v, R.pts) * half;
        if (d > 900) continue;
        const valley = R.w + 50 + Math.max(0, h) * 3;
        if (d < valley) h = lerp(-5, h, smoothstep(R.w, valley, d));
      }
    }
    return h;
  }
  riverDistN(u, v) { let d = Infinity; for (const R of RIVERS) d = Math.min(d, lineDist(u, v, R.pts)); return d; }
  coastDistN(u, v) { return Math.abs(coastSigned(u, v)); }
  // the region a point belongs to (null at sea)
  region(u, v) {
    if (coastSigned(u, v) < 0.004) return null;
    const w = this.n3(u * 4 + 3, v * 4 - 2) * 0.04; u += w; v -= w;
    if (u < -0.68) return 'pacific';
    if (u < -0.36) return v < 0.12 ? 'mountains' : 'southwest';
    if (u < -0.06) return v < 0.16 ? 'plains' : (u < -0.25 ? 'southwest' : 'south');
    if (u < 0.45) return v < -0.15 ? 'lakes' : v < 0.17 ? 'midwest' : 'south';
    return v < 0.15 ? 'northeast' : 'south';
  }
}

// ---------- the frontier (CONTINENT_PLAN.md §3, phase 3) ----------
// Territories: regions that are settled over the game. Each starts with a third of its industries; the rest, and new
// towns on the sites below, are founded as its population grows (rail service makes towns grow). From `opens` on it
// takes settlers; it becomes a state at `grow` × its starting population, or in `stateYear` at the latest. Until then,
// track built there earns a land grant.
export const TERRITORIES = {
  plains:    { name: 'Plains Territory',     opens: 1852, grow: 2.2, stateYear: 1876, sites: 5 },
  southwest: { name: 'South-west Territory', opens: 1856, grow: 2.4, stateYear: 1890, sites: 5 },
  mountains: { name: 'Mountain Territory',   opens: 1858, grow: 2.4, stateYear: 1886, sites: 5 },
};
export const FRONTIER = {
  keep: 0.35,       // share of a territory's industries working from the start
  townPop: 350,     // a new frontier town
  landGrant: 2200,  // $ per mile of track built in a territory (1850 dollars), at most half the track's cost
};
// names for towns founded on the frontier (invented)
export const FRONTIER_NAMES = ['Dustwater', 'Coyote Wells', 'Sagebrush', 'Antelope Flats', 'Buffalo Ford', 'Wagon Gap', 'Prospect',
  'Juniper', 'Saddleback', 'Windrow', 'Hollow Creek', 'Thistle Rock', 'Kestrel Gap', 'Ochre Springs', 'Cinder Butte',
  'Larkspur', 'Tumbleweed', 'Quail Hollow', 'Flint Ridge', 'Gallows Creek'];

// is (u, v) west of the great river? (beyond its source and mouth: west of where it starts and ends)
export function westOfGreatRiver(u, v) {
  const P = RIVERS[0].pts;
  if (v <= P[0][1]) return u < P[0][0];
  for (let i = 0; i < P.length - 1; i++) {
    const [u0, v0] = P[i], [u1, v1] = P[i + 1];
    if (v >= v0 && v <= v1) return u < u0 + (u1 - u0) * (v - v0) / ((v1 - v0) || 1);
  }
  return u < P[P.length - 1][0];
}
