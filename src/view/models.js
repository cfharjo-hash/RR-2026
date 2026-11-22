import * as THREE from 'three';
import { PartBuilder } from './gfx.js';
import { CARGO, ECON, LOCO_LEN, WAGON_LEN } from '../data.js';

const PI = Math.PI;
const darker = (hex, f = 0.7) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

// ---------------- industries ----------------
export function industryModel(def, rand) {
  const b = new PartBuilder();
  const stacks = [];
  const outCargo = Object.keys(def.out)[0];
  const cc = outCargo ? CARGO[outCargo].color : (def.color || '#8a8a8a');
  const R = () => rand();
  switch (def.kind) {
    case 'mine': {
      b.box(66, 0.6, 60, '#6c6253', 0, -0.4, 0);
      b.box(18, 8, 12, '#7a6a58', -14, 0, -10).roof(12, 4, 18, '#3f3a36', -14, 8, -10, PI / 2);
      b.box(10, 6, 8, '#8a7a66', 10, 0, -16).roof(8, 3, 10, '#4b3a30', 10, 6, -16, PI / 2);
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.add(new THREE.BoxGeometry(0.7, 24, 0.7), '#3a2e26', 8 + dx * 0.7, 12, 2 + dz * 0.7, dz * 0.08, 0, -dx * 0.08);
      for (let y = 5; y < 22; y += 5) b.box(5.5, 0.4, 0.4, '#3a2e26', 8, y, 2).box(0.4, 0.4, 5.5, '#3a2e26', 8, y, 2);
      b.cyl(2.6, 2.6, 0.5, '#555', 8, 24.5, 2, 18, 0, 0, PI / 2);
      b.cone(9, 6, cc, 14, 0, 20).cone(7, 4.5, cc, -6, 0, 18).cone(5, 3.5, darker(cc), -16, 0, 12);
      b.cyl(0.9, 1.2, 18, '#7d3b2e', -22, 9, -14, 10); stacks.push([-22, 18.5, -14]);
      break;
    }
    case 'pit': {
      b.cyl(30, 32, 0.6, darker(cc, 0.75), 0, -0.1, 0, 28);
      b.cyl(18, 22, 0.8, darker(cc, 0.55), 4, 0.1, 4, 22);
      b.cone(8, 5, cc, -16, 0, 14).cone(6, 4, cc, -20, 0, 2).cone(5, 3, darker(cc, 0.9), 18, 0, -16);
      b.box(1.2, 20, 1.2, '#6d4a2d', 16, 0, 12).add(new THREE.BoxGeometry(22, 0.8, 0.8), '#6d4a2d', 8, 19.5, 12, 0, 0.3, 0);
      b.box(12, 6, 8, '#8a7a66', -18, 0, -18).roof(8, 3, 12, '#4b3a30', -18, 6, -18, PI / 2);
      break;
    }
    case 'lumber': {
      b.box(56, 0.6, 50, '#6a5a42', 0, -0.4, 0);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6 - r; k++)
        b.cyl(0.8, 0.8, 14, '#7a5532', -8 + k * 1.6 + r * 0.8, 0.8 + r * 1.4, 10, 8, 0, 0, PI / 2);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 5 - r; k++)
        b.cyl(0.8, 0.8, 12, '#6b4a2b', 10 + k * 1.6 + r * 0.8, 0.8 + r * 1.4, -8, 8, PI / 2, 0, 0);
      b.box(12, 5, 9, '#7b5a3a', -14, 0, -12).roof(9, 3.5, 12, '#3f3328', -14, 5, -12, PI / 2);
      b.box(16, 6, 10, '#8b6a46', 12, 0, 14).roof(10, 3, 16, '#4a3b2c', 12, 6, 14, PI / 2);
      b.cyl(0.6, 0.8, 10, '#5a5a5a', 18, 5, 18); stacks.push([18, 10.5, 18]);
      break;
    }
    case 'farm': case 'ranch': {
      const field = def.field || cc;
      b.box(40, 0.4, 34, '#6e6248', 0, -0.3, 0);
      b.box(10, 6, 8, '#e8e1cf', -10, 0, -8).roof(8, 4, 10, '#8f3a2c', -10, 6, -8, PI / 2);
      b.box(12, 8, 16, '#9b2f25', 8, 0, -4).roof(12, 5, 16, '#3a3330', 8, 8, -4);
      b.cyl(3, 3, 14, '#b9b9b4', 16, 7, 8, 14).cone(3.3, 3, '#8b8b88', 16, 14, 8, 14);
      if (def.kind === 'farm') {
        for (const [fx, fz, rot] of [[-45, 0, 0], [45, 8, PI / 2], [0, 45, 0], [-38, -44, PI / 2], [40, -40, 0]]) {
          for (let s = 0; s < 8; s++) {
            const off = -14 + s * 4;
            const col = s % 2 ? field : darker(field, 0.8);
            if (rot) b.box(28, 0.5, 3.6, col, fx, -0.1, fz + off); else b.box(3.6, 0.5, 28, col, fx + off, -0.1, fz);
          }
        }
      } else {
        // pasture fences and cattle
        for (const [fx, fz] of [[-45, 10], [40, 30], [0, -45]]) {
          b.box(36, 1.2, 0.3, '#5d4630', fx, 0, fz - 15).box(36, 1.2, 0.3, '#5d4630', fx, 0, fz + 15)
            .box(0.3, 1.2, 30, '#5d4630', fx - 18, 0, fz).box(0.3, 1.2, 30, '#5d4630', fx + 18, 0, fz);
          for (let c = 0; c < 6; c++) {
            const x = fx - 14 + R() * 28, z = fz - 12 + R() * 24, ry = R() * PI;
            b.add(new THREE.BoxGeometry(0.9, 1.1, 2.0), R() < 0.5 ? '#5a3a22' : '#e8e2d8', x, 1.2, z, 0, ry);
          }
        }
      }
      break;
    }
    case 'well': {
      b.box(56, 0.6, 50, '#5a5446', 0, -0.4, 0);
      for (const [x, z] of [[-14, -10], [8, -14], [-4, 14]]) {
        b.add(new THREE.CylinderGeometry(0.4, 4, 20, 4), '#4a3a2a', x, 10, z, 0, PI / 4, 0);
        b.box(5, 2, 5, '#3a3a3a', x, 0, z);
      }
      for (const [x, z] of [[16, 8], [22, 18], [14, 22]]) b.cyl(4.5, 4.5, 7, '#c8c2b0', x, 3.5, z, 18).cyl(4.6, 4.6, 0.4, '#8a857a', x, 7.2, z, 18);
      break;
    }
    case 'factory': {
      const st = def.style; const k = st.big ? 1.3 : 1;
      b.box(72, 0.6, 62, '#6d6a62', 0, -0.4, 0);
      const hw = 30 * k, hd = 20 * k, hh = 11 * k;
      b.box(hw, hh, hd, st.hall, -6, 0, -8);
      if (st.saw) {
        for (let s = 0; s < 5; s++) b.add(new THREE.BoxGeometry(hd / 5, 3, hw), st.roof, -6, hh + 1.2, -8 - hd / 2 + hd / 10 + s * hd / 5, 0, PI / 2, 0.5);
      } else b.roof(hd, 5 * k, hw, st.roof, -6, hh, -8, PI / 2);
      b.box(16, 8, 14, darker(st.hall, 0.9), 18, 0, 10).roof(14, 3.5, 16, st.roof, 18, 8, 10, PI / 2);
      b.box(10, 5, 6, '#c9c2b2', -20, 0, 16).roof(6, 2, 10, '#555', -20, 5, 16, PI / 2);
      for (let s = 0; s < (st.stacks || 0); s++) {
        const x = -18 + s * 8, z = -22 * k, h = 24 + (st.big ? 8 : 0);
        b.cyl(1.1, 1.6, h, '#7a3528', x, h / 2, z, 10).cyl(1.3, 1.3, 0.8, '#3a3a3a', x, h, z, 10);
        stacks.push([x, h + 0.8, z]);
      }
      for (let s = 0; s < (st.silos || 0); s++) b.cyl(3, 3, 16, '#c7c4ba', 26, 8, -16 + s * 7, 14).cone(3.2, 2.5, '#9a978e', 26, 16, -16 + s * 7, 14);
      for (let s = 0; s < (st.tanks || 0); s++) b.cyl(5, 5, 8, '#d9d4c8', -24 + (s % 2) * 12, 4, 24 - Math.floor(s / 2) * 0 + (s > 1 ? -50 : 0), 18);
      if (st.cone) { b.cyl(2, 8, 16, '#8a5040', 14, 8, -14, 14); stacks.push([14, 16.5, -14]); }
      // input/output yard
      b.box(8, 2, 6, cc, 2, 0, 20).box(6, 1.5, 6, darker(cc), 10, 0, 22);
      break;
    }
    // ---------- customers ----------
    case 'base': { // army base: parade ground, barracks rows, depot sheds, flag
      b.box(80, 0.5, 70, '#8a8270', 0, -0.3, 0).box(34, 0.2, 24, '#a89f86', 0, 0, 0);
      for (const z of [-26, 26]) for (const x of [-26, 0, 26]) b.box(20, 6, 9, '#b5a98a', x, 0, z).roof(9, 3, 20, '#5a5040', x, 6, z, PI / 2);
      for (const x of [-34, 34]) b.box(10, 7, 26, '#6b6a4a', x, 0, 0).roof(10, 3, 26, '#3e4231', x, 7, 0);
      b.cyl(0.25, 0.3, 18, '#ddd', 0, 9, 0, 6).box(4, 2.4, 0.15, '#9a2a2a', 2.1, 16.6, 0);
      break;
    }
    case 'fort': { // frontier fort: log palisade, corner blockhouses, flag
      const W = 46;
      b.box(W + 10, 0.4, W + 10, '#8a7a5a', 0, -0.3, 0);
      for (let k = -W / 2; k <= W / 2; k += 2.4) for (const [x, z] of [[k, -W / 2], [k, W / 2], [-W / 2, k], [W / 2, k]]) b.cyl(0.6, 0.7, 6.5, '#6b4f30', x, 3.2, z, 6);
      for (const [x, z] of [[-W / 2, -W / 2], [W / 2, W / 2]]) b.box(8, 7, 8, '#7a5a38', x, 0, z).box(9.5, 2.2, 9.5, '#5a4128', x, 7, z).roof(9.5, 2.5, 9.5, '#4a3522', x, 9.2, z, 0);
      b.box(16, 4.5, 8, '#8a6a44', -6, 0, 8).roof(8, 2.4, 16, '#4a3522', -6, 4.5, 8, PI / 2).box(8, 4, 8, '#8a6a44', 10, 0, -8);
      b.cyl(0.2, 0.25, 15, '#ddd', 4, 7.5, 0, 6).box(3.4, 2, 0.12, '#2a4a8a', 5.8, 13.6, 0);
      break;
    }
    case 'wharf': { // export wharf: warehouses, a pier and a crane
      b.box(70, 0.5, 50, '#7a7262', 0, -0.3, 0);
      for (const x of [-20, 4]) b.box(20, 9, 16, '#9a6a4a', x, 0, -8).roof(16, 4, 20, '#4a3a2e', x, 9, -8, PI / 2);
      b.box(46, 1.2, 8, '#6a5440', 0, 0.2, 16);
      b.box(1.2, 16, 1.2, '#3a3a3a', 22, 0, 10).box(14, 1, 1, '#3a3a3a', 16, 15.5, 10);
      for (let k = 0; k < 6; k++) b.box(3, 2, 3, ['#e3c15a', '#f3f1ea', '#c9a067'][k % 3], -14 + k * 5, 1.4, 16);
      break;
    }
    case 'mint': { // the mint: a classical hall with columns and a pediment
      b.box(50, 0.5, 40, '#9a958a', 0, -0.3, 0).box(34, 1.6, 24, '#c9c3b6', 0, 0, 0);
      b.box(30, 12, 18, '#e2ddd0', 0, 1.6, -2);
      for (let k = 0; k < 6; k++) b.cyl(0.9, 1, 10, '#efeae0', -12.5 + k * 5, 6.6, 8.4, 10);
      b.box(32, 1.4, 4, '#d8d2c4', 0, 11.6, 8.4).roof(5, 4, 32, '#cfc8b8', 0, 13, 8.4, PI / 2);
      b.box(2.4, 4, 0.3, '#5a4a2a', 0, 1.6, 7.2);
      break;
    }
  }
  return { geo: b.build(), stacks };
}

