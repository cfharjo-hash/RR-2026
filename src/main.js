import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { TerrainView } from './view/terrainView.js';
import { WorldView } from './view/worldView.js';
import { JUNCTION_COST, SIGNAL_COST, MAX_GRADE } from './track.js';
import { createGame, generateMap, newGame } from './setup.js';
import { TrackView } from './view/trackView.js';
import { VehicleView } from './view/vehicleView.js';
import { RoadView } from './view/roadView.js';
import { stationModel } from './view/models.js';
import { ECON, FEATURES } from './data.js';
// ?dlc=1: switch on the transport modes held back for an expansion (ships, aircraft, roads)
if (new URLSearchParams(location.search).get('dlc') === '1') Object.assign(FEATURES, { ships: true, planes: true, roads: true });
import { UI } from './ui.js';
import { money, mapSeeds, MAP_MAX, MAP_GEN } from './util.js';
import { writeSlot, readSlot, queueLoad, takePending } from './save.js';

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 40000);

const sky = new Sky();
sky.scale.setScalar(30000); // (it moves with the camera, so even the continent's far corners have a sky)
const su = sky.material.uniforms;
su.turbidity.value = 4.5; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.85;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
su.sunPosition.value.copy(sunDir);
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
Object.assign(sky2.material.uniforms.turbidity, { value: 4.5 }); skyScene.add(sky2);
scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
scene.fog = new THREE.FogExp2('#b9c7cf', 0.00016); // (thinner on the continent: set once the world is known)

const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#bcd3ea', '#5a5240', 0.9));

// ---------------- world ----------------
const loadEl = document.getElementById('loading-msg');
const step = (msg) => { loadEl.textContent = msg; return new Promise(r => setTimeout(r, 20)); };

// the map: a loaded save brings its own seeds; a new game uses ?map=N (0 = the original map, 'random' = pick one)
let pending = takePending();
let pendingErr = null;
if ((pending?.seeds?.map || pending?.seeds?.kind) && (pending.seeds.gen || 1) !== MAP_GEN) { pendingErr = 'This save was made with an older map generator and can’t be rebuilt'; pending = null; }
const qs0 = new URLSearchParams(location.search);
let mapArg = qs0.get('map');
if (mapArg === 'random') mapArg = 1 + Math.floor(Math.random() * MAP_MAX);
// the world: a save's own (a classic 3 km map unless it says continent); a new game is the continent unless ?world=classic
const worldKind = pending ? (pending.seeds?.kind || 'classic') : (qs0.get('world') === 'classic' ? 'classic' : 'continent');
const seeds = { ...(pending ? (pending.seeds?.map || pending.seeds?.kind ? { map: pending.seeds.map || 0, terrain: pending.seeds.terrain, world: pending.seeds.world } : mapSeeds(0)) : mapSeeds(mapArg)), kind: worldKind }; // (saves without a map number are map 0)
if (seeds.map) qs0.set('map', seeds.map); else qs0.delete('map'); // the address always names the map in play (so New game keeps it)
if (worldKind === 'classic') qs0.set('world', 'classic'); else qs0.delete('world');
if (qs0.toString() !== location.search.replace(/^\?/, '')) history.replaceState(null, '', location.pathname + (qs0.toString() ? '?' + qs0 : ''));
// rule set: a save's own (classic if it has none); a new game is continental unless ?rules=classic
const core = createGame(seeds, pending ? (pending.rules || 'classic') : (qs0.get('rules') === 'classic' ? 'classic' : 'continental')), { terrain, world, net, game } = core;
// the views draw the game and follow its changes (attached before the map is generated)
const terrainView = new TerrainView(terrain);
const worldView = new WorldView(scene, world);
const trackView = new TrackView(scene, net);
const vehicleView = new VehicleView(scene, game);
vehicleView.camera = camera;
const roadView = new RoadView(scene, game.roads);
let ui;

