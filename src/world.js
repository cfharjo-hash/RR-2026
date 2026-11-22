// The map's towns, industries and stations (pure data and rules; drawn by view/worldView.js).
// Changes the view must show go through `this.view` (null when the game runs headless).
import { INDUSTRY, TOWN_NAMES, TOWN_POOL, CARGO, ECON, TOWN_ACCEPTS } from './data.js';
import { mulberry32, smoothstep, clamp } from './util.js';
import { Vec3 } from './math.js';
import { CITIES, TERRITORIES, FRONTIER, FRONTIER_NAMES } from './continent.js';

// random numbers each industry's 3D model uses (models.js industryModel): drawn here, in the map's stream,
// so town layout comes out exactly as when the models drew them (the view checks the count)
export const LOOK_DRAWS = { ranch: 72 };

export class World {
  constructor(terrain, seed = 11) {
    this.terrain = terrain; this.seed = seed; this.rand = mulberry32(seed); this.view = null;
    // map 0 keeps its original names; other maps draw theirs from a larger pool (own stream, so layout is unaffected)
    this.names = TOWN_NAMES.slice();
    if (terrain.map) {
      const r = mulberry32(seed ^ 0x85ebca6b), pool = TOWN_POOL.slice();
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      this.names = pool.slice(0, TOWN_NAMES.length);
    }
    this.towns = []; this.industries = []; this.stations = [];
    this.stationSeq = 0; // station ids (a removed station's id is never reused)
  }

  okSite(x, z, minDist, maxSlope = 0.12) {
    const t = this.terrain;
    if (!t.inBounds(x, z, 120)) return false;
    const h = t.heightAt(x, z);
    if (h < 3) return false;
    if (t.slopeAt(x, z, 30) > maxSlope) return false;
    if (t.riverDist(x, z) < 130) return false;
    for (const o of this.towns) if (Math.hypot(o.x - x, o.z - z) < minDist + 120) return false;
    for (const o of this.industries) if (Math.hypot(o.x - x, o.z - z) < minDist) return false;
    return true;
  }

  flattenSite(x, z, r, y, mark = 1) {
    this.terrain.modify(x - r * 1.8, z - r * 1.8, x + r * 1.8, z + r * 1.8, (px, pz) => {
      const d = Math.hypot(px - x, pz - z);
      if (d > r * 1.8) return null;
      return { h: y, w: smoothstep(r * 1.8, r, d), mark: d < r ? mark : 0 };
    }, mark);
  }