// ---------------- station ----------------
export function stationModel() {
  const L = ECON.platformLen;
  const b = new PartBuilder();
  b.box(L + 8, 0.5, 52, '#7a7262', 0, -0.4, -3);
  b.box(L, 1.1, 5, '#a59c8a', 0, 0, 4.6);
  b.box(L - 4, 1.1, 3.6, '#a59c8a', 0, 0, -4.6);
  for (let s = -20; s <= 20; s += 10) b.box(0.25, 3.4, 0.25, '#3a3a3a', s, 1.1, -4.6);
  b.box(44, 0.25, 3.2, '#5a4a3c', 0, 4.5, -4.6);
  b.box(18, 7, 8, '#c8b48e', 0, 0, 12).roof(8, 4, 18, '#5b3a2e', 0, 7, 12, PI / 2);
  b.box(6, 5, 6, '#b8a07e', -14, 0, 12).roof(6, 3, 6, '#5b3a2e', -14, 5, 12, PI / 2);
  b.cyl(0.6, 0.8, 4, '#6a3a2a', 4, 9.5, 12, 8);
  for (let s = -24; s <= 24; s += 8) b.box(0.3, 4, 0.3, '#3a3a3a', s, 1.1, 5.4);
  b.box(54, 0.3, 4.4, '#4b5560', 0, 5.1, 5.2);
  // clock/sign
  b.box(4, 1.2, 0.3, '#2b3e5c', 0, 3.6, 7.8);
  return b.build();
}