async function init() {
  await step('Placing towns and industries…');
  generateMap(core);
  await step('Sculpting terrain…');
  scene.add(terrainView.buildMesh(), terrainView.buildWater(), terrainView.buildSkirt());
  await step('Raising buildings and forests…');
  worldView.build();
  await step('Opening the company books…');
  ui = new UI(game, world, net, api);
  window.__ih = { game, world, net, api, terrain, ui, camera, controls, renderer, scene }; // debug handle
  const t0 = world.towns[0];
  controls.target.set(t0.x, t0.y, t0.z);
  camera.position.set(t0.x + 420, t0.y + 520, t0.z + 520);
  controls.update();
  if (pending) {
    await step('Rebuilding your railroad…');
    try {
      game.load(pending);
      const v = pending.view;
      if (v) { controls.target.set(...v.target); camera.position.set(...v.camera); controls.update(); }
      ui.setSpeed(0);
      ui.toast(`Game loaded — ${pending.meta.date} (paused, press Space)`);
      if (game.ousted) ui.openOusted(game.comp(game.ousted.by)); // a save made at the moment you were ousted
    } catch (err) { console.error(err); ui.toast('Load failed: ' + err.message, true); }
    document.getElementById('loading').classList.add('hide');
  } else {
    // a new game: rival companies (2 by default; ?rivals=0..3 in the address changes it)
    // balance runs: ?seed=N varies the random streams, ?personalities=builder,financier,… reassigns the rivals
    // ?competition=friendly: rivals never buy shares · cutthroat: + rate wars and short selling
    const qs = new URLSearchParams(location.search), nr = qs.get('rivals');
    newGame(game, { rivals: nr === null ? 2 : +nr || 0, difficulty: qs.get('difficulty') || 'normal', seed: +qs.get('seed') || 0,
      personalities: qs.get('personalities')?.split(','), competition: qs.get('competition') });
    document.getElementById('loading').classList.add('hide');
    ui.showWelcome();
    if (pendingErr) ui.toast(pendingErr, true);
  }
  game.on('year', () => { if (!game.ousted) api.save('auto', true); });
  renderer.setAnimationLoop(loop);
}

// ---------------- controls ----------------
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.maxPolarAngle = 1.38; controls.minDistance = 22; controls.maxDistance = terrain.S > 3000 ? 15000 : 3200;
if (terrain.S > 3000) scene.fog.density = 0.000045;
controls.zoomSpeed = 1.4; controls.screenSpacePanning = false;
const keys = new Set();
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; keys.add(e.key.toLowerCase()); onKey(e); });
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------- particles (smoke) ----------------
class Smoke {
  constructor(max = 4000) {
    this.max = max; this.n = 0; this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.shade = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aShade', new THREE.BufferAttribute(this.shade, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; varying float vA; varying float vS;
        void main(){ vA=aAlpha; vS=aShade; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*(900.0/-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; varying float vS; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d)*vA; if(a<0.01) discard; gl_FragColor=vec4(vec3(vS),a); }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, size, life, shade) {
    if (this.p.length >= this.max) return;
    this.p.push({ x, y, z, vx: (Math.random() - 0.5) * 1.5, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, age: 0, life, size, shade });
  }
  update(dt) {
    const wind = 2.2;
    let k = 0;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i]; q.age += dt;
      if (q.age > q.life) continue;
      q.x += (q.vx + wind) * dt; q.y += q.vy * dt; q.z += (q.vz + wind * 0.4) * dt; q.vy *= 0.995;
      const t = q.age / q.life;
      this.pos[k * 3] = q.x; this.pos[k * 3 + 1] = q.y; this.pos[k * 3 + 2] = q.z;
      this.size[k] = q.size * (0.4 + t * 1.6); this.alpha[k] = (1 - t) * Math.min(1, t * 6) * 0.55; this.shade[k] = q.shade;
      this.p[k++] = q;
    }
    this.p.length = k;
    const g = this.points.geometry; g.setDrawRange(0, k);
    for (const a of ['position', 'aSize', 'aAlpha', 'aShade']) g.attributes[a].needsUpdate = true;
  }
}
const smoke = new Smoke();

// ---------------- tools ----------------
const ghostMat = new THREE.MeshBasicMaterial({ color: '#6dff8e', transparent: true, opacity: 0.45, depthWrite: false });
const ghost = new THREE.Mesh(stationModel(), ghostMat); ghost.visible = false; scene.add(ghost);
const ringGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, () => new THREE.Vector3()));
const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.9, depthTest: false }));
ring.visible = false; ring.renderOrder = 9; scene.add(ring);
const wpGroup = new THREE.Group(); scene.add(wpGroup);
const wpGeo = new THREE.CylinderGeometry(1.5, 1.5, 10, 10); const wpMat = new THREE.MeshBasicMaterial({ color: '#ffe08a' });

const snapMark = new THREE.Mesh(new THREE.TorusGeometry(7, 0.9, 6, 32), new THREE.MeshBasicMaterial({ color: '#5fe3ff', transparent: true, opacity: 0.9, depthTest: false }));
snapMark.rotation.x = Math.PI / 2; snapMark.renderOrder = 11; snapMark.visible = false; scene.add(snapMark);
const showSnap = (o) => { snapMark.visible = !!o; if (o) { const q = o.p || o; snapMark.position.set(q.x, (q.y ?? terrain.heightAt(q.x, q.z)) + 2, q.z); } };

const tool = { mode: 'select', angle: 0, from: null, wps: [], plan: null, hover: null, orders: [], buy: null, double: false, grade: MAX_GRADE };
// the grade limits the track tool offers ( [ flatter, ] steeper ): flatter lines cost more (cuttings, embankments,
// bridges) but loaded trains climb them much faster
const GRADES = [0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, MAX_GRADE];

