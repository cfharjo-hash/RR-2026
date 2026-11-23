// Deterministic sin and cos for the simulation: a port of fdlibm (the same algorithm V8 uses unless it is built to
// use the system's faster trig functions, as Chromium is — which is why Node and the browser used to disagree in the
// last bit on about 3% of inputs). Every engine now computes the same bits, and so does the C# port
// (unity/Assets/Scripts/Sim/DMath.cs, checked against this file by tools/dmath-check.mjs).
// pow is here too (V8's Math.pow calls the platform's C library); the other functions the sim uses (atan2, acos,
// exp, hypot) are V8's own code, the same on every platform.
// Arguments beyond about ±823,000 (never used by the game) fall back to Math.sin / Math.cos.
// Legacy mode (setLegacyMath): games from saves made before these functions existed (map generator 1) use the
// engine's own Math.sin / cos / pow, as they were made with, so they rebuild and play on exactly as before.

let legacy = false;
export function setLegacyMath(on) { legacy = !!on; }

const buf = new DataView(new ArrayBuffer(8));
const hi = (x) => { buf.setFloat64(0, x); return buf.getInt32(0); };
const withHi = (h) => { buf.setInt32(0, h); buf.setInt32(4, 0); return buf.getFloat64(0); }; // INSERT_WORDS(h, 0)

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x, y, iy) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x, y) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : withHi(ix - 0x00200000);
  const hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
  pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
  pio2_3t = 8.47842766036889956997e-32;
const npio2hw = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a,
  0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a,
  0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb,
  0x404858eb, 0x404921fb];
const y = [0, 0];
// x reduced to y[0] + y[1] in [-pi/4, pi/4]; returns n (the quadrant is n & 3), or null when |x| is too large
function remPio2(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) { // |x| < 3pi/4
    if (hx > 0) {
      let z = x - pio2_1;
      if (ix !== 0x3ff921fb) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
      else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
      return 1;
    }
    let z = x + pio2_1;
    if (ix !== 0x3ff921fb) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
    else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
    return -1;
  }
  if (ix > 0x413921fb) return null; // |x| > 2^19 * pi/2
  let t = Math.abs(x);
  const n = (t * invpio2 + 0.5) | 0, fn = n;
  let r = t - fn * pio2_1, w = fn * pio2_1t;
  if (n < 32 && ix !== npio2hw[n - 1]) y[0] = r - w;
  else {
    const j = ix >> 20; y[0] = r - w;
    let i = j - ((hi(y[0]) >> 20) & 0x7ff);
    if (i > 16) {
      t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y[0] = r - w;
      i = j - ((hi(y[0]) >> 20) & 0x7ff);
      if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y[0] = r - w; }
    }
  }
  y[1] = (r - y[0]) - w;
  if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
  return n;
}

export function sin(x) {
  if (legacy) return Math.sin(x);
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x; // NaN
  const n = remPio2(x);
  if (n === null) return Math.sin(x);
  switch (n & 3) {
    case 0: return kSin(y[0], y[1], 1);
    case 1: return kCos(y[0], y[1]);
    case 2: return -kSin(y[0], y[1], 1);
    default: return -kCos(y[0], y[1]);
  }
}

export function cos(x) {
  if (legacy) return Math.cos(x);
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  if (n === null) return Math.cos(x);
  switch (n & 3) {
    case 0: return kCos(y[0], y[1]);
    case 1: return -kSin(y[0], y[1], 1);
    case 2: return -kCos(y[0], y[1]);
    default: return kSin(y[0], y[1], 1);
  }
}

// ---------------- pow ----------------
// fdlibm / FreeBSD msun pow. V8's Math.pow calls the platform's C library, so its last bit can depend on the
// operating system; the sim uses this one instead (same bits as DMath.Pow in C#).
const lo = (x) => { buf.setFloat64(0, x); return buf.getUint32(4); };
const make = (h, l) => { buf.setInt32(0, h); buf.setUint32(4, l >>> 0); return buf.getFloat64(0); };
const withLo0 = (x) => make(hi(x), 0);
const setHi = (x, h) => make(h, lo(x));
const bp = [1.0, 1.5], dp_h = [0.0, 5.84962487220764160156e-01], dp_l = [0.0, 1.35003920212974897128e-08];
const two53 = 9007199254740992.0, huge = 1.0e300, tiny = 1.0e-300,
  L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01,
  L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01,
  P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08,
  lg2 = 6.93147180559945286227e-01, lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09,
  ovt = 8.0085662595372944372e-17, cp = 9.61796693925975554329e-01, cp_h = 9.61796700954437255859e-01,
  cp_l = -7.02846165095275826516e-09, ivln2 = 1.44269504088896338700e+00, ivln2_h = 1.44269502162933349609e+00,
  ivln2_l = 1.92596299112661746887e-08;

