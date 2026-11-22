// Draws the terrain: the ground mesh (vertex colours from height, slope and earthworks), water and map-edge skirt.
// Follows the Terrain heightfield: Terrain.modify() calls onModify, and the changed part is redrawn.
import * as THREE from 'three';
import { makeNoise2D, mulberry32, smoothstep } from '../util.js';
import { canvasTexture } from './gfx.js';
import { WATER_LEVEL } from '../terrain.js';

export class TerrainView {
  constructor(terrain) {
    this.t = terrain;
    terrain.onModify = (i0, i1, j0, j1) => { if (this.mesh) this.refresh(i0, i1, j0, j1); };
  }
  buildMesh() {
    const geo = new THREE.PlaneGeometry(this.t.S, this.t.S, this.t.N, this.t.N);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.geo = geo;
    const uv = geo.attributes.uv;
    const rep = 220 * this.t.S / 3000; // (the detail texture keeps its size on a bigger map)
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * rep, uv.getY(k) * rep);
    const detail = canvasTexture(256, (g, s) => {
      const img = g.createImageData(s, s); const r = mulberry32(3);
      for (let k = 0; k < s * s; k++) {
        const v = 205 + r() * 50; img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.globalAlpha = 0.25;
      for (let k = 0; k < 400; k++) { g.fillStyle = r() < 0.5 ? '#ffffff' : '#9a9a9a'; g.fillRect(r() * s, r() * s, 1 + r() * 3, 4 + r() * 6); }
    });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
    // height overlay (toggle with setOverlay): elevation tint, contour lines every 10 m (heavier every 50 m), and red
    // hatching where the ground is steeper than the steepest track (6%) — drawn per pixel in the terrain's shader
    this.overlay = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uOverlay = this.overlay;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vH; varying float vGrade; varying vec2 vXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y; vXZ = position.xz; vGrade = length(objectNormal.xz) / max(objectNormal.y, 0.05);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uOverlay; varying float vH; varying float vGrade; varying vec2 vXZ;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (uOverlay > 0.5) {
            float h = vH;
            vec3 ramp = h < 0.0 ? vec3(0.12, 0.3, 0.45)
              : h < 25.0 ? mix(vec3(0.16, 0.38, 0.12), vec3(0.42, 0.52, 0.14), h / 25.0)
              : h < 70.0 ? mix(vec3(0.42, 0.52, 0.14), vec3(0.6, 0.42, 0.16), (h - 25.0) / 45.0)
              : h < 130.0 ? mix(vec3(0.6, 0.42, 0.16), vec3(0.42, 0.28, 0.2), (h - 70.0) / 60.0)
              : mix(vec3(0.42, 0.28, 0.2), vec3(0.9, 0.9, 0.9), clamp((h - 130.0) / 30.0, 0.0, 1.0));
            float f10 = h / 10.0, f50 = h / 50.0;
            float l10 = 1.0 - clamp(abs(fract(f10 - 0.5) - 0.5) / max(fwidth(f10), 1e-4), 0.0, 1.0);
            float l50 = 1.0 - clamp(abs(fract(f50 - 0.5) - 0.5) / max(fwidth(f50) * 1.8, 1e-4), 0.0, 1.0);
            vec3 c = ramp;
            float steep = smoothstep(0.06, 0.25, vGrade);
            float hatch = step(0.5, fract((vXZ.x + vXZ.y) / 6.0));
            c = mix(c, vec3(0.75, 0.08, 0.05), steep * (0.45 + 0.4 * hatch));
            c = mix(c, vec3(0.06, 0.05, 0.03), max(l10 * 0.5, l50 * 0.85));
            diffuseColor.rgb = c;
          }`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.refresh(0, this.t.N, 0, this.t.N);
    return this.mesh;
  }

  refresh(i0, i1, j0, j1) {
    const V = this.t.N + 1, pos = this.geo.attributes.position, col = this.geo.attributes.color;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * V + i; pos.setY(k, this.t.h[k]); }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    const nrm = this.geo.attributes.normal;
    const c = new THREE.Color(), t = new THREE.Color();
    const grassA = new THREE.Color('#5b7f34'), grassB = new THREE.Color('#7d8f3e'), dry = new THREE.Color('#9b9555');
    const rock = new THREE.Color('#7b7266'), rock2 = new THREE.Color('#5f5a54'), sand = new THREE.Color('#c9b98a');
    const snow = new THREE.Color('#f2f4f6'), dirt = new THREE.Color('#7e6a4f'), paved = new THREE.Color('#8b8478'), mud = new THREE.Color('#5a5141');
    const a = Math.max(0, i0 - 1), b = Math.min(this.t.N, i1 + 1), cc = Math.max(0, j0 - 1), d = Math.min(this.t.N, j1 + 1);
    for (let j = cc; j <= d; j++) for (let i = a; i <= b; i++) {
      const k = j * V + i, h = this.t.h[k], ny = nrm.getY(k);
      const x = -this.t.half + i * this.t.cell, z = -this.t.half + j * this.t.cell;
      const n1 = this.t.noise(x * 0.004, z * 0.004) * 0.5 + 0.5, n2 = this.t.noise2(x * 0.02, z * 0.02) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, n1 * 0.8 + n2 * 0.2);
      c.lerp(dry, smoothstep(45, 110, h) * 0.8);
      if (h < 3.5) c.lerp(sand, smoothstep(3.5, 1.0, h));
      if (h < -0.5) c.lerp(mud, 0.7);
      const steep = smoothstep(0.88, 0.7, ny);
      t.copy(rock).lerp(rock2, n2); c.lerp(t, steep);
      c.lerp(snow, smoothstep(125, 150, h + n2 * 15) * smoothstep(0.6, 0.8, ny));
      const m = this.t.mark[k];
      if (m === 1) c.lerp(dirt, 0.85); else if (m === 2) c.lerp(paved, 0.9);
      col.setXYZ(k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  // Fast ray vs heightfield (ray-march + bisection)
  raycast(ray) {
    const o = ray.origin, dvec = ray.direction;
    let prev = 0, step = 3;
    for (let t = 0; t < 9000; t += step) {
      const x = o.x + dvec.x * t, y = o.y + dvec.y * t, z = o.z + dvec.z * t;
      if (Math.abs(x) > this.t.half + 5 || Math.abs(z) > this.t.half + 5) { if (t > 6000) break; prev = t; step = Math.min(20, 3 + t * 0.004); continue; }
      const hy = Math.max(this.t.heightAt(x, z), WATER_LEVEL - 0.3);
      if (y <= hy) {
        let lo = prev, hi = t;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          const mx = o.x + dvec.x * m, mz = o.z + dvec.z * m, my = o.y + dvec.y * m;
          if (my <= Math.max(this.t.heightAt(mx, mz), WATER_LEVEL - 0.3)) hi = m; else lo = m;
        }
        const p = new THREE.Vector3(o.x + dvec.x * hi, 0, o.z + dvec.z * hi);
        p.y = this.t.heightAt(p.x, p.z);
        if (Math.abs(p.x) > this.t.half || Math.abs(p.z) > this.t.half) return null;
        return p;
      }
      prev = t; step = Math.min(20, 3 + t * 0.004);
    }
    return null;
  }

  buildWater() {
    const normalTex = canvasTexture(256, (g, s) => {
      const img = g.createImageData(s, s); const n = makeNoise2D(mulberry32(5));
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const f = (u, v) => n(u / 18, v / 18) * 0.6 + n(u / 7, v / 7) * 0.4;
        // tileable-ish via sampling on a torus is overkill; blend edges softly
        const dx = f(x + 1, y) - f(x - 1, y), dy = f(x, y + 1) - f(x, y - 1);
        const k = (y * s + x) * 4;
        img.data[k] = 128 + dx * 160; img.data[k + 1] = 128 + dy * 160; img.data[k + 2] = 255; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    normalTex.colorSpace = THREE.NoColorSpace;
    const span = this.t.S > 3000 ? 6 : 1.6; // (on the continent the sea runs on to the horizon)
    normalTex.repeat.set(60 * span / 1.6, 60 * span / 1.6);
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#2d5b6b', roughness: 0.08, metalness: 0.0, transmission: 0, transparent: true, opacity: 0.86,
      normalMap: normalTex, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.1,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(this.t.S * span, this.t.S * span), mat);
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    this.water = water; this.waterTex = normalTex;
    return water;
  }
  setOverlay(on) { this.overlay.value = on ? 1 : 0; }
  update(dt) { if (this.waterTex) { this.waterTex.offset.x += dt * 0.004; this.waterTex.offset.y += dt * 0.0025; } }

  // skirt to hide map edge
  buildSkirt() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#4d4438', roughness: 1 });
    const V = this.t.N + 1;
    const sides = [
      (t) => [t, 0], (t) => [t, this.t.N], (t) => [0, t], (t) => [this.t.N, t],
    ];
    for (const side of sides) {
      const pos = [];
      for (let t = 0; t < this.t.N; t++) {
        const [i0, j0] = side(t), [i1, j1] = side(t + 1);
        const x0 = -this.t.half + i0 * this.t.cell, z0 = -this.t.half + j0 * this.t.cell, x1 = -this.t.half + i1 * this.t.cell, z1 = -this.t.half + j1 * this.t.cell;
        const h0 = this.t.h[j0 * V + i0], h1 = this.t.h[j1 * V + i1], b = -40;
        pos.push(x0, h0, z0, x1, h1, z1, x1, b, z1, x0, h0, z0, x1, b, z1, x0, b, z0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.material.side = THREE.DoubleSide;
      g.add(m);
    }
    return g;
  }
}