// Snap-style laying: the next point turns from the line so far by whole 7.5° steps (up to 45° for track, 60° for
// roads), and runs straight ahead when the turn is small; so every click gives a smooth curve that can be built.
// Hold Shift to place a point freely.
function snapPoint(p) {
  if (!p || !tool.from || keys.has('shift')) return p;
  const pts = [], from = tool.from;
  let last, dir;
  if (tool.wps.length) {
    last = tool.wps[tool.wps.length - 1];
    const prev = tool.wps.length > 1 ? tool.wps[tool.wps.length - 2] : (from.type === 'jc' ? from.p : from.type === 'rjc' ? from.p : from);
    dir = { x: last.x - prev.x, z: last.z - prev.z };
  } else if (from.type === 'station' && from.axis && tool.mode === 'track') {
    const side = Math.sign((p.x - from.x) * from.axis.x + (p.z - from.z) * from.axis.z) || 1;
    dir = { x: from.axis.x * side, z: from.axis.z * side };
    last = { x: from.x + dir.x * (ECON.platformLen / 2 + 22), z: from.z + dir.z * (ECON.platformLen / 2 + 22) };
  } else if (from.type === 'jc' && from.t) {
    const side = Math.sign((p.x - from.p.x) * from.t.x + (p.z - from.p.z) * from.t.z) || 1;
    dir = { x: from.t.x * side, z: from.t.z * side };
    last = { x: from.p.x + dir.x * 34, z: from.p.z + dir.z * 34 };
  } else return p; // a road from a stop or a road: free first point
  const dl = Math.hypot(dir.x, dir.z) || 1, vx = p.x - last.x, vz = p.z - last.z, L = Math.hypot(vx, vz);
  if (L < 25) return p;
  const a0 = Math.atan2(dir.z / dl, dir.x / dl);
  let turn = Math.atan2(vz, vx) - a0; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI;
  const step = Math.PI / 24, max = tool.mode === 'road' ? Math.PI / 3 : Math.PI / 4;
  turn = Math.max(-max, Math.min(max, Math.round(turn / step) * step));
  const x = last.x + Math.cos(a0 + turn) * L, z = last.z + Math.sin(a0 + turn) * L;
  return new THREE.Vector3(x, terrain.heightAt(x, z), z);
}
const api = {
  tool, scene, camera, controls,
  setTool(m) {
    tool.mode = m; tool.from = null; tool.wps = []; tool.plan = null; tool.orders = [];
    trackView.showPreview(null); roadView.showPreview(null); showSnap(null); ghost.visible = false; ring.visible = false; refreshWps();
    ui.setToolUI(m);
  },
  // one step flatter (-1) or steeper (+1)
  setGrade(step) {
    const i = GRADES.indexOf(tool.grade), j = Math.max(0, Math.min(GRADES.length - 1, (i < 0 ? GRADES.length - 1 : i) + step));
    tool.grade = GRADES[j]; ui.setToolUI(tool.mode);
    if (tool.mode === 'track') onMove({ clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement });
  },
  follow: null,
  view() { return { target: controls.target.toArray().map(Math.round), camera: camera.position.toArray().map(Math.round) }; },
  save(slot, quiet = false) {
    if (game.ousted) { ui.toast('You are no longer chairman, so this game cannot be saved', true); return 'ousted'; }
    const err = writeSlot(slot, game.serialize(api.view()));
    if (err) ui.toast(err, true); else if (!quiet) ui.toast(`Saved — ${game.dateStr()}`);
    if (slot === 'auto' && !err) ui.news('💾 Autosaved');
    return err;
  },
  load(slot) {
    const d = readSlot(slot);
    if (!d) { ui.toast('Nothing saved there yet', true); return; }
    const err = queueLoad(d); if (err) ui.toast(err, true);
  },
  loadData(d) { const err = queueLoad(d); if (err) ui.toast(err, true); },
  newGame() { location.reload(); },
  heights: false,
  toggleHeights(on = !api.heights) { api.heights = on; terrainView.setOverlay(on); ui.heightLegend(on); },
  map: seeds.map,
  newMap(n) { const q = new URLSearchParams(location.search); q.set('map', n); location.href = location.pathname + '?' + q; },
  focus(x, y, z) { const d = new THREE.Vector3().subVectors(camera.position, controls.target); controls.target.set(x, y, z); camera.position.copy(controls.target).add(d); },
  // look at a place from `dist` away (the current viewing direction kept)
  flyTo(x, y, z, dist) {
    const d = new THREE.Vector3().subVectors(camera.position, controls.target).normalize().multiplyScalar(dist);
    if (d.y < dist * 0.45) d.set(d.x, dist * 0.7, d.z).setLength(dist); // (not from too low)
    controls.target.set(x, y, z); camera.position.copy(controls.target).add(d); controls.update(); api.follow = null;
  },
  // the whole map from above
  overview() { const S = terrain.S; controls.target.set(0, 0, S * 0.05); camera.position.set(0, S * (S > 3000 ? 0.9 : 0.8), S * (S > 3000 ? 0.62 : 0.55)); controls.update(); api.follow = null; },
};

