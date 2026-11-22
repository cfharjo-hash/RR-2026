// Draws the track network: ballast, rails and sleepers, bridges, station tracks, signals (with live lights from
// the block reservations) and the green/red preview line while planning. TrackNetwork calls the hooks below.
import * as THREE from 'three';
import { smoothstep, mulberry32 } from '../util.js';
import { PartBuilder, canvasTexture } from './gfx.js';
import { DOUBLE_OFF, PLATFORM2, SWITCH_LEN, HALF, tangentAt } from '../track.js';

const ballastTex = canvasTexture(128, (g, s) => {
  const r = mulberry32(9);
  g.fillStyle = '#7d756a'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 2500; k++) { const v = 80 + r() * 90; g.fillStyle = `rgb(${v},${v - 6},${v - 14})`; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
});
const ballastMat = new THREE.MeshStandardMaterial({ map: ballastTex, roughness: 1 });
const railMat = new THREE.MeshStandardMaterial({ color: '#8d8a86', metalness: 0.85, roughness: 0.35 });
const sleeperMat = new THREE.MeshStandardMaterial({ color: '#4a3b2e', roughness: 0.95 });
const bridgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 });
const sleeperGeo = new THREE.BoxGeometry(2.5, 0.16, 0.38);
const signalPostGeo = (() => {
  const b = new PartBuilder();
  b.cyl(0.14, 0.18, 5.6, '#2b2b2b', 0, 2.8, 0, 8).box(0.7, 1.6, 0.5, '#151515', 0, 5.0, 0).box(0.9, 0.12, 0.7, '#151515', 0, 6.6, 0);
  return b.build();
})();
const signalPostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
const lightGeo = new THREE.SphereGeometry(0.26, 10, 8);
const diamondGeo = new THREE.BoxGeometry(7.5, 0.12, 7.5), diamondMat = new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 0.9 });
// the planning preview: a ribbon coloured along its length by grade (green on the flat, yellow, orange near the
// limit, red beyond), so you see where a route is too steep; the tooltip says why a plan is refused
const previewMatGrade = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
export function gradeLine(pts, max, refused = false) {
  const pos = [], col = [], idx = [], c = new THREE.Color();
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1, gr = Math.abs(b.y - a.y) / run / max; // share of the limit
    c.setHSL(gr > 1.02 ? 0 : 0.33 - 0.25 * Math.min(1, gr) ** 1.5, 0.95, 0.52); // green → yellow → orange at the limit; red beyond
    const tx = (b.x - a.x) / run, tz = (b.z - a.z) / run;
    for (const s of [-2, 2]) { pos.push(p.x - tz * s, p.y + 1.4, p.z + tx * s); col.push(c.r, c.g, c.b); }
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}
export function gradePreview(pts, max, refused) { const m = new THREE.Mesh(gradeLine(pts, max, refused), previewMatGrade); m.renderOrder = 10; return m; }
export const LIGHT_RED = new THREE.Color('#ff2a1a'), LIGHT_GREEN = new THREE.Color('#38ff6a');

