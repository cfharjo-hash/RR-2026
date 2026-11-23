// The track network: planning, earthworks, junctions, signals and routing (pure; drawn by view/trackView.js).
import { sin as dsin, cos as dcos } from './dmath.js';
import { ECON } from './data.js';
import { smoothstep, clamp } from './util.js';
import { Vec3, CatmullRom } from './math.js';

export const MAX_GRADE = 0.06;
// how far over a line's grade limit is still accepted (the default's 1 point; a tighter margin for a chosen limit)
export const gradeTol = (lim) => lim < MAX_GRADE ? lim * 0.1 + 0.002 : 0.01;
export const DOUBLE_OFF = 2.8;      // lateral offset of each line on double track
export const PLATFORM2 = -9.2;      // local z of a station's second platform track
export const SWITCH_LEN = 26;       // length over which tracks diverge at switches
export const JUNCTION_COST = 9000;
export const SIGNAL_COST = 6000;
// Signals are three-aspect (red, yellow, green). A driver only knows what the signals show: passing a green signal
// (or seeing it from SIGHT m away) clears the next two blocks, a yellow one only the next block. So a train must
// always be able to stop within one block plus SIGHT: shorter blocks than that slow fast trains down.
// (continental rules; classic trains keep their perfect look-ahead.) BRAKE: deceleration in m/s².
export const SIGHT = 30, BRAKE = 3.5;
export const stopDistance = (mph, airbrake) => { const v = mph * 0.5 * (airbrake ? 1.1 : 1); return v * v / (2 * BRAKE); };
// semaphore arms until this year, colour-light (searchlight) signals after
export const LIGHT_SIGNALS_YEAR = 1915;
// track crossings: a level crossing (diamond) is an interlocked lock shared by both lines; tracks at least
// XING.clear m apart in height pass over/under each other (the upper one bridged) with no lock
// endGap: crossings stay off platforms and switches (beyond them, near a station a crossing works like a busy flat
// junction: the reservations keep it safe). nearSignal: not right at a signal. connect: how far from a station or
// junction the tracks that meet there count as connected rather than crossing.
// runIn: a branch runs in along the station or the line it joins for this far: tracks meeting there don't cross
export const XING = { cost: 8000, fee: 10000, minAngle: 15, clear: 8, minClear: 6, zone: 12, sep: 4.5, nearSignal: 35, endGap: 6, connect: 60, runIn: 40, apart: 20 };
const CELL = 24;
export const HALF = ECON.platformLen / 2;
// half a station's platform: standard stations (and road depots) have ECON.platformLen, long ones their own `len`
export const halfOf = (st) => (st.len || ECON.platformLen) / 2;

export const tangentAt = (pts, i) => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  return new Vec3(b.x - a.x, 0, b.z - a.z).normalize();
};
const cumOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1])); return c; };

export class TrackNetwork {
  constructor(terrain, world) {
    this.terrain = terrain; this.world = world; this.view = null;
    this.edges = []; this.junctions = []; this.nextId = 1; this.jSeq = 1;
    this.grid = new Map();   // CELL-sized cells → track segments {e, j} (fast crossing checks)
    this.diamonds = []; this.xSeq = 1;
    this.legacy = false;     // games saved before crossings existed (save v3) replay without them
    this.onSplit = null; // set by Game: called with (oldEdge, [e1, e2])
  }

  // ---------- helpers ----------
  endFree(node) { return node.type === 'station' ? halfOf(node) : 0; }
  // where a track's end is too busy for a crossing: the platform (or the switch point of a junction)
  endZone(node) { return (node.type === 'station' ? halfOf(node) + 4 : 12) + XING.endGap; }
  // 0..1: how far apart the two lines of a double track are at distance d along the edge
  doubleW(edge, d) {
    const fa = this.endFree(edge.a) + 4, fb = this.endFree(edge.b) + 4;
    return smoothstep(fa, fa + SWITCH_LEN, d) * smoothstep(edge.length - fb, edge.length - fb - SWITCH_LEN, d);
  }
  blockId(edge, k, dir) { return edge.double ? `${edge.id}#${k}#${dir}` : `${edge.id}#${k}`; }
  edgePoint(edge, d, out = new Vec3()) {
    const c = edge.cum; d = clamp(d, 0, edge.length);
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    return out.lerpVectors(edge.pts[lo], edge.pts[hi], (d - c[lo]) / Math.max(1e-6, c[hi] - c[lo]));
  }
  edgeIndexAt(edge, d) { let i = 0; while (i < edge.cum.length - 1 && edge.cum[i + 1] <= d) i++; return i; }
  posOf(node) { return node.type === 'jc' ? node.p : new Vec3(node.x, node.y, node.z); }