export function pow(x, y) {
  if (legacy) return Math.pow(x, y);
  if (Number.isNaN(y) || ((y === Infinity || y === -Infinity) && (x === 1 || x === -1))) return NaN; // (JavaScript, not C)
  let z, ax, z_h, z_l, p_h, p_l, y1, t1, t2, r, s, t, u, v, w, i, j, k, yisint, n;
  const hx = hi(x), hy = hi(y), lx = lo(x), ly = lo(y);
  let ix = hx & 0x7fffffff; const iy = hy & 0x7fffffff;
  if ((iy | ly) === 0) return 1;
  if (hx === 0x3ff00000 && lx === 0) return 1;
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;
  yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff;
      if (k > 20) { const jj = ly >>> (52 - k); if (((jj << (52 - k)) >>> 0) === ly) yisint = 2 - (jj & 1); }
      else if (ly === 0) { j = iy >> (20 - k); if ((j << (20 - k)) === iy) yisint = 2 - (j & 1); }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) === 0) return 1;
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }
  ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    z = ax; if (hy < 0) z = 1 / z;
    if (hx < 0) { if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z); else if (yisint === 1) z = -z; }
    return z;
  }
  n = (hx >>> 31) - 1;
  if ((n | yisint) === 0) return (x - x) / (x - x);
  s = 1; if ((n | (yisint - 1)) === 0) s = -1;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
      if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    t = ax - 1;
    w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = ivln2_h * t; v = t * ivln2_l - w * ivln2;
    t1 = withLo0(u + v); t2 = v - (t1 - u);
  } else {
    let ss, s2, s_h, s_l, t_h, t_l;
    n = 0;
    if (ix < 0x00100000) { ax *= two53; n -= 53; ix = hi(ax); }
    n += (ix >> 20) - 0x3ff; j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    if (j <= 0x3988E) k = 0; else if (j < 0xBB67A) k = 1; else { k = 0; n += 1; ix -= 0x00100000; }
    ax = setHi(ax, ix);
    u = ax - bp[k]; v = 1 / (ax + bp[k]); ss = u * v; s_h = withLo0(ss);
    t_h = make(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    t_l = ax - (t_h - bp[k]);
    s_l = v * ((u - s_h * t_h) - s_h * t_l);
    s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = withLo0(3.0 + s2 + r);
    t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h; v = s_l * t_h + t_l * ss;
    p_h = withLo0(u + v); p_l = v - (p_h - u);
    z_h = cp_h * p_h; z_l = cp_l * p_h + p_l * cp + dp_l[k];
    t = n;
    t1 = withLo0(((z_h + z_l) + dp_h[k]) + t);
    t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
  }
  y1 = withLo0(y);
  p_l = (y - y1) * t1 + y * t2; p_h = y1 * t1; z = p_l + p_h;
  j = hi(z); i = lo(z) | 0;
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }
  i = j & 0x7fffffff; k = (i >> 20) - 0x3ff; n = 0;
  if (i > 0x3fe00000) {
    n = (j + (0x00100000 >> (k + 1))) | 0;
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    t = make(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  t = withLo0(p_l + p_h);
  u = t * lg2_h; v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v; w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = (hi(z) + (n << 20)) | 0;
  if ((j >> 20) <= 0) z = scaleB(z, n); else z = setHi(z, j);
  return s * z;
}
// x * 2^n for a subnormal result (as DMath.ScaleB)
function scaleB(x, n) {
  if (n >= -1074) return x * (n >= -1022 ? make((n + 1023) << 20, 0) : make(n + 1074 >= 32 ? 1 << (n + 1074 - 32) : 0, n + 1074 >= 32 ? 0 : 2 ** (n + 1074)));
  return x * 5e-324 * Math.pow(2, n + 1074);
}