function ribbon(pts, profile, i0 = 0, i1 = pts.length - 1, uvScale = 0.25) {
  const pos = [], uv = [], idx = [];
  const n = i1 - i0 + 1, m = profile.length;
  const t = new THREE.Vector3(), side = new THREE.Vector3();
  let along = 0;
  for (let i = i0; i <= i1; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    t.set(b.x - a.x, 0, b.z - a.z).normalize();
    side.set(-t.z, 0, t.x);
    if (i > i0) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    for (let k = 0; k < m; k++) {
      const [lat, up] = profile[k];
      pos.push(pts[i].x + side.x * lat, pts[i].y + up, pts[i].z + side.z * lat);
      uv.push(k / (m - 1) * 2, along * uvScale);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < m - 1; k++) {
    const a = i * m + k, b = a + 1, c = a + m, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const BALLAST = [[-2.7, -0.7], [-1.8, 0.3], [1.8, 0.3], [2.7, -0.7]];
const RAIL = (o) => [[o - 0.08, 0.38], [o - 0.08, 0.6], [o + 0.08, 0.6], [o + 0.08, 0.38]];

export class TrackView {
  constructor(scene, net) {
    this.scene = scene; this.net = net; this.terrain = net.terrain; this.preview = null;
    this.fine = new Set(); this.detail = true; // rails, sleepers and signals: hidden when the camera is far out
    net.view = this;
    // anything built before the view was attached
    for (const st of net.world.stations) this.stationTrack(st);
    for (const e of net.edges) this.edgeAdded(e);
    for (const D of net.diamonds) this.diamondAdded(D);
  }
  // a level crossing: a timbered square where the two tracks meet
  diamondAdded(D) {
    const m = new THREE.Mesh(diamondGeo, diamondMat);
    m.position.set(D.x, D.y + 0.42, D.z); m.receiveShadow = true;
    m.userData.pick = null;
    D.mesh = m; this.scene.add(m);
  }
  diamondRemoved(D) { if (D.mesh) { this.scene.remove(D.mesh); D.mesh = null; } }
  edgeAdded(edge) { this.buildVisual(edge); this.buildSignals(edge); }
  edgeRemoved(edge) {
    for (const g of [edge.group, edge.sigGroup]) if (g) {
      this.scene.remove(g);
      g.traverse(o => this.fine.delete(o));
      g.traverse(o => { if (o.geometry && o.geometry !== sleeperGeo && o.geometry !== signalPostGeo && o.geometry !== lightGeo) o.geometry.dispose(); });
    }
  }
  signalsChanged(edge) { this.buildSignals(edge); }
  pickables() { return [...this.net.edges.map(e => e.group), ...this.net.edges.map(e => e.sigGroup).filter(Boolean)]; }

  showPreview(plan) {
    if (this.preview) { this.scene.remove(this.preview); this.preview.geometry.dispose(); this.preview = null; }
    if (!plan) return;
    this.preview = gradePreview(plan.pts, 0.06, !!plan.bad);
    this.preview.renderOrder = 10;
    this.scene.add(this.preview);
  }

  offsetLine(edge, lat) {
    return edge.pts.map((p, i) => {
      const w = this.net.doubleW(edge, edge.cum[i]);
      if (w <= 0) return p;
      const t = tangentAt(edge.pts, i);
      return new THREE.Vector3(p.x - t.z * lat * w, p.y, p.z + t.x * lat * w);
    });
  }

  buildVisual(edge) {
    const { pts, cum, length: total, bridge } = edge;
    const group = new THREE.Group();
    let i0 = 0, i1 = pts.length - 1;
    if (edge.a.type === 'station') while (i0 < pts.length - 1 && cum[i0] < HALF - 1) i0++;
    if (edge.b.type === 'station') while (i1 > 0 && total - cum[i1] < HALF - 1) i1--;
    if (i1 > i0) {
      if (edge.double) { this.addTrackMeshes(group, this.offsetLine(edge, DOUBLE_OFF), i0, i1); this.addTrackMeshes(group, this.offsetLine(edge, -DOUBLE_OFF), i0, i1); }
      else this.addTrackMeshes(group, pts, i0, i1);
    }
    const pb = new PartBuilder(); let anyBridge = false;
    const deckW = edge.double ? 11.4 : 5.6;
    for (let i = i0; i < i1; i++) {
      if (!bridge[i]) continue; anyBridge = true;
      const a = pts[i], b = pts[i + 1];
      const ang = Math.atan2(b.x - a.x, b.z - a.z), len = a.distanceTo(b);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      const c = Math.cos(ang), s = Math.sin(ang), hw = deckW / 2;
      pb.add(new THREE.BoxGeometry(deckW, 1.2, len + 0.1), '#6b6f73', mx, my - 1.0, mz, 0, ang);
      pb.add(new THREE.BoxGeometry(0.3, 1.4, len + 0.1), '#4c5257', mx + c * hw, my + 0.2, mz - s * hw, 0, ang);
      pb.add(new THREE.BoxGeometry(0.3, 1.4, len + 0.1), '#4c5257', mx - c * hw, my + 0.2, mz + s * hw, 0, ang);
      if (i % 7 === 0) {
        const g = Math.min(this.terrain.heightAt(a.x, a.z), 0) - 3;
        const h = a.y - 1.6 - g;
        if (h > 1) pb.add(new THREE.BoxGeometry(deckW - 1.4, h, 2.2), '#8a8178', a.x, g + h / 2, a.z, 0, ang);
      }
    }
    if (anyBridge) { const m = new THREE.Mesh(pb.build(), bridgeMat); m.castShadow = m.receiveShadow = true; group.add(m); }
    group.traverse(o => { o.userData.pick = edge; });
    edge.group = group;
    this.scene.add(group);
  }

  addTrackMeshes(group, pts, i0, i1) {
    const ballast = new THREE.Mesh(ribbon(pts, BALLAST, i0, i1), ballastMat);
    ballast.receiveShadow = true;
    const r1 = new THREE.Mesh(ribbon(pts, RAIL(-0.75), i0, i1), railMat);
    const r2 = new THREE.Mesh(ribbon(pts, RAIL(0.75), i0, i1), railMat);
    r1.castShadow = r2.castShadow = true;
    group.add(ballast, r1, r2);
    this.addFine(r1, r2);
    const list = [];
    for (let i = i0; i < i1; i++) {
      const a = pts[i], b = pts[i + 1], d = a.distanceTo(b);
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      for (let s = 0; s < d; s += 0.9) list.push([a.x + (b.x - a.x) * s / d, a.y + (b.y - a.y) * s / d, a.z + (b.z - a.z) * s / d, ang]);
    }
    const im = new THREE.InstancedMesh(sleeperGeo, sleeperMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    list.forEach((s, k) => { q.setFromAxisAngle(up, s[3]); m.compose(new THREE.Vector3(s[0], s[1] + 0.36, s[2]), q, one); im.setMatrixAt(k, m); });
    im.receiveShadow = true;
    group.add(im); this.addFine(im);
  }
  addFine(...ms) { for (const m of ms) { this.fine.add(m); m.visible = this.detail; } }
  // (meshes of removed track are dropped from the set when it is next switched)
  setDetail(on) {
    if (on === this.detail) return;
    this.detail = on;
    for (const m of this.fine) m.visible = on;
  }

  // station: main track + a second platform track with switches at both ends
  stationTrack(st) {
    const g = new THREE.Group();
    const lz = new THREE.Vector3(-st.axis.z, 0, st.axis.x);
    const P = (x, z) => new THREE.Vector3(st.x + st.axis.x * x + lz.x * z, st.y, st.z + st.axis.z * x + lz.z * z);
    const main = []; for (let s = -HALF - 2; s <= HALF + 2; s += 2) main.push(P(s, 0));
    this.addTrackMeshes(g, main, 0, main.length - 1);
    const side = []; for (let s = -HALF - SWITCH_LEN; s <= HALF + SWITCH_LEN; s += 2) side.push(P(s, PLATFORM2 * smoothstep(HALF + SWITCH_LEN, HALF, Math.abs(s))));
    this.addTrackMeshes(g, side, 0, side.length - 1);
    const sw = SWITCH_LEN * 1.6, sid = [];
    for (let s = -HALF - sw; s <= HALF + sw; s += 2) sid.push(P(s, PLATFORM2 * 2 * smoothstep(HALF + sw, HALF, Math.abs(s))));
    this.addTrackMeshes(g, sid, 0, sid.length - 1);
    g.traverse(o => o.userData.pick = st);
    this.scene.add(g); st.trackGroup = g;
  }
  stationRemoved(st) { const g = st.trackGroup; if (!g) return; this.scene.remove(g); g.traverse(o => { this.fine.delete(o); if (o.geometry && o.geometry !== sleeperGeo) o.geometry.dispose(); }); st.trackGroup = null; }

  buildSignals(edge) {
    if (edge.sigGroup) { this.scene.remove(edge.sigGroup); edge.sigGroup.traverse(o => this.fine.delete(o)); edge.sigGroup.traverse(o => { if (o.material && o.material !== signalPostMat) o.material.dispose(); }); }
    const g = new THREE.Group(); edge.heads = [];
    edge.signals.forEach((d, j) => {
      const i = this.net.edgeIndexAt(edge, d);
      const p = this.net.edgePoint(edge, d), t = tangentAt(edge.pts, i);
      for (const dir of [1, -1]) {
        const lat = ((edge.double ? DOUBLE_OFF : 0) + 3.6) * dir;
        const post = new THREE.Group();
        post.position.set(p.x - t.z * lat, p.y - 0.3, p.z + t.x * lat);
        post.rotation.y = Math.atan2(-t.x * dir, -t.z * dir);
        const pm = new THREE.Mesh(signalPostGeo, signalPostMat); pm.castShadow = true;
        const lm = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: LIGHT_GREEN }));
        lm.position.set(0, 5.35, 0.3);
        post.add(pm, lm);
        post.traverse(o => o.userData.pick = { type: 'signal', edge, d });
        g.add(post);
        edge.heads.push({ light: lm, id: this.net.blockId(edge, dir > 0 ? j + 1 : j, dir) });
      }
    });
    edge.sigGroup = g;
    this.addFine(g);
    this.scene.add(g);
  }
  updateSignalLights(blocks) {
    for (const e of this.net.edges) for (const h of e.heads || []) {
      const o = blocks.get(h.id);
      h.light.material.color.copy(o && o.size ? LIGHT_RED : LIGHT_GREEN);
    }
  }

}
