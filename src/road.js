// The road network (pure; drawn by view/roadView.js). Roads are public: any company's road vehicles may use any
// road. Roads join stations (a rail station's road forecourt, or a road depot) and each other at road junctions.
// No signals or reservations: road vehicles pass each other. Saves rebuild roads from the construction history.
import { ECON } from './data.js';
import { clamp, smoothstep } from './util.js';
import { Vec3, CatmullRom } from './math.js';

const R = () => ECON.road;
const FORECOURT = 16; // a rail station's road access: this far out on the side away from its platforms
const cumOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1])); return c; };

export class RoadNetwork {
  constructor(terrain, world, net) {
    this.terrain = terrain; this.world = world; this.net = net; this.view = null;
    this.edges = []; this.junctions = []; this.seq = 1; this.jSeq = 1;
  }

  // where a road meets a node: a depot's yard, a rail station's forecourt, a road junction
  point(n) {
    if (n.type === 'rjunction') return new Vec3(n.x, n.y, n.z);
    if (n.depot) return new Vec3(n.x, n.y, n.z);
    return new Vec3(n.x - n.axis.z * FORECOURT, n.y, n.z + n.axis.x * FORECOURT);
  }
  // the nearest point on any road (a junction candidate), or null
  nearestRoad(p, maxD = 8) {
    if (!p) return null;
    let best = null, bd = maxD;
    for (const e of this.edges) for (let i = 1; i < e.pts.length - 1; i++) {
      const q = e.pts[i], d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = { e, i }; }
    }
    if (!best) return null;
    const { e, i } = best;
    const end = Math.min(e.cum[i], e.length - e.cum[i]);
    return { type: 'rjc', edge: e, i, p: e.pts[i].clone(), bad: end < 12 ? 'Too close to the end of the road' : e.bridge[i] ? 'Cannot join a road on a bridge' : null };
  }

  // ---------- planning ----------
  plan(A, waypoints, B) {
    const t = this.terrain, G = R().maxGrade;
    const pa = A.type === 'rjc' ? A.p.clone() : this.point(A);
    const pb = B ? (B.type === 'rjc' ? B.p.clone() : this.point(B)) : null;
    const ctrl = [new Vec3(pa.x, 0, pa.z), ...waypoints.map(w => new Vec3(w.x, 0, w.z))];
    if (pb) ctrl.push(new Vec3(pb.x, 0, pb.z));
    const cp = [ctrl[0]];
    for (let i = 1; i < ctrl.length; i++) if (ctrl[i].distanceTo(cp[cp.length - 1]) > 3) cp.push(ctrl[i]);
    if (cp.length < 2) return null;
    const curve = new CatmullRom(cp);
    const pts = curve.getSpacedPoints(Math.max(3, Math.ceil(curve.getLength() / 3)));
    const cum = cumOf(pts), total = cum[cum.length - 1];
    const ground = pts.map(p => t.heightAt(p.x, p.z));
    // over the river keep ~9 m clearance so ships pass under the bridge
    const ys = ground.map(h => h < -1 ? 9 : Math.max(h, 1.5));
    const pin = (i) => i === 0 ? pa.y : (pb && i === pts.length - 1 ? pb.y : null);
    const tmp = new Array(ys.length);
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < ys.length; i++) {
        const p = pin(i); if (p !== null) { tmp[i] = p; continue; }
        let s = 0, c = 0; for (let k = -3; k <= 3; k++) { s += ys[clamp(i + k, 0, ys.length - 1)]; c++; }
        tmp[i] = s / c;
      }
      for (let i = 0; i < ys.length; i++) ys[i] = tmp[i];
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < ys.length; i++) { const ds = cum[i] - cum[i - 1]; if (pin(i) === null) ys[i] = clamp(ys[i], ys[i - 1] - G * ds, ys[i - 1] + G * ds); }
      for (let i = ys.length - 2; i >= 0; i--) { const ds = cum[i + 1] - cum[i]; if (pin(i) === null) ys[i] = clamp(ys[i], ys[i + 1] - G * ds, ys[i + 1] + G * ds); }
    }
    let bad = null, bridgeLen = 0, maxGrade = 0;
    const bridge = [];
    for (let i = 0; i < pts.length; i++) {
      pts[i].y = ys[i];
      const ds = i ? cum[i] - cum[i - 1] : 0, b = ground[i] < 0.8 || ys[i] - ground[i] > 5;
      bridge.push(b); if (b) bridgeLen += ds;
      if (i) maxGrade = Math.max(maxGrade, Math.abs(ys[i] - ys[i - 1]) / Math.max(0.01, ds));
      if (!t.inBounds(pts[i].x, pts[i].z, 15)) bad = 'The road leaves the map';
    }
    if (maxGrade > G + 0.01) bad ||= `Too steep (${(maxGrade * 100).toFixed(0)}% grade, max ${G * 100}%) — add waypoints`;
    if (B && B === A) bad ||= 'Pick a different stop';
    if (B && A.type === 'rjc' && B.type === 'rjc' && A.edge === B.edge) bad ||= 'Cannot join a road to itself';
    if (B && A.type === 'station' && B.type === 'station' && this.edges.some(e => (e.a === A && e.b === B) || (e.a === B && e.b === A))) bad ||= 'Already joined by a road';
    // not through stations (other than the ones it joins)
    for (const st of this.world.stations) if (!bad && st !== A && st !== B && !st.depot && pts.some(p => this.net.inStation(st, p))) bad = `Runs through ${st.name}`;
    const joins = (A.type === 'rjc' ? 1 : 0) + (B && B.type === 'rjc' ? 1 : 0);
    const cost = Math.round(total * R().perUnit + bridgeLen * R().bridgePerUnit) + joins * 2000;
    return { pts, cum, total, bridge, bridgeLen, cost, maxGrade, bad, a: A, b: B };
  }

  // ---------- construction ----------
  build(plan, A, B, owner) {
    const t = this.terrain, pts = plan.pts;
    // a narrow level road bed, sloping into the ground on both sides (not under bridges)
    const minX = Math.min(...pts.map(p => p.x)) - 14, maxX = Math.max(...pts.map(p => p.x)) + 14;
    const minZ = Math.min(...pts.map(p => p.z)) - 14, maxZ = Math.max(...pts.map(p => p.z)) + 14;
    t.modify(minX, minZ, maxX, maxZ, (x, z) => {
      let best = 1e9, bi = -1, bt = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        if (Math.abs(a.x - x) > 20 && Math.abs(b.x - x) > 20) continue;
        const tt = clamp(((x - a.x) * vx + (z - a.z) * vz) / l2, 0, 1), d = Math.hypot(x - (a.x + vx * tt), z - (a.z + vz * tt));
        if (d < best) { best = d; bi = i; bt = tt; }
      }
      if (bi < 0 || best > 12 || (plan.bridge[bi] && plan.bridge[bi + 1])) return null;
      return { h: pts[bi].y + (pts[bi + 1].y - pts[bi].y) * bt - 0.25, w: smoothstep(12, 4, best), mark: best < 4.5 ? 1 : 0 };
    });
    this.world.reseatTrees(minX, minZ, maxX, maxZ);
    this.world.clearTrees((x, z) => { for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i].x - x, pts[i].z - z) < 8) return true; return false; });
    const e = this.makeEdge({ a: A, b: B, owner, pts, bridge: plan.bridge, cost: plan.cost });
    this.view?.roadAdded(e);
    return e;
  }
  makeEdge(o) {
    const cum = cumOf(o.pts);
    const e = { id: 'R' + this.seq++, type: 'road', ...o, cum, length: cum[cum.length - 1] };
    this.edges.push(e);
    for (const n of [o.a, o.b]) (n.redges ||= []).push(e);
    return e;
  }
  // a road junction on a road (splits it in two)
  split(cand) {
    const nr = this.nearestRoad(cand.p, 3);
    if (!nr) return null;
    const E = nr.edge, i = nr.i;
    const J = { id: 'RJ' + this.jSeq++, type: 'rjunction', name: 'Road junction', x: E.pts[i].x, y: E.pts[i].y, z: E.pts[i].z, redges: [] };
    const frac = E.cum[i] / E.length;
    this.unlink(E);
    const E1 = this.makeEdge({ a: E.a, b: J, owner: E.owner, pts: E.pts.slice(0, i + 1).map(p => p.clone()), bridge: E.bridge.slice(0, i + 1), cost: Math.round(E.cost * frac) });
    const E2 = this.makeEdge({ a: J, b: E.b, owner: E.owner, pts: E.pts.slice(i).map(p => p.clone()), bridge: E.bridge.slice(i), cost: E.cost - Math.round(E.cost * frac) });
    this.view?.roadRemoved(E); this.view?.roadAdded(E1); this.view?.roadAdded(E2);
    this.junctions.push(J);
    this.onSplit?.(E, E1, E2);
    return J;
  }
  unlink(e) {
    this.edges = this.edges.filter(x => x !== e);
    for (const n of [e.a, e.b]) n.redges = (n.redges || []).filter(x => x !== e);
  }
  remove(e) { this.unlink(e); this.view?.roadRemoved(e); }

  // ---------- routing ----------
  // shortest road route between two nodes: [{ edge, forward }], or null
  route(from, to) {
    if (from === to) return [];
    const dist = new Map([[from, 0]]), prev = new Map(), open = new Set([from]);
    while (open.size) {
      let u = null, best = Infinity;
      for (const n of open) if (dist.get(n) < best) { best = dist.get(n); u = n; }
      open.delete(u);
      if (u === to) break;
      for (const e of u.redges || []) {
        const v = e.a === u ? e.b : e.a, nd = best + e.length;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { e, u, forward: e.a === u }); open.add(v); }
      }
    }
    if (!prev.has(to)) return null;
    const legs = []; let cur = to;
    while (cur !== from) { const p = prev.get(cur); legs.unshift({ edge: p.e, forward: p.forward }); cur = p.u; }
    return legs;
  }
  // a drivable path: { pts, cum, length, legs } (the road's centre line; vehicles keep to the right in the view)
  path(from, to) {
    const legs = this.route(from, to);
    if (!legs || !legs.length) return null;
    return this.pathOf(legs);
  }
  // the path along given roads (a saved route is rebuilt from its roads, not routed again)
  pathOf(legs) {
    const pts = [];
    for (const { edge, forward } of legs) {
      const p = forward ? edge.pts : [...edge.pts].reverse();
      for (let i = pts.length ? 1 : 0; i < p.length; i++) pts.push(p[i]);
    }
    const cum = cumOf(pts);
    return { pts, cum, length: cum[cum.length - 1], legs };
  }
  // does station st have road access?
  served(st) { return !!st.redges?.length; }
}