  generate() {
    if (this.terrain.cont) return this.generateContinent();
    const r = this.rand, t = this.terrain;
    // towns
    let tries = 0;
    while (this.towns.length < this.names.length && tries++ < 4000) {
      const x = (r() * 2 - 1) * 1250, z = (r() * 2 - 1) * 1250;
      if (!this.okSite(x, z, 0, 0.09)) continue;
      if (this.towns.some(o => Math.hypot(o.x - x, o.z - z) < 650)) continue;
      if (t.map && this.towns.length < 2 && tries < 3000 && t.riverDist(x, z) > 320) continue; // new maps: two river towns, so harbors are possible
      const pop = 600 + Math.floor(r() * 2400);
      this.towns.push({ id: 'T' + this.towns.length, type: 'town', name: this.names[this.towns.length], x, z, pop, angle: r() * Math.PI, growth: 0, delivered: {}, supply: { passengers: 0, mail: 0 }, demandMul: {} });
    }
    // industries
    const order = Object.entries(INDUSTRY).sort((a, b) => a[1].tier - b[1].tier);
    for (const [key, def] of order) {
      for (let n = 0; n < def.count; n++) {
        let best = null, bestScore = -1e9;
        // if no site is found, look again with more tries and looser rules (rugged maps; never needed on map 0)
        for (let pass = 0; pass < 3 && !best; pass++) for (let k = 0; k < 140 * (pass + 1); k++) {
          const x = (r() * 2 - 1) * 1330, z = (r() * 2 - 1) * 1330;
          const big = def.kind === 'farm' || def.kind === 'ranch', loose = 1 + pass * 0.4;
          if (!this.okSite(x, z, (big ? 230 : 170) / loose, (big ? 0.07 : 0.12) * loose)) continue;
          const h = t.heightAt(x, z);
          let s = r() * 10;
          if (def.terrain === 'hill') s += h * 0.4;
          if (def.terrain === 'flat' || def.terrain === 'low') s -= h * 0.4 + t.slopeAt(x, z, 40) * 200;
          if (def.terrain === 'forest') s += this.forestMask(x, z) * 60;
          // customers: the wharf on the river, the mint by a town, forts out in the wilds
          if (def.terrain === 'river') s -= Math.abs(t.riverDist(x, z) - 170) * 0.5;
          if (def.terrain === 'town') s -= Math.min(...this.towns.map(o => Math.hypot(o.x - x, o.z - z))) * 0.3;
          if (def.terrain === 'remote') s += Math.min(...this.towns.map(o => Math.hypot(o.x - x, o.z - z))) * 0.1;
          if (def.tier > 0) { const dt = Math.min(...this.towns.map(o => Math.hypot(o.x - x, o.z - z))); s -= Math.abs(dt - 330) * 0.08; }
          if (s > bestScore) { bestScore = s; best = { x, z }; }
        }
        if (!best) continue;
        this.industries.push({ id: 'I' + this.industries.length, type: 'industry', key, def, name: def.name, x: best.x, z: best.z,
          stock: {}, level: 1, producedLastMonth: {}, transportedLastMonth: {}, boostStock: {}, active: false, history: [], dormant: (def.year || 0) > 1850 });
      }
    }
    // flatten & mark sites
    for (const ind of this.industries) {
      const big = ind.def.kind === 'farm' || ind.def.kind === 'ranch';
      ind.y = Math.max(3, t.heightAt(ind.x, ind.z));
      ind.rot = r() * Math.PI * 2;
      this.flattenSite(ind.x, ind.z, big ? 75 : 46, ind.y, ind.def.kind === 'farm' ? 0 : 1);
    }
    for (const town of this.towns) {
      town.y = t.heightAt(town.x, town.z);
      this.flattenSite(town.x, town.z, 40, town.y, 2);
    }
  }

