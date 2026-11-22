// 3D models of harbors, ships, airfields and aircraft (view only).
import * as THREE from 'three';
import { PartBuilder } from './gfx.js';
import { CARGO, ECON } from '../data.js';
import { clamp, lerp } from '../util.js';

// ---------- models (forward = +z) ----------
export function harborModel(berth, shore, landY) {
  const b = new PartBuilder();
  // (if the shore point falls on the berth itself, point the pier along +z instead of dividing by zero)
  let dx = shore.x - berth.x, dz = shore.z - berth.z;
  if (Math.hypot(dx, dz) < 0.5) { dx = 0; dz = 1; }
  const L = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
  const len = L + 8, cx = berth.x + dx / L * (len / 2 - 6), cz = berth.z + dz / L * (len / 2 - 6);
  const deck = Math.max(1.6, landY * 0.25 + 1.4);
  // pier deck along the line berth → shore, on wooden piles
  b.add(new THREE.BoxGeometry(9, 0.7, len), '#7a5f43', cx, deck, cz, 0, ang);
  for (let s = -len / 2 + 2; s < len / 2; s += 6) for (const off of [-4, 4]) {
    const px = cx + Math.sin(ang) * s + Math.cos(ang) * off, pz = cz + Math.cos(ang) * s - Math.sin(ang) * off;
    b.add(new THREE.CylinderGeometry(0.35, 0.35, deck + 6, 6), '#4b3a2a', px, deck / 2 - 3, pz);
  }
  // crane at the water end
  const ex = berth.x + dx / L * 2, ez = berth.z + dz / L * 2;
  b.add(new THREE.BoxGeometry(1.2, 12, 1.2), '#5b6066', ex + Math.cos(ang) * 3, deck + 6, ez - Math.sin(ang) * 3);
  b.add(new THREE.BoxGeometry(0.8, 0.8, 13), '#5b6066', ex + Math.cos(ang) * 3 - Math.sin(ang) * 5, deck + 11.5, ez - Math.sin(ang) * 3 - Math.cos(ang) * 5, 0, ang + Math.PI);
  // bollards and some crates
  for (let k = 0; k < 4; k++) b.add(new THREE.BoxGeometry(1.4, 1.2, 1.4), k % 2 ? '#9a7b55' : '#6d5a44', cx - Math.cos(ang) * 2 + Math.sin(ang) * (k * 2 - 8), deck + 0.9, cz + Math.sin(ang) * 2 + Math.cos(ang) * (k * 2 - 8));
  return b.build();
}