function refreshWps() {
  wpGroup.clear();
  for (const w of tool.wps) { const m = new THREE.Mesh(wpGeo, wpMat); m.position.set(w.x, terrain.heightAt(w.x, w.z) + 5, w.z); wpGroup.add(m); }
}
function updateRing(x, z, r) {
  const p = ringGeo.attributes.position;
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; p.setXYZ(i, px, Math.max(terrain.heightAt(px, pz), 0) + 2, pz); }
  p.needsUpdate = true; ring.visible = true;
}

const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
let lastMouse = { x: 0, y: 0 };
function terrainPoint(e) {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  return terrainView.raycast(raycaster.ray);
}
function pickObject(e) {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const list = [...worldView.pickables, ...vehicleView.pickables(), ...roadView.pickables(), ...trackView.pickables()];
  const hits = raycaster.intersectObjects(list, true);
  const tp = terrainView.raycast(raycaster.ray);
  const td = tp ? tp.distanceTo(raycaster.ray.origin) : Infinity;
  for (const h of hits) { if (h.distance > td + 5) break; if (h.object.userData.pick) return h.object.userData.pick; }
  return null;
}
// destination for the track tool: a station, or a point on another track (junction)
function trackEnd(s, jc) {
  if (s && s !== tool.from) return s;
  if (jc && !(tool.from.type === 'jc' && jc.edge === tool.from.edge)) return jc;
  return null;
}
// a stop a road can start or end at: one of your stations or depots
function roadStop(p) { const s = stationNear(p, 40, true); return s && s.owner === game.player.id ? s : null; }
// depots count only for road tools and road vehicles
function stationNear(p, r = 50, depots = tool.mode === 'train' && !!tool.buy?.road) {
  if (!p) return null;
  let best = null, bd = r;
  for (const s of world.stations) if (s.owner === game.co.id && (depots || !s.depot)) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
  return best;
}

