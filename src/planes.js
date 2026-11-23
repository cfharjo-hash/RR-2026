// Aviation: airfield siting and flight paths (pure; the models are in view/craftModels.js).
import { sin as dsin, cos as dcos } from './dmath.js';
import { clamp, lerp } from './util.js';
import { Vec3, CatmullRom } from './math.js';
import { ECON } from './data.js';

const segDist = (px, pz, a) => {
  // distance from a point to the runway centre line of airfield/candidate a
  const ux = px - a.x, uz = pz - a.z;
  const along = clamp(ux * a.dx + uz * a.dz, -a.len / 2, a.len / 2);
  return Math.hypot(ux - a.dx * along, uz - a.dz * along);
};

// Find a flat, clear runway site near a station (deterministic for save replay)
export function findAirportSite(world, net, st) {
  const t = world.terrain, L = ECON.runwayLen;
  let best = null;
  for (let r = 110; r <= ECON.airportReach; r += 30) for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, cx = st.x + dcos(a) * r, cz = st.z + dsin(a) * r;
    for (let o = 0; o < 6; o++) {
      const ang = o / 6 * Math.PI, dx = dcos(ang), dz = dsin(ang);
      const cand = { x: cx, z: cz, dx, dz, len: L };
      let mn = 1e9, mx = -1e9, ok = true, sum = 0, n = 0;
      for (let u = -L / 2 - 20; u <= L / 2 + 20 && ok; u += 20) for (const v of [-24, 0, 24]) {
        const x = cx + dx * u - dz * v, z = cz + dz * u + dx * v;
        if (!t.inBounds(x, z, 40)) { ok = false; break; }
        const h = t.heightAt(x, z);
        if (h < 2.5) { ok = false; break; }
        mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++;
      }
      if (!ok || mx - mn > 16) continue;
      if (segDist(st.x, st.z, cand) < 55) continue;
      if (world.towns.some(tw => segDist(tw.x, tw.z, cand) < 70 + (tw.radius || 60) * 0.8)) continue;
      if (world.industries.some(i => segDist(i.x, i.z, cand) < 85)) continue;
      if (world.stations.some(s => s !== st && segDist(s.x, s.z, cand) < 75)) continue;
      if (world.stations.some(s => s.airport && Math.hypot(s.airport.x - cx, s.airport.z - cz) < 500)) continue;
      let clash = false;
      for (const e of net.edges) { for (let i = 0; i < e.pts.length; i += 3) if (segDist(e.pts[i].x, e.pts[i].z, cand) < 32) { clash = true; break; } if (clash) break; }
      if (clash) continue;
      const score = (mx - mn) + r * 0.03;
      if (!best || score < best.score) best = { ...cand, y: sum / n, score };
    }
  }
  return best;
}

// Flight path from airfield A to airfield B, starting from where the plane is parked on A's runway.
// Returns points with markers for the ground phases (taxi + take-off roll, landing roll-out).
export function flightPath(terrain, A, B, park, gear = 1.6) {
  const L = A.len, V = (x, y, z) => new Vec3(x, y, z);
  const sa = Math.sign(A.dx * (B.x - A.x) + A.dz * (B.z - A.z)) || 1, da = { x: A.dx * sa, z: A.dz * sa };
  const sb = Math.sign(B.dx * (A.x - B.x) + B.dz * (A.z - B.z)) || 1, db = { x: -B.dx * sb, z: -B.dz * sb };
  const ga = A.y + gear, gb = B.y + gear;
  const thr = { x: A.x - da.x * L / 2 + da.x * 6, z: A.z - da.z * L / 2 + da.z * 6 };
  const lift = { x: A.x + da.x * L * 0.2, z: A.z + da.z * L * 0.2 };
  const td = { x: B.x - db.x * L * 0.38, z: B.z - db.z * L * 0.38 };
  const stop = { x: B.x + db.x * L * 0.3, z: B.z + db.z * L * 0.3 };
  let hmax = 0; for (let k = 0; k <= 50; k++) hmax = Math.max(hmax, terrain.heightAt(lerp(A.x, B.x, k / 50), lerp(A.z, B.z, k / 50)));
  const cruise = Math.max(150, hmax + 80);
  const pts = [];
  const line = (p, q, y0, y1, step) => { const d = Math.hypot(q.x - p.x, q.z - p.z), n = Math.max(1, Math.ceil(d / step)); for (let k = pts.length ? 1 : 0; k <= n; k++) pts.push(V(lerp(p.x, q.x, k / n), lerp(y0, y1, k / n), lerp(p.z, q.z, k / n))); };
  const p0 = park || { x: A.x, z: A.z };
  line(p0, thr, ga, ga, 4);                    // taxi to the threshold
  const groundEnd0 = pts.length;
  line(thr, lift, ga, ga, 4);                  // take-off roll
  const sAirIdx = pts.length - 1;
  const air = [V(lift.x, ga, lift.z), V(lift.x + da.x * 90, ga + 18, lift.z + da.z * 90), V(lift.x + da.x * 320, ga + 75, lift.z + da.z * 320)];
  const app = V(td.x - db.x * 420, gb + 60, td.z - db.z * 420);
  const c1 = air[2], c2 = app;
  air.push(V(lerp(c1.x, c2.x, 0.33), cruise, lerp(c1.z, c2.z, 0.33)), V(lerp(c1.x, c2.x, 0.66), cruise, lerp(c1.z, c2.z, 0.66)));
  air.push(app, V(td.x - db.x * 120, gb + 14, td.z - db.z * 120), V(td.x, gb, td.z));
  const curve = new CatmullRom(air);
  const ap = curve.getSpacedPoints(Math.max(20, Math.ceil(curve.getLength() / 8)));
  // terrain clearance: stay ~35 m above the ground once clear of the runways (hills near airfields)
  for (const q of ap) {
    const dA = Math.hypot(q.x - lift.x, q.z - lift.z), dB = Math.hypot(q.x - td.x, q.z - td.z);
    const margin = 35 * Math.min(1, Math.min(dA, dB) / 260);
    const ground = Math.max(0, terrain.heightAt(q.x, q.z));
    if (q.y < ground + margin) q.y = ground + margin;
  }
  for (let pass = 0; pass < 3; pass++) for (let k = 1; k < ap.length - 1; k++) {
    const dB = Math.hypot(ap[k].x - td.x, ap[k].z - td.z); if (dB < 160) continue; // keep the final approach exact
    const sm = (ap[k - 1].y + ap[k].y * 2 + ap[k + 1].y) / 4; if (sm > ap[k].y) ap[k].y = sm;
  }
  for (let k = 1; k < ap.length; k++) pts.push(ap[k]);
  const sLandIdx = pts.length - 1;
  line(td, stop, gb, gb, 4);                   // roll-out
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
  return { pts, cum, length: cum[cum.length - 1], sTaxi: cum[Math.max(0, groundEnd0 - 1)], sAir: cum[sAirIdx], sLand: cum[sLandIdx], park: stop, cruise };
}