const cacheM = new Map();
export function shipModel(kind, cargo) {
  const key = kind + '|' + (cargo || '');
  if (cacheM.has(key)) return cacheM.get(key);
  const b = new PartBuilder();
  const cc = cargo ? CARGO[cargo].color : '#3a3a3a';
  const tug = (z0) => {
    b.box(6, 2.4, 14, '#2c3a4a', 0, -1.2, z0).add(new THREE.ConeGeometry(3, 5, 4), '#2c3a4a', 0, 0, z0 + 9, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.5);
    b.box(4, 3, 5, '#e8e1cf', 0, 1.2, z0 - 1).box(4.4, 0.3, 5.4, '#5b3a2e', 0, 4.2, z0 - 1);
    b.cyl(0.7, 0.8, 4, '#1a1a1a', 0, 6, z0 + 1, 10).cyl(0.75, 0.75, 0.6, '#b8332b', 0, 7.2, z0 + 1, 10);
  };
  const barge = (z0, tank) => {
    b.box(8.5, 2.6, 26, '#4a4038', 0, -1.6, z0);
    if (tank) { for (const x of [-2, 2]) b.cyl(1.7, 1.7, 22, cargo ? '#262626' : '#3a3a3a', x, 2.0, z0, 12, Math.PI / 2); if (cargo) b.cyl(1.75, 1.75, 3, cc, 0, 2.0, z0, 12, Math.PI / 2, 0, Math.PI / 2); }
    else if (cargo) b.box(7, 1.6, 23, cc, 0, 0.8, z0).box(5, 1, 18, cc, 0, 2.2, z0);
  };
  let smoke = [0, 7.5, 0];
  switch (kind) {
    case 'packet': {
      b.box(10, 3, 40, '#2a2f36', 0, -1.6, 0).add(new THREE.ConeGeometry(5, 8, 4), '#2a2f36', 0, -0.1, 23.5, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.45);
      b.box(10.4, 0.3, 40.5, '#b08a5a', 0, 1.4, 0);
      b.box(8, 3, 26, '#f1ece0', 0, 1.7, -2).box(8.6, 0.3, 27, '#7a2f26', 0, 4.7, -2);
      b.box(6, 2.4, 12, '#f1ece0', 0, 5, -4).box(6.4, 0.3, 12.5, '#7a2f26', 0, 7.4, -4).box(3.5, 2, 4, '#e2d6bd', 0, 7.7, 6);
      for (const x of [-1.6, 1.6]) b.cyl(0.8, 0.9, 4, '#1a1a1a', x, 9.2, 3, 10).cyl(1.1, 0.8, 0.6, '#c0392b', x, 11.3, 3, 10);
      for (const x of [-6.2, 6.2]) b.cyl(4.2, 4.2, 2.4, '#7a2f26', x, 1.2, 0, 16, 0, 0, Math.PI / 2);
      if (cargo) b.box(5, 1.2, 5, cc, 0, 1.6, 16);
      smoke = [0, 11.8, 3];
      break;
    }
    case 'barge': tug(26); barge(4, false); barge(-24, false); smoke = [0, 7.6, 27]; break;
    case 'tankbarge': tug(26); barge(4, true); barge(-24, true); smoke = [0, 7.6, 27]; break;
    case 'freighter': {
      b.box(11, 5, 56, '#3b2f2a', 0, -3, 0).add(new THREE.ConeGeometry(5.5, 9, 4), '#3b2f2a', 0, -0.5, 32, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.5);
      b.box(11.2, 0.6, 56.5, '#9b2f25', 0, -2.4, 0).box(11.3, 0.3, 57, '#cfc6b5', 0, 2, 0);
      for (const z of [18, 8, -2]) b.box(7, 1.2, 7, cargo ? cc : '#5a4a3c', 0, 2.2, z);
      b.box(9, 6, 10, '#ece6d8', 0, 2.2, -18).box(9.4, 0.4, 10.4, '#5b3a2e', 0, 8.2, -18);
      b.cyl(1.4, 1.6, 4, '#1a1a1a', 0, 9.2, -14, 12).cyl(1.5, 1.5, 0.8, '#b8332b', 0, 11.1, -14, 12);
      for (const z of [24, 2]) b.cyl(0.25, 0.3, 9, '#4a3a2a', 0, 6.5, z, 6);
      smoke = [0, 11.6, -14];
      break;
    }
  }
  const out = { geo: b.build(), smoke };
  cacheM.set(key, out);
  return out;
}

// Airfield model in its local frame: runway along +z, buildings on the +x side
export function airportModel(level = 1) {
  const b = new PartBuilder(), L = ECON.runwayLen;
  b.box(34, 0.5, L + 30, '#6f7b58', 0, -0.4, 0);                // grass strip
  b.box(22, 0.4, L, '#3d4044', 0, -0.1, 0);                     // runway
  for (let z = -L / 2 + 20; z < L / 2 - 15; z += 22) b.box(0.8, 0.45, 9, '#e8e6df', 0, -0.1, z);
  for (const s of [-1, 1]) for (let x = -8; x <= 8; x += 4) b.box(1.6, 0.45, 10, '#e8e6df', x, -0.1, s * (L / 2 - 8));
  b.box(10, 0.4, 70, '#4a4d50', 22, -0.1, 0);                   // taxiway
  b.box(46, 0.4, 60, '#55585b', 50, -0.1, 0);                   // apron
  b.box(16, 8, 34, '#d9d3c5', 82, 0, 10).box(16.6, 0.5, 34.6, '#7a3a2e', 82, 8, 10).box(16.2, 2, 30, '#8ec5d6', 82, 5, 10); // terminal
  b.add(new THREE.CylinderGeometry(11, 11, 30, 16, 1, false, 0, Math.PI), '#9aa3a8', 82, 0, -28, Math.PI / 2, 0, 0); // hangar
  b.cyl(2.2, 2.6, 16, '#d9d3c5', 70, 8, 34, 10).box(6, 3.5, 6, '#8ec5d6', 70, 16, 34).box(6.6, 0.5, 6.6, '#3a3a3a', 70, 19.5, 34); // tower
  b.cyl(0.15, 0.15, 7, '#888', 16, 3.5, L / 2 - 30, 6).add(new THREE.ConeGeometry(0.7, 3, 8), '#e2662b', 17.3, 6.6, L / 2 - 30, 0, 0, Math.PI / 2);
  return b.build();
}