// track you can branch from: your own, or a line another company has opened to you (trackage rights)
const branchable = (e) => e.owner === game.player.id || game.trackOpen(e.owner, game.player);
function onMove(e) {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (e.target !== renderer.domElement) return;
  const p = terrainPoint(e); tool.hover = p;
  if (api.heights && tool.mode === 'select') {
    if (!p) { ui.tooltip(null); return; }
    const g = terrain.slopeAt(p.x, p.z, 8);
    ui.tooltip(`Height <b>${Math.round(terrain.heightAt(p.x, p.z))} m</b> · slope <b class="${g > 0.06 ? 'bad' : ''}">${(g * 100).toFixed(0)}%</b>${g > 0.06 ? ' (steeper than track can climb)' : ''}`, e.clientX, e.clientY);
    return;
  }
  if (tool.mode === 'station') {
    if (!p) { ghost.visible = false; ring.visible = false; ui.tooltip(null); return; }
    ghost.visible = true; ghost.position.set(p.x, Math.max(p.y, 2), p.z); ghost.rotation.y = -tool.angle;
    const err = world.stationCheck(p.x, p.z) || (net.stationClear(p.x, p.z, tool.angle) ? null : 'The station would sit on existing track');
    ghostMat.color.set(err ? '#ff5a4a' : '#6dff8e');
    updateRing(p.x, p.z, ECON.catchment);
    ui.stationTooltip(p, err, e.clientX, e.clientY);
  } else if (tool.mode === 'track') {
    const s = stationNear(p, 75), jc = s ? null : net.nearestTrack(p, 16, branchable);
    showSnap(s || (jc && !jc.bad ? jc : null));
    if (!tool.from) {
      ui.tooltip(s ? `Start track at <b>${s.name}</b>`
        : jc ? (jc.bad ? `<span class="bad">${jc.bad}</span>` : jc.owner !== game.player.id
          ? `Branch onto <b style="color:${game.comp(jc.owner).color}">${game.comp(jc.owner).name}</b>’s line — new junction (${money(JUNCTION_COST)}). Your trains pay ${money(ECON.trackageRate * game.infl())} per mile on their track.`
          : `Branch off here — new junction (${money(JUNCTION_COST)})`)
        : 'Click a station — or an existing track to branch off', e.clientX, e.clientY);
      return;
    }
    const end = trackEnd(s, jc);
    if (!end) showSnap(null);
    let plan;
    if (end) plan = net.plan(tool.from, tool.wps, end, tool.double, tool.grade);
    else if (p) plan = net.plan(tool.from, [...tool.wps, snapPoint(p)], null, tool.double, tool.grade);
    tool.plan = plan && plan.b ? plan : null;
    trackView.showPreview(plan);
    if (plan) {
      const miles = (plan.total / ECON.unitsPerMile).toFixed(1);
      const kind = tool.double ? 'Double track' : 'Single track';
      const msg = plan.b
        ? `${kind} to <b>${end.type === 'station' ? end.name : 'new junction'}</b>: ${miles} mi · <b>${money(game.trackCost(plan))}</b>${(() => { const gr = game.frontier.grantFor(plan, game.trackCost(plan)); return gr ? ` <span class="ok">− land grant ${money(gr)}</span>` : ''; })()} · grade ${(plan.maxGrade * 100).toFixed(1)}% <small>(limit ${+(tool.grade * 100).toFixed(1)}%)</small>${plan.bridgeLen > 0 ? ` · bridges ${Math.round(plan.bridgeLen)} m` : ''}${plan.cutLen > 0 ? ` · cuttings ${Math.round(plan.cutLen)} m` : ''}${plan.crossings?.length ? ` · ${plan.crossings.length} level crossing${plan.crossings.length > 1 ? 's' : ''}${game.crossingFees(plan).length ? ` (fees ${game.crossingFees(plan).map(f => `${money(f.amount)} to ${game.comp(f.owner).name}`).join(', ')})` : ''}` : ''}${plan.flyovers ? ` · ${plan.flyovers} flyover${plan.flyovers > 1 ? 's' : ''}` : ''}${ui.profileSvg(plan)}${plan.bad ? `<span class="bad">${plan.bad}</span>` : 'Click to build'}`
        : `${kind} · ${miles} mi so far · ${money(game.trackCost(plan))} · grade ${(plan.maxGrade * 100).toFixed(1)}% <small>(limit ${+(tool.grade * 100).toFixed(1)}%)</small>${plan.bridgeLen > 0 ? ` · bridges ${Math.round(plan.bridgeLen)} m` : ''}${plan.cutLen > 0 ? ` · cuttings ${Math.round(plan.cutLen)} m` : ''}${ui.profileSvg(plan)}${plan.bad ? `<span class="bad">${plan.bad}</span><br>` : ''}click to add a point; click a station or a track to finish<br><small>Points snap to smooth curves (Shift: free) · <b>−/+</b> flatter/steeper grade · right-click: undo point · G: single/double · Esc: cancel</small>`;
      ui.tooltip(msg, e.clientX, e.clientY);
    }
  } else if (tool.mode === 'depot') {
    if (!p) { ring.visible = false; ui.tooltip(null); return; }
    updateRing(p.x, p.z, ECON.catchment);
    const err = world.depotCheck(p.x, p.z);
    ui.tooltip(err ? `<span class="bad">${err}</span>` : `Road depot · ${money(Math.round(ECON.road.depotCost * game.infl() / 100) * 100)}<br><small>A small stop for road vehicles; the ring is its catchment</small>`, e.clientX, e.clientY);
  } else if (tool.mode === 'road') {
    const s = roadStop(p), rj = s ? null : game.roads.nearestRoad(p, 12);
    showSnap(s ? game.roads.point(s) : (rj && !rj.bad ? rj : null));
    if (!tool.from) {
      ui.tooltip(s ? `Start a road at <b>${s.name}</b>` : rj ? (rj.bad ? `<span class="bad">${rj.bad}</span>` : 'Join this road here') : 'Click one of your stations or depots — or a road — to start a road', e.clientX, e.clientY);
      return;
    }
    const end = s || (rj && !rj.bad ? rj : null);
    if (!end) showSnap(null);
    const plan = end ? game.roads.plan(tool.from, tool.wps, end) : (p ? game.roads.plan(tool.from, [...tool.wps, snapPoint(p)], null) : null);
    tool.plan = plan && plan.b ? plan : null;
    roadView.showPreview(plan);
    if (plan) ui.tooltip(`Road${plan.b ? ` to <b>${end.name || 'the road'}</b>` : ''}: ${(plan.total / ECON.unitsPerMile).toFixed(1)} mi · <b>${money(plan.cost)}</b> · max grade ${(plan.maxGrade * 100).toFixed(1)}%${plan.bridgeLen > 0 ? ` · bridges ${Math.round(plan.bridgeLen)} m` : ''}${plan.bad ? `<br><span class="bad">${plan.bad}</span>` : plan.b ? '<br>Click to build' : '<br>Click to add a waypoint; click a stop or a road to finish'}`, e.clientX, e.clientY);
  } else if (tool.mode === 'signal') {
    const jc = net.nearestTrack(p, 12, 'P');
    const err = jc ? net.signalSpotOk(jc.edge, jc.d) : null;
    ui.tooltip(!jc ? 'Click a track to place a signal (splits it into blocks)' : err ? `<span class="bad">${err}</span>` : `Place signal · ${money(SIGNAL_COST)}<br><small>${jc.edge.double ? 'Lets several trains follow each other on this double track' : 'Single track is reserved station-to-station; signals pay off on double track'}</small>`, e.clientX, e.clientY);
  } else if (tool.mode === 'train') {
    const s = stationNear(p), ship = tool.buy && tool.buy.ship, plane = tool.buy && tool.buy.plane;
    ui.tooltip(s ? (ship && !s.harbor ? `<span class="bad">${s.name} has no harbor</span>` : plane && !s.airport ? `<span class="bad">${s.name} has no airfield</span>` : `Add stop: <b>${s.name}</b>`) : (ship ? 'Click stations with a harbor ⚓' : plane ? 'Click stations with an airfield ✈' : 'Click stations to add stops'), e.clientX, e.clientY);
  } else if (tool.mode === 'bulldoze') {
    const o = pickObject(e);
    const theirs = o && (o.type === 'track' ? o.owner : o.type === 'signal' ? o.edge.owner : 'P') !== 'P';
    ui.tooltip(theirs ? `<span class="bad">Owned by ${game.ownerOf(o.type === 'signal' ? o.edge : o).name}</span>` : o && o.type === 'track' ? `Remove track ${o.a.name} ↔ ${o.b.name}` : o && o.type === 'signal' ? 'Remove signal' : 'Click a track or signal to remove it', e.clientX, e.clientY);
  } else ui.tooltip(null);
}

