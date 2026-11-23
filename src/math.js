// Pure math for the simulation (no Three.js): a 3D vector and the centripetal Catmull-Rom spline that track
// planning uses. Both follow Three.js r160 (MIT licence) operation for operation, so every number matches what
// the game computed with Three.js before (tools/math-check.mjs verifies this bit for bit). Saves replay
// construction, so any change here would change rebuilt maps.
import { pow as dpow } from './dmath.js';

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setY(y) { this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { return this.divideScalar(this.length() || 1); }
  setLength(l) { return this.normalize().multiplyScalar(l); }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
  lerpVectors(v1, v2, a) { this.x = v1.x + (v2.x - v1.x) * a; this.y = v1.y + (v2.y - v1.y) * a; this.z = v1.z + (v2.z - v1.z) * a; return this; }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx; return this;
  }
  cross(v) { return this.crossVectors(this, v); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  toArray() { return [this.x, this.y, this.z]; }
}

// one cubic segment of a non-uniform Catmull-Rom spline (Three.js CubicPoly)
function cubic(x0, x1, x2, x3, dt0, dt1, dt2) {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1; t2 *= dt1;
  const c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return (t) => { const tt = t * t, ttt = tt * t; return c0 + c1 * t + c2 * tt + c3 * ttt; };
}

// open centripetal Catmull-Rom curve through `points` (Vec3s), with Three.js's arc-length parametrisation
export class CatmullRom {
  constructor(points) { this.points = points; this.divisions = 200; this.lengths = null; }
  getPoint(t, out = new Vec3()) {
    const points = this.points, l = points.length;
    const p = (l - 1) * t;
    let intPoint = Math.floor(p), weight = p - intPoint;
    if (weight === 0 && intPoint === l - 1) { intPoint = l - 2; weight = 1; }
    const tmp = new Vec3();
    const p0 = intPoint > 0 ? points[(intPoint - 1) % l] : tmp.subVectors(points[0], points[1]).add(points[0]);
    const p1 = points[intPoint % l], p2 = points[(intPoint + 1) % l];
    // as in Three.js, both extrapolated ends share one temp vector: on a 2-point curve p3 overwrites p0
    const p3 = intPoint + 2 < l ? points[(intPoint + 2) % l] : tmp.subVectors(points[l - 1], points[l - 2]).add(points[l - 1]);
    let dt0 = dpow(p0.distanceToSquared(p1), 0.25), dt1 = dpow(p1.distanceToSquared(p2), 0.25), dt2 = dpow(p2.distanceToSquared(p3), 0.25);
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    return out.set(cubic(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2)(weight), cubic(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2)(weight), cubic(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2)(weight));
  }
  getLengths() {
    if (this.lengths) return this.lengths;
    const cache = [0];
    let last = this.getPoint(0), sum = 0;
    for (let p = 1; p <= this.divisions; p++) { const cur = this.getPoint(p / this.divisions); sum += cur.distanceTo(last); cache.push(sum); last = cur; }
    return (this.lengths = cache);
  }
  getLength() { const l = this.getLengths(); return l[l.length - 1]; }
  getUtoTmapping(u) {
    const arc = this.getLengths(), il = arc.length, target = u * arc[il - 1];
    let low = 0, high = il - 1, i = 0;
    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);
      const c = arc[i] - target;
      if (c < 0) low = i + 1; else if (c > 0) high = i - 1; else { high = i; break; }
    }
    i = high;
    if (arc[i] === target) return i / (il - 1);
    return (i + (target - arc[i]) / (arc[i + 1] - arc[i])) / (il - 1);
  }
  getPointAt(u, out) { return this.getPoint(this.getUtoTmapping(u), out); }
  getSpacedPoints(divisions = 5) { const pts = []; for (let d = 0; d <= divisions; d++) pts.push(this.getPointAt(d / divisions)); return pts; }
}