const cache = new Map();
export function planeModel(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const b = new PartBuilder();
  const prop = (x, y, z) => { b.box(3.6, 0.3, 0.12, '#2a2a2a', x, y - 0.15, z).box(0.3, 3.6, 0.12, '#2a2a2a', x, y - 1.8, z).cyl(0.35, 0.35, 0.6, '#999', x, y, z - 0.3, 8, Math.PI / 2); };
  const wheels = (x, z, h) => { for (const s of [-1, 1]) b.box(0.15, h, 0.15, '#333', x * s, -h, z).cyl(0.45, 0.45, 0.3, '#1d1d1d', x * s, -h - 0.1, z, 10, 0, 0, Math.PI / 2); };
  switch (kind) {
    case 'biplane':
      b.box(1.6, 1.6, 8, '#d8c27a', 0, 0, 0).add(new THREE.ConeGeometry(0.8, 2, 8), '#d8c27a', 0, 0.8, -5, -Math.PI / 2);
      b.box(13, 0.22, 1.8, '#b5402f', 0, 0.2, 1.5).box(13, 0.22, 1.8, '#b5402f', 0, 2.6, 1.5);
      for (const x of [-4.5, 4.5]) for (const z of [0.9, 2.1]) b.box(0.12, 2.3, 0.12, '#444', x, 0.3, z);
      b.box(4.6, 0.18, 1.3, '#b5402f', 0, 1, -4.6).box(0.18, 1.8, 1.4, '#b5402f', 0, 1, -4.8);
      prop(0, 0.8, 4.1); wheels(0.9, 2, 1.1);
      break;
    case 'trimotor':
      b.cyl(1.3, 1.1, 15, '#b9bfc4', 0, 0, 0, 12, Math.PI / 2).add(new THREE.ConeGeometry(1.1, 2.5, 12), '#b9bfc4', 0, 0, -8.7, -Math.PI / 2);
      b.box(22, 0.35, 3.2, '#a9b0b5', 0, 1.4, 2);
      for (const x of [-4.5, 0, 4.5]) { b.cyl(0.6, 0.6, 2.2, '#4a4a4a', x, x ? 0.6 : 0, x ? 3.2 : 7.6, 10, Math.PI / 2); prop(x, x ? 0.6 : 0, x ? 4.4 : 8.8); }
      b.box(7, 0.2, 2, '#a9b0b5', 0, 0.3, -8.2).box(0.2, 2.6, 2.2, '#a9b0b5', 0, 0.4, -8.6);
      b.box(2.7, 0.5, 9, '#2f4f7a', 0, -0.2, 0.5);
      wheels(2.2, 3, 1.5);
      break;
    case 'twin':
      b.cyl(1.6, 1.4, 20, '#c9ced2', 0, 0, 0, 14, Math.PI / 2).add(new THREE.ConeGeometry(1.4, 3.5, 14), '#c9ced2', 0, 0, -11.7, -Math.PI / 2).add(new THREE.SphereGeometry(1.6, 12, 8), '#c9ced2', 0, 0, 10);
      b.box(3.3, 0.5, 18, '#b8332b', 0, -0.4, 0.5);
      b.box(28, 0.4, 3.8, '#b4babf', 0, -0.9, 2);
      for (const x of [-5.5, 5.5]) { b.cyl(0.9, 0.8, 4, '#8f969b', x, -0.6, 3.6, 12, Math.PI / 2); prop(x, -0.6, 5.8); }
      b.box(9, 0.25, 2.4, '#b4babf', 0, 0.4, -10.4).box(0.25, 3.6, 3, '#b8332b', 0, 0.6, -10.8);
      wheels(5.5, 3, 1.6);
      break;
    case 'freighter':
      b.cyl(2.3, 2.1, 26, '#9aa39e', 0, 0, 0, 14, Math.PI / 2).add(new THREE.ConeGeometry(2.1, 4.5, 14), '#9aa39e', 0, 0, -15.2, -Math.PI / 2).add(new THREE.SphereGeometry(2.3, 12, 8), '#9aa39e', 0, 0, 13);
      b.box(36, 0.5, 4.5, '#8c958f', 0, 2, 2);
      for (const x of [-12, -6, 6, 12]) { b.cyl(0.9, 0.8, 4, '#5a605c', x, 1.6, 4, 12, Math.PI / 2); prop(x, 1.6, 6.2); }
      b.box(12, 0.3, 3, '#8c958f', 0, 1, -13.5).box(0.3, 4.5, 3.6, '#2e5e3a', 0, 1, -14);
      wheels(3, 3, 2.3);
      break;
  }
  const out = b.build();
  cache.set(kind, out);
  return out;
}