let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button, moved: 0 }; });
// (a right-drag turns the camera: it is not a right-click, even if it ends where it began)
renderer.domElement.addEventListener('pointermove', e => { if (down) down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y)); });
renderer.domElement.addEventListener('pointerup', e => {
  if (down && down.b === 2 && down.moved <= 5 && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5) { down = null; undoStep(); return; }
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || down.b !== 0) { down = null; return; }
  down = null; onClick(e);
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('pointermove', onMove);
renderer.domElement.addEventListener('pointermove', e => { if (down && down.b === 0 && api.follow && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) api.follow = null; });

// right-click steps back, one thing at a time, all the way to Inspect: a track or road point, then the start, then
// the tool itself; a route's last stop, then the route; any other tool; then the open panel
function undoStep() {
  if ((tool.mode === 'track' || tool.mode === 'road') && (tool.wps.length || tool.from)) {
    if (tool.wps.length) { tool.wps.pop(); refreshWps(); ui.toast('Point removed'); }
    else { tool.from = null; trackView.showPreview(null); roadView.showPreview(null); showSnap(null); ui.toast('Plan cancelled'); }
    onMove({ clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement });
  } else if (tool.mode === 'train' && tool.orders.length) { tool.orders.pop(); ui.updateOrders(); }
  else if (tool.mode !== 'select') { api.setTool('select'); ui.toast('Inspect'); }
  else { api.follow = null; ui.inspect(null); }
}
function onClick(e) {
  const p = terrainPoint(e);
  switch (tool.mode) {
    case 'select': {
      const o = pickObject(e);
      api.follow = null;
      ui.inspect(o);
      break;
    }
    case 'station': {
      if (!p) return;
      const r = game.buildStation(p.x, p.z, tool.angle);
      if (typeof r === 'string') ui.toast(r, true);
      else { ui.toast(`${r.name} built (${money(ECON.stationCost)})`); onMove(e); }
      break;
    }
    case 'track': {
      const s = stationNear(p, 75), jc = s ? null : net.nearestTrack(p, 16, branchable);
      if (!tool.from) {
        if (s) { tool.from = s; ui.toast(`Track from ${s.name} — click points, then a station or a track (right-click: undo)`); }
        else if (jc) { if (jc.bad) ui.toast(jc.bad, true); else { tool.from = jc; ui.toast('Branching off — click waypoints, then a station or a track'); } }
        else ui.toast('Start the track at a station or on an existing track', true);
        return;
      }
      const end = trackEnd(s, jc);
      if (end) {
        const plan = net.plan(tool.from, tool.wps, end, tool.double, tool.grade);
        const r = game.buildTrack(plan);
        if (typeof r === 'string') { ui.toast(r, true); return; }
        tool.wps = []; refreshWps(); trackView.showPreview(null);
        if (end.type === 'station') { tool.from = end; ui.toast(`Connected! Continue from ${end.name} or press Esc`); }
        else { tool.from = null; showSnap(null); ui.toast('Junction built — trains will route through it automatically'); }
      } else if (p) { tool.wps.push(snapPoint(p)); refreshWps(); }
      break;
    }
    case 'depot': {
      if (!p) return;
      const r = game.buildDepot(p.x, p.z, 0);
      if (typeof r === 'string') ui.toast(r, true); else ui.toast(`${r.name} built — connect it with a road (R)`);
      break;
    }
    case 'road': {
      const s = roadStop(p), rj = s ? null : game.roads.nearestRoad(p, 12);
      if (!tool.from) {
        if (s) { tool.from = s; ui.toast(`Road from ${s.name} — click waypoints, then a stop or a road`); }
        else if (rj) { if (rj.bad) ui.toast(rj.bad, true); else { tool.from = rj; ui.toast('Joining the road — click waypoints, then a stop or a road'); } }
        else ui.toast('Start the road at one of your stations or depots, or on a road', true);
        return;
      }
      const end = s || (rj && !rj.bad ? rj : null);
      if (end) {
        const r = game.buildRoad(game.roads.plan(tool.from, tool.wps, end));
        if (typeof r === 'string') { ui.toast(r, true); return; }
        tool.wps = []; refreshWps(); roadView.showPreview(null);
        tool.from = end.type === 'station' ? end : null;
        ui.toast(end.type === 'station' ? `Road built — continue from ${end.name} or press Esc` : 'Road built');
      } else if (p) { tool.wps.push(snapPoint(p)); refreshWps(); }
      break;
    }
    case 'signal': {
      const jc = net.nearestTrack(p, 12, 'P');
      if (!jc) { ui.toast('Click on a track', true); return; }
      const err = game.addSignal(jc.edge, jc.d);
      ui.toast(err || `Signal placed (${money(SIGNAL_COST)})`, !!err);
      break;
    }
    case 'train': {
      const s = stationNear(p);
      if (s && tool.buy && tool.buy.ship && !s.harbor) { ui.toast(`${s.name} has no harbor — build one in its station panel`, true); break; }
      if (s && tool.buy && tool.buy.plane && !s.airport) { ui.toast(`${s.name} has no airfield — build one in its station panel`, true); break; }
      if (s && tool.buy && tool.buy.road && !game.roads.served(s)) { ui.toast(`${s.name} has no road — build one with the road tool (R)`, true); break; }
      if (s) { tool.orders.push(s); ui.updateOrders(); }
      break;
    }
    case 'bulldoze': {
      const o = pickObject(e);
      if (o && o.type === 'track') { const err = game.removeTrack(o); if (err) ui.toast(err, true); }
      else if (o && o.type === 'station' && !o.depot) { if (confirm(`Take down ${o.name} and your track that ends there? You get a quarter of the cost back.`)) { const err = game.removeStation(o); if (err) ui.toast(err, true); else ui.inspect(null); } }
      else if (o && o.type === 'signal') { const err = game.removeSignal(o.edge, o.d); ui.toast(err || 'Signal removed', !!err); }
      else if (o && o.type === 'road') { const err = game.removeRoad(o); if (err) ui.toast(err, true); }
      break;
    }
  }
}
function onKey(e) {
  const k = e.key.toLowerCase();
  if (k === 'escape' && api.follow) { api.follow = null; return; }
  if (k === 'escape') { if ((tool.mode === 'track' || tool.mode === 'road') && tool.from) { tool.from = null; tool.wps = []; refreshWps(); trackView.showPreview(null); roadView.showPreview(null); } else { api.setTool('select'); ui.closeModals(); ui.inspect(null); } }
  else if (k === 'r' && tool.mode === 'station') { tool.angle += Math.PI / 12; onMove({ ...lastMouse, clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement }); }
  else if (k === 'backspace' && (tool.mode === 'track' || tool.mode === 'road')) { tool.wps.pop(); refreshWps(); onMove({ clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement }); }
  else if (k === 'q' && tool.mode === 'station') { tool.angle -= Math.PI / 12; onMove({ clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement }); }
  else if (k === ' ') { e.preventDefault(); ui.togglePause(); }
  else if (k === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); api.save('quick'); }
  else if (k === 's') api.setTool('station');
  else if (k === 't') api.setTool('track');
  else if (k === 'b') ui.openBuyTrain();
  else if (k === 'h' && FEATURES.ships) ui.openBuyShip();
  else if (k === 'j' && FEATURES.planes) ui.openBuyPlane();
  else if (k === 'r' && tool.mode !== 'station' && FEATURES.roads) api.setTool('road');
  else if (k === 'u' && FEATURES.roads) api.setTool('depot');
  else if (k === 'e') api.toggleHeights();
  else if (k === 'k' && FEATURES.roads) ui.openBuyRoad();
  else if (k === 'x') api.setTool('bulldoze');
  else if (k === 'n') api.setTool('signal');
  else if (['[', ']', '-', '+', '='].includes(k) && tool.mode === 'track' && !e.ctrlKey && !e.metaKey && !e.altKey) api.setGrade(k === '[' || k === '-' ? -1 : 1); // (− and + for keyboards where [ ] need AltGr)
  else if (k === 'g') { tool.double = !tool.double; ui.setToolUI(tool.mode); if (tool.mode === 'track') onMove({ clientX: lastMouse.x, clientY: lastMouse.y, target: renderer.domElement }); }
  else if (k === 'p') ui.openChain();
  else if (k === 'l') ui.openLedger();
  else if (k === 'o') ui.openSaves();
  else if (k === 'm') ui.openMarkets();
  else if (k === 'f') ui.openFinance();
  else if (k === 'c') ui.openRivals();
  else if (k === 'a') ui.openAuctions();
  else if (k === 'v') ui.openTrains();
  else if (k === 'home') api.overview();
  else if (k === 'y') ui.openNewsLog();
  else if (k === '/') { e.preventDefault(); ui.openFind(); }
  else if (k === '1' || k === '2' || k === '3' || k === '4') ui.setSpeed([1, 2, 4, 8][+k - 1]);
}