// ---------------- rolling stock (forward = +z) ----------------
const cache = new Map();
function wheelsAndFrame(b, len) {
  b.box(2.5, 0.45, len, '#262626', 0, 0.85, 0);
  for (const z of [-len / 2 + 1.6, len / 2 - 1.6]) {
    b.box(2.2, 0.5, 2.4, '#1c1c1c', 0, 0.4, z);
    for (const dz of [-0.7, 0.7]) for (const x of [-1.2, 1.2]) b.cyl(0.45, 0.45, 0.2, '#2a2a2a', x, 0.45, z + dz, 10, 0, 0, PI / 2);
  }
}
export function locoModel(def) {
  const key = 'loco|' + def.id;
  if (cache.has(key)) return cache.get(key);
  const b = new PartBuilder();
  const c = def.color, t = def.trim, big = def.power > 2;
  b.box(2.4, 0.6, 11.6, '#1d1d1d', 0, 0.7, 0.2);
  const drivers = big ? [-1.4, 0.0, 1.4, 2.8] : (def.speed > 45 ? [-0.6, 1.8] : [-1.2, 0.6, 2.4].slice(0, def.power > 1.5 ? 3 : 2));
  const dr = big ? 0.8 : (def.speed > 45 ? 1.15 : 1.0);
  for (const z of drivers) for (const x of [-1.25, 1.25]) {
    b.cyl(dr, dr, 0.22, '#1b1b1b', x, dr, z, 16, 0, 0, PI / 2);
    b.cyl(dr * 0.75, dr * 0.75, 0.24, t, x, dr, z, 16, 0, 0, PI / 2);
  }
  for (const z of [4.4, 5.3]) for (const x of [-1.1, 1.1]) b.cyl(0.45, 0.45, 0.2, '#1b1b1b', x, 0.45, z, 10, 0, 0, PI / 2);
  b.box(2.7, 0.15, 7.6, '#222', 0, 1.9, 1.8);
  b.cyl(1.0, 1.0, 6.4, c, 0, 2.75, 2.2, 18, PI / 2);
  for (const z of [0.0, 1.6, 3.2, 4.6]) b.cyl(1.03, 1.03, 0.12, t, 0, 2.75, z, 18, PI / 2);
  b.cyl(1.08, 1.08, 1.0, '#222', 0, 2.75, 5.6, 18, PI / 2);
  b.cyl(0.62, 0.38, 1.9, '#1a1a1a', 0, 4.4, 5.2, 12);
  b.cyl(0.42, 0.5, 0.8, t, 0, 4.0, 2.6, 12).cyl(0.3, 0.4, 0.6, t, 0, 3.9, 0.8, 12);
  b.box(0.5, 0.5, 0.5, '#e8d38a', 0, 3.3, 6.15);
  b.add(new THREE.ConeGeometry(1.25, 1.5, 4), '#3a3a3a', 0, 0.8, 6.4, PI / 2, PI / 4, 0, 1, 1, 0.6);
  b.box(2.7, 2.9, 2.6, c, 0, 1.5, -2.4).box(3.0, 0.25, 3.0, '#1e1e1e', 0, 4.4, -2.4);
  b.box(2.75, 0.6, 1.0, '#cfd6d8', 0, 3.2, -2.4);
  b.box(2.6, 1.9, 3.8, c, 0, 1.2, -4.8).box(2.66, 0.2, 3.86, t, 0, 2.6, -4.8).box(2.2, 0.6, 3.2, '#121212', 0, 3.1, -4.8);
  for (const z of [-5.8, -3.8]) for (const x of [-1.15, 1.15]) b.cyl(0.45, 0.45, 0.2, '#1b1b1b', x, 0.45, z, 10, 0, 0, PI / 2);
  const out = { geo: b.build(), len: LOCO_LEN, smoke: [0, 5.4, 5.2] };
  cache.set(key, out); return out;
}
export { WAGON_LEN };
export function wagonModel(type, cargo) {
  const key = type + '|' + (cargo || '');
  if (cache.has(key)) return cache.get(key);
  const b = new PartBuilder(); const L = 8;
  const cc = cargo ? CARGO[cargo].color : null;
  wheelsAndFrame(b, L);
  switch (type) {
    case 'coach':
      b.box(2.6, 2.4, L, '#6b2a26', 0, 1.1, 0).box(2.66, 0.7, L - 0.6, '#d9c99f', 0, 2.2, 0).box(2.8, 0.3, L + 0.2, '#2d2d2d', 0, 3.5, 0);
      break;
    case 'van':
      b.box(2.6, 2.5, L, '#9b2a23', 0, 1.1, 0).box(2.8, 0.3, L + 0.2, '#2d2d2d', 0, 3.6, 0).box(2.66, 0.6, 1.4, '#e3d2a5', 0, 2.2, 0);
      break;
    case 'box':
      b.box(2.6, 2.6, L, '#7a4a2e', 0, 1.1, 0).box(2.8, 0.25, L + 0.2, '#4a3020', 0, 3.7, 0).box(2.66, 2.0, 1.6, '#6a3f26', 0, 1.3, 0);
      if (cc) b.box(2.68, 0.4, 2.2, cc, 0, 2.9, 2.6);
      break;
    case 'reefer':
      b.box(2.6, 2.6, L, '#e6e1d4', 0, 1.1, 0).box(2.8, 0.25, L + 0.2, '#8a8a84', 0, 3.7, 0).box(2.66, 0.4, L - 1, cc || '#b4b0a4', 0, 2.8, 0);
      break;
    case 'stock':
      b.box(2.6, 2.4, L, '#8a6a42', 0, 1.1, 0);
      for (let y = 1.5; y < 3.4; y += 0.6) b.box(2.66, 0.2, L - 0.4, '#5e4428', 0, y, 0);
      b.box(2.8, 0.25, L + 0.2, '#4a3a2a', 0, 3.6, 0);
      break;
    case 'hopper':
      b.box(2.6, 2.2, L, '#3b3b3b', 0, 1.1, 0).box(2.2, 0.4, L - 0.4, '#2a2a2a', 0, 3.2, 0);
      if (cc) b.add(new THREE.BoxGeometry(2.3, 0.9, L - 0.6), cc, 0, 3.3, 0, 0, 0, 0, 1, 1, 1);
      break;
    case 'tank':
      b.box(2.4, 0.4, L, '#262626', 0, 1.1, 0).cyl(1.3, 1.3, L - 0.6, cc ? '#1d1d1d' : '#2a2a2a', 0, 2.75, 0, 16, PI / 2).cyl(0.5, 0.5, 0.6, '#444', 0, 4.2, 0, 10);
      if (cc) b.cyl(1.32, 1.32, 0.8, cc, 0, 2.75, 0, 16, PI / 2);
      break;
    case 'autorack':
      b.box(2.7, 0.3, L, '#2f3338', 0, 1.1, 0);
      for (const z of [-3.8, -1.3, 1.3, 3.8]) for (const x of [-1.3, 1.3]) b.box(0.18, 3.4, 0.18, '#4a5058', x, 1.3, z);
      b.box(2.7, 0.2, L, '#3a4048', 0, 2.75, 0).box(2.8, 0.2, L + 0.2, '#3a4048', 0, 4.55, 0);
      if (cc) for (const y of [1.4, 2.95]) for (const z of [-2.1, 2.1]) b.box(1.7, 0.8, 3.4, cc, 0, y, z).box(1.5, 0.5, 1.8, '#cfd8dc', 0, y + 0.8, z - 0.2);
      break;
    case 'flat':
    default:
      b.box(2.6, 0.4, L, '#4b3a2a', 0, 1.1, 0);
      for (const z of [-3.6, -1.2, 1.2, 3.6]) for (const x of [-1.2, 1.2]) b.box(0.15, 1.2, 0.15, '#333', x, 1.5, z);
      if (cargo === 'logs') { for (let k = 0; k < 5; k++) b.cyl(0.5, 0.5, L - 0.4, cc, -1 + (k % 3) * 1, 2.0 + Math.floor(k / 3) * 0.85, 0, 8, PI / 2); }
      else if (cargo === 'machinery') { b.box(2.2, 1.6, 3, cc, 0, 1.5, -1.8).cyl(0.9, 0.9, 2.2, '#2f4f80', 0, 2.4, 2, 12, 0, 0, PI / 2); }
      else if (cargo === 'steel' || cargo === 'copper') { for (let k = 0; k < 3; k++) b.box(2.2, 0.35, L - 0.8, cc, 0, 1.5 + k * 0.4, 0); }
      else if (cc) { b.box(2.3, 1.2, 3.4, cc, 0, 1.5, -1.9).box(2.3, 1.0, 3.4, darker(cc, 0.85), 0, 1.5, 1.9); }
      break;
  }
  const out = { geo: b.build(), len: WAGON_LEN };
  cache.set(key, out); return out;
}

