// Draws the road network: a gravel surface with shoulders, bridge decks, and the preview while planning.
// RoadNetwork calls roadAdded / roadRemoved.
import * as THREE from 'three';
import { PartBuilder } from './gfx.js';
import { gradePreview } from './trackView.js';
import { ECON } from '../data.js';

const roadMat = new THREE.MeshStandardMaterial({ color: '#8f8068', roughness: 1 });
const bridgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const PROFILE = [[-3.4, -0.35], [-2.8, 0.18], [2.8, 0.18], [3.4, -0.35]];

function surface(pts) {
  const pos = [], idx = [], m = PROFILE.length, t = new THREE.Vector3();
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    t.set(b.x - a.x, 0, b.z - a.z).normalize();
    for (const [lat, up] of PROFILE) pos.push(p.x - t.z * lat, p.y + up, p.z + t.x * lat);
  });
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < m - 1; k++) { const a = i * m + k, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class RoadView {
  constructor(scene, roads) {
    this.scene = scene; this.roads = roads; this.preview = null;
    roads.view = this;
    for (const e of roads.edges) this.roadAdded(e);
  }
  roadAdded(e) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(surface(e.pts), roadMat); m.receiveShadow = true; g.add(m);
    const pb = new PartBuilder(); let any = false;
    for (let i = 0; i < e.pts.length - 1; i++) {
      if (!e.bridge[i]) continue; any = true;
      const a = e.pts[i], b = e.pts[i + 1], ang = Math.atan2(b.x - a.x, b.z - a.z), len = Math.hypot(b.x - a.x, b.z - a.z);
      pb.add(new THREE.BoxGeometry(7, 0.8, len + 0.1), '#6f6458', (a.x + b.x) / 2, (a.y + b.y) / 2 - 0.3, (a.z + b.z) / 2, 0, ang);
      if (i % 6 === 0) { const gy = Math.min(this.roads.terrain.heightAt(a.x, a.z), 0) - 3, h = a.y - 0.7 - gy; if (h > 1) pb.add(new THREE.BoxGeometry(5, h, 1.6), '#8a8178', a.x, gy + h / 2, a.z, 0, ang); }
    }
    if (any) { const bm = new THREE.Mesh(pb.build(), bridgeMat); bm.castShadow = bm.receiveShadow = true; g.add(bm); }
    g.traverse(o => { o.userData.pick = e; });
    e.group = g; this.scene.add(g);
  }
  roadRemoved(e) { if (e.group) { this.scene.remove(e.group); e.group.traverse(o => o.geometry?.dispose()); e.group = null; } }
  pickables() { return this.roads.edges.map(e => e.group).filter(Boolean); }
  showPreview(plan) {
    if (this.preview) { this.scene.remove(this.preview); this.preview.geometry.dispose(); this.preview = null; }
    if (!plan) return;
    this.preview = gradePreview(plan.pts, ECON.road.maxGrade, !!plan.bad);
    this.preview.renderOrder = 10;
    this.scene.add(this.preview);
  }
}