// ---------------- loop ----------------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
let smokeAcc = 0;
function loop() {
  const dt = Math.min(0.25, clock.getDelta());
  // keyboard pan
  const pan = new THREE.Vector3();
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  if (keys.has('w') || keys.has('arrowup')) pan.add(fwd);
  if (keys.has('arrowdown')) pan.sub(fwd);
  if (keys.has('a') || keys.has('arrowleft')) pan.sub(right);
  if (keys.has('d') || keys.has('arrowright')) pan.add(right);
  if (pan.lengthSq() > 0) {
    const dist = camera.position.distanceTo(controls.target);
    pan.normalize().multiplyScalar(dt * (200 + dist * 1.1));
    controls.target.add(pan); camera.position.add(pan); api.follow = null;
  }
  const speed = ui.speed;
  if (speed > 0) {
    let gd = dt * speed / ECON.daySeconds;
    while (gd > 0) { const s = Math.min(gd, 0.12); game.update(s); gd -= s; }
  }
  vehicleView.keep = api.follow; vehicleView.sync();
  if (api.follow) {
    const m = vehicleView.mesh(api.follow);
    if (m && game.vehicles().includes(api.follow)) {
      tmpV.subVectors(m.position, controls.target).multiplyScalar(Math.min(1, dt * 4));
      controls.target.add(tmpV); camera.position.add(tmpV);
    } else api.follow = null;
  }
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -terrain.half, terrain.half);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -terrain.half, terrain.half);
  // the view rests on the ground, except when following an aircraft in the sky
  if (!(api.follow && api.follow.type === 'plane')) controls.target.y = Math.max(0, terrain.heightAt(controls.target.x, controls.target.z));
  controls.update();
  // keep the camera above ground
  const gh = Math.max(terrain.heightAt(camera.position.x, camera.position.z), 0) + 6;
  if (camera.position.y < gh) camera.position.y = gh;

  // sun & shadows follow view
  const dist = camera.position.distanceTo(controls.target);
  trackView.setDetail(dist < 3500); // (rails, sleepers and signals only when they can be seen)
  // depth precision: the near plane moves out as the camera does (with 1 m near and 40 km far, low land and the sea
  // fought each other when zoomed out: the sea showed through the coast)
  const above = camera.position.y - Math.max(terrain.heightAt(camera.position.x, camera.position.z), 0);
  const near = THREE.MathUtils.clamp(Math.min(dist * 0.02, above * 0.5), 1, 80); // (never past the ground under the camera)
  if (Math.abs(camera.near - near) > near * 0.1) { camera.near = near; camera.updateProjectionMatrix(); }
  const ext = THREE.MathUtils.clamp(dist * 0.9, 120, 900);
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(sunDir, 1500);
  const sc = sun.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 100; sc.far = 3200; sc.updateProjectionMatrix(); }

  // smoke
  smokeAcc += dt;
  if (smokeAcc > 0.08) {
    const k = smokeAcc; smokeAcc = 0;
    for (const ind of world.industries) if (ind.active || !ind.def.in) for (const s of ind.stacks) if (Math.random() < 0.9 * (k / 0.08)) smoke.emit(s.x, s.y, s.z, 7, 7, ind.def.in ? 0.55 : 0.75);
    if (speed > 0) for (const tr of game.trains) if (tr.state === 'moving' && vehicleView.mesh(tr) && !vehicleView.isFar(tr)) {
      const p = new THREE.Vector3(0, 5.4, 5.2).applyMatrix4(vehicleView.mesh(tr).matrixWorld);
      smoke.emit(p.x, p.y, p.z, 4, 3.2, 0.8); smoke.emit(p.x, p.y, p.z, 3, 2.5, 0.45);
    }
    if (speed > 0) for (const sh of game.ships) if (sh.state === 'moving' && vehicleView.mesh(sh)) {
      const p = new THREE.Vector3(...vehicleView.smokeOf(sh)).applyMatrix4(vehicleView.mesh(sh).matrixWorld);
      smoke.emit(p.x, p.y, p.z, 6, 4, 0.55);
    }
  }
  smoke.update(dt * Math.max(0.5, Math.min(speed || 0.5, 2)));
  terrainView.update(dt);
  trackView.updateSignalLights(game.blocks);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  ui.frame(dt);
}

init();