  // The continent: its named cities where the plan puts them, extra towns in the interior (more in the east), and each
  // industry in its home regions (def.regions), several times as many as on a classic map.
  generateContinent() {
    const r = this.rand, t = this.terrain, H = t.half;
    const used = new Set();
    const addTown = (x, z, name, pop, extra = {}) => {
      used.add(name);
      this.towns.push({ id: 'T' + this.towns.length, type: 'town', name, x, z, pop, angle: r() * Math.PI, growth: 0, delivered: {}, supply: { passengers: 0, mail: 0 }, demandMul: {}, ...extra });
    };
    for (const c of CITIES) {
      for (let k = 0; k < 200; k++) { // (searching wider and wider: the coast moves a little with the seed)
        const rad = 220 + k * 4, x = c.u * H + (k ? (r() * 2 - 1) * rad : 0), z = c.v * H + (k ? (r() * 2 - 1) * rad : 0);
        if (!this.okSite(x, z, 0, 0.12) || this.towns.some(o => Math.hypot(o.x - x, o.z - z) < 500)) continue;
        addTown(x, z, c.name, Math.round(c.pop * (0.85 + r() * 0.3)), { city: true, ...(c.port ? { port: c.port } : {}) });
        break;
      }
    }
    const pool = TOWN_POOL.filter(n => !used.has(n));
    for (let tries = 0; this.towns.length < CITIES.length + 14 && pool.length && tries < 6000; tries++) {
      const x = (r() * 2 - 1) * (H - 300), z = (r() * 2 - 1) * (H - 300), reg = t.regionAt(x, z);
      if (!reg || (reg === 'mountains' || reg === 'southwest' || reg === 'pacific') && r() < 0.6) continue; // (the west is thinly settled)
      if (!this.okSite(x, z, 0, 0.09) || this.towns.some(o => Math.hypot(o.x - x, o.z - z) < 700)) continue;
      const west = x < -0.35 * H;
      addTown(x, z, pool.splice(Math.floor(r() * pool.length), 1)[0], Math.round((west ? 400 : 700) + r() * (west ? 900 : 2000)));
    }
    // industries
    const mult = [3, 3, 2, 1]; // (raw producers and their first processors in step, so works do not drown in ore)
    const order = Object.entries(INDUSTRY).sort((a, b) => a[1].tier - b[1].tier);
    for (const [key, def] of order) {
      const count = def.ccount ?? def.count * mult[def.tier];
      for (let n = 0; n < count; n++) {
        let best = null, bestScore = -1e9;
        for (let pass = 0; pass < 3 && !best; pass++) for (let k = 0; k < 300 * (pass + 1); k++) {
          const x = (r() * 2 - 1) * (H - 200), z = (r() * 2 - 1) * (H - 200);
          const reg = t.regionAt(x, z);
          if (!reg || (def.regions && pass < 2 && !def.regions.includes(reg))) continue;
          const big = def.kind === 'farm' || def.kind === 'ranch', loose = 1 + pass * 0.4;
          if (!this.okSite(x, z, (big ? 230 : 170) / loose, (big ? 0.07 : 0.12) * loose)) continue;
          const h = t.heightAt(x, z);
          let s = r() * 10;
          if (def.terrain === 'hill') s += Math.min(h, 70) * 0.25; // (hilly, not the high peaks)
          if (def.terrain === 'flat' || def.terrain === 'low') s -= t.slopeAt(x, z, 40) * 200;
          if (def.terrain === 'forest') s += this.forestMask(x, z) * 60;
          const dt = Math.min(...this.towns.map(o => Math.hypot(o.x - x, o.z - z)));
          if (def.tier === 1 || def.tier === 2) {
            s -= Math.abs(dt - 330) * 0.04; // (works near towns, and near what they work with)
            for (const c of Object.keys(def.in || {})) {
              const src = this.industries.filter(o => o.def.out?.[c] !== undefined);
              if (src.length) s -= Math.min(...src.map(o => Math.hypot(o.x - x, o.z - z))) * 0.02;
            }
          }
          if (def.terrain === 'town') s -= dt * 0.3;
          if (def.terrain === 'remote') s += Math.min(dt, 1500) * 0.05;
          if (def.terrain === 'river') { // wharves: on a coast, by a port city
            const port = Math.min(...this.towns.filter(o => o.port).map(o => Math.hypot(o.x - x, o.z - z)));
            s -= Math.abs(t.coastDist(x, z) - 170) * 0.5 + port * 0.05;
          }
          if (s > bestScore) { bestScore = s; best = { x, z }; }
        }
        if (!best) continue;
        this.industries.push({ id: 'I' + this.industries.length, type: 'industry', key, def, name: def.name, x: best.x, z: best.z,
          stock: {}, level: 1, producedLastMonth: {}, transportedLastMonth: {}, boostStock: {}, active: false, history: [], dormant: (def.year || 0) > 1850 });
      }
    }
    for (const ind of this.industries) {
      const big = ind.def.kind === 'farm' || ind.def.kind === 'ranch';
      ind.y = Math.max(3, t.heightAt(ind.x, ind.z));
      ind.rot = r() * Math.PI * 2;
      this.flattenSite(ind.x, ind.z, big ? 75 : 46, ind.y, ind.def.kind === 'farm' ? 0 : 1);
    }
    for (const town of this.towns) {
      town.y = t.heightAt(town.x, town.z);
      this.flattenSite(town.x, town.z, 40, town.y, 2);
    }
    // the frontier: sites for towns founded later, and the territories' industries held back (with their own random
    // stream, so everything above stays as it was)
    const fr = mulberry32(this.seed ^ 0x7e5a11ed), names = FRONTIER_NAMES.filter(n => !this.towns.some(o => o.name === n));
    this.frontierSites = {};
    for (const [reg, T] of Object.entries(TERRITORIES)) {
      const sites = this.frontierSites[reg] = [];
      for (let k = 0; k < 5000 && sites.length < T.sites && names.length; k++) {
        const x = (fr() * 2 - 1) * (H - 300), z = (fr() * 2 - 1) * (H - 300);
        if (t.regionAt(x, z) !== reg || !this.okSite(x, z, 0, 0.09)) continue;
        if ([...this.towns, ...sites].some(o => Math.hypot(o.x - x, o.z - z) < 650) || this.industries.some(i => Math.hypot(i.x - x, i.z - z) < 260)) continue;
        sites.push({ x, z, name: names.splice(Math.floor(fr() * names.length), 1)[0], angle: fr() * Math.PI, region: reg });
      }
      for (const ind of this.industries) {
        if (ind.def.consumer || t.regionAt(ind.x, ind.z) !== reg) continue;
        ind.frontier = reg;
        if (fr() > FRONTIER.keep) ind.dormant = true;
      }
    }
  }
  // a town founded on the frontier (sim: Frontier.found). Its site is not levelled (track may already run near it), and
  // lots where blocked(x, z) (stations, track) stay empty. Returns the town.
  foundTown(site, blocked = () => false) {
    const t = this.terrain;
    const town = { id: 'T' + this.towns.length, type: 'town', name: site.name, x: site.x, z: site.z, y: t.heightAt(site.x, site.z), pop: FRONTIER.townPop,
      angle: site.angle, growth: 0, delivered: {}, supply: { passengers: 0, mail: 0 }, demandMul: {}, founded: true };
    this.towns.push(town);
    this.layoutTown(town, mulberry32(this.seed ^ (0x51 + this.towns.length * 7919)), blocked);
    this.view?.townAdded(town);
    return town;
  }

