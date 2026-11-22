// Three.js helpers for building meshes and textures (view only)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class PartBuilder {
  constructor() { this.parts = []; this._m = new THREE.Matrix4(); }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, x, y, z, ry = 0) { return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, 0, ry); }
  // gable roof: prism along local z
  roof(w, h, d, color, x, y, z, ry = 0) {
    const a = (w / 2 + 0.4) * Math.SQRT2;
    const g = new THREE.BoxGeometry(a, a, d + 0.8);
    g.rotateZ(Math.PI / 4);
    g.scale(1, (h) / (w / 2 + 0.4), 1);
    return this.add(g, color, x, y, z, 0, ry);
  }
  cyl(rt, rb, h, color, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  cone(r, h, color, x, y, z, seg = 10) { return this.add(new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z); }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    return g;
  }
}

export function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// shared material for vertex-coloured models
export const vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
