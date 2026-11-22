// Waterways: navigation grid on the terrain heightfield, A* routing and berths (pure; ship and harbor models are in view/craftModels.js).
import { clamp } from './util.js';
import { Vec3, CatmullRom } from './math.js';
import { CARGO } from './data.js';

const NAV = -1.2;     // a grid point is navigable when the river bed is below this
const DEEP = -2.6;    // berths and smoothed lines prefer water at least this deep

export class Waterways {
  constructor(terrain) {
    this.t = terrain; this.N = terrain.N; this.V = terrain.N + 1;
    this.cache = new Map();
    // navigation uses the river bed as generated: later terraforming (track embankments) must not
    // change routes, or a path would depend on when it was first asked for (and saves would drift)
    this.h0 = terrain.h.slice();
  }
  h(i, j) { return this.h0[j * this.V + i]; }
  ok(i, j) { return i >= 0 && j >= 0 && i <= this.N && j <= this.N && this.h(i, j) < NAV; }
  cell(x, z) { return [Math.round((x + this.t.half) / this.t.cell), Math.round((z + this.t.half) / this.t.cell)]; }
  pos(i, j) { return { x: -this.t.half + i * this.t.cell, z: -this.t.half + j * this.t.cell }; }

  // nearest deep-enough water to a point (used for harbor berths)
  nearestWater(x, z, r) {
    const [ci, cj] = this.cell(x, z), R = Math.ceil(r / this.t.cell);
    let best = null, bd = Infinity;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (!this.ok(i, j) || this.h(i, j) > DEEP) continue;
      // berth needs room: all 8 neighbours navigable
      let room = true;
      for (let dj = -1; dj <= 1 && room; dj++) for (let di = -1; di <= 1; di++) if (!this.ok(i + di, j + dj)) { room = false; break; }
      if (!room) continue;
      const p = this.pos(i, j), d = Math.hypot(p.x - x, p.z - z);
      if (d < bd && d <= r) { bd = d; best = { x: p.x, z: p.z, i, j, d }; }
    }
    return best;
  }

  // A* over navigable grid points; deeper water is cheaper so ships keep to mid-channel
  path(a, b) {
    const key = `${Math.round(a.x)},${Math.round(a.z)}>${Math.round(b.x)},${Math.round(b.z)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const V = this.V, start = this.cell(a.x, a.z), goal = this.cell(b.x, b.z);
    const sk = start[1] * V + start[0], gk = goal[1] * V + goal[0];
    const g = new Map([[sk, 0]]), came = new Map();
    const heap = [[0, sk]];
    const push = (f, k) => { heap.push([f, k]); let n = heap.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
    const hdist = (k) => Math.hypot((k % V) - goal[0], Math.floor(k / V) - goal[1]);
    let found = false, guard = 0;
    while (heap.length && guard++ < 400000) {
      const [, k] = pop();
      if (k === gk) { found = true; break; }
      const i = k % V, j = Math.floor(k / V), gk0 = g.get(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(i + di, j) || !this.ok(i, j + dj))) continue; // no corner cutting
        const depthPenalty = 1 + Math.max(0, this.h(ni, nj) + 4) * 0.8;
        const nk = nj * V + ni, ng = gk0 + Math.hypot(di, dj) * depthPenalty;
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, k); push(ng + hdist(nk), nk); }
      }
    }
    if (!found) { this.cache.set(key, null); return null; }
    const cells = []; for (let k = gk; k !== undefined; k = came.get(k)) cells.push([k % V, Math.floor(k / V)]);
    cells.reverse();
    // string-pull: skip points while the straight line stays in deep enough water
    const sm = [cells[0]];
    let anchor = 0;
    for (let n = 2; n < cells.length; n++) if (!this.clear(cells[anchor], cells[n])) { sm.push(cells[n - 1]); anchor = n - 1; }
    sm.push(cells[cells.length - 1]);
    const ctrl = [new Vec3(a.x, 0, a.z), ...sm.slice(1, -1).map(([i, j]) => { const p = this.pos(i, j); return new Vec3(p.x, 0, p.z); }), new Vec3(b.x, 0, b.z)];
    let pts;
    if (ctrl.length >= 3) { const c = new CatmullRom(ctrl); pts = c.getSpacedPoints(Math.max(4, Math.ceil(c.getLength() / 4))); }
    else pts = [ctrl[0], ctrl[ctrl.length - 1]];
    const cum = [0]; for (let n = 1; n < pts.length; n++) cum.push(cum[n - 1] + pts[n].distanceTo(pts[n - 1]));
    const res = { pts, cum, length: cum[cum.length - 1] };
    this.cache.set(key, res);
    return res;
  }
  clear(a, b) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
    for (let k = 0; k <= n; k++) {
      const i = Math.round(a[0] + (b[0] - a[0]) * k / n), j = Math.round(a[1] + (b[1] - a[1]) * k / n);
      if (!this.ok(i, j) || this.h(i, j) > NAV - 0.6) return false;
    }
    return true;
  }
  // where the shore is, walking from the berth toward a land point
  shorePoint(berth, land) {
    const dx = land.x - berth.x, dz = land.z - berth.z, L = Math.hypot(dx, dz);
    for (let s = 0; s <= L; s += 2) { const x = berth.x + dx / L * s, z = berth.z + dz / L * s; if (this.t.heightAt(x, z) > 2.2) return { x, z, s }; }
    return { x: land.x, z: land.z, s: L };
  }
}