  forestMask(x, z) {
    const n = this.terrain.noise2(x * 0.0022 + 40, z * 0.0022 - 13) * 0.6 + this.terrain.noise(x * 0.009, z * 0.009) * 0.4;
    return smoothstep(0.0, 0.35, n);
  }

  // Town lots and buildings, drawn from the map's random stream after the industries' model numbers, in the
  // same order as always (town coverage depends on the lots). Trees come after this and are the view's.
  layout() {
    const r = this.rand;
    for (const ind of this.industries) ind.look = Array.from({ length: LOOK_DRAWS[ind.key] || 0 }, () => r());
    for (const town of this.towns) this.layoutTown(town);
  }
  layoutTown(town, r = this.rand, blocked = null) {
    const t = this.terrain;
    const ca = Math.cos(town.angle), sa = Math.sin(town.angle);
    const lots = [];
    const sp = 15;
    for (let u = -16; u <= 16; u++) for (let v = -16; v <= 16; v++) {
      if (u % 4 === 0 || v % 5 === 0) continue; // streets
      const lx = u * sp + (r() - 0.5) * 3, lz = v * sp * 0.8 + (r() - 0.5) * 3;
      const x = town.x + lx * ca - lz * sa, z = town.z + lx * sa + lz * ca;
      const d = Math.hypot(lx, lz);
      if (d < 26) continue;
      if (!t.inBounds(x, z, 30)) continue;
      const h = t.heightAt(x, z);
      if (h < 1.5 || t.slopeAt(x, z, 6) > 0.35 || blocked?.(x, z)) continue;
      lots.push({ x, z, d: d + r() * 40 });
    }
    lots.sort((a, b) => a.d - b.d);
    const max = Math.min(lots.length, 420), buildings = [];
    for (let k = 0; k < max; k++) {
      const L = lots[k];
      const centrality = clamp(1 - L.d / 260, 0, 1);
      const w = 8 + r() * 4, d = 7 + r() * 4, h = 5 + r() * 3 + centrality * (6 + r() * 9);
      const y = Math.min(t.heightAt(L.x - 4, L.z - 4), t.heightAt(L.x + 4, L.z + 4), t.heightAt(L.x, L.z)) - 0.6;
      const rot = -town.angle + (r() < 0.5 ? 0 : Math.PI / 2);
      const wall = r(), rh = 2.5 + r() * 2.5, roof = r(); // (colour picks: the view maps them to its palettes)
      buildings.push({ x: L.x, y, z: L.z, w, d, h, rot, wall, rh, roof });
    }
    town.lots = lots; town.buildings = buildings; town.maxBuildings = max;
    this.updateTownSize(town);
    town.radius = 0;
  }