  // nearest point on any track; returns a junction candidate
  // owner: a company id, or a test (edge) => true for the tracks that count
  nearestTrack(p, maxD = 9, owner = null) {
    if (!p) return null;
    let best = null, bd = maxD;
    const take = typeof owner === 'function' ? owner : (e) => !owner || e.owner === owner;
    for (const e of this.edges) if (take(e)) for (let i = 1; i < e.pts.length - 1; i++) {
      const q = e.pts[i], d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = { e, i }; }
    }
    if (!best) return null;
    const { e, i } = best, d = e.cum[i];
    const okA = d > this.endFree(e.a) + SWITCH_LEN + 12, okB = e.length - d > this.endFree(e.b) + SWITCH_LEN + 12;
    const nearSig = e.signals.some(s => Math.abs(s - d) < 12), nearX = (e.xings || []).some(x => Math.abs(x.d - d) < XING.endGap + SWITCH_LEN);
    return {
      type: 'jc', edge: e, owner: e.owner, i, d, p: e.pts[i].clone(), t: tangentAt(e.pts, i),
      bad: !(okA && okB) ? 'Too close to a station or junction for a switch' : (e.bridge[i] ? 'Cannot branch on a bridge' : (nearSig ? 'Too close to a signal' : (nearX ? 'Too close to a level crossing' : null))),
    };
  }

  endInfo(node, target) {
    if (node.type === 'station') {
      const side = Math.sign((target.x - node.x) * node.axis.x + (target.z - node.z) * node.axis.z) || 1;
      const H = halfOf(node), end = new Vec3(node.x + node.axis.x * side * H, 0, node.z + node.axis.z * side * H);
      return { side, ctrl: [new Vec3(node.x, 0, node.z), end, end.clone().addScaledVector(node.axis, side * 22)], pinR: H + 4, y: node.y };
    }
    const side = Math.sign((target.x - node.p.x) * node.t.x + (target.z - node.p.z) * node.t.z) || 1;
    const p0 = new Vec3(node.p.x, 0, node.p.z);
    return { side, ctrl: [p0, p0.clone().addScaledVector(node.t, side * 16), p0.clone().addScaledVector(node.t, side * 34)], pinR: 12, y: node.p.y };
  }

  // ---------- planning ----------
  plan(A, waypoints, B, double = false, maxGrade0 = MAX_GRADE) {
    const LIM = Math.min(MAX_GRADE, maxGrade0); // the steepest grade allowed for this line (the player can ask for a flatter one)
    const t = this.terrain;
    const firstT = waypoints[0] || (B ? this.posOf(B) : null);
    if (!firstT) return null;
    const ia = this.endInfo(A, firstT);
    const ctrl = [...ia.ctrl];
    for (const w of waypoints) ctrl.push(new Vec3(w.x, 0, w.z));
    let ib = null;
    if (B) {
      const lastT = waypoints[waypoints.length - 1] || this.posOf(A);
      ib = this.endInfo(B, lastT);
      ctrl.push(...[...ib.ctrl].reverse());
    }
    const cp = [ctrl[0]];
    for (let i = 1; i < ctrl.length; i++) if (ctrl[i].distanceTo(cp[cp.length - 1]) > 4) cp.push(ctrl[i]);
    if (cp.length < 2) return null;
    const curve = new CatmullRom(cp); // centripetal, as Three.js's CatmullRomCurve3 (math.js)
    const len = curve.getLength();
    const pts = curve.getSpacedPoints(Math.max(4, Math.ceil(len / 2.5)));
    const cum = cumOf(pts);
    const total = cum[cum.length - 1];
    const ground = pts.map(p => t.heightAt(p.x, p.z));
    // heights: follow the ground, smoothed, pinned at the ends (and at level crossings), within the grade limit
    const heights = (extra) => {
      // over navigable water keep ~9 m clearance so ships can pass under the bridge
      const ys = ground.map(h => h < -1 ? 9 : Math.max(h, 2.5));
      let G = LIM, need = 0; // (the grade the passes below keep to; with a chosen limit, the least these pins allow if steeper)
      const pinned = (i) => cum[i] <= ia.pinR ? ia.y : (ib && total - cum[i] <= ib.pinR ? ib.y : (extra ? extra.get(i) ?? null : null));
      for (let i = 0; i < ys.length; i++) { const p = pinned(i); if (p !== null) ys[i] = p; }
      // (the hot loop of planning: the pins are looked up once, and away from the ends the window needs no clamping;
      // the sums are added in the same order as before, so the heights are exactly the same)
      const n = ys.length, tmp = new Array(n), pinV = new Array(n);
      for (let i = 0; i < n; i++) pinV[i] = pinned(i);
      for (let pass = 0; pass < 30; pass++) {
        for (let i = 0; i < n; i++) {
          const p = pinV[i]; if (p !== null) { tmp[i] = p; continue; }
          let s = 0;
          if (i >= 5 && i < n - 5) for (let k = i - 5; k <= i + 5; k++) s += ys[k];
          else for (let k = -5; k <= 5; k++) s += ys[clamp(i + k, 0, n - 1)];
          tmp[i] = s / 11;
        }
        for (let i = 0; i < n; i++) ys[i] = tmp[i];
      }
      // a flatter limit than the default: keep every point within reach of the pinned heights (the ends, crossings)
      // at that grade, so the line climbs evenly instead of saving the climb for one step next to a station.
      // (Only then: lines at the default limit are planned exactly as before — saves, replays and the AI rely on it.)
      if (LIM < MAX_GRADE) {
        const pins = []; for (let i = 0; i < ys.length; i++) { const p = pinned(i); if (p !== null && (pinned(i - 1) === null || pinned(i + 1) === null || i === 0 || i === ys.length - 1)) pins.push([cum[i], p]); }
        // (pinned heights too far apart for the limit: climb evenly at the least grade that joins them)
        let L = LIM; for (const [c1, y1] of pins) for (const [c2, y2] of pins) if (c2 > c1 + 1) L = Math.max(L, Math.abs(y2 - y1) / (c2 - c1) * 1.001);
        if (L > LIM) need = Math.max(need, L);
        G = L;
        for (let i = 0; i < ys.length; i++) {
          if (pinned(i) !== null) continue;
          let lo = -Infinity, hi = Infinity;
          for (const [c, y] of pins) { const r = L * Math.abs(cum[i] - c); lo = Math.max(lo, y - r); hi = Math.min(hi, y + r); }
          ys[i] = clamp(ys[i], lo, hi);
        }
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < ys.length; i++) { const ds = cum[i] - cum[i - 1]; if (pinned(i) === null) ys[i] = clamp(ys[i], ys[i - 1] - G * ds, ys[i - 1] + G * ds); }
        for (let i = ys.length - 2; i >= 0; i--) { const ds = cum[i + 1] - cum[i]; if (pinned(i) === null) ys[i] = clamp(ys[i], ys[i + 1] - G * ds, ys[i + 1] + G * ds); }
      }
      ys.need = need;
      return ys;
    };
    let ys = heights(null), bad = null;
    // crossings with other track (not in games from before crossings existed)
    const X = this.legacy ? null : this.classify(pts, cum, ys, ia, ib, A, B, double);
    if (X) bad = X.bad;
    if (X && X.pins.size) {
      // meet the other tracks' height at level crossings, where the grade limit allows
      const lv = heights(X.pins);
      let ok = true; for (let i = 1; i < lv.length && ok; i++) ok = Math.abs(lv[i] - lv[i - 1]) <= (LIM + gradeTol(LIM)) * Math.max(0.01, cum[i] - cum[i - 1]);
      if (ok) ys = lv;
      else for (const x of X.list) if (x.mode === 'level') {
        // not levelled: a small mismatch still makes a diamond; well above the other track it bridges over; else no
        const y = ys[x.i] + (ys[x.i + 1] - ys[x.i]) * x.t;
        if (y - x.yo >= XING.minClear) { x.mode = 'over'; for (let i = 0; i < pts.length; i++) if (Math.abs(cum[i] - x.s) < 14) X.forced.add(i); }
        else if (Math.abs(y - x.yo) >= XING.minClear - 3) X.bad ||= 'Cannot meet the other track’s level within the grade limit — cross higher or lower';
      }
      bad = X.bad;
    }
    let bridgeLen = 0, earth = 0, maxGrade = 0, cutLen = 0;
    const bridge = [], cut = [];
    for (let i = 0; i < pts.length; i++) {
      pts[i].y = ys[i];
      const ds = i ? cum[i] - cum[i - 1] : 0;
      const isBridge = ground[i] < 0.8 || ys[i] - ground[i] > 7 || (X ? X.forced.has(i) : false);
      bridge.push(isBridge);
      const isCut = !isBridge && ground[i] - ys[i] > 4; cut.push(isCut); if (isCut) cutLen += ds;
      if (isBridge) bridgeLen += ds; else earth += Math.abs(ys[i] - ground[i]) * ds;
      if (i) maxGrade = Math.max(maxGrade, Math.abs(ys[i] - ys[i - 1]) / Math.max(0.01, ds));
      if (!t.inBounds(pts[i].x, pts[i].z, 15)) bad = 'Track leaves the map';
    }
    if (X && !bad) bad = this.checkClearance(X, pts, bridge);
    const need = ys.need || 0;
    if (maxGrade > LIM + gradeTol(LIM)) bad = LIM < MAX_GRADE ? (need > LIM ? `The ends are too far apart in height for ${+(LIM * 100).toFixed(1)}%: this line needs at least ${(need * 100).toFixed(1)}% — allow a steeper grade (+) or route it longer` : `Can’t keep to ${+(LIM * 100).toFixed(1)}% here (${(maxGrade * 100).toFixed(1)}%) — allow a steeper grade (+) or add waypoints`) : `Too steep (${(maxGrade * 100).toFixed(0)}% grade, max ${MAX_GRADE * 100}%) — add waypoints for a longer route`;
    if (A.type === 'jc' && A.bad) bad = A.bad;
    if (B && B.type === 'jc' && B.bad) bad = B.bad;
    if (B && B === A) bad = 'Pick a different station';
    if (B && A.type === 'jc' && B.type === 'jc' && A.edge === B.edge) bad = 'Cannot connect a track to itself';
    if (B && A.type === 'station' && B.type === 'station' && this.edges.some(e => (e.a === A && e.b === B) || (e.a === B && e.b === A))) bad = 'Stations already connected';
    for (let i = 2; i < pts.length - 2 && !bad; i++) {
      const a = new Vec3().subVectors(pts[i], pts[i - 2]).setY(0).normalize();
      const b = new Vec3().subVectors(pts[i + 2], pts[i]).setY(0).normalize();
      if (a.dot(b) < 0.55) bad = 'Curve too sharp — add waypoints';
    }
    const k = double ? 1.75 : 1;
    const switches = (A.type === 'jc' ? 1 : 0) + (B && B.type === 'jc' ? 1 : 0);
    const levels = X ? X.list.filter(x => x.mode === 'level') : [];
    const cost = Math.round((total * ECON.trackPerUnit + bridgeLen * ECON.bridgePerUnit + earth * 6) * k + switches * JUNCTION_COST) + levels.length * XING.cost;
    return { pts, cum, total, bridge, bridgeLen, cut, cutLen, ground, limit: LIM, need, cost, maxGrade, bad, a: A, b: B, sideA: ia.side, sideB: ib ? ib.side : 0, double, switches,
      crossings: levels.map(x => ({ owner: x.e.owner, d: x.d, s: x.s })), flyovers: X ? X.list.length - levels.length : 0 };
  }

  // ---------- crossings ----------
  cellsOf(ax, az, bx, bz, m = 0) {
    const out = [];
    for (let cx = Math.floor((Math.min(ax, bx) - m) / CELL); cx <= Math.floor((Math.max(ax, bx) + m) / CELL); cx++)
      for (let cz = Math.floor((Math.min(az, bz) - m) / CELL); cz <= Math.floor((Math.max(az, bz) + m) / CELL); cz++) out.push(cx + ',' + cz);
    return out;
  }
  gridAdd(e) {
    // (one entry per segment, shared by all its cells, so near() can tell repeats apart by identity)
    for (let j = 0; j < e.pts.length - 1; j++) { const x = { e, j }; for (const k of this.cellsOf(e.pts[j].x, e.pts[j].z, e.pts[j + 1].x, e.pts[j + 1].z)) {
      let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(x);
    } }
  }
  gridRemove(e) { for (const [k, c] of this.grid) { const n = c.filter(x => x.e !== e); if (n.length) this.grid.set(k, n); else this.grid.delete(k); } }
  // other tracks' segments near segment i of pts (within m)
  near(a, b, m) {
    const seen = new Set(), out = [];
    for (const k of this.cellsOf(a.x, a.z, b.x, b.z, m)) for (const x of this.grid.get(k) || []) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
    return out;
  }
  // where pts crosses other track: [{ i, s (along pts), e, j, d (along e), yo (e's height there), ang (degrees) }]
  intersections(pts, cum) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      for (const { e, j } of this.near(p, q, 0)) {
        const r = e.pts[j], v = e.pts[j + 1];
        const den = (q.x - p.x) * (v.z - r.z) - (q.z - p.z) * (v.x - r.x);
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((r.x - p.x) * (v.z - r.z) - (r.z - p.z) * (v.x - r.x)) / den, u = ((r.x - p.x) * (q.z - p.z) - (r.z - p.z) * (q.x - p.x)) / den;
        if (tt < 0 || tt >= 1 || u < 0 || u >= 1) continue;
        const la = Math.hypot(q.x - p.x, q.z - p.z), lb = Math.hypot(v.x - r.x, v.z - r.z);
        const cos = Math.abs((q.x - p.x) * (v.x - r.x) + (q.z - p.z) * (v.z - r.z)) / Math.max(1e-9, la * lb);
        out.push({ i, t: tt, s: cum[i] + (cum[i + 1] - cum[i]) * tt, e, j, d: e.cum[j] + (e.cum[j + 1] - e.cum[j]) * u, yo: r.y + (v.y - r.y) * u,
          ang: Math.acos(Math.min(1, cos)) * 180 / Math.PI });
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }
  // the crossings of a planned track: level (diamond, pinned to the other track's height), over (bridge) or under
  classify(pts, cum, ys, ia, ib, A, B, double) {
    const total = cum[cum.length - 1];
    const zone = (g) => (s) => s < ia.pinR + g || (ib && total - s < ib.pinR + g);
    const inZone = zone(XING.endGap), runIn = zone(XING.runIn), nearEnd = zone(SWITCH_LEN + XING.connect);
    // tracks this one connects to (they meet at the station or junction, they don't cross)
    const incident = (e) => [A, B].some(n => n && (n.type === 'jc' ? n.edge === e : (e.a === n || e.b === n)));
    const out = { bad: null, pins: new Map(), forced: new Set(), list: [] };
    const fail = (m) => { if (!out.bad) out.bad = m; };
    // a track never crosses itself (segments are put in a coarse grid, so only nearby pairs are tested: it was every pair)
    const SC = 16, sgrid = new Map(), cellsOf = (i, f) => {
      const p = pts[i], q = pts[i + 1];
      const x0 = Math.floor(Math.min(p.x, q.x) / SC), x1 = Math.floor(Math.max(p.x, q.x) / SC), z0 = Math.floor(Math.min(p.z, q.z) / SC), z1 = Math.floor(Math.max(p.z, q.z) / SC);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) f(x * 100003 + z);
    };
    for (let j = 0; j < pts.length - 1; j++) cellsOf(j, (k) => { const c = sgrid.get(k); if (c) c.push(j); else sgrid.set(k, [j]); });
    const seenAt = new Int32Array(pts.length).fill(-1), cand = [];
    for (let i = 0; i < pts.length - 1 && !out.bad; i++) {
      cand.length = 0;
      cellsOf(i, (k) => { for (const j of sgrid.get(k)) if (j >= i + 2 && seenAt[j] !== i) { seenAt[j] = i; cand.push(j); } });
      for (const j of cand) {
      const p = pts[i], q = pts[i + 1], r = pts[j], v = pts[j + 1];
      if (Math.max(r.x, v.x) < Math.min(p.x, q.x) || Math.min(r.x, v.x) > Math.max(p.x, q.x) || Math.max(r.z, v.z) < Math.min(p.z, q.z) || Math.min(r.z, v.z) > Math.max(p.z, q.z)) continue;
      const den = (q.x - p.x) * (v.z - r.z) - (q.z - p.z) * (v.x - r.x); if (Math.abs(den) < 1e-9) continue;
      const tt = ((r.x - p.x) * (v.z - r.z) - (r.z - p.z) * (v.x - r.x)) / den, u = ((r.x - p.x) * (q.z - p.z) - (r.z - p.z) * (q.x - p.x)) / den;
      if (tt > 0 && tt < 1 && u > 0 && u < 1) { fail('The track crosses itself'); break; }
      }
    }
    for (const x of this.intersections(pts, cum)) {
      const e = x.e;
      if (inZone(x.s)) { if (!incident(e)) fail('Crosses another track on a platform or switch'); continue; } // (tracks meeting at a station or junction start together)
      if (runIn(x.s) && incident(e)) continue; // where it runs in alongside the tracks it joins (beyond, crossing them is a normal crossing)
      if (x.d < this.endZone(e.a) || e.length - x.d < this.endZone(e.b)) { fail('Crosses another track on its platform or switch'); continue; }
      if (x.ang < XING.minAngle) { fail('Crosses another track at too shallow an angle — cross more squarely'); continue; }
      const y0 = ys[x.i] + (ys[x.i + 1] - ys[x.i]) * x.t;
      if (y0 - x.yo >= XING.clear) { x.mode = 'over'; for (let i = 0; i < pts.length; i++) if (Math.abs(cum[i] - x.s) < 14) out.forced.add(i); }
      else if (x.yo - y0 >= XING.clear && e.bridge[x.j] && e.bridge[x.j + 1]) x.mode = 'under';
      else {
        x.mode = 'level';
        if (e.signals.some(sg => Math.abs(sg - x.d) < XING.nearSignal)) fail('Crosses another track too close to one of its signals');
        // (two crossings on one spot would each have their own lock: keep level crossings apart)
        const px = pts[x.i].x + (pts[x.i + 1].x - pts[x.i].x) * x.t, pz = pts[x.i].z + (pts[x.i + 1].z - pts[x.i].z) * x.t;
        if (this.diamonds.some(D => Math.hypot(D.x - px, D.z - pz) < XING.apart) || out.list.some(y => y.mode === 'level' && Math.abs(y.s - x.s) < XING.apart)) fail('Too close to another level crossing');
        for (let i = 0; i < pts.length; i++) if (Math.abs(cum[i] - x.s) <= 4) out.pins.set(i, x.yo);
      }
      out.list.push(x);
    }
    // never through a station (other than the ones it connects)
    // (stations away from the line's bounding box are skipped: a point in a station is within 80 m of its centre)
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const p of pts) { if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x; if (p.z < bz0) bz0 = p.z; if (p.z > bz1) bz1 = p.z; }
    for (const st of this.world.stations) {
      if (out.bad) break;
      if (st === A || st === B) continue; // (it was `break`: stations listed after its own ends went unchecked)
      const M = 80 + halfOf(st) - HALF; // (more for a long station)
      if (st.x < bx0 - M || st.x > bx1 + M || st.z < bz0 - M || st.z > bz1 + M) continue;
      if (st.depot) { if (pts.some(p => Math.hypot(p.x - st.x, p.z - st.z) < 16)) fail(`Runs through ${st.name}`); continue; }
      if (Math.abs(st.x - pts[0].x) > total + 200 && Math.abs(st.x - pts[pts.length - 1].x) > total + 200) continue;
      if (pts.some(p => this.inStation(st, p))) fail(`Runs through ${st.name}`);
    }
    // never run along another track (except where it meets it, at the ends, or at a crossing)
    for (let i = 0; i < pts.length && !out.bad; i++) {
      const p = pts[i];
      for (const { e, j } of this.near(p, p, 12)) {
        if (nearEnd(cum[i]) && incident(e)) continue;
        if (out.list.some(x => x.e === e && Math.abs(x.s - cum[i]) < 25)) continue;
        const r = e.pts[j], v = e.pts[j + 1], vx = v.x - r.x, vz = v.z - r.z, l2 = vx * vx + vz * vz || 1;
        const tt = clamp(((p.x - r.x) * vx + (p.z - r.z) * vz) / l2, 0, 1);
        const sep = XING.sep + (double ? DOUBLE_OFF : 0) + (e.double ? DOUBLE_OFF : 0);
        if (Math.hypot(p.x - r.x - vx * tt, p.z - r.z - vz * tt) < sep) { fail('Runs too close alongside another track'); break; }
      }
    }
    return out;
  }
  checkClearance(X, pts, bridge) {
    for (const x of X.list) {
      const y = pts[x.i].y + (pts[x.i + 1].y - pts[x.i].y) * x.t;
      if (x.mode === 'over' && y - x.yo < XING.minClear) return 'Not enough clearance to bridge over the other track';
      if (x.mode === 'under' && x.yo - y < XING.minClear) return 'Not enough clearance to pass under the other track';
    }
    return null;
  }
  // is point p on station st's footprint (platforms, siding and switches)?
  inStation(st, p) {
    const L = halfOf(st) + SWITCH_LEN * 1.6, W = -PLATFORM2 * 2 + 5, dx = p.x - st.x, dz = p.z - st.z;
    const lx = dx * st.axis.x + dz * st.axis.z, lz = -dx * st.axis.z + dz * st.axis.x;
    return Math.abs(lx) < L && lz > -W && lz < 5;
  }
  // would a station here (its platforms, siding and switches) lie on existing track?
  stationClear(x, z, angle, len = ECON.platformLen) {
    if (this.legacy) return true;
    const ca = dcos(angle), sa = dsin(angle), L = len / 2 + SWITCH_LEN * 1.6, W = -PLATFORM2 * 2 + 5;
    for (const { e, j } of this.near({ x: x - L, z: z - L }, { x: x + L, z: z + L }, 0)) for (const p of [e.pts[j], e.pts[j + 1]]) {
      const dx = p.x - x, dz = p.z - z, lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
      if (Math.abs(lx) < L && lz > -W && lz < 5) return false;
    }
    return true;
  }
  // level crossings of a newly built edge become diamonds, interlocked for trains on both lines
  addDiamonds(edge) {
    if (this.legacy) return;
    // (the platform or switch at each end, and branches leaving a shared station or junction: tracks meeting there
    // start together, they don't cross; plans refuse other cases)
    const inZone = (s) => s < this.endZone(edge.a) || edge.length - s < this.endZone(edge.b);
    const at = (e, n) => e.a === n || e.b === n;
    const run = (n) => (n.type === 'station' ? halfOf(n) + 4 : 12) + XING.runIn;
    const meets = (x) => (x.s < run(edge.a) && at(x.e, edge.a)) || (edge.length - x.s < run(edge.b) && at(x.e, edge.b));
    for (const x of this.intersections(edge.pts, edge.cum)) {
      if (x.e === edge || inZone(x.s) || meets(x)) continue;
      const y = edge.pts[x.i].y + (edge.pts[x.i + 1].y - edge.pts[x.i].y) * x.t;
      if (Math.abs(y - x.yo) >= XING.minClear) continue; // a flyover or underpass
      const p = edge.pts[x.i], q = edge.pts[x.i + 1];
      const D = { id: 'X' + this.xSeq++, type: 'diamond', x: p.x + (q.x - p.x) * x.t, y: x.yo, z: p.z + (q.z - p.z) * x.t, lock: null, owners: [edge.owner, x.e.owner] };
      this.attach(D, edge, x.s); this.attach(D, x.e, x.d);
      this.diamonds.push(D);
      this.view?.diamondAdded(D);
    }
  }
  attach(D, e, d) { (e.xings ||= []).push({ d, x: D }); e.xings.sort((a, b) => a.d - b.d); }

  // ---------- construction ----------
  terraform(pts, bridge, width) {
    const minX = Math.min(...pts.map(p => p.x)) - 24, maxX = Math.max(...pts.map(p => p.x)) + 24;
    const minZ = Math.min(...pts.map(p => p.z)) - 24, maxZ = Math.max(...pts.map(p => p.z)) + 24;
    const B = 20, buckets = new Map();
    const key = (x, z) => Math.floor(x / B) + ',' + Math.floor(z / B);
    for (let i = 0; i < pts.length - 1; i++) {
      const cx = (pts[i].x + pts[i + 1].x) / 2, cz = (pts[i].z + pts[i + 1].z) / 2;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = key(cx + dx * B, cz + dz * B);
        if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i);
      }
    }
    const nearest = (x, z) => {
      const list = buckets.get(key(x, z)); if (!list) return null;
      let best = 1e9, bi = -1, bt = 0;
      for (const i of list) {
        const a = pts[i], b = pts[i + 1];
        const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const tt = clamp(((x - a.x) * vx + (z - a.z) * vz) / l2, 0, 1);
        const d = Math.hypot(x - (a.x + vx * tt), z - (a.z + vz * tt));
        if (d < best) { best = d; bi = i; bt = tt; }
      }
      return { d: best, i: bi, y: pts[bi].y + (pts[bi + 1].y - pts[bi].y) * bt };
    };
    const w0 = 5 + width, w1 = 16 + width;
    this.terrain.modify(minX, minZ, maxX, maxZ, (x, z) => {
      const n = nearest(x, z);
      if (!n || n.d > w1) return null;
      if (bridge[n.i] && bridge[n.i + 1]) return null;
      return { h: n.y - 0.4, w: smoothstep(w1, w0, n.d), mark: n.d < w0 + 1.5 ? 1 : 0 };
    });
    this.world.reseatTrees(minX, minZ, maxX, maxZ);
    this.world.clearTrees((x, z) => { const n = nearest(x, z); return n && n.d < 11 + width; });
  }

  makeEdge(o) {
    const cum = cumOf(o.pts);
    const edge = { id: 'E' + this.nextId++, type: 'track', signals: [], ...o, cum, length: cum[cum.length - 1], xings: [] };
    this.edges.push(edge);
    this.gridAdd(edge);
    this.view?.edgeAdded(edge);
    return edge;
  }

  build(plan, nodeA, nodeB, owner) {
    this.terraform(plan.pts, plan.bridge, plan.double ? DOUBLE_OFF : 0);
    const edge = this.makeEdge({ a: nodeA, b: nodeB, owner, sideA: plan.sideA, sideB: plan.sideB, pts: plan.pts, bridge: plan.bridge, double: plan.double, cost: plan.cost, maxGrade: plan.maxGrade });
    this.addDiamonds(edge);
    nodeA.edges.push(edge); nodeB.edges.push(edge);
    return edge;
  }

  // can a single-track line take a second track alongside? (the planner's "too close alongside" rule, for the double
  // width, away from its ends, where tracks meet, and from its crossings)
  canDouble(edge) {
    if (edge.double) return 'Already double track';
    const pts = edge.pts, cum = edge.cum, total = edge.length;
    const endG = (n) => (n.type === 'station' ? halfOf(n) : 0) + SWITCH_LEN + 12;
    const incident = (e) => [edge.a, edge.b].some(n => e.a === n || e.b === n);
    const X = this.intersections(pts, cum).filter(x => x.e !== edge); // (where other tracks cross it, level or not)
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] < endG(edge.a) || total - cum[i] < endG(edge.b)) continue;
      if ((edge.xings || []).some(x => Math.abs(x.d - cum[i]) < 25)) continue;
      const p = pts[i];
      for (const { e, j } of this.near(p, p, 14)) {
        if (e === edge || (incident(e) && (cum[i] < endG(edge.a) + 30 || total - cum[i] < endG(edge.b) + 30))) continue;
        if (X.some(x => x.e === e && Math.abs(x.s - cum[i]) < 25)) continue;
        const r = e.pts[j], v = e.pts[j + 1], vx = v.x - r.x, vz = v.z - r.z, l2 = vx * vx + vz * vz || 1;
        const tt = clamp(((p.x - r.x) * vx + (p.z - r.z) * vz) / l2, 0, 1);
        if (Math.hypot(p.x - r.x - vx * tt, p.z - r.z - vz * tt) < XING.sep + DOUBLE_OFF + (e.double ? DOUBLE_OFF : 0)) return 'Another track runs too close alongside for a second track';
      }
      for (const st of this.world.stations) if (st !== edge.a && st !== edge.b && Math.hypot(st.x - p.x, st.z - p.z) < 120 + halfOf(st) - HALF && this.inStation(st, p)) return `It runs too close to ${st.name}`;
    }
    return null;
  }
  // make a line double track (Game.doubleTrack has checked it may)
  makeDouble(edge) {
    edge.double = true;
    this.terraform(edge.pts, edge.bridge, DOUBLE_OFF);
    this.view?.edgeRemoved(edge); this.view?.edgeAdded(edge);
  }

  // Split an edge at a junction candidate; returns the new junction node
  split(cand) {
    // re-find (edges may have changed since planning)
    const nt = this.nearestTrack(cand.p, 3, cand.owner || (cand.edge && cand.edge.owner) || null);
    if (!nt) return null;
    const E = nt.edge, i = nt.i, d = E.cum[i];
    const J = { id: 'J' + this.jSeq++, type: 'junction', owner: E.owner, name: 'Junction', x: E.pts[i].x, y: E.pts[i].y, z: E.pts[i].z, t: tangentAt(E.pts, i), edges: [], lock: null };
    const frac = d / E.length;
    const E1 = this.makeEdge({ a: E.a, b: J, sideA: E.sideA, sideB: -1, pts: E.pts.slice(0, i + 1).map(p => p.clone()), bridge: E.bridge.slice(0, i + 1), double: E.double, cost: Math.round(E.cost * frac), maxGrade: E.maxGrade, signals: E.signals.filter(s => s < d - 15) });
    const E2 = this.makeEdge({ a: J, b: E.b, sideA: 1, sideB: E.sideB, pts: E.pts.slice(i).map(p => p.clone()), bridge: E.bridge.slice(i), double: E.double, cost: E.cost - Math.round(E.cost * frac), maxGrade: E.maxGrade, signals: E.signals.filter(s => s > d + 15).map(s => s - d) });
    for (const { d: xd, x: D } of E.xings) { if (xd < d) this.attach(D, E1, xd); else this.attach(D, E2, xd - d); }
    E.xings = [];
    this.disposeEdge(E);
    E.a.edges = E.a.edges.map(x => x === E ? E1 : x);
    E.b.edges = E.b.edges.map(x => x === E ? E2 : x);
    J.edges.push(E1, E2);
    this.junctions.push(J);
    if (this.onSplit) this.onSplit(E, E1, E2);
    return J;
  }

  disposeEdge(edge) {
    this.view?.edgeRemoved(edge);
    this.gridRemove(edge);
    this.edges = this.edges.filter(e => e !== edge);
    // its level crossings go too (returns the other tracks that lost one)
    const others = [];
    for (const { x: D } of edge.xings || []) {
      this.diamonds = this.diamonds.filter(y => y !== D);
      for (const e of this.edges) if (e.xings?.some(y => y.x === D)) { e.xings = e.xings.filter(y => y.x !== D); others.push(e); }
      this.view?.diamondRemoved(D);
    }
    return others;
  }
  // station tracks (main + second platform + passing siding) are drawn by the view
  stationTrack(st) { this.view?.stationTrack(st); }
  stationRemoved(st) { this.view?.stationRemoved(st); }

  // ---------- signals ----------
  addSignal(edge, d) {
    edge.signals.push(d); edge.signals.sort((a, b) => a - b);
    this.view?.signalsChanged(edge);
  }
  removeSignal(edge, d) {
    edge.signals = edge.signals.filter(s => Math.abs(s - d) > 0.01);
    this.view?.signalsChanged(edge);
  }
  signalSpotOk(edge, d) {
    if (d < this.endFree(edge.a) + 60 || edge.length - d < this.endFree(edge.b) + 60) return 'Too close to a station or junction';
    if (edge.signals.some(s => Math.abs(s - d) < 40)) return 'Too close to another signal';
    if ((edge.xings || []).some(x => Math.abs(x.d - d) < XING.nearSignal)) return 'Too close to a level crossing';
    if (edge.bridge[this.edgeIndexAt(edge, d)]) return 'Cannot place on a bridge';
    return null;
  }
  remove(edge) {
    const others = this.disposeEdge(edge);
    edge.a.edges = edge.a.edges.filter(e => e !== edge);
    edge.b.edges = edge.b.edges.filter(e => e !== edge);
    return others;
  }

  // ---------- routing ----------
  // Dijkstra over (node, side of arrival). Trains may not reverse at junctions;
  // reversing at a station they only pass through is allowed but heavily penalised.
  // rule (optional): { use(edge): may the train run on it, through(node): may it pass through, cost(edge) }
  route(from, to, rule = null) {
    if (from === to) return [];
    const key = (n, s) => n.id + '|' + s;
    const dist = new Map([[key(from, 0), 0]]), prev = new Map(), nodes = new Map([[key(from, 0), [from, 0]]]);
    const open = new Set([key(from, 0)]);
    let goal = null;
    while (open.size) {
      let k = null, best = Infinity;
      for (const s of open) if (dist.get(s) < best) { best = dist.get(s); k = s; }
      open.delete(k);
      const [u, arr] = nodes.get(k);
      if (u === to) { goal = k; break; }
      if (rule && u !== from && !rule.through(u)) continue; // (another company's station: trains don't pass through)
      for (const e of u.edges) {
        if (rule && !rule.use(e)) continue;
        const exitSide = e.a === u ? e.sideA : e.sideB;
        let cost = rule ? rule.cost(e) : e.length;
        if (u.type === 'junction') { if (arr === 0 || exitSide !== -arr) continue; }
        else if (u !== from && arr !== 0 && exitSide === arr) cost += 3000;
        const v = e.a === u ? e.b : e.a, arrV = e.a === u ? e.sideB : e.sideA;
        const kv = key(v, arrV), nd = best + cost;
        if (nd < (dist.get(kv) ?? Infinity)) { dist.set(kv, nd); prev.set(kv, { e, k, forward: e.a === u }); nodes.set(kv, [v, arrV]); open.add(kv); }
      }
    }
    if (!goal) return null;
    const legs = []; let cur = goal;
    while (prev.has(cur)) { const p = prev.get(cur); legs.unshift({ edge: p.e, forward: p.forward }); cur = p.k; }
    return legs;
  }
  routePath(legs) {
    const out = [];
    for (const { edge, forward } of legs) {
      const p = forward ? edge.pts : [...edge.pts].reverse();
      for (let i = out.length ? 1 : 0; i < p.length; i++) out.push(p[i]);
    }
    return out;
  }
}
