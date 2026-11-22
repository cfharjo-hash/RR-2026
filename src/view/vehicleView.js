// Draws trains, ships and planes from the simulation's state. sync() runs every frame: it creates meshes for
// new vehicles, drops those of sold or merged-away ones, swaps wagon/ship models when cargo changes
// (Game calls cargoChanged) and places everything along its path. The game itself never touches a mesh.
import * as THREE from 'three';
import { clamp } from '../util.js';
import { ECON, CARGO, LOCO_LEN, WAGON_LEN } from '../data.js';
import { locoModel, wagonModel } from './models.js';
import { shipModel, planeModel, roadVehicleModel } from './craftModels.js';
import { vertexMat } from './gfx.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _o = new THREE.Vector3(), _c = new THREE.Vector3();

export class VehicleView {
  constructor(scene, game) {
    this.scene = scene; this.g = game; this.map = new Map();
    this.camera = null; this.far = 3000; // vehicles further from the camera are drawn as dots (one draw call for all)
    this.dotGeo = new THREE.BufferGeometry(); this.dotCap = 0;
    this.dots = new THREE.Points(this.dotGeo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, depthTest: true }));
    this.dots.frustumCulled = false; scene.add(this.dots);
    game.view = this;
  }
  cargoChanged(v) { const e = this.map.get(v); if (e) e.dirty = true; }
  // a train's wagons changed: rebuild its meshes on the next frame
  consistChanged(v) { const e = this.map.get(v); if (e) { for (const m of e.meshes) this.scene.remove(m); this.map.delete(v); } }
  mesh(v) { return this.map.get(v)?.meshes[0] || null; }
  isFar(v) { return !!this.map.get(v)?.far; } // (drawn as a dot: its models are hidden and not placed)
  pickables() { const out = []; for (const e of this.map.values()) if (!e.far) out.push(...e.meshes); return out; }
  // where a ship's funnel smoke comes out (model coordinates)
  smokeOf(v) { return this.map.get(v)?.smoke || null; }

  make(geo, v, shadowIn = false) {
    const m = new THREE.Mesh(geo, vertexMat);
    m.castShadow = true; m.receiveShadow = shadowIn; m.userData.pick = v;
    this.scene.add(m);
    return m;
  }
  create(v) {
    const e = { meshes: [], dirty: false };
    if (v.type === 'train') {
      e.meshes.push(this.make(locoModel(v.loco).geo, v));
      for (const w of v.wagons) e.meshes.push(this.make(wagonModel(w.type, w.cargo).geo, v));
    } else if (v.type === 'ship') {
      const sm = shipModel(v.def.model, this.mainCargo(v));
      e.meshes.push(this.make(sm.geo, v, true)); e.smoke = sm.smoke; e.bob = Math.random() * 6;
    } else if (v.type === 'truck') {
      e.meshes.push(this.make(roadVehicleModel(v.def.model, this.mainCargo(v)), v));
    } else {
      e.meshes.push(this.make(planeModel(v.def.model), v)); e.roll = 0;
    }
    this.map.set(v, e);
    return e;
  }
  mainCargo(sh) { // the ship shows its main cargo on deck
    const count = {}; for (const w of sh.wagons) if (w.cargo) count[w.cargo] = (count[w.cargo] || 0) + w.units * CARGO[w.cargo].wt;
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
  }
  refresh(v, e) {
    e.dirty = false;
    if (v.type === 'train') v.wagons.forEach((w, k) => { e.meshes[k + 1].geometry = wagonModel(w.type, w.cargo).geo; });
    else if (v.type === 'ship') e.meshes[0].geometry = shipModel(v.def.model, this.mainCargo(v)).geo;
    else if (v.type === 'truck') e.meshes[0].geometry = roadVehicleModel(v.def.model, this.mainCargo(v));
  }

  sync() {
    const g = this.g, live = new Set(), cam = this.camera?.position, dots = [], cols = [], col = new THREE.Color();
    for (const list of [g.trains, g.ships, g.planes, g.trucks]) for (const v of list) {
      live.add(v);
      const e = this.map.get(v) || this.create(v);
      if (e.dirty) this.refresh(v, e);
      // far away: a dot in the company's colour instead of the models (and no model placing)
      if (cam && v.type === 'train' && v.path) {
        g.pointAt(v, v.s - v.len / 2, _c);
        const far = v !== this.keep && cam.distanceTo(_c) > this.far; // (a followed train keeps its model: the camera rides on it)
        if (far !== !!e.far) { e.far = far; for (const m of e.meshes) m.visible = !far; }
        if (far) { dots.push(_c.x, _c.y + 6, _c.z); col.set(g.comp(v.owner).color || '#ffd35a'); cols.push(col.r, col.g, col.b); continue; }
      }
      if (v.type === 'train') this.placeTrain(v, e); else if (v.type === 'ship') this.placeShip(v, e); else if (v.type === 'truck') this.placeTruck(v, e); else this.placePlane(v, e);
    }
    // one buffer, grown when needed
    const n = dots.length / 3;
    if (n > this.dotCap) {
      this.dotCap = Math.max(64, n * 2);
      this.dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.dotCap * 3), 3));
      this.dotGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.dotCap * 3), 3));
    }
    if (n) {
      const P = this.dotGeo.attributes.position, C = this.dotGeo.attributes.color;
      P.array.set(dots); C.array.set(cols); P.needsUpdate = C.needsUpdate = true;
    }
    this.dotGeo.setDrawRange(0, n);
    this.dots.visible = n > 0;
    for (const [v, e] of this.map) if (!live.has(v)) { for (const m of e.meshes) this.scene.remove(m); this.map.delete(v); }
  }

  placeTrain(tr, e) {
    if (!tr.path) return;
    const g = this.g;
    let off = 0;
    e.meshes.forEach((m, k) => {
      const L = k === 0 ? LOCO_LEN : WAGON_LEN;
      const c = tr.s - off - L / 2;
      g.pointAt(tr, c + L * 0.35, _a).add(g.offsetAt(tr, c + L * 0.35, _o));
      g.pointAt(tr, c - L * 0.35, _b).add(g.offsetAt(tr, c - L * 0.35, _o));
      m.position.addVectors(_a, _b).multiplyScalar(0.5); m.position.y += 0.6;
      _a.y += 0.6; m.lookAt(_a);
      off += L;
    });
  }
  placeShip(sh, e) {
    const m = e.meshes[0], p = sh.path, g = this.g;
    if (!p) return;
    const bob = e.bob + g.day * ECON.daySeconds;
    const a = g.pathAt(p, sh.s + 4, new THREE.Vector3()), b = g.pathAt(p, sh.s - 4, new THREE.Vector3());
    g.pathAt(p, sh.s, m.position);
    m.position.y = Math.sin(bob * 1.3) * 0.12;
    const dirx = a.x - b.x, dirz = a.z - b.z;
    if (dirx * dirx + dirz * dirz > 1e-4) m.rotation.set(0, Math.atan2(dirx, dirz), 0);
    m.rotation.z = Math.sin(bob * 0.9) * 0.012;
  }
  // road vehicles keep to the right of the road's centre line
  placeTruck(rv, e) {
    const m = e.meshes[0], p = rv.path, g = this.g;
    if (!p) { const st = rv.at || rv.orders[rv.idx]; m.position.set(st.x, st.y + 0.2, st.z); return; }
    const a = g.pathAt(p, rv.s + 2, new THREE.Vector3()), b = g.pathAt(p, rv.s - 2, new THREE.Vector3());
    const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1;
    g.pathAt(p, rv.s, m.position);
    m.position.x -= dz / l * 1.6; m.position.z += dx / l * 1.6; m.position.y += 0.2;
    if (l > 1e-3) m.rotation.set(-Math.atan2(a.y - b.y, l), Math.atan2(dx, dz), 0, 'YXZ');
  }
  placePlane(pl, e) {
    const m = e.meshes[0], p = pl.path, g = this.g;
    if (!p) return;
    const at = (s) => g.pathAt(p, s, new THREE.Vector3());
    const pos = at(pl.s), ahead = at(pl.s + 6);
    if (ahead.distanceToSquared(pos) < 1e-4) { const back = at(pl.s - 6); ahead.copy(pos).multiplyScalar(2).sub(back); }
    m.position.copy(pos);
    m.lookAt(ahead);
    // bank into turns while airborne
    const inAir = pl.s > p.sAir && pl.s < p.sLand;
    let bank = 0;
    if (inAir) {
      const a = at(pl.s - 30), b = at(pl.s + 30);
      const h1 = Math.atan2(pos.x - a.x, pos.z - a.z), h2 = Math.atan2(b.x - pos.x, b.z - pos.z);
      let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      bank = clamp(dh * 2.2, -0.55, 0.55);
    }
    // ease into the bank as the simulation advances (as fast as before: 20% per 0.12-day step), not while paused
    const steps = Math.max(0, g.day - (e.day ?? g.day)) / 0.12; e.day = g.day;
    e.roll += (bank - e.roll) * (1 - Math.pow(0.8, steps));
    m.rotateZ(-e.roll);
  }
}