  updateTownSize(town) {
    const n = clamp(Math.round(town.pop / 22), 8, town.maxBuildings);
    town.built = n; // buildings standing
    town.radius = town.lots[n - 1] ? Math.hypot(town.lots[n - 1].x - town.x, town.lots[n - 1].z - town.z) : 60;
    this.view?.townResized(town);
  }
  // trees are scenery: the view clears them from new earthworks and re-seats them on changed ground
  clearTrees(test) { this.view?.clearTrees(test); }
  reseatTrees(minX, minZ, maxX, maxZ) { this.view?.reseatTrees(minX, minZ, maxX, maxZ); }
  // demolish town buildings on a footprint (inside(x, z) in the footprint)
  raze(inside) {
    for (const town of this.towns) {
      let hit = false;
      town.lots.forEach(lot => { if (!lot.razed && inside(lot.x, lot.z)) { lot.razed = true; hit = true; } });
      if (hit) this.view?.townRazed(town);
    }
  }

  // ---------- stations ----------
  stationCheck(x, z) {
    const t = this.terrain;
    if (!t.inBounds(x, z, 60)) return 'Too close to map edge';
    if (t.heightAt(x, z) < 1.5) return 'Cannot build on water';
    if (t.slopeAt(x, z, 25) > 0.22) return 'Terrain too steep';
    for (const s of this.stations) if (Math.hypot(s.x - x, s.z - z) < (s.depot ? 50 : 90)) return 'Too close to another station';
    for (const i of this.industries) if (Math.hypot(i.x - x, i.z - z) < 50) return 'Overlaps an industry';
    for (const tw of this.towns) if (Math.hypot(tw.x - x, tw.z - z) < 30) return 'Overlaps town centre';
    return null;
  }
  coverage(x, z) {
    const R = ECON.catchment;
    const inds = this.industries.filter(i => Math.hypot(i.x - x, i.z - z) < R + 20);
    const towns = this.towns.filter(t => Math.hypot(t.x - x, t.z - z) < R + Math.max(40, t.radius * 0.6));
    return { inds, towns };
  }
  // road depot: a small road stop (yard and shed) with a normal catchment
  depotCheck(x, z) {
    const t = this.terrain;
    if (!t.inBounds(x, z, 40)) return 'Too close to map edge';
    if (t.heightAt(x, z) < 1.5) return 'Cannot build on water';
    if (t.slopeAt(x, z, 12) > 0.3) return 'Terrain too steep';
    for (const s of this.stations) if (Math.hypot(s.x - x, s.z - z) < (s.depot ? 40 : 60)) return 'Too close to another stop';
    for (const i of this.industries) if (Math.hypot(i.x - x, i.z - z) < 35) return 'Overlaps an industry';
    for (const tw of this.towns) if (Math.hypot(tw.x - x, tw.z - z) < 20) return 'Overlaps town centre';
    return null;
  }
  addDepot(x, z, angle, name) {
    const t = this.terrain, y = Math.max(2, t.heightAt(x, z));
    t.modify(x - 24, z - 24, x + 24, z + 24, (px, pz) => { const d = Math.hypot(px - x, pz - z); return d > 22 ? null : { h: y - 0.1, w: smoothstep(22, 10, d), mark: d < 9 ? 1 : 0 }; });
    this.world_reseat(x, z, 26);
    this.clearTrees((px, pz) => Math.hypot(px - x, pz - z) < 18);
    this.raze((px, pz) => Math.hypot(px - x, pz - z) < 14);
    const st = { id: 'S' + this.stationSeq++, type: 'station', depot: true, name, x, y, z, angle, axis: new Vec3(Math.cos(angle), 0, Math.sin(angle)), waiting: {}, cov: this.coverage(x, z), edges: [], served: 0, created: 0 };
    this.stations.push(st);
    this.view?.stationAdded(st);
    return st;
  }
  addStation(x, z, angle, name) {
    const t = this.terrain;
    const y = Math.max(2, t.heightAt(x, z));
    const L = ECON.platformLen;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    t.modify(x - 80, z - 80, x + 80, z + 80, (px, pz) => {
      const dx = px - x, dz = pz - z;
      const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca; // local coords (x along platform)
      const ox = Math.max(0, Math.abs(lx) - (L / 2 + 44)), oz = Math.max(0, Math.abs(lz + 1) - 26);
      const d = Math.hypot(ox, oz);
      if (d > 28) return null;
      return { h: y - 0.15, w: smoothstep(28, 0, d), mark: d < 2 ? 1 : 0 };
    });
    this.world_reseat(x, z, 90);
    this.clearTrees((px, pz) => Math.hypot(px - x, pz - z) < 70);
    // demolish town buildings on the station footprint
    this.raze((px, pz) => {
      const dx = px - x, dz = pz - z;
      const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
      return Math.abs(lx) < L / 2 + 24 && lz > -30 && lz < 28;
    });
    const st = { id: 'S' + this.stationSeq++, type: 'station', name, x, y, z, angle, waiting: {}, cov: this.coverage(x, z), edges: [], served: 0, created: 0 };
    // axis direction (world) along platform
    st.axis = new Vec3(ca, 0, sa);
    this.stations.push(st);
    this.view?.stationAdded(st);
    return st;
  }
  // what a station here would be, for planning track to it before it is built
  stationStub(x, z, angle) { return { type: 'station', stub: true, x, y: Math.max(2, this.terrain.heightAt(x, z)), z, angle, axis: new Vec3(Math.cos(angle), 0, Math.sin(angle)), edges: [] }; }
  world_reseat(x, z, r) { this.reseatTrees(x - r, z - r, x + r, z + r); }
  activateIndustry(ind) {
    ind.dormant = false;
    this.view?.industryActivated(ind);
  }
  // airfield: level the ground, clear trees and houses, place runway + buildings
  setAirport(st, a) {
    const L = a.len, px = a.dz, pz = -a.dx; // local +x (buildings side)
    const local = (x, z) => { const ux = x - a.x, uz = z - a.z; return { u: ux * a.dx + uz * a.dz, v: ux * px + uz * pz }; };
    const R = L / 2 + 140;
    this.terrain.modify(a.x - R, a.z - R, a.x + R, a.z + R, (x, z) => {
      const { u, v } = local(x, z);
      const ou = Math.max(0, Math.abs(u) - (L / 2 + 22)), ov = Math.max(0, -22 - v, v - 100);
      const d = Math.hypot(ou, ov);
      if (d > 34) return null;
      return { h: a.y - 0.2, w: 1 - Math.min(1, d / 34) ** 2 * (3 - 2 * Math.min(1, d / 34)), mark: d < 1 && v < 14 ? 2 : 0 };
    });
    this.reseatTrees(a.x - R, a.z - R, a.x + R, a.z + R);
    this.clearTrees((x, z) => { const { u, v } = local(x, z); return Math.abs(u) < L / 2 + 40 && v > -40 && v < 120; });
    this.raze((x, z) => { const { u, v } = local(x, z); return Math.abs(u) < L / 2 + 30 && v > -30 && v < 110; });
    this.view?.airportSet(st, a);
  }
  // a station taken down (Game.removeStation has checked it may go)
  removeStation(st) {
    this.stations = this.stations.filter(s => s !== st);
    for (const i of st.cov.inds) i.stations = (i.stations || []).filter(s => s !== st);
    for (const t of st.cov.towns) t.stations = (t.stations || []).filter(s => s !== st);
    this.view?.stationRemoved(st);
  }

  setHarbor(st, berth) { this.view?.harborSet(st, berth); }
  setWarehouse(st, level) { this.view?.warehouseSet(st, level); }
  accepts(st) {
    const set = new Set();
    for (const i of st.cov.inds) {
      if (i.dormant) continue; for (const c of Object.keys(i.def.in || {})) set.add(c); for (const c of Object.keys(i.def.boost || {})) set.add(c); }
    if (st.cov.towns.length) for (const c of TOWN_ACCEPTS) if (c !== 'automobiles') set.add(c); // (classic towns never listed cars here)
    return set;
  }
  supplies(st) {
    const set = new Set();
    for (const i of st.cov.inds) if (!i.dormant) for (const c of Object.keys(i.def.out)) set.add(c);
    if (st.cov.towns.length) { set.add('passengers'); set.add('mail'); }
    return set;
  }
}
