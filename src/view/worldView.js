// Draws the world: industries, towns (instanced buildings from World.layout), churches, trees, stations and
// their airfields, harbors and warehouses. World calls the hook methods below when something visible changes.
import * as THREE from 'three';
import { industryModel, unitBox, unitRoof, treeGeometries, churchModel, stationModel, warehouseModel } from './models.js';
import { harborModel, airportModel, depotModel } from './craftModels.js';
import { vertexMat } from './gfx.js';

const WALL_COLS = ['#e3d9c6', '#d8c3a0', '#b5654a', '#c9b79a', '#f0ece2', '#a0563e', '#cfc6b5'].map(c => new THREE.Color(c));
const ROOF_COLS = ['#8c3a2b', '#5a4a46', '#6b2f24', '#4e5560', '#7a4a32'].map(c => new THREE.Color(c));
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class WorldView {
  constructor(scene, world) {
    this.scene = scene; this.w = world; this.terrain = world.terrain;
    this.pickables = [];
    world.view = this;
  }
  add(m, pick, pickable = true) {
    m.traverse(o => { o.userData.pick = pick; });
    this.scene.add(m); if (pickable) this.pickables.push(m);
    return m;
  }
  drop(m) {
    if (!m) return;
    this.scene.remove(m); m.geometry?.dispose();
    this.pickables = this.pickables.filter(p => p !== m);
  }

  build() {
    const W = this.w;
    for (const ind of W.industries) {
      // the model's random numbers were drawn by World.layout (ind.look)
      let n = 0;
      const { geo, stacks } = industryModel(ind.def, () => { if (n >= ind.look.length) console.error(`industry model ${ind.key} wants more random numbers than LOOK_DRAWS gives`); return ind.look[n++]; });
      if (n !== ind.look.length) console.error(`industry model ${ind.key} used ${n} random numbers, LOOK_DRAWS gives ${ind.look.length}`);
      const m = new THREE.Mesh(geo, vertexMat);
      m.position.set(ind.x, ind.y, ind.z); m.rotation.y = ind.rot;
      m.castShadow = true; m.receiveShadow = true;
      m.visible = !ind.dormant; // future-era industries appear when they are founded
      this.add(m, ind, !ind.dormant);
      ind.mesh = m;
      ind.stacks = stacks.map(s => new THREE.Vector3(...s).applyEuler(new THREE.Euler(0, ind.rot, 0)).add(m.position));
    }
    this.boxGeo = unitBox(); this.roofGeo = unitRoof();
    const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const church = churchModel();
    this.townMats = [wallMat, roofMat, church]; // (for towns founded later)
    for (const town of W.towns) this.buildTown(town, wallMat, roofMat, church);
    this.buildTrees();
    // anything built before the view was attached (e.g. a game rebuilt from a save)
    for (const st of W.stations) {
      this.stationAdded(st);
      if (st.airport) this.airportSet(st, st.airport);
      if (st.harbor) this.harborSet(st, st.harbor.berth);
      if (st.warehouse) this.warehouseSet(st, st.warehouse);
    }
  }

  buildTown(town, wallMat, roofMat, church) {
    const max = town.maxBuildings;
    const walls = new THREE.InstancedMesh(this.boxGeo, wallMat, max);
    const roofs = new THREE.InstancedMesh(this.roofGeo, roofMat, max);
    walls.castShadow = roofs.castShadow = true; walls.receiveShadow = roofs.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    town.buildings.forEach((b, k) => {
      q.setFromEuler(e.set(0, b.rot, 0));
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h + 0.6, b.d));
      walls.setMatrixAt(k, m); walls.setColorAt(k, WALL_COLS[Math.floor(b.wall * WALL_COLS.length)]);
      m.compose(new THREE.Vector3(b.x, b.y + b.h + 0.6, b.z), q, new THREE.Vector3(b.w + 0.8, b.rh * 2, b.d + 0.8));
      roofs.setMatrixAt(k, m); roofs.setColorAt(k, ROOF_COLS[Math.floor(b.roof * ROOF_COLS.length)]);
    });
    town.mesh = { walls, roofs };
    this.add(walls, town); this.add(roofs, town);
    this.townRazed(town); this.townResized(town);
    const ch = new THREE.Mesh(church, vertexMat);
    ch.position.set(town.x, town.y, town.z); ch.rotation.y = -town.angle; ch.castShadow = true;
    this.add(ch, town);
  }
  townAdded(town) { if (this.townMats) this.buildTown(town, ...this.townMats); }
  townResized(town) {
    if (!town.mesh) return;
    town.mesh.walls.count = town.built; town.mesh.roofs.count = town.built;
  }
  townRazed(town) {
    if (!town.mesh) return;
    const { walls, roofs } = town.mesh;
    town.lots.forEach((lot, k) => { if (lot.razed && k < town.maxBuildings) { walls.setMatrixAt(k, ZERO); roofs.setMatrixAt(k, ZERO); } });
    walls.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true;
  }

  // trees: scenery only, from the map's random stream after the town layout
  buildTrees() {
    const t = this.terrain, W = this.w, r = W.rand.fork(); // (a copy: the simulation's stream is left untouched)
    const { conifer, deciduous } = treeGeometries();
    const N = t.S > 3000 ? 45000 : 14000;
    const pts = [];
    for (let k = 0; k < N * 4 && pts.length < N; k++) {
      const x = (r() * 2 - 1) * (t.half - 10), z = (r() * 2 - 1) * (t.half - 10);
      const fm = W.forestMask(x, z);
      if (r() > fm * 0.95 + 0.02) continue;
      const h = t.heightAt(x, z);
      if (h < 2.5 || h > 135) continue;
      if (t.slopeAt(x, z, 4) > 0.9) continue;
      if (W.towns.some(o => Math.hypot(o.x - x, o.z - z) < 280)) continue;
      if (W.industries.some(o => Math.hypot(o.x - x, o.z - z) < (o.def.kind === 'farm' || o.def.kind === 'ranch' ? 110 : 55))) continue;
      pts.push({ x, z, h, con: h > 50 ? r() < 0.85 : r() < 0.35, s: 0.8 + r() * 0.7, ry: r() * 6.28 });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const sets = [pts.filter(p => p.con), pts.filter(p => !p.con)];
    this.trees = [];
    [conifer, deciduous].forEach((geo, gi) => {
      const list = sets[gi];
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = true; im.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      list.forEach((p, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
        m.compose(new THREE.Vector3(p.x, p.h - 0.3, p.z), q, new THREE.Vector3(p.s, p.s * (0.9 + r() * 0.4), p.s));
        im.setMatrixAt(k, m);
        col.setHSL(0.25 + (r() - 0.5) * 0.06, 0.25 + r() * 0.2, 0.5 + r() * 0.15);
        im.setColorAt(k, col);
        p.im = im; p.k = k;
      });
      this.scene.add(im);
      this.trees.push(...list);
    });
  }
  clearTrees(test) {
    if (!this.trees) return;
    const touched = new Set();
    for (const p of this.trees) if (!p.gone && test(p.x, p.z)) { p.gone = true; p.im.setMatrixAt(p.k, ZERO); touched.add(p.im); }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
  }
  reseatTrees(minX, minZ, maxX, maxZ) {
    if (!this.trees) return;
    const m = new THREE.Matrix4(), touched = new Set();
    for (const p of this.trees) {
      if (p.gone || p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) continue;
      p.im.getMatrixAt(p.k, m);
      m.elements[13] = this.terrain.heightAt(p.x, p.z) - 0.3;
      p.im.setMatrixAt(p.k, m); touched.add(p.im);
    }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
  }

  industryActivated(ind) {
    if (ind.mesh && !ind.mesh.visible) { ind.mesh.visible = true; this.pickables.push(ind.mesh); }
  }
  stationAdded(st) {
    if (st.mesh) return;
    const mesh = new THREE.Mesh(st.depot ? depotModel() : stationModel(st.len), vertexMat);
    mesh.position.set(st.x, st.y, st.z); mesh.rotation.y = -st.angle;
    mesh.castShadow = true; mesh.receiveShadow = true;
    st.mesh = this.add(mesh, st);
  }
  stationRemoved(st) { for (const m of [st.mesh, st.whMesh, st.hbMesh, st.apMesh]) this.drop(m); st.mesh = st.whMesh = st.hbMesh = st.apMesh = null; }
  airportSet(st, a) {
    const m = new THREE.Mesh(airportModel(), vertexMat);
    m.position.set(a.x, a.y, a.z); m.rotation.y = Math.atan2(a.dx, a.dz);
    m.castShadow = m.receiveShadow = true;
    st.apMesh = this.add(m, st);
  }
  harborSet(st, berth) {
    const shore = this.w.water.shorePoint(berth, st);
    const m = new THREE.Mesh(harborModel(berth, shore, this.terrain.heightAt(shore.x, shore.z)), vertexMat);
    m.castShadow = m.receiveShadow = true;
    st.hbMesh = this.add(m, st);
  }
  warehouseSet(st, level) {
    this.drop(st.whMesh);
    const m = new THREE.Mesh(warehouseModel(level), vertexMat);
    m.position.set(st.x, st.y, st.z); m.rotation.y = -st.angle;
    m.castShadow = m.receiveShadow = true;
    st.whMesh = this.add(m, st);
  }
}
