// The terrain heightfield (pure data; drawn by view/terrainView.js)
import { sin as dsin, cos as dcos } from './dmath.js';
import { makeNoise2D, mulberry32, smoothstep, clamp, lerp } from './util.js';
import { ContinentShape, CONTINENT } from './continent.js';

export const WATER_LEVEL = 0;

export class Terrain {
  // kind: 'classic' (a 3 km generated map) or 'continent' (the stylised North America, continent.js)
  constructor(seed = 7, map = 0, kind = 'classic') {
    this.kind = kind;
    this.cont = kind === 'continent' ? new ContinentShape(seed) : null;
    this.S = this.cont ? CONTINENT.S : 3000; this.N = this.cont ? CONTINENT.N : 400; this.half = this.S / 2; this.cell = this.S / this.N;
    this.seed = seed; this.map = map;
    this.river = map ? Terrain.riverFor(seed) : null; // map 0 keeps the classic river
    this.rand = mulberry32(seed);
    this.noise = makeNoise2D(this.rand);
    this.noise2 = makeNoise2D(this.rand);
    const V = this.N + 1;
    this.h = new Float32Array(V * V);
    this.mark = new Uint8Array(V * V); // 0 natural, 1 dirt/embankment, 2 paved
    this.generate();
  }
  fbm(x, z, oct, n = this.noise) {
    let a = 1, f = 1, s = 0, t = 0;
    for (let i = 0; i < oct; i++) { s += a * n(x * f, z * f); t += a; a *= 0.5; f *= 2.03; }
    return s / t;
  }
  // the river winds across the whole map, along z (north-south) or, on some maps, along x
  static riverFor(seed) {
    const r = mulberry32(seed ^ 0x9e3779b9);
    return { axis: r() < 0.5 ? 'z' : 'x', base: (r() * 2 - 1) * 360, a1: 200 + r() * 220, f1: 500 + r() * 300, p1: r() * 6.283,
      a2: 70 + r() * 110, f2: 180 + r() * 120, p2: r() * 6.283 };
  }
  riverX(z) {
    const v = this.river;
    if (!v) return -180 + 360 * dsin(z / 650) + 160 * dsin(z / 230 + 1.3);
    return v.base + v.a1 * dsin(z / v.f1 + v.p1) + v.a2 * dsin(z / v.f2 + v.p2);
  }
  riverDist(x, z) {
    if (this.cont) return this.cont.riverDistN(x / this.half, z / this.half) * this.half;
    return this.river?.axis === 'x' ? Math.abs(z - this.riverX(x)) : Math.abs(x - this.riverX(z)); }
  // the region at a point (continent only; null at sea or on a classic map)
  regionAt(x, z) { return this.cont ? this.cont.region(x / this.half, z / this.half) : null; }
  coastDist(x, z) { return this.cont ? this.cont.coastDistN(x / this.half, z / this.half) * this.half : Infinity; }
  genHeight(x, z) {
    if (this.cont) return this.cont.height(x / this.half, z / this.half, this.half);
    const nx = x / this.S, nz = z / this.S;
    const e = this.fbm(nx * 3.2, nz * 3.2, 6);
    const m = smoothstep(0.05, 0.55, this.fbm(nx * 1.4 + 11, nz * 1.4 - 7, 3, this.noise2));
    let r = 1 - Math.abs(this.noise(nx * 7 + 3, nz * 7 - 9)); r = r * r;
    let h = 16 + e * 26 + m * (r * 150 + Math.max(0, e) * 60);
    // river
    const d = this.riverDist(x, z);
    if (d < 110) h = lerp(-5, h, smoothstep(26, 110, d));
    return h;
  }
  generate() {
    const V = this.N + 1;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      this.h[j * V + i] = this.genHeight(x, z);
    }
  }
  idx(i, j) { return j * (this.N + 1) + i; }
  heightAt(x, z) {
    const fx = clamp((x + this.half) / this.cell, 0, this.N - 0.0001);
    const fz = clamp((z + this.half) / this.cell, 0, this.N - 0.0001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const V = this.N + 1, h = this.h;
    const a = h[j * V + i], b = h[j * V + i + 1], c = h[(j + 1) * V + i], d = h[(j + 1) * V + i + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  slopeAt(x, z, r = 8) {
    const dx = this.heightAt(x + r, z) - this.heightAt(x - r, z);
    const dz = this.heightAt(x, z + r) - this.heightAt(x, z - r);
    return Math.hypot(dx, dz) / (2 * r);
  }
  inBounds(x, z, m = 60) { return Math.abs(x) < this.half - m && Math.abs(z) < this.half - m; }

  // Modify heights in a region. fn(x,z,h) -> {h, w} (w = blend weight 0..1) or null.
  modify(minX, minZ, maxX, maxZ, fn, markType = 1) {
    const V = this.N + 1;
    const i0 = clamp(Math.floor((minX + this.half) / this.cell), 0, this.N), i1 = clamp(Math.ceil((maxX + this.half) / this.cell), 0, this.N);
    const j0 = clamp(Math.floor((minZ + this.half) / this.cell), 0, this.N), j1 = clamp(Math.ceil((maxZ + this.half) / this.cell), 0, this.N);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i;
      const x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      const r = fn(x, z, this.h[k]);
      if (!r || r.w <= 0) continue;
      this.h[k] = lerp(this.h[k], r.h, r.w);
      if (r.w > 0.5 && markType) this.mark[k] = Math.max(this.mark[k], r.mark ?? markType);
    }
    this.onModify?.(i0, i1, j0, j1); // the view redraws this part of the terrain
  }
}