// ---------------- town buildings / trees (unit geometries for instancing) ----------------
export function unitBox() { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; }
export function unitRoof() {
  const a = Math.SQRT1_2;
  const g = new THREE.BoxGeometry(a, a, 1);
  g.rotateZ(PI / 4); g.scale(1.08, 1, 1.04); // width ~1.08, height ~1
  g.translate(0, 0, 0);
  return g;
}
export function treeGeometries() {
  const con = new PartBuilder();
  con.cyl(0.25, 0.35, 2, '#4a3524', 0, 1, 0, 6).cone(2.2, 4.5, '#2f5a32', 0, 1.6, 0, 7).cone(1.7, 3.8, '#335f35', 0, 3.6, 0, 7).cone(1.1, 3, '#3a6a3b', 0, 5.6, 0, 7);
  const dec = new PartBuilder();
  dec.cyl(0.25, 0.4, 3, '#5a4330', 0, 1.5, 0, 6)
    .add(new THREE.IcosahedronGeometry(2.4, 0), '#4f7a33', 0, 4.6, 0)
    .add(new THREE.IcosahedronGeometry(1.8, 0), '#5d8a3a', 0.9, 5.6, 0.6);
  return { conifer: con.build(), deciduous: dec.build() };
}
// station warehouse, grows with its level (placed beside the station building)
export function warehouseModel(level) {
  const b = new PartBuilder();
  const w = 12 + level * 6, h = 6 + level * 1.5, x = 11 + w / 2;
  b.box(w, h, 10, '#8a6d52', x, 0, 16).roof(10, 3, w, '#4a3f38', x, h, 16, Math.PI / 2);
  for (let k = 0; k < level + 1; k++) b.box(3.2, 3.6, 0.3, '#3a3029', x - w / 2 + 3 + k * 5.5, 0, 10.9);
  if (level >= 2) b.box(8, 5, 8, '#c9cfd2', x + w / 2 + 5, 0, 17).box(8.4, 0.4, 8.4, '#7a8a90', x + w / 2 + 5, 5, 17); // cold store
  if (level >= 3) b.cyl(2.6, 2.6, 9, '#b9b6ac', x + w / 2 + 5, 4.5, 8.5, 14);
  for (let k = 0; k < 3; k++) b.box(1.4, 1.2, 1.4, '#9a7b55', x - w / 2 + 2 + k * 1.8, 0, 22);
  return b.build();
}
export function churchModel() {
  const b = new PartBuilder();
  b.box(8, 9, 16, '#d8d0bf', 0, 0, 0).roof(8, 5, 16, '#4d4a52', 0, 9, 0);
  b.box(5, 16, 5, '#d0c8b6', 0, 0, -9).cone(3.6, 9, '#4d4a52', 0, 16, -9, 4);
  return b.build();
}