// ---------- roads: depots and road vehicles (forward = +z) ----------
export function depotModel() {
  const b = new PartBuilder();
  b.box(26, 0.2, 22, '#7d6f5a', 0, -0.05, 0);                 // yard
  b.box(10, 5, 8, '#8a5a3c', -6, 0, -5).box(11, 0.6, 9, '#4e3b2e', -6, 5, -5); // shed and roof
  b.box(3, 3.4, 0.3, '#2b2018', -6, 0, -0.9);                  // shed door
  for (const [x, z] of [[-13, -11], [13, -11], [-13, 11], [13, 11]]) b.box(0.4, 1.6, 0.4, '#5b4632', x, 0, z);
  b.box(6, 1.2, 3, '#a08a5c', 7, 0, -6).box(4, 0.9, 2.5, '#9c8a6a', 8, 0, 2); // crates and sacks
  return b.build();
}
const cacheR = new Map();
export function roadVehicleModel(kind, cargo) {
  const key = kind + '|' + (cargo || '');
  if (cacheR.has(key)) return cacheR.get(key);
  const b = new PartBuilder(), cc = cargo ? CARGO[cargo].color : null;
  const wheels = (zs, r = 0.55, w = 2.1) => { for (const z of zs) for (const x of [-w / 2, w / 2]) b.cyl(r, r, 0.25, '#2a2420', x, r, z, 10, 0, 0, Math.PI / 2); };
  const horses = (z0, n = 2) => { for (let i = 0; i < n; i++) { const x = n === 1 ? 0 : (i ? 0.55 : -0.55); b.box(0.5, 0.9, 2.0, '#5a3b26', x, 0.9, z0).box(0.35, 0.6, 0.7, '#5a3b26', x, 1.6, z0 + 1.1); for (const dz of [-0.7, 0.7]) b.box(0.18, 0.9, 0.18, '#3d2817', x, 0, z0 + dz); } };
  if (kind === 'coach') {
    b.box(1.9, 1.7, 3.6, '#6b2f24', 0, 0.9, 0).box(2.0, 0.15, 3.8, '#2a1d17', 0, 2.6, 0).box(1.4, 0.4, 0.8, '#2a1d17', 0, 2.75, -1.2);
    wheels([-1.2, 1.2], 0.6); horses(3.2); horses(5.4);
  } else if (kind === 'wagon') {
    b.box(1.9, 0.5, 4.2, '#7a5a3a', 0, 0.8, 0);
    if (cc) b.box(1.6, 0.8, 3.6, cc, 0, 1.3, 0);
    b.cyl(1.0, 1.0, 3.8, '#e6dcc2', 0, 1.5, 0, 10, Math.PI / 2).box(2.0, 0.1, 0.1, '#e6dcc2', 0, 1.5, 1.9);
    wheels([-1.4, 1.4], 0.6); horses(3.5); horses(5.7);
  } else if (kind === 'lorry') {
    b.box(2.1, 0.6, 5.2, '#2f3a32', 0, 0.8, -0.4).cyl(0.75, 0.75, 2.2, '#1f1f1f', 0, 1.8, 2.2, 10, Math.PI / 2).cyl(0.18, 0.2, 1.6, '#1a1a1a', 0, 2.9, 2.9, 8);
    b.box(2.0, 0.9, 3.2, cc || '#6b5a44', 0, 1.4, -1.2);
    wheels([-2.2, 0.6, 2.6], 0.65);
  } else if (kind === 'truck' || kind === 'tanker') {
    b.box(2.2, 1.6, 1.8, '#355a7a', 0, 0.9, 2.4).box(2.2, 0.5, 6.4, '#2a2a2a', 0, 0.7, -0.4);
    if (kind === 'tanker') b.cyl(1.0, 1.0, 4.6, cc || '#9aa0a6', 0, 2.0, -1.4, 12, Math.PI / 2);
    else b.box(2.3, 1.8, 4.6, cc || '#8a7a5c', 0, 1.2, -1.4);
    wheels([-2.6, -1.4, 2.3], 0.5);
  } else { // bus
    b.box(2.3, 2.3, 8.0, '#b8862b', 0, 0.7, 0).box(2.35, 0.7, 7.6, '#d9e1e6', 0, 1.9, 0);
    wheels([-2.6, 2.6], 0.5);
  }
  const out = b.build();
  cacheR.set(key, out);
  return out;
}
