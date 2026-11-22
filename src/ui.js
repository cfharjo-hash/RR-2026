import * as THREE from 'three';
import { CARGO, INDUSTRY, LOCOS, ECON, WAGONS, SHIPS, PLANES, ROAD_VEHICLES, TOWN_ACCEPTS, INVENTIONS, AUCTION, FEATURES, RULES } from './data.js';
import { money, moneyShort } from './util.js';
import { REGION_NAMES, TERRITORIES, FRONTIER } from './continent.js';
import { RACE, MILESTONES } from './race.js';
import { SLOTS, slotMeta, deleteSlot, download, readFile } from './save.js';
import { SAVE_VERSION, LEVEL_MUL } from './sim.js';
import { FIN } from './finance.js';
import { MARKET } from './market.js';
import { RATEWAR } from './ratewars.js';
import { XING } from './track.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const lift = (hex) => { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); return '#' + c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, 0.45)).getHexString(); };
const fmtU = (c, n) => `${Math.round(n).toLocaleString()} ${CARGO[c].unit}`;
const spark = (hist) => {
  if (!hist || hist.length < 2) return '<span class="sub">—</span>';
  const pts = hist.slice(-24).map((v, i, a) => `${(i / (a.length - 1) * 58 + 1).toFixed(1)},${(15 - (Math.min(1.5, v) - 0.45) / 1.05 * 14).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="60" height="16"><line x1="0" x2="60" y1="${(15 - 0.55 / 1.05 * 14).toFixed(1)}" y2="${(15 - 0.55 / 1.05 * 14).toFixed(1)}"/><polyline points="${pts}"/></svg>`;
};
const chip = (c, extra = '') => `<span class="chip" style="--c:${CARGO[c].color}">${CARGO[c].name}${extra}</span>`;

export class UI {
  constructor(game, world, net, api) {
    this.game = game; this.world = world; this.net = net; this.api = api;
    this.speed = 1; this.prevSpeed = 1; this.selected = null; this.floats = [];
    this.buildLabels();
    this.bind();
    game.on('news', (t) => this.news(t));
    game.on('float', (p, t) => this.float(p, t));
    game.on('changed', () => { this.topbar(); });
    game.on('merged', () => { for (const l of this.labels) if (l.kind === 'sta') this.styleStation(l.e, l.o); });
    game.on('defend', (c, s) => this.openDefend(c, s));
    $('#era').onclick = () => this.openFrontier();
    game.on('ousted', (c) => this.openOusted(c));
    game.on('goal', (t) => this.modal(`${t.icon} ${t.name} medal!`, `<p>Your company is worth <b>${money(game.companyValue())}</b> in ${game.year} — ${t.name} goal (${moneyShort(t.value)} by ${game.deadline}) reached.${t.name !== 'Gold' ? ` Next: <b>${game.goal.name}</b> at ${moneyShort(game.goal.value)}.` : ' The scenario is complete. Keep playing as long as you like!'}</p>`));
    this.topbar();
    setInterval(() => { this.topbar(); this.tips(); if (this.selected) this.inspect(this.selected, true); if (this.trainsOpen) this.openTrains(true); }, 400);
  }

  bind() {
    document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
      const t = b.dataset.tool;
      if (t === 'train') this.openBuyTrain(); else if (t === 'ship') this.openBuyShip(); else if (t === 'plane') this.openBuyPlane(); else if (t === 'roadveh') this.openBuyRoad(); else this.api.setTool(t);
    });
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => this.setSpeed(+b.dataset.speed));
    $('#btn-chain').onclick = () => this.openChain();
    $('#btn-ledger').onclick = () => this.openLedger();
    $('#btn-trains').onclick = () => this.openTrains();
    $('#btn-help').onclick = () => this.showWelcome();
    $('#btn-saves').onclick = () => this.openSaves();
    $('#btn-markets').onclick = () => this.openMarkets();
    $('#btn-finance').onclick = () => this.openFinance();
    $('#btn-rivals').onclick = () => this.openRivals();
    $('#btn-auctions').onclick = () => this.openAuctions();
    $('#btn-news').onclick = () => this.openNewsLog();
    $('#btn-heights').onclick = () => this.api.toggleHeights();
    // transport modes held back for an expansion are hidden
    document.querySelectorAll('[data-dlc]').forEach(b => { if (!FEATURES[b.dataset.dlc]) b.remove(); });
    $('#cell-share').onclick = () => this.openFinance();
  }
  setSpeed(s) {
    this.speed = s; if (s) this.prevSpeed = s;
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
  }
  togglePause() { this.setSpeed(this.speed ? 0 : this.prevSpeed || 1); }
  setToolUI(m) {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === m));
    $('#orders').classList.toggle('hide', m !== 'train');
    const hints = {
      select: '', station: 'Station: click to place · <b>R/Q</b> rotate · yellow ring = catchment',
      track: `${this.api.tool.double ? '<b>DOUBLE</b>' : '<b>SINGLE</b>'} track (G to switch): click a station or a track (junction), click points (they snap to smooth curves; Shift: free), click a station or a track · <b>right-click</b> undo · <b>Esc</b> cancel · to double an existing line, click it with Inspect (Esc)`,
      signal: 'Signal: click a track to split it into blocks — most useful on double track',
      road: 'Road: click one of your stations or depots (or a road), click points (they snap; Shift: free), click a stop or a road · roads are public · <b>right-click</b> undo · <b>Esc</b> cancel',
      depot: 'Road depot: click to place a small road stop (ring = catchment), then join it to a station or depot with a road (R)',
      train: 'Route: click stations in the order the train should visit', bulldoze: 'Bulldoze: click a track, a signal, a station (with its track) or one of your roads to remove it',
    };
    $('#hint').innerHTML = hints[m] || ''; $('#hint').classList.toggle('hide', !hints[m]);
    if (m !== 'select') this.tooltip(null);
  }

  topbar() {
    const g = this.game, me = g.player; // (a rival may be acting while this runs)
    $('#date').textContent = g.dateStr();
    $('#cash').textContent = money(me.cash); $('#cash').classList.toggle('neg', me.cash < 0);
    const f = me.fin, h = f.hist, ch = h.length > 12 ? f.price / h[h.length - 13] - 1 : 0;
    $('#share').innerHTML = `$${f.price.toFixed(2)}<small class="${ch >= 0 ? 'ok' : 'bad'}">${ch >= 0 ? '▲' : '▼'}${Math.abs(ch * 100).toFixed(0)}%</small>`;
    $('#wealth').textContent = moneyShort(f.netWorth());
    const v = g.companyValue(me);
    $('#value').textContent = moneyShort(v);
    $('#goal').style.width = Math.min(100, v / g.goal.value * 100) + '%';
    $('#goal-label').textContent = `${g.medals.map(m => g.medalTiers.find(t => t.name === m.name).icon).join('')}${g.goal.name}: ${moneyShort(g.goal.value)} by ${g.goal.year}`;
    $('#year-rev').textContent = moneyShort(me.ledger.revenue);
    this.eraBadge();
    // labels for towns founded since (also those a loaded save rebuilt)
    const named = new Set(this.labels.filter(l => l.kind === 'town').map(l => l.o));
    for (const t of this.world.towns) if (!named.has(t)) { const e = el('div', 'lbl town', ''); $('#labels').append(e); this.labels.push({ e, o: t, kind: 'town' }); }
  }
  // under the date: wartime (or a war coming), else the frontier's open territories
  eraBadge() {
    const F = this.game.frontier, w = F.war(), nx = F.nextWar(), y = this.game.year, e = $('#era');
    const open = Object.entries(F.t).filter(([, v]) => !v.state).length;
    const R = this.game.race, rc = R.active && !R.spike ? '🏁 race west' : '';
    const txt = w ? `⚔ ${w.name} ×${w.mul}` : nx && nx.from - y <= 1 ? `⚔ war expected ${nx.from}` : [open ? `🐂 ${open} territor${open > 1 ? 'ies' : 'y'}` : '', rc].filter(Boolean).join(' · ');
    e.classList.toggle('hide', !txt && !F.active && !R.active && !(F.eras && RULES.wars?.length)); e.classList.toggle('war', !!w);
    e.textContent = txt || 'Eras';
  }
  // the frontier screen: territories and wartime
  openFrontier() {
    const g = this.game, F = g.frontier, y = g.year;
    const terr = Object.entries(F.t).map(([reg, v]) => {
      const T = TERRITORIES[reg], pop = F.settled(reg), held = g.world.industries.filter(i => i.frontier === reg);
      const status = v.state ? `a state since ${v.state}` : v.opened ? 'open to settlers' : `opens ${T.opens}`;
      const bar = v.state ? 100 : Math.min(100, Math.max(0, (pop - v.pop0) / Math.max(1, v.target - v.pop0) * 100));
      return `<tr><td><b>${T.name}</b><br><small class="muted">${status}</small></td><td>${pop.toLocaleString()} / ${v.target.toLocaleString()}<div class="goalbar" style="width:auto"><div style="width:${bar}%;height:100%;background:var(--gold)"></div></div></td>
        <td>${v.founded} of ${(g.world.frontierSites[reg] || []).length}</td><td>${held.filter(i => !i.dormant).length} of ${held.length}</td><td>${v.opened && !v.state ? money(FRONTIER.landGrant * g.infl()) + '/mi' : '—'}</td></tr>`;
    }).join('');
    const wars = (F.eras ? RULES.wars || [] : []).map(w => `<tr class="${y >= w.from && y <= w.to ? 'sum' : ''}"><td>${w.name}</td><td>${w.from}${w.to > w.from ? '–' + w.to : ''}</td><td>army buys ×${w.mul}, pays +${Math.round((w.mul - 1) * 15)}%</td><td>${y > w.to ? 'over' : y >= w.from ? '<b>now</b>' : 'ahead'}</td></tr>`).join('');
    const R = g.race, prog = (u) => u == null ? 0 : Math.max(0, Math.min(100, (0.8 - u) / 1.65 * 100));
    const race = R.active ? `<h4>The race to the Pacific</h4>
      <p>${R.spike ? `🏆 <b style="color:${g.comp(R.spike.by).color}">${g.comp(R.spike.by).name}</b> drove the Golden Spike in ${R.spike.year} (${R.spike.from} to ${R.spike.to}) and earns ${Math.round(RACE.bonus * 100)}% more on hauls of ${RACE.bonusMiles} miles or more.`
        : `The first company to link a station at an Atlantic port city (${g.world.towns.filter(t => t.port === 'east').map(t => t.name).join(', ')}) to one at a Pacific port city (${g.world.towns.filter(t => t.port === 'pacific').map(t => t.name).join(', ')}) by rail drives the <b>Golden Spike</b>: ${money(RACE.spikePrize * g.infl())}, and ${Math.round(RACE.bonus * 100)}% more on long hauls for good. Its own track counts, and lines opened to it (trackage rights); trains can't pass through another company's station.`}</p>
      <table class="tbl"><tr><th>Company</th><th>Furthest west, linked to the Atlantic</th>${MILESTONES.map(M => `<th>${M.name}</th>`).join('')}</tr>
      ${g.active.map(c => { const r = R.reach[c.id]; return `<tr><td><b style="color:${c.color}">${c === g.player ? 'You' : c.name}</b></td><td>${r?.n ? `${Math.round(prog(r.west))}% of the way<div class="goalbar" style="width:auto"><div style="width:${prog(r.west)}%;height:100%;background:${c.color}"></div></div>` : '<span class="muted">no station at an Atlantic port</span>'}</td>${MILESTONES.map(M => `<td>${R.won[M.id]?.by === c.id ? `🚩 ${R.won[M.id].year}` : ''}</td>`).join('')}</tr>`; }).join('')}</table>
      <p class="muted">Milestones pay ${money(RACE.milestonePrize * g.infl())} to the first company to reach them from the Atlantic.</p>` : '';
    this.modal(R.active ? 'Eras, the frontier and the race' : 'Eras and the frontier', `${race}
      ${F.active ? `<p>The west starts as <b>territories</b>. Their towns grow when your trains serve them, and as they grow, new industries open and settlers found new towns. Track you build in a territory earns a <b>land grant</b> per mile (up to half its cost) until it becomes a state.</p>
      <table class="tbl"><tr><th>Territory</th><th>People / statehood</th><th>New towns</th><th>Industries working</th><th>Land grant</th></tr>${terr}</table>` : ''}
      ${wars ? `<h4>Wartime</h4><p class="muted">Army bases and forts buy several times as much in wartime and pay more; for two years after, they buy less. Forts in a territory that became a state buy half as much.</p><table class="tbl">${wars}</table>` : '<p class="muted">No wartime periods in this rule set.</p>'}`, true);
  }

  // ---------- messages ----------
  news(html) {
    const box = $('#news');
    const n = el('div', 'news-item', `<span class="d">${this.game.dateStr()}</span> ${html}`);
    (this.newsLog ||= []).unshift({ d: this.game.dateStr(), html });
    if (this.newsLog.length > 400) this.newsLog.pop();
    box.prepend(n);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => n.classList.add('fade'), 12000);
  }
  // all the news since the game was opened, with filters
  openNewsLog(filter = 'all') {
    const g = this.game, rivals = g.companies.slice(1).map(c => c.name);
    const kinds = { all: 'All', you: 'Your company', rivals: 'Rivals', era: 'Frontier, race and wars', towns: 'Towns', industry: 'Industries and auctions' };
    const test = {
      all: () => true,
      you: (h) => !rivals.some(n => h.includes(n)) && !/^(🏘|🏗|⚔|🕊|🐂|⭐)/u.test(h) && !/Auction|founded|expands|production/i.test(h),
      rivals: (h) => rivals.some(n => h.includes(n)),
      era: (h) => /^(🏆|🚩|🐂|⭐|⚔|🕊)/u.test(h) || h.includes('Settlers'),
      towns: (h) => /^🏘/u.test(h),
      industry: (h) => /^🏗|Auction|founded|expands|production|closes/i.test(h),
    }[filter];
    const rows = (this.newsLog || []).filter(n => test(n.html.replace(/<[^>]+>/g, '')));
    const m = this.modal('News', `<div class="tabs">${Object.entries(kinds).map(([k, v]) => `<button data-k="${k}" class="${k === filter ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="newslog">${rows.map(n => `<div><span class="muted">${n.d}</span> ${n.html}</div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>`, true);
    m.querySelectorAll('.tabs button').forEach(b => b.onclick = () => this.openNewsLog(b.dataset.k));
  }
  toast(text, bad = false) {
    const t = el('div', 'toast' + (bad ? ' bad' : ''), text);
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('fade'), 2200); setTimeout(() => t.remove(), 3000);
  }
  tooltip(html, x, y) {
    const t = $('#tooltip');
    if (!html) { t.classList.add('hide'); return; }
    t.innerHTML = html; t.classList.remove('hide');
    t.style.left = Math.min(innerWidth - 300, x + 18) + 'px'; t.style.top = (y + 18) + 'px';
  }
  stationTooltip(p, err, x, y) {
    const cov = this.world.coverage(p.x, p.z);
    const fake = { cov };
    const sup = [...this.world.supplies(fake)], acc = [...this.world.accepts(fake)];
    let h = err ? `<span class="bad">${err}</span><br>` : `New station · <b>${money(ECON.stationCost)}</b><br>`;
    const names = [...cov.towns.map(t => '🏘 ' + t.name), ...cov.inds.map(i => '🏭 ' + i.name)];
    h += names.length ? `<small>${names.join(' · ')}</small>` : '<small>Nothing in catchment</small>';
    if (sup.length) h += `<div class="tt-row"><small>Supplies</small> ${sup.map(c => chip(c)).join('')}</div>`;
    if (acc.length) h += `<div class="tt-row"><small>Accepts</small> ${acc.map(c => chip(c)).join('')}</div>`;
    this.tooltip(h, x, y);
  }
  float(pos, text) {
    // only where the camera can see it, and at most 40 at once (oldest go first): they pile up at high speed or
    // while the window is hidden
    if (this.api.camera.position.distanceTo(pos) > 3000) return;
    const f = el('div', 'float', text); $('#labels').append(f);
    this.floats.push({ el: f, pos: pos.clone().add(new THREE.Vector3(0, 8, 0)), t: 0 });
    while (this.floats.length > 40) this.floats.shift().el.remove();
  }

  // ---------- world labels ----------
  buildLabels() {
    this.labels = [];
    const root = $('#labels');
    for (const t of this.world.towns) { const e = el('div', 'lbl town', ''); root.append(e); this.labels.push({ e, o: t, kind: 'town' }); }
    for (const i of this.world.industries) {
      const c = Object.keys(i.def.out)[0];
      const e = el('div', 'lbl ind', `<i style="background:${i.def.color || CARGO[c].color}"></i>${i.name}`); root.append(e); this.labels.push({ e, o: i, kind: 'ind' });
    }
  }
  styleStation(e, st) {
    const rival = st.owner && st.owner !== 'P', c = rival ? this.game.comp(st.owner) : null;
    e.style.background = rival ? c.color + '55' : ''; e.style.borderColor = rival ? c.color : ''; e.title = rival ? c.name : ''; delete this.labels.find(l => l.e === e)?.key;
  }
  addStationLabel(st) {
    const e = el('div', 'lbl sta', st.name);
    this.styleStation(e, st);
    $('#labels').append(e); this.labels.push({ e, o: st, kind: 'sta' });
  }
  // passengers and mail waiting at a station, on its map label (amber when storage is filling, red when full and
  // being lost); only close up, and only where there is a town or something waiting
  stationCounter(l, d) {
    const g = this.game, st = l.o, near = d < 1300;
    const parts = near ? [['passengers', '👤'], ['mail', '✉']].map(([c, icon]) => {
      const n = g.stored(st, c);
      if (n < 0.5 && !st.cov.towns.length) return null;
      const f = n / g.storageCap(st, c);
      return { html: `<span class="${f >= 0.98 ? 'full' : f >= 0.7 ? 'warn' : ''}">${icon}${Math.round(n)}</span>` };
    }).filter(Boolean) : [];
    const key = st.name + '|' + parts.map(p => p.html).join('');
    if (l.key === key) return;
    l.key = key;
    l.e.innerHTML = parts.length ? `${st.name}<em class="cnt">${parts.map(p => p.html).join('')}</em>` : st.name;
  }
  frame(dt) {
    const cam = this.api.camera, v = new THREE.Vector3();
    const skey = this.world.stations.length + ':' + (this.world.stations[this.world.stations.length - 1]?.id ?? '');
    if (skey !== this.staLabelled) { // (new stations get labels; removed ones lose theirs)
      const live = new Set(this.world.stations);
      this.labels = this.labels.filter(l => l.kind !== 'sta' || live.has(l.o) || (l.e.remove(), false));
      const known = new Set(this.labels.filter(l => l.kind === 'sta').map(l => l.o));
      for (const s of this.world.stations) if (!known.has(s)) this.addStationLabel(s);
      this.staLabelled = skey;
    }
    const W = innerWidth, H = innerHeight;
    const dist = cam.position.distanceTo(this.api.controls.target), big = this.world.terrain.S > 3000;
    for (const l of this.labels) {
      const o = l.o;
      const y = (o.y ?? 0) + (l.kind === 'town' ? 45 : l.kind === 'sta' ? 16 : 30);
      v.set(o.x, y, o.z);
      const d = cam.position.distanceTo(v);
      v.project(cam);
      // (on a big map, small towns' names fade out with distance, cities' last)
      const reach = l.kind === 'town' ? (!big ? Infinity : o.city || o.pop >= 8000 ? 16000 : o.pop >= 3000 ? 6500 : 3200) : l.kind === 'sta' ? 2200 : 1500;
      const show = !(l.kind === 'ind' && o.dormant) && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < reach;
      if (!show) { if (l.vis !== false) { l.e.style.display = 'none'; l.vis = false; } continue; }
      if (l.vis !== true) { l.e.style.display = ''; l.vis = true; }
      if (l.kind === 'town') {
        if (l.pop !== o.pop) { l.pop = o.pop; l.e.innerHTML = `${o.name}<small>${o.pop.toLocaleString()}</small>`; }
        if (big) { const far = d > 4500, bg = !!(o.city || o.pop >= 8000); if (l.far !== far || l.big !== bg) { l.far = far; l.big = bg; l.e.classList.toggle('far', far); l.e.classList.toggle('big', bg); } }
      }
      else if (l.kind === 'sta' && (l.tick = (l.tick || 0) + 1) % 12 === 1) this.stationCounter(l, d);
      // (the DOM is written only when a label moves or fades: style writes are the cost here)
      const px = Math.round((v.x + 1) / 2 * W), py = Math.round((1 - v.y) / 2 * H);
      if (px !== l.px || py !== l.py) { l.px = px; l.py = py; l.e.style.transform = `translate(-50%,-100%) translate(${px}px,${py}px)`; }
      if (l.kind === 'ind') { const op = Math.round(Math.max(0.35, 1 - d / 1600) * 20) / 20; if (op !== l.op) { l.op = op; l.e.style.opacity = op; } }
    }
    for (const f of this.floats) {
      f.t += dt; v.copy(f.pos); v.y += f.t * 6; v.project(cam);
      f.el.style.transform = `translate(-50%,-100%) translate(${(v.x + 1) / 2 * innerWidth}px,${(1 - v.y) / 2 * innerHeight}px)`;
      f.el.style.opacity = Math.max(0, 1 - f.t / 2.5);
      if (f.t > 2.5 || v.z > 1) f.el.remove();
    }
    this.floats = this.floats.filter(f => f.t <= 2.5 && f.el.isConnected);
    this.loadBars(cam, v);
    this.followBadge();
    this.minimap(dt);
  }
  // a load bar above each nearby vehicle: one segment per wagon (or hold), filled in its cargo's colour
  loadBars(cam, v) {
    const g = this.game, live = new Set(), tick = (this.lbTick = (this.lbTick || 0) + 1) % 10 === 0;
    this.lbars ||= new Map();
    for (const t of g.vehicles()) {
      live.add(t);
      if (t.type === 'train' && t.path) { g.pointAt(t, t.s - t.len / 2, v); v.y += 9; }
      else { v.copy(g.vehiclePos(t)); v.y += t.type === 'plane' ? 6 : t.type === 'ship' ? 12 : 5; }
      const d = cam.position.distanceTo(v);
      v.project(cam);
      let b = this.lbars.get(t);
      const show = d < 650 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!show) { if (b) b.el.style.display = 'none'; continue; }
      if (!b) { b = { el: el('div', 'lbl vload', '') }; $('#labels').append(b.el); this.lbars.set(t, b); }
      if (tick || !b.key) {
        const segs = t.wagons.map(w => { const f = w.cargo ? Math.min(1, w.units / CARGO[w.cargo].cap[w.type]) : 0; return [w.cargo ? CARGO[w.cargo].color : '#000', Math.round(f * 100)]; });
        const key = segs.map(s => s.join(':')).join(',');
        if (key !== b.key) { b.key = key; b.el.innerHTML = segs.map(([c, p]) => `<i style="background:linear-gradient(to right,${c} ${p}%,#3b4048 ${p}%)"></i>`).join('') + `<em>${Math.round(segs.reduce((s, x) => s + x[1], 0) / Math.max(1, segs.length))}%</em>`; }
      }
      b.el.style.display = '';
      b.el.style.transform = `translate(-50%,-100%) translate(${(v.x + 1) / 2 * innerWidth}px,${(1 - v.y) / 2 * innerHeight}px)`;
    }
    for (const [t, b] of this.lbars) if (!live.has(t)) { b.el.remove(); this.lbars.delete(t); }
  }
  heightLegend(on) {
    const b = $('#hlegend'); b.classList.toggle('hide', !on); $('#btn-heights')?.classList.toggle('on', on);
    if (on) b.innerHTML = `<b>Heights</b> <span class="muted">(E to hide)</span><div class="ramp"></div><div class="ticks"><span>river</span><span>25 m</span><span>70 m</span><span>130 m</span><span>peaks</span></div>
      <p class="sub" style="margin:6px 0 0">Contour lines every 10 m (heavier every 50 m). <span class="steep"></span>steeper than 6%, the steepest track; roads manage 10%. Hover for height and slope. While planning track or roads the line shows its grade: green flat → orange at the limit, red too steep.</p>`;
  }
  // the overview map (the continent): terrain and regions drawn once, then towns, every company's track and the view
  minimap(dt) {
    const t = this.world.terrain, box = $('#minimap');
    if (!t.cont) return;
    if (!this.mm) {
      box.classList.remove('hide');
      const cv = box.querySelector('canvas'), W = cv.width, base = document.createElement('canvas'); base.width = base.height = W;
      const g = base.getContext('2d'), img = g.createImageData(W, W);
      for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
        const x = -t.half + (i + 0.5) / W * t.S, z = -t.half + (j + 0.5) / W * t.S, h = t.heightAt(x, z), k = (j * W + i) * 4;
        const c = h < 0 ? [44, 84, 110] : h < 30 ? [92, 128, 70] : h < 70 ? [134, 140, 82] : h < 130 ? [140, 112, 84] : [210, 210, 214];
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.font = '600 9px Segoe UI, sans-serif'; g.fillStyle = 'rgba(255,255,255,.55)'; g.textAlign = 'center';
      const sums = {};
      for (let j = 0; j < W; j += 6) for (let i = 0; i < W; i += 6) { const rg = t.regionAt(-t.half + i / W * t.S, -t.half + j / W * t.S); if (rg) { const s = sums[rg] ||= [0, 0, 0]; s[0] += i; s[1] += j; s[2]++; } }
      for (const [rg, [si, sj, n]] of Object.entries(sums)) g.fillText(REGION_NAMES[rg].toUpperCase(), si / n, sj / n);
      const to = (x, z) => [(x + t.half) / t.S * W, (z + t.half) / t.S * W];
      // territories: tinted until they become states (redrawn when one does)
      const cells = [];
      for (let j = 0; j < W; j += 3) for (let i = 0; i < W; i += 3) { const rg = t.regionAt(-t.half + (i + 1.5) / W * t.S, -t.half + (j + 1.5) / W * t.S); if (rg && TERRITORIES[rg]) cells.push([i, j, rg]); }
      const terr = document.createElement('canvas'); terr.width = terr.height = W;
      this.mm = { cv, ctx: cv.getContext('2d'), base, W, to, acc: 1, cells, terr, terrKey: null };
      // click to jump, drag to pan
      const jump = (e) => {
        const r = cv.getBoundingClientRect(), lim = t.half - 50, x = Math.max(-lim, Math.min(lim, (e.clientX - r.left) / r.width * t.S - t.half)), z = Math.max(-lim, Math.min(lim, (e.clientY - r.top) / r.height * t.S - t.half));
        const { camera, controls } = this.api, d = camera.position.clone().sub(controls.target);
        controls.target.set(x, Math.max(0, t.heightAt(x, z)), z); camera.position.copy(controls.target).add(d); controls.update(); this.api.follow = null;
        this.mm.acc = 1; // (redraw the view box now)
      };
      cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); this.mm.drag = true; jump(e); };
      cv.onpointermove = (e) => { if (this.mm.drag) jump(e); };
      cv.onpointerup = cv.onpointercancel = () => { this.mm.drag = false; };
      box.querySelector('button').onclick = () => this.toggleMinimap();
      box.querySelector('.mm-find').onclick = () => this.openFind();
      box.querySelector('.mm-home').onclick = () => this.api.overview();
    }
    if (box.classList.contains('small') || (this.mm.acc += dt) < 0.25) return;
    this.mm.acc = 0;
    const { ctx, base, W, to } = this.mm, g = this.game;
    ctx.drawImage(base, 0, 0);
    const F = g.frontier, key = Object.entries(F.t).map(([r, v]) => r + (v.state ? 's' : v.opened ? 'o' : 'c')).join();
    if (key !== this.mm.terrKey) {
      this.mm.terrKey = key;
      const tc = this.mm.terr.getContext('2d'); tc.clearRect(0, 0, W, W);
      for (const [i, j, rg] of this.mm.cells) { const v = F.t[rg]; if (!v || v.state) continue; tc.fillStyle = v.opened ? 'rgba(240,200,120,.22)' : 'rgba(60,40,20,.35)'; tc.fillRect(i, j, 3, 3); }
    }
    ctx.drawImage(this.mm.terr, 0, 0);
    // track, in each company's colour: drawn on its own layer, again only when the network changes (or every 5 s)
    const E = this.net.edges, tkey = `${E.length}:${E[E.length - 1]?.id}:${g.active.length}`;
    if (tkey !== this.mm.tkey || (this.mm.tage = (this.mm.tage || 0) + 1) > 20) {
      this.mm.tkey = tkey; this.mm.tage = 0;
      const tl = this.mm.track ||= Object.assign(document.createElement('canvas'), { width: W, height: W }), tc = tl.getContext('2d');
      tc.clearRect(0, 0, W, W);
      for (const e of E) {
        tc.strokeStyle = e.owner === g.player.id ? '#ffd35a' : (g.comp(e.owner)?.color || '#aaa'); tc.lineWidth = e.owner === g.player.id ? 1.8 : 1.2;
        tc.beginPath(); e.pts.forEach((p, k) => { if (k % 4 && k !== e.pts.length - 1) return; const [a, b] = to(p.x, p.z); k ? tc.lineTo(a, b) : tc.moveTo(a, b); }); tc.stroke();
      }
    }
    ctx.drawImage(this.mm.track, 0, 0);
    for (const tw of this.world.towns) { const [a, b] = to(tw.x, tw.z), r = 1.2 + Math.sqrt(tw.pop) / 40; ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.fill(); }
    // trains on the move: a small marker each, in the owner's colour (yours on top, outlined; the followed one ringed)
    const P = this.mm.pt ||= new THREE.Vector3(), mine = [];
    let ring = null;
    ctx.lineWidth = 1;
    for (const v of g.trains) {
      if (!v.path) continue; // (standing in a station)
      g.pointAt(v, v.s - v.len / 2, P);
      const [a, b] = to(P.x, P.z);
      if (v === this.api.follow) ring = [a, b];
      if (v.owner === g.player.id) { mine.push(a, b, v); continue; }
      ctx.fillStyle = g.comp(v.owner)?.color || '#aaa'; ctx.fillRect(a - 1.5, b - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ffd35a'; ctx.strokeStyle = '#1a1408';
    for (let i = 0; i < mine.length; i += 3) { ctx.beginPath(); ctx.arc(mine[i], mine[i + 1], 2.6, 0, 7); ctx.fill(); ctx.stroke(); }
    if (ring) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ring[0], ring[1], 5.5, 0, 7); ctx.stroke(); }
    // where the camera looks
    const { controls } = this.api, [cx, cz] = to(controls.target.x, controls.target.z), span = Math.min(W, this.api.camera.position.distanceTo(controls.target) / t.S * W * 0.9);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.strokeRect(cx - span / 2, cz - span / 2, span, span);
  }
  toggleMinimap() { $('#minimap').classList.toggle('small'); }
  // ---------- tips for a new player: one at a time, until done or dismissed (remembered in this browser) ----------
  tipsOn(set) {
    try { if (set !== undefined) localStorage.setItem('ih-tips-off', set ? '' : '1'); return !localStorage.getItem('ih-tips-off'); } catch { return set ?? true; }
  }
  tips() {
    const box = $('#tip'), g = this.game, me = g.player;
    const mem = this.tipSeen ||= new Set(); // (also kept here: the browser may refuse to store it)
    let seen; try { seen = new Set([...JSON.parse(localStorage.getItem('ih-tips') || '[]'), ...mem]); } catch { seen = new Set(mem); }
    const save = () => { for (const x of seen) mem.add(x); try { localStorage.setItem('ih-tips', JSON.stringify([...seen])); } catch { } };
    if (!this.tipsOn() || !$('#modals').classList.contains('hide') || g.ousted) { box.classList.add('hide'); return; }
    const st = g.stationsOf(me).filter(s => !s.depot).length, tracks = g.net.edges.some(e => e.owner === me.id), trains = g.trains.some(t => t.owner === me.id);
    const big = this.world.terrain.cont;
    const list = [
      ['station', st === 0, 'Press <b>S</b> and click near a town or an industry to place your first station. Hover first: the tooltip shows what a site supplies and accepts.'],
      ['station2', st === 1, 'Place a second station where the first one’s goods are wanted: another town for passengers and mail, or a works that takes the cargo (an industry’s panel lists its buyers).'],
      ['track', st >= 2 && !tracks, 'Press <b>T</b>, click one station, then the other. The cost and the steepest grade show as you go; right-click takes back the last point.'],
      ['train', tracks && !trains, 'Press <b>B</b> to buy a train: a locomotive and wagons for the cargo. Click your stations in order, then <i>Start service</i>.'],
      ['earn', trains && g.day < 400, 'Trains earn when they deliver. Speed up with <b>2</b>–<b>4</b>, and watch the counters over your stations.'],
      ['grow', trains && g.year >= 1852 && st < 5, 'Grow from what pays: the Ledger (<b>L</b>) shows revenue by cargo, and Markets (<b>M</b>) the prices goods fetch.'],
      ['map', big && trains && g.day > 300, 'The continent is big: <b>Home</b> shows it all, <b>/</b> finds a town, and the overview map (bottom right) jumps where you click or drag.'],
      ['race', big && g.race.active && !g.race.spike && g.year >= 1855, 'The race west is on: click the line under the date to see who is closest to the Pacific, and what the territories offer.'],
    ];
    const cur = list.find(([id, when]) => when && !seen.has(id));
    // a tip that was showing and is no longer needed counts as done
    if (this.tipShown && this.tipShown !== cur?.[0]) { seen.add(this.tipShown); save(); }
    this.tipShown = cur?.[0] || null;
    if (!cur) { box.classList.add('hide'); return; }
    if (box.dataset.id !== cur[0]) { box.dataset.id = cur[0]; box.querySelector('span').innerHTML = cur[2]; }
    box.classList.remove('hide');
    box.querySelector('button').onclick = () => { seen.add(cur[0]); save(); this.tipShown = null; box.classList.add('hide'); };
  }
  // find a town (or an industry) by name and look at it
  openFind() {
    const W = this.world, items = [...W.towns.map(t => ({ o: t, label: `🏘 ${t.name}`, sub: `${t.pop.toLocaleString()} people${t.port ? ' · port' : ''}`, key: t.pop + 1e6 })),
      ...W.industries.filter(i => !i.dormant).map(i => ({ o: i, label: `🏭 ${i.name}`, sub: this.nearTown(i), key: 0 }))];
    const m = this.modal('Find a place', `<input id="find-q" placeholder="Town or industry name…" autocomplete="off" style="width:100%;font-size:15px;padding:6px 8px">
      <div id="find-list" class="findlist"></div><p class="muted">Enter jumps to the first match · Home shows the whole map</p>`);
    const q = m.querySelector('#find-q'), list = m.querySelector('#find-list');
    const go = (o) => { this.closeModals(); this.api.flyTo(o.x, o.y ?? this.world.terrain.heightAt(o.x, o.z), o.z, o.type === 'town' ? 1100 : 600); this.inspect(o); };
    const show = () => {
      const s = q.value.trim().toLowerCase();
      const hits = items.filter(it => !s || it.o.name.toLowerCase().includes(s)).sort((a, b) => (a.o.name.toLowerCase().startsWith(s) ? 0 : 1) - (b.o.name.toLowerCase().startsWith(s) ? 0 : 1) || b.key - a.key).slice(0, 12);
      list.innerHTML = hits.map((it, i) => `<a data-i="${i}">${it.label} <small class="muted">${it.sub}</small></a>`).join('') || '<span class="muted">nothing matches</span>';
      list.querySelectorAll('a').forEach(a => a.onclick = () => go(hits[+a.dataset.i].o));
      q.onkeydown = (e) => { if (e.key === 'Enter' && hits[0]) go(hits[0].o); if (e.key === 'Escape') this.closeModals(); };
    };
    q.oninput = show; show(); setTimeout(() => q.focus(), 0);
  }
  nearTown(o) { const t = this.world.towns.reduce((a, b) => Math.hypot(b.x - o.x, b.z - o.z) < Math.hypot(a.x - o.x, a.z - o.z) ? b : a); return `near ${t.name}`; }
  // "Following …" with a way out (drag the map, click, Esc or ✕)
  followBadge() {
    const f = this.api.follow, box = $('#follow');
    if (f === this.shownFollow) return;
    this.shownFollow = f;
    box.classList.toggle('hide', !f);
    if (!f) return;
    box.innerHTML = `<span>📷 Following <b>${f.name}</b> <small>· drag the map, click or Esc to stop</small></span><button title="Stop following">✕</button>`;
    box.querySelector('button').onclick = () => { this.api.follow = null; };
  }

  // ---------- inspector ----------
  inspect(o, refresh = false) {
    const p = $('#inspector');
    this.selected = o;
    if (!o) { p.classList.add('hide'); return; }
    // don't rebuild while the pointer is on a button (keeps clicks reliable)
    if (refresh && p.matches(':hover') && p.querySelector('button:hover')) return;
    p.classList.remove('hide');
    let h = '';
    const g = this.game, W = this.world;
    const pct = (v) => `<b class="${v >= 1.15 ? 'ok' : v < 0.8 ? 'bad' : ''}">${Math.round(v * 100)}%</b>`;
    const foreign = !!o.owner && o.owner !== 'P' && ['station', 'train', 'ship', 'plane', 'track', 'truck', 'road'].includes(o.type);
    const ownerLine = foreign ? `<p class="owner"><i style="background:${g.comp(o.owner).color}"></i>Owned by <b>${g.comp(o.owner).name}</b> (rival)</p>` : '';
    if (o.type === 'station') {
      const wh = o.warehouse || 0;
      h += o.depot ? `<h2>🛻 ${o.name}</h2>${ownerLine}<p class="muted">Road depot · ${g.roads.served(o) ? `${o.redges.length} road(s)` : '<span class="warn">no road yet — build one with the road tool (R)</span>'} · ${g.trucks.filter(t => t.orders.includes(o)).length} road vehicle(s) call here</p>`
        : `<h2>🚉 ${o.name}</h2>${ownerLine}<p class="muted">${wh ? `📦 Warehouse level ${wh} · transfer hub${wh >= 2 ? ' · cold storage' : ''}` : 'No warehouse — small storage, no transfers'}${g.roads.served(o) ? ` · 🛣 road (${g.trucks.filter(t => t.orders.includes(o)).length} road vehicle(s))` : ''}</p>`;
      const cs = [...new Set([...Object.keys(o.waiting), ...(o.transfer || []).map(l => l.c)])].filter(c => g.stored(o, c) >= 0.5);
      h += `<h4>Storage</h4>` + (cs.length ? cs.map(c => {
        const tot = g.stored(o, c), cap = g.storageCap(o, c), tf = tot - (o.waiting[c] || 0);
        return `<div class="bar"><span>${chip(c)}</span><div><b style="width:${Math.min(100, tot / cap * 100)}%;background:${CARGO[c].color}"></b></div><em>${Math.round(tot)}/${Math.round(cap)}</em></div>${tf >= 0.5 ? `<p class="sub">⇄ ${Math.round(tf)} ${CARGO[c].unit} waiting for transfer</p>` : ''}`;
      }).join('') : '<p class="muted">Empty — production arrives monthly.</p>');
      const acc = [...W.accepts(o)];
      h += `<h4>Accepts · price paid</h4><div class="chips">${acc.map(c => { const b = g.bestConsumer(o, c); return chip(c, b ? ' ' + pct(g.priceAt(b, c)) : ''); }).join('') || '<span class="muted">nothing</span>'}</div>`;
      if (wh) h += `<p class="muted">Hub: trains drop cargo here that none of their other stops take; other trains carry it on. Pay is for the whole trip from where it was first loaded.</p>`;
      if (wh < 3 && !foreign && !o.depot) h += `<div class="btns"><button id="b-wh" class="primary">${wh ? 'Upgrade' : 'Build'} warehouse · ${money(Math.round(ECON.warehouseCost[wh + 1] * g.infl() / 1000) * 1000)}</button></div><p class="sub">Level ${wh + 1}: storage ${ECON.storage[wh + 1]} wagonloads per cargo${wh + 1 >= 2 ? ', cold storage' : ''}${wh === 0 ? ', transfer hub' : ''} · upkeep ${money(ECON.warehouseUpkeep[wh + 1])}/yr</p>`;
      if (o.harbor) h += `<h4>Harbor</h4><p>⚓ Ships can call here · ${g.ships.filter(s => s.orders.includes(o)).length} ship(s) serve this harbor</p>`;
      else if (!foreign && !o.depot && FEATURES.ships && g.harborSpot(o)) h += `<div class="btns"><button id="b-harbor">⚓ Build harbor · ${money(Math.round(ECON.harborCost * g.infl() / 1000) * 1000)}</button></div><p class="sub">The river is within reach: ships could load and unload here, sharing this station's storage with your trains.</p>`;
      if (o.airport) h += `<h4>Airfield</h4><p>✈ Planes can land here · ${g.planes.filter(p => p.orders.includes(o)).length} aircraft serve this airfield</p>`;
      else if (!foreign && !o.depot && FEATURES.planes && g.year >= g.aviationYear()) {
        if (g.airportSpot(o)) h += `<div class="btns"><button id="b-airport">✈ Build airfield · ${money(Math.round(ECON.airportCost * g.infl() / 1000) * 1000)}</button></div><p class="sub">Runway, terminal and hangar on open ground next to this station; planes share its storage with your trains${o.harbor ? ' and ships' : ''}. Upkeep ${money(ECON.airportUpkeep)}/yr.</p>`;
        else h += `<p class="sub">No flat, open ground for an airfield near this station.</p>`;
      }
      h += `<h4>Catchment</h4><div class="links">${[...o.cov.towns.map(t => `<a data-sel="${t.id}">🏘 ${t.name}</a>`), ...o.cov.inds.filter(i => !i.dormant).map(i => `<a data-sel="${i.id}">🏭 ${i.name}</a>`)].join('') || '<span class="muted">empty</span>'}</div>`;
      const rivalsHere = [...new Set([...o.cov.towns, ...o.cov.inds].flatMap(x => (x.stations || []).filter(s => s.owner !== o.owner).map(s => s.owner)))];
      for (const t of o.cov.towns) {
        const w = g.rateWars.at(t);
        if (w && !w.pending && [w.a, w.b].includes(o.owner)) {
          const other = w.a === o.owner ? w.b : w.a, sh = g.rateWars.share(w, o.owner);
          h += `<h4>⚔ Rate war: ${t.name}</h4><div class="bar"><span>${o.owner === g.player.id ? 'You' : g.comp(o.owner).name} ${Math.round(sh * 100)}%</span><div><b style="width:${sh * 100}%;background:${g.comp(o.owner).color}"></b></div><em>${Math.round((1 - sh) * 100)}%</em></div><p class="sub">vs <b style="color:${g.comp(other).color}">${g.comp(other).name}</b> until ${g.auctions.dateOf(w.end)}. Both earn ${RATEWAR.cut * 100}% less on traffic from or to ${t.name}; whoever carries more (by value) keeps the town.</p>`;
        }
      }
      if (rivalsHere.length) {
        const svc = Object.keys(o.svc || {}).filter(c => (o.svc[c] ?? 0) > 0 || (o.waiting[c] || 0) > 0);
        h += `<h4>Competition</h4><p class="sub">${rivalsHere.map(id => `<b style="color:${g.comp(id).color}">${g.comp(id).name}</b>`).join(', ')} also serve${rivalsHere.length > 1 ? '' : 's'} this catchment. Output is shared by service: the better you pick up what is offered, the bigger your share.</p>${svc.length ? `<div class="chips">${svc.map(c => chip(c, ' ' + Math.round(g.service(o, c) * 100) + '%')).join('')}</div>` : ''}`;
      }
      if (!foreign && !o.depot) h += `<div class="btns"><button id="b-rmst">Take down station</button></div><p class="sub">Also removes your track that ends here; a quarter of the cost comes back. Trains must stop calling here first.</p>`;
      h += `<h4>Platforms</h4><p>${(o.plats || [new Set(), new Set(), new Set()]).map((p, i) => `${i < 2 ? 'Platform ' + (i + 1) : 'Siding'}: ${p.size ? [...p].map(t => t.name).join(', ') : '<span class="muted">free</span>'}`).join('<br>')}</p>`;
    } else if (o.type === 'industry') {
      const d = o.def, lv = LEVEL_MUL[o.level];
      if (d.consumer) { // a customer: the army, the export wharf, the mint
        const icon = { base: '🎖', fort: '🏰', wharf: '⚓', mint: '🏛' }[d.kind] || '🏛';
        h += `<h2>${icon} ${o.name}</h2><p class="muted">A customer${d.premium > 1 ? ` · pays <b class="ok">×${d.premium}</b> the usual price` : d.premium < 1 ? ` · pays the world price (×${d.premium})` : ''}${d.kind === 'base' || d.kind === 'fort' ? ' · late deliveries earn less, as everywhere' : ''}</p>`;
        if (d.army && g.frontier.armyMul(o) !== 1) h += `<p class="sub">${g.frontier.war() ? `⚔ Wartime (${g.frontier.war().name}): buys ×${g.frontier.armyMul(o)} and pays more` : g.frontier.armyMul(o) < 1 ? `${g.frontier.war() || !RULES.wars.some(w => g.year > w.to && g.year <= w.to + 2) ? 'The frontier has moved on' : 'Peacetime cuts'}: buys ×${g.frontier.armyMul(o)}` : ''}</p>`;
        h += `<h4>Buys per month · stock · price paid</h4>${Object.entries(d.in).filter(([c]) => !CARGO[c].year || CARGO[c].year <= g.year).map(([c, q]) => { const cap = 3 * g.demandCap(o, c); return `<div class="bar"><span>${chip(c)} <small class="muted">${fmtU(c, g.demandCap(o, c))}</small></span><div><b style="width:${Math.min(100, (o.stock[c] || 0) / cap * 100)}%;background:${CARGO[c].color}"></b></div><em>${pct(g.priceAt(o, c))}</em></div>`; }).join('')}`;
        const makers = Object.entries(INDUSTRY).filter(([, x]) => Object.keys(x.out || {}).some(c => d.in[c] !== undefined)).map(([, x]) => x.name);
        h += `<h4>Supplied from</h4><p>${[...new Set(makers)].join(', ')}</p>`;
        if (!o.stations || !o.stations.length) h += `<p class="warn">Not served — place a station within ${ECON.catchment} m.</p>`;
      } else {
      h += `<h2>🏭 ${o.name}</h2><p class="muted">Tier ${d.tier} · level ${o.level}${o.boosted ? ' · <b class="ok">boosted</b>' : ''}${o.owner ? (o.owner === 'P' ? ' · <b class="gold">owned by you</b>' : ` · <b>owned by ${g.comp(o.owner).name}</b>`) : ''}</p>`;
      if (o.dormant) h += `<p class="warn">Will be founded in ${d.year}.</p>`;
      if (d.in) {
        h += `<h4>Recipe (per batch, up to ${Math.round(d.cap * lv)}/month)</h4><p>${Object.entries(d.in).map(([c, q]) => `${q} ${CARGO[c].unit} ${chip(c)}`).join(' + ')} → ${Object.entries(d.out).map(([c, q]) => `${q} ${CARGO[c].unit} ${chip(c)}`).join(' + ')}</p>`;
        h += `<h4>Input stock · price paid</h4>${Object.keys(d.in).map(c => { const cap = 3 * g.demandCap(o, c); return `<div class="bar"><span>${chip(c)}</span><div><b style="width:${Math.min(100, (o.stock[c] || 0) / cap * 100)}%;background:${CARGO[c].color}"></b></div><em>${pct(g.priceAt(o, c))}</em></div>`; }).join('')}`;
      }
      h += `<h4>Output last month</h4>${Object.keys(d.out).map(c => { const pr = o.producedLastMonth[c] || 0, tr = o.transportedLastMonth[c] || 0; return `<p>${chip(c)} ${fmtU(c, pr)} · shipped <b>${pr ? Math.round(tr / pr * 100) : 0}%</b>${pr - tr > 0.5 ? ` · <span class="bad">lost ${fmtU(c, pr - tr)}</span>` : ''}<br><span class="sub">worth ${money(g.value(c))} per ${CARGO[c].unit.replace(/s$/, '')}</span></p>`; }).join('')}`;
      if (d.boost) h += `<h4>Productivity boosters</h4><p>${Object.entries(d.boost).map(([c, b]) => `${chip(c)} +${Math.round(b * 100)}% <small class="muted">(${Math.round(o.boostStock[c] || 0)}/${g.maxLoad(c)})</small>`).join(' ')}</p>`;
      const users = Object.entries(INDUSTRY).filter(([, x]) => Object.keys(d.out).some(c => (x.in && x.in[c]) || (x.boost && x.boost[c])));
      const townUse = Object.keys(d.out).some(c => TOWN_ACCEPTS.includes(c));
      h += `<h4>Deliver output to</h4><p>${users.map(([, x]) => x.name).join(', ')}${townUse ? (users.length ? ', ' : '') + 'Towns' : ''}</p>`;
      if (!o.dormant && (!o.stations || !o.stations.length)) h += `<p class="warn">Not served — place a station within ${ECON.catchment} m.</p>`;
      if (!o.dormant) {
        const price = g.industryPrice(o);
        const potential = Object.entries(d.out).reduce((s, [c, q]) => s + q * (d.in ? d.cap : 1) * lv * g.value(c), 0) * ECON.industryMargin * 12 - price * 0.048;
        h += `<h4>Ownership</h4>`;
        const auc = o.auction && g.auctions.byId(o.auction);
        if (auc) h += `<p class="warn">🔨 Up for auction until ${g.auctions.dateOf(auc.closes)} · reserve ${money(auc.reserve)}${auc.bids[g.player.id] ? ` · your bid ${money(auc.bids[g.player.id])}` : ''}</p><div class="btns"><button id="b-auction">Open auctions</button></div>`;
        if (o.owner === 'P') {
          h += `<p>Income last month <b class="${(o.incomeMonth || 0) >= 0 ? 'ok' : 'bad'}">${money(o.incomeMonth || 0)}</b> · this year ${money(o.incomeYear || 0)} · last year ${money(o.incomeLast || 0)}</p>`;
          h += `<div class="btns">${o.level < 4 ? `<button id="b-expand" class="primary" ${auc ? 'disabled' : ''}>Expand · ${money(Math.round(price * ECON.expandCost / 1000) * 1000)}</button>` : ''}${auc ? '' : `<button id="b-sellind" class="danger" title="Sealed-bid auction; if nobody bids, the market pays the reserve">Auction it · reserve ${money(g.saleReserve(o))}</button>`}</div>`;
        } else if (o.owner) {
          h += `<p>Owned by <b style="color:${g.comp(o.owner).color}">${g.comp(o.owner).name}</b> — it earns ${Math.round(ECON.industryMargin * 100)}% of the value of what its own vehicles pick up here.</p>`;
        } else {
          h += `<p>Price <b>${money(price)}</b> · earns ${Math.round(ECON.industryMargin * 100)}% of the value of every unit your own vehicles pick up here${d.in ? ' (needs its inputs delivered)' : ''}.<br><span class="sub">Fully served: about ${money(potential)}/yr</span></p>${auc ? '' : '<div class="btns"><button id="b-buyind" class="primary">Buy industry</button></div>'}`;
        }
      }
      }
    } else if (o.type === 'town') {
      h += `<h2>🏘 ${o.name}</h2><p>Population <b>${o.pop.toLocaleString()}</b></p>`;
      h += `<h4>Produces per month</h4><p>${chip('passengers')} ~${Math.round(o.pop * ECON.paxPerPop)} · ${chip('mail')} ~${Math.round(o.pop * ECON.mailPerPop)} bags</p>`;
      h += `<h4>Market prices · demand / month</h4><table class="mini">${g.marketList(o).map(c => { const m = g.mkt(o, c); return `<tr><td>${chip(c)}</td><td>${pct(g.priceAt(o, c))}</td><td>${spark(m.hist)}</td><td class="sub">${fmtU(c, g.demandCap(o, c))}</td></tr>`; }).join('')}</table>`;
      h += `<p class="sub">Prices rise when a good is scarce and fall when you deliver more than the town needs.</p>`;
      h += `<p class="muted">Stations: ${(o.stations || []).map(s => s.owner === 'P' ? s.name : `<span style="color:${g.comp(s.owner).color}">${s.name}</span>`).join(', ') || 'none'}</p>`;
    } else if (o.type === 'train') {
      const st = o.state === 'moving' ? (o.waiting ? `<span class="warn">Waiting for a clear block</span> → ${o.to.name} (${Math.round(o.wait)} days)` : `En route to <b>${o.to.name}</b> · ${Math.round(o.speed / 0.5)} mph`) : o.state === 'stuck' ? '<span class="bad">No route!</span>' : `Loading at <b>${o.orders[o.idx].name}</b>`;
      h += `<h2>🚂 ${o.name}</h2>${ownerLine}<p class="muted">${o.loco.name} · ${o.wagons.length} wagons · ${Math.round(g.trainTons(o))} t · built ${Math.floor(o.ageDays / 365)}y ago</p><p>${st}</p>`;
      h += `<h4>Consist</h4><table class="mini">${o.wagons.map(w => `<tr><td>${WAGONS[w.type].name}</td><td>${w.cargo ? chip(w.cargo) : '<span class="muted">empty</span>'}</td><td class="sub">${w.cargo ? fmtU(w.cargo, w.units) : ''}</td></tr>`).join('')}</table>`;
      if (o.newConsist) h += `<p class="warn">🔧 At the next stop: ${this.consistText(o.newConsist)} <button id="b-cmixx" class="small">Cancel</button></p>`;
      h += `<h4>Route</h4><ol class="route">${o.orders.map((s, i) => `<li class="${i === o.idx ? 'cur' : ''}">${s.name}${s.warehouse ? ' 📦' : ''}</li>`).join('')}</ol>`;
      h += `<p>Revenue this year <b>${money(o.revenueYear)}</b> · last year ${money(o.revenueLast)}<br>Lifetime ${money(o.lifetime)} · upkeep ${money(o.loco.upkeep)}/yr${o.handedOver ? `<br><span class="sub">📦 ${Math.round(o.handedOver).toLocaleString()} units handed to warehouses (paid to the train that delivers them)</span>` : ''}</p>`;
      h += `<div class="btns"><button id="b-follow">📷 Follow</button>${foreign ? '' : '<button id="b-cmix">🔧 Change wagons</button><button id="b-sell" class="danger">Sell</button>'}</div>`;
    } else if (o.type === 'plane') {
      const p = o.path, phase = o.state !== 'moving' ? '' : o.s < p.sTaxi ? 'taxiing' : o.s < p.sAir ? 'taking off' : o.s < p.sLand ? (p.sLand - o.s < 450 ? 'on approach' : 'cruising') : 'landing';
      const st = o.state === 'moving' ? `${phase[0].toUpperCase() + phase.slice(1)} → <b>${o.to.name}</b> · ${Math.round(o.speed / 0.5)} mph` : o.state === 'stuck' ? '<span class="bad">No airfield!</span>' : `At <b>${o.orders[o.idx].name}</b> · boarding`;
      const agg = {}; for (const w of o.wagons) if (w.cargo) agg[w.cargo] = (agg[w.cargo] || 0) + w.units;
      h += `<h2>✈ ${o.name}</h2>${ownerLine}<p class="muted">${o.def.name} · ${o.def.speed} mph · built ${Math.floor(o.ageDays / 365)}y ago</p><p>${st}</p>`;
      h += `<h4>Aboard</h4><div class="chips">${Object.entries(agg).map(([c, u]) => chip(c, ' ' + fmtU(c, u))).join('') || '<span class="muted">empty</span>'}</div>`;
      h += `<h4>Route</h4><ol class="route">${o.orders.map((s, i) => `<li class="${i === o.idx ? 'cur' : ''}">${s.name}</li>`).join('')}</ol>`;
      h += `<p>Revenue this year <b>${money(o.revenueYear)}</b> · last year ${money(o.revenueLast)}<br>Lifetime ${money(o.lifetime)} · upkeep ${money(o.def.upkeep)}/yr</p>`;
      h += `<div class="btns"><button id="b-follow">📷 Follow</button>${foreign ? '' : '<button id="b-sellplane" class="danger">Sell</button>'}</div>`;
    } else if (o.type === 'truck') {
      const st = o.state === 'moving' ? `On the road to <b>${o.to.name}</b> · ${Math.round(o.speed / 0.5)} mph` : o.state === 'stuck' ? '<span class="bad">No road!</span>' : `At <b>${o.orders[o.idx].name}</b> · loading`;
      const agg = {}; for (const w of o.wagons) if (w.cargo) agg[w.cargo] = (agg[w.cargo] || 0) + w.units;
      h += `<h2>🛻 ${o.name}</h2>${ownerLine}<p class="muted">${o.def.name} · ${o.def.speed} mph · built ${Math.floor(o.ageDays / 365)}y ago</p><p>${st}</p>`;
      h += `<h4>Load</h4><div class="chips">${Object.entries(agg).map(([c, u]) => chip(c, ' ' + fmtU(c, u))).join('') || '<span class="muted">empty</span>'}</div>`;
      h += `<h4>Route</h4><ol class="route">${o.orders.map((s, i) => `<li class="${i === o.idx ? 'cur' : ''}">${s.name}${s.warehouse ? ' 📦' : ''}</li>`).join('')}</ol>`;
      h += `<p>Revenue this year <b>${money(o.revenueYear)}</b> · last year ${money(o.revenueLast)}<br>Lifetime ${money(o.lifetime)} · upkeep ${money(o.def.upkeep)}/yr${o.handedOver ? `<br><span class="sub">📦 ${Math.round(o.handedOver).toLocaleString()} units handed to warehouses (paid to the train that delivers them)</span>` : ''}</p>`;
      h += `<div class="btns"><button id="b-follow">📷 Follow</button>${foreign ? '' : '<button id="b-selltruck" class="danger">Sell</button>'}</div>`;
    } else if (o.type === 'road') {
      h += `<h2>🛣 Road</h2>${ownerLine || `<p class="owner">Built by <b>${o.owner === 'P' ? 'you' : g.comp(o.owner).name}</b></p>`}<p>${(o.length / ECON.unitsPerMile).toFixed(1)} mi · ${g.trucks.filter(t => t.path?.legs?.some(l => l.edge === o)).length} road vehicle(s) on it now · upkeep ${money(o.length * ECON.road.upkeepPerUnit * g.infl())}/yr (paid by its builder)</p><p class="sub">Roads are public: every company's road vehicles may use them.</p>`;
      if (!foreign) h += `<div class="btns"><button id="b-delroad" class="danger">Remove road</button></div>`;
    } else if (o.type === 'ship') {
      const st = o.state === 'moving' ? `Sailing to <b>${o.to.name}</b> · ${Math.round(o.speed / 0.5)} mph` : o.state === 'stuck' ? '<span class="bad">No waterway!</span>' : `At <b>${o.orders[o.idx].name}</b> · ${o.def.fullLoad && (g.loadableFill(o, o.orders[o.idx]) ?? 1) < 0.9 && o.dockDays < 30 ? 'waiting for a full load' : 'loading'}`;
      const agg = {}; for (const w of o.wagons) if (w.cargo) agg[w.cargo] = (agg[w.cargo] || 0) + w.units;
      h += `<h2>🚢 ${o.name}</h2>${ownerLine}<p class="muted">${o.def.name} · ${o.wagons.length} holds · built ${Math.floor(o.ageDays / 365)}y ago</p><p>${st}</p>`;
      h += `<h4>Hold · ${Math.round(g.shipFill(o) * 100)}% full</h4><div class="chips">${Object.entries(agg).map(([c, u]) => chip(c, ' ' + fmtU(c, u))).join('') || '<span class="muted">empty</span>'}</div>`;
      h += `<h4>Route</h4><ol class="route">${o.orders.map((s, i) => `<li class="${i === o.idx ? 'cur' : ''}">${s.name}</li>`).join('')}</ol>`;
      h += `<p>Revenue this year <b>${money(o.revenueYear)}</b> · last year ${money(o.revenueLast)}<br>Lifetime ${money(o.lifetime)} · upkeep ${money(o.def.upkeep)}/yr${o.handedOver ? `<br><span class="sub">📦 ${Math.round(o.handedOver).toLocaleString()} units handed to warehouses</span>` : ''}</p>`;
      h += `<div class="btns"><button id="b-follow">📷 Follow</button>${foreign ? '' : '<button id="b-sellship" class="danger">Sell</button>'}</div>`;
    } else if (o.type === 'track') {
      const nm = (n) => n.type === 'junction' ? 'Junction' : n.name;
      const blocks = o.signals.length + 1;
      const busy = [...this.game.blocks.keys()].filter(k => k.startsWith(o.id + '#')).length;
      h += `<h2>🛤 ${o.double ? 'Double' : 'Single'} track</h2>${ownerLine}<p>${nm(o.a)} ↔ ${nm(o.b)}<br>${(o.length / ECON.unitsPerMile).toFixed(1)} mi · max grade ${(o.maxGrade * 100).toFixed(1)}% · built for ${money(o.cost)}</p>`;
      h += `<h4>Signalling</h4><p>${o.signals.length} signal(s) → ${blocks} block(s)${o.double ? ' per direction' : ''} · <b>${busy}</b> reserved now</p>`;
      h += `<p class="muted">${o.double ? 'Each direction has its own line; signals let trains follow each other.' : 'Single track: a train reserves it all the way to the next station, so opposing trains wait at stations to pass.'}</p>`;
      if (!o.double && !foreign) {
        const why = this.net.canDouble(o);
        h += why ? `<p class="sub">Can’t be doubled here: ${why}.</p>` : `<div class="btns"><button id="b-double" class="primary">Upgrade to double track · ${money(this.game.doubleCost(o))}</button></div><p class="sub">Trains in each direction get their own line. Add signals (N) so several can follow each other.</p>`;
      }
    }
    p.dataset.key = o.id;
    p.innerHTML = `<button class="x" id="insp-x">×</button>` + h;
    $('#insp-x').onclick = () => this.inspect(null);
    p.querySelectorAll('[data-sel]').forEach(a => a.onclick = () => {
      const t = [...W.towns, ...W.industries].find(x => x.id === a.dataset.sel);
      if (t) { this.inspect(t); this.api.focus(t.x, t.y, t.z); }
    });
    const act = (id, fn) => { const b = p.querySelector('#' + id); if (b) b.onclick = () => { const e = fn(); if (e) this.toast(e, true); this.inspect(o); }; };
    const on = (id, fn) => { const b = p.querySelector('#' + id); if (b) b.onclick = fn; };
    on('b-follow', () => { this.api.follow = o; });
    on('b-cmix', () => this.openConsist(o));
    on('b-cmixx', () => { this.game.setConsist(o, o.wagons.map(w => w.type)); this.inspect(o, true); });
    on('b-sell', () => { this.game.sellTrain(o); this.inspect(null); });
    act('b-wh', () => g.buildWarehouse(o));
    act('b-double', () => g.doubleTrack(o));
    on('b-rmst', () => { if (!confirm(`Take down ${o.name} and your track that ends there?`)) return; const e = this.game.removeStation(o); if (e) this.toast(e, true); else this.inspect(null); });
    act('b-harbor', () => g.buildHarbor(o));
    act('b-airport', () => g.buildAirport(o));
    on('b-sellplane', () => { this.game.sellPlane(o); this.inspect(null); });
    on('b-sellship', () => { this.game.sellShip(o); this.inspect(null); });
    on('b-selltruck', () => { this.game.sellTruck(o); this.inspect(null); });
    on('b-delroad', () => { const e = this.game.removeRoad(o); if (e) this.toast(e, true); else this.inspect(null); });
    act('b-buyind', () => g.buyIndustry(o));
    act('b-expand', () => g.expandIndustry(o));
    act('b-sellind', () => g.sellIndustry(o));
    on('b-auction', () => this.openAuctions());
  }

  // ---------- modals ----------
  modal(title, html, wide = false) {
    this.closeModals();
    const m = el('div', 'modal' + (wide ? ' wide' : ''));
    m.innerHTML = `<div class="mhead"><h2>${title}</h2><button class="x">×</button></div><div class="mbody">${html}</div>`;
    m.querySelector('.x').onclick = () => this.closeModals();
    $('#modals').append(m); $('#modals').classList.remove('hide');
    return m;
  }
  closeModals() { $('#modals').innerHTML = ''; $('#modals').classList.add('hide'); this.trainsOpen = false; }

  showWelcome() {
    this.modal('Iron Horizon — 1850', `
      <p>You are the founder of a young railroad company. Connect towns and industries, haul cargo up the
      production tree, and grow your company's value by <b>${this.game.deadline}</b>: ${this.game.medalTiers.map(m => `${m.icon} <b>${moneyShort(m.value)}</b>`).join(' · ')}.</p>
      <h4>Your first line</h4>
      <ol class="steps">
        <li><b>Station</b> (S): place one near an industry (e.g. a Coal Mine) and another near something that accepts its cargo (a Steel Mill). Hover to see what a site supplies and accepts.</li>
        <li><b>Track</b> (T): click the first station, optionally click waypoints around hills, then click the second station.</li>
        <li><b>Train</b> (B): choose a locomotive and the right wagons — hoppers for coal and ore, flatcars for logs and steel, boxcars for goods, coaches for passengers — then click the stations in order and press <i>Start service</i>. More wagon types appear over the years.</li>
      </ol>
      <details class="more"><summary>More: junctions, markets, rivals${this.game.race.active ? ', the race west, the frontier' : ''}</summary><ul class="steps">
        <li><b>Junctions &amp; signals</b>: start or end a track on an existing track to build a junction. Press G in the track tool for double track, and use Signal (N) to split it into blocks. To double a line you already have, click it and press <i>Upgrade to double track</i>. Single track is reserved station-to-station, so trains pass each other at stations.</li>
        <li><b>Value grows up the chain:</b> finished goods pay far more per wagon than raw materials (see Markets, M). Prices fall if you flood a market and rise where goods are scarce.</li>
        <li><b>Warehouses</b> (station panel) add storage and make a station a transfer hub. <b>Buy industries</b> (industry panel): expensive, but very profitable when you keep them supplied and shipping.</li>
        ${FEATURES.planes ? '' : '<!--'}<li><b>Aircraft</b> (J, from 1920): stations with open ground nearby can build an airfield ✈. Fast, best for passengers, mail and valuable goods.</li>${FEATURES.planes ? '' : '-->'}
        ${FEATURES.ships ? '' : '<!--'}<li><b>Ships</b> (H): stations near the river can build a harbor ⚓. Ships are slow but carry a lot, and they share the station's storage with your trains.</li>${FEATURES.ships ? '' : '-->'}
        ${FEATURES.roads ? '' : '<!--'}<li><b>Roads</b> (R) and <b>road depots</b> (U): horse wagons and stagecoaches (K), later lorries and buses, feed industries and towns off your railway to a station. With a warehouse there, trains carry the cargo on and are paid for the whole trip. Roads are public.</li>${FEATURES.roads ? '' : '-->'}
        <li><b>Rivals</b> (C): ${this.game.rivals.length ? `${this.game.rivals.map(c => `<b style="color:${c.color}">${c.name}</b>`).join(' and ')} build their own networks. Where you share a town or industry, the output is split by service — pick up quickly and often to win the bigger share. Buy their shares to take them over — and keep over 50% of your own company, or a rival can take you over.` : 'this game has no rival companies.'}</li>
        ${this.game.race.active ? '<li><b>The race to the Pacific</b>: the first company to link an Atlantic port city to a Pacific one by rail drives the Golden Spike — a large prize, and more pay on long hauls for good. Milestones on the way pay too. Rivals race as well (click the line under the date).</li>' : ''}
        ${this.game.frontier.active ? '<li><b>The frontier</b> (click the line under the date): the west starts as territories. Serve their towns and they grow; new industries and towns follow. Track built there earns a land grant per mile until the territory becomes a state. In <b>wartime</b> the army buys several times as much.</li>' : ''}
        <li>Open the <b>Production chain</b> (P) to plan deeper chains. Tools &amp; Machinery delivered back to farms and mines boost their output.</li>
      </ul></details>
      <p class="muted">Camera: left-drag pan · right-drag rotate · wheel zoom · arrows/WAD pan${this.world.terrain.cont ? ' · Home: the whole map · /: find a town · the overview map (bottom right): click or drag' : ''}. Speed: 1-4, Space pause. Ledger (L), Trains (V), News (Y), Bulldoze (X).</p>
      <label class="muted"><input type="checkbox" id="w-tips" ${this.tipsOn() ? 'checked' : ''}> Show tips while I play</label>
      ${this.game.actions.some(a => !a.o) || this.game.day > 60 ? `<p class="muted">Map ${this.api.map ? '#' + this.api.map : '0 (the original map)'}</p>` : `
      <div class="map-row">Map <input id="w-map" type="number" min="0" max="99999" value="${this.api.map}"> <button id="w-map-go">Play this map</button> <button id="w-map-rnd">Random map</button>
        <span class="muted">${this.world.terrain.cont ? 'Each number gives the continent different detail: hills, sites, frontier towns.' : '0 is the original map; any other number gives a new landscape, river and towns.'}</span></div>`}
      <div class="btns"><button id="w-start" class="primary">Start building</button></div>`);
    const resume = this.speed || this.prevSpeed || 1;
    this.setSpeed(0); // the clock waits while the player reads
    $('#w-start').onclick = () => { this.closeModals(); this.setSpeed(resume); };
    $('#w-tips').onchange = (e) => this.tipsOn(e.target.checked);
    if ($('#w-map')) {
      const leave = () => this.game.day < 1 || confirm('Start a new game on another map? This game is not saved.');
      $('#w-map-go').onclick = () => leave() && this.api.newMap(Math.max(0, Math.min(99999, Math.floor(+$('#w-map').value || 0))));
      $('#w-map-rnd').onclick = () => leave() && this.api.newMap('random');
    }
  }

  openBuyTrain() {
    const g = this.game, locos = g.availableLocos();
    const avail = g.wagonsAvailable().filter(k => Object.values(CARGO).some(c => c.cap[k])); // (no wagons nothing fits in)
    const carries = (t) => Object.keys(CARGO).filter(c => CARGO[c].cap[t] && (!CARGO[c].year || CARGO[c].year <= g.year));
    const counts = Object.fromEntries(Object.keys(WAGONS).map(k => [k, 0]));
    const m = this.modal('Buy a train', `
      <div class="buy-grid">
        <div><h4>Locomotive</h4><div class="locos">${locos.map((l, i) => `<label class="loco-card"><input type="radio" name="loco" value="${l.id}" ${i === 0 ? 'checked' : ''}>
          <div><b>${l.name}</b><small>${l.speed} mph · pulls ~${Math.round(l.power * 250)} t well · max ${Math.min(l.maxCars, 6)} wagons<br>${money(g.locoCost(l))} · upkeep ${money(l.upkeep)}/yr</small></div>
          <i style="background:${l.color};border-color:${l.trim}"></i></label>`).join('')}
          ${LOCOS.filter(l => l.year > g.year).map(l => `<div class="loco-card locked"><div><b>${l.name}</b><small>available ${l.year}</small></div></div>`).join('')}</div></div>
        <div><h4>Wagons</h4><table class="mini wagons">${Object.entries(WAGONS).filter(([, w]) => !w.air && !w.road).map(([k, w]) => avail.includes(k)
          ? `<tr><td><b>${w.name}</b><br><span class="sub">${carries(k).map(c => CARGO[c].name).join(', ') || '—'}</span></td><td class="sub">${money(g.wagonCost(k))}</td><td class="step"><button data-dec="${k}">−</button><b id="wc-${k}">0</b><button data-inc="${k}">+</button></td></tr>`
          : `<tr class="locked"><td><b>${w.name}</b><br><span class="sub">available ${w.year}</span></td><td></td><td></td></tr>`).join('')}</table></div>
      </div>
      <p id="buy-sum"></p>
      <div class="btns"><button id="b-route" class="primary">Choose route on map →</button></div>`, true);
    const loco = () => LOCOS.find(x => x.id === m.querySelector('input[name=loco]:checked').value);
    const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
    const upd = () => {
      const l = loco(), max = Math.min(l.maxCars, 6);
      for (const k of Object.keys(counts)) { const e = $('#wc-' + k); if (e) e.textContent = counts[k]; }
      const consist = Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k));
      const cost = g.locoCost(l) + consist.reduce((s, t) => s + g.wagonCost(t), 0);
      const empty = 50 + 25 * l.power + consist.reduce((s, t) => s + WAGONS[t].tare, 0);
      const full = empty + consist.reduce((s, t) => s + Math.max(0, ...carries(t).map(c => CARGO[c].cap[t] * CARGO[c].wt)), 0);
      $('#buy-sum').innerHTML = `${total()}/${max} wagons · <b>${money(cost)}</b> · weight ${Math.round(empty)}–${Math.round(full)} t ${full > l.power * 250 * 1.1 ? '<span class="warn">(heavy for this locomotive — slow on hills)</span>' : ''}`;
    };
    m.querySelectorAll('input[name=loco]').forEach(i => i.oninput = () => { const max = Math.min(loco().maxCars, 6); while (total() > max) { const k = Object.keys(counts).reverse().find(k => counts[k]); counts[k]--; } upd(); });
    m.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { if (total() < Math.min(loco().maxCars, 6)) counts[b.dataset.inc]++; upd(); });
    m.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { if (counts[b.dataset.dec] > 0) counts[b.dataset.dec]--; upd(); });
    upd();
    $('#b-route').onclick = () => {
      if (g.stationsOf(g.player).length < 2 || !this.net.edges.some(e => e.owner === 'P')) { this.toast('Build two stations and a track first', true); return; }
      if (!total()) { this.toast('Add at least one wagon', true); return; }
      this.api.tool.buy = { loco: loco().id, consist: Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k)) };
      this.closeModals(); this.api.setTool('train'); this.updateOrders();
    };
  }
  consistText(types) { return Object.entries(types.reduce((o, t) => (o[t] = (o[t] || 0) + 1, o), {})).map(([t, n]) => `${n}× ${WAGONS[t].name.toLowerCase()}`).join(', '); }
  // change a train's wagon mix: +/− per type, a suggestion from what its route offers; done at the next stop
  openConsist(tr) {
    const g = this.game, W = this.world, avail = g.wagonsAvailable().filter(k => !WAGONS[k].air && !WAGONS[k].road), max = Math.min(tr.loco.maxCars, 6);
    const carries = (t) => Object.keys(CARGO).filter(c => CARGO[c].cap[t] && (!CARGO[c].year || CARGO[c].year <= g.year));
    const counts = Object.fromEntries(avail.map(k => [k, 0]));
    for (const t of tr.newConsist || tr.wagons.map(w => w.type)) if (counts[t] !== undefined) counts[t]++;
    // what the route offers: cargo a stop supplies (or holds for transfer) that another stop takes, weighted by what waits
    const suggest = () => {
      const want = {};
      for (const st of tr.orders) for (const c of new Set([...W.supplies(st), ...(st.transfer || []).map(l => l.c)])) {
        if (CARGO[c].year && CARGO[c].year > g.year) continue;
        if (!tr.orders.some(o => o !== st && g.consumers(o, c).length)) continue;
        const t = Object.keys(CARGO[c].cap).find(w => avail.includes(w)); if (!t) continue;
        want[t] = (want[t] || 0) + Math.max(1, g.stored(st, c)) / CARGO[c].cap[t];
      }
      const tot = Object.values(want).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(counts)) counts[k] = 0;
      if (!tot) return false;
      const ranked = Object.entries(want).sort((a, b) => b[1] - a[1]).slice(0, max);
      let left = max;
      for (const [t, w] of ranked) { const n = Math.max(1, Math.round(w / tot * max)); counts[t] = Math.min(n, left - (ranked.length - 1 - ranked.indexOf(ranked.find(r => r[0] === t)))); left -= counts[t]; }
      while (left > 0) { counts[ranked[0][0]]++; left--; }
      return true;
    };
    const consist = () => Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k));
    const m = this.modal(`Wagons of ${tr.name}`, `
      <p class="muted">${tr.loco.name} pulls up to ${max} wagons. The change is made at the train's next stop, after it unloads: wagons that go are sold for half their price, new ones arrive empty.</p>
      <table class="mini wagons">${avail.map(k => `<tr><td><b>${WAGONS[k].name}</b><br><span class="sub">${carries(k).map(c => CARGO[c].name).join(', ') || '—'}</span></td><td class="sub">${money(g.wagonCost(k))}</td><td class="step"><button data-dec="${k}">−</button><b id="cw-${k}">0</b><button data-inc="${k}">+</button></td></tr>`).join('')}</table>
      <p id="cw-sum"></p>
      <div class="btns"><button id="cw-sug">✨ Suggest for this route</button><button id="cw-ok" class="primary">Change at next stop</button></div>`);
    const upd = () => {
      for (const k of Object.keys(counts)) { const e = m.querySelector('#cw-' + k); if (e) e.textContent = counts[k]; }
      const c = g.consistCost(tr, consist()), n = consist().length;
      m.querySelector('#cw-sum').innerHTML = `${n}/${max} wagons · ${this.consistText(consist()) || '<span class="bad">no wagons</span>'}<br>${c.bought ? `buy ${c.bought} for ${money(c.buy)}` : ''}${c.bought && c.sold ? ' · ' : ''}${c.sold ? `sell ${c.sold} for ${money(c.sell)}` : ''}${c.bought || c.sold ? ` · <b>${c.net >= 0 ? 'cost' : 'refund'} ${money(Math.abs(c.net))}</b>` : '<span class="muted">no change</span>'}`;
    };
    m.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { if (consist().length < max) counts[b.dataset.inc]++; upd(); });
    m.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { if (counts[b.dataset.dec] > 0) counts[b.dataset.dec]--; upd(); });
    m.querySelector('#cw-sug').onclick = () => { if (!suggest()) this.toast('Nothing on this route for these wagons yet', true); upd(); };
    m.querySelector('#cw-ok').onclick = () => {
      const err = g.setConsist(tr, consist());
      if (err) { this.toast(err, true); return; }
      this.closeModals(); this.inspect(tr);
      this.toast(tr.newConsist ? `${tr.name} changes its wagons at the next stop` : 'No change');
    };
    upd();
  }
  updateOrders() {
    const t = this.api.tool, l = LOCOS.find(x => x.id === t.buy?.loco);
    const box = $('#orders');
    box.innerHTML = `<h4>${t.buy?.plane ? `Airfields for ${PLANES[t.buy.plane].name}` : t.buy?.ship ? `Harbors for ${SHIPS[t.buy.ship].name}` : t.buy?.road ? `Stops for ${ROAD_VEHICLES[t.buy.road].name}` : `Route for ${l ? l.name : ''} + ${t.buy?.consist.length} wagons`}</h4><ol>${t.orders.map(s => `<li>${s.name}</li>`).join('') || '<li class="muted">click stations on the map…</li>'}</ol>
      <div class="btns"><button id="o-undo">Undo</button><button id="o-cancel">Cancel</button><button id="o-go" class="primary" ${t.orders.length < 2 ? 'disabled' : ''}>Start service</button></div>`;
    $('#o-undo').onclick = () => { t.orders.pop(); this.updateOrders(); };
    $('#o-cancel').onclick = () => this.api.setTool('select');
    $('#o-go').onclick = () => {
      const r = t.buy.plane ? this.game.buyPlane(t.buy.plane, t.orders) : t.buy.ship ? this.game.buyShip(t.buy.ship, t.orders) : t.buy.road ? this.game.buyTruck(t.buy.road, t.orders) : this.game.buyTrain(t.buy.loco, t.buy.consist, t.orders);
      if (typeof r === 'string') { this.toast(r, true); return; }
      this.api.setTool('select'); this.inspect(r);
    };
  }

  openBuyPlane() {
    const g = this.game, avail = g.availablePlanes();
    const n = g.stationsOf(g.player).filter(s => s.airport).length;
    const holds = (d) => Object.entries(d.holds).map(([t, k]) => `${k}× ${WAGONS[t].name.toLowerCase()}`).join(', ');
    const cap = (d) => { const pax = (d.holds.cabin || 0) * CARGO.passengers.cap.cabin, mail = (d.holds.mailbay || 0) * CARGO.mail.cap.mailbay; return `${pax ? pax + ' passengers' : ''}${pax && mail ? ', ' : ''}${mail ? mail + ' bags of mail' : ''}${d.holds.cargobay ? `, ${d.holds.cargobay} cargo hold(s) for electronics, clothing, tools or food` : ''}`; };
    const m = this.modal('Buy an aircraft', `
      <p class="muted">Aircraft fly between stations with an airfield ✈ (build one from a station panel). They are fast and earn the most on passengers, mail and light, valuable goods, which all pay extra for speed, but airfields are expensive.${g.year < g.aviationYear() ? ` <b class="warn">The first aircraft appear in ${g.aviationYear()}.</b>` : n < 2 ? ' <b class="warn">You need at least two airfields first.</b>' : ''}</p>
      <div class="locos">${Object.entries(PLANES).map(([k, d]) => avail.includes(k)
        ? `<label class="loco-card"><input type="radio" name="plane" value="${k}" ${k === avail[avail.length - 1] ? 'checked' : ''}><div><b>${d.name}</b><small>${d.speed} mph · ${cap(d)}<br>${money(g.planeCost(k))} · upkeep ${money(d.upkeep)}/yr</small></div></label>`
        : `<div class="loco-card locked"><div><b>${d.name}</b><small>available ${d.year} · ${d.speed} mph · ${cap(d)}</small></div></div>`).join('')}</div>
      <div class="btns"><button id="b-proute" class="primary" ${avail.length ? '' : 'disabled'}>Choose airfields on map →</button></div>`);
    const btn = $('#b-proute'); if (btn) btn.onclick = () => {
      if (n < 2) { this.toast('Build airfields at two stations first', true); return; }
      const k = m.querySelector('input[name=plane]:checked').value;
      this.closeModals(); this.api.setTool('train'); this.api.tool.buy = { plane: k }; this.updateOrders();
    };
  }
  openBuyRoad() {
    const g = this.game, avail = g.availableTrucks();
    const n = g.stationsOf(g.player).filter(s => g.roads.served(s)).length;
    const cap = (d) => Object.entries(d.holds).map(([t, k]) => { const fits = Object.keys(CARGO).filter(c => CARGO[c].cap[t]); const ex = fits.includes('passengers') ? `${k * CARGO.passengers.cap[t]} passengers or ${k * CARGO.mail.cap[t]} bags of mail` : `${k}× ${WAGONS[t].name.toLowerCase()} (e.g. ${k * (CARGO.coal?.cap[t] || CARGO[fits[0]].cap[t])} ${CARGO.coal?.cap[t] ? 't of coal' : CARGO[fits[0]].unit + ' of ' + CARGO[fits[0]].name.toLowerCase()})`; return ex; }).join(', ');
    const m = this.modal('Buy a road vehicle', `
      <p class="muted">Road vehicles run on roads (R) between your stations and road depots (U) that have a road. Roads are public: any company may use them. They are small and slow, but cheap: good for feeding an industry or a town that is off your railway to a station, where trains carry the cargo on (a warehouse at the station makes it a transfer hub).${n < 2 ? ' <b class="warn">You need two stops with a road first.</b>' : ''}</p>
      <div class="locos">${Object.entries(ROAD_VEHICLES).map(([k, d]) => avail.includes(k)
        ? `<label class="loco-card"><input type="radio" name="rv" value="${k}" ${k === avail[0] ? 'checked' : ''}><div><b>${d.name}</b><small>${d.speed} mph · ${cap(d)}<br>${money(g.truckCost(k))} · upkeep ${money(d.upkeep)}/yr</small></div></label>`
        : `<div class="loco-card locked"><div><b>${d.name}</b><small>available ${d.year} · ${d.speed} mph · ${cap(d)}</small></div></div>`).join('')}</div>
      <div class="btns"><button id="b-rroute" class="primary">Choose stops on map →</button></div>`);
    $('#b-rroute').onclick = () => {
      if (n < 2) { this.toast('Join two of your stations or depots with a road first', true); return; }
      const k = m.querySelector('input[name=rv]:checked')?.value || avail[0];
      this.closeModals(); this.api.setTool('train'); this.api.tool.buy = { road: k }; this.updateOrders();
    };
  }
  openBuyShip() {
    const g = this.game, avail = g.availableShips();
    const hasHarbor = g.stationsOf(g.player).filter(s => s.harbor).length;
    const holds = (def) => Object.entries(def.holds).map(([t, n]) => `${n}× ${WAGONS[t].name.toLowerCase()}`).join(', ');
    const tons = (def) => Math.round(Object.entries(def.holds).reduce((s, [t, n]) => s + n * Math.max(0, ...Object.keys(CARGO).filter(c => CARGO[c].cap[t]).map(c => CARGO[c].cap[t] * CARGO[c].wt)), 0));
    const m = this.modal('Buy a ship', `
      <p class="muted">Ships sail between stations that have a harbor ⚓ (build one from a station panel near the river). They are slow but carry as much as several trains, and trains and ships share the station's storage, so you can transfer cargo between rail and river.${hasHarbor < 2 ? ' <b class="warn">You need at least two harbors first.</b>' : ''}</p>
      <div class="locos">${Object.entries(SHIPS).map(([k, d], i) => avail.includes(k)
        ? `<label class="loco-card"><input type="radio" name="ship" value="${k}" ${k === avail[0] ? 'checked' : ''}><div><b>${d.name}</b><small>${d.speed} mph · hold: ${holds(d)} (up to ~${tons(d)} t)${d.fullLoad ? ' · waits for a full load' : ''}<br>${money(g.shipCost(k))} · upkeep ${money(d.upkeep)}/yr</small></div></label>`
        : `<div class="loco-card locked"><div><b>${d.name}</b><small>available ${d.year}</small></div></div>`).join('')}</div>
      <div class="btns"><button id="b-sroute" class="primary">Choose harbors on map →</button></div>`);
    $('#b-sroute').onclick = () => {
      if (hasHarbor < 2) { this.toast('Build harbors at two stations first', true); return; }
      this.api.tool.buy = { ship: m.querySelector('input[name=ship]:checked').value };
      this.closeModals(); this.api.setTool('train'); this.api.tool.buy = { ship: m.querySelector('input[name=ship]:checked')?.value || avail[0] }; this.updateOrders();
    };
  }

  openTrains(refresh = false) {
    const g = this.game;
    const fleet = g.vehiclesOf(g.player);
    const html = fleet.length ? `<table class="tbl"><tr><th>Vehicle</th><th>Route</th><th>Status</th><th>Rev. this year</th><th>Last year</th></tr>
      ${fleet.map(t => `<tr data-tr="${t.id}"><td>${t.type === 'ship' ? '🚢' : t.type === 'plane' ? '✈' : t.type === 'truck' ? '🛻' : '🚂'} <b>${t.name}</b></td><td>${t.orders.map(s => s.name).join(' → ')}</td><td>${t.state === 'moving' ? (t.waiting ? '⛔ waiting → ' : '→ ') + t.to.name : t.state}</td><td>${money(t.revenueYear)}</td><td>${money(t.revenueLast)}</td></tr>`).join('')}</table>`
      : '<p class="muted">No trains or ships yet. Press B to buy a train, H for a ship.</p>';
    if (refresh) { const b = document.querySelector('.modal .mbody'); if (b) b.innerHTML = html; else return; }
    else this.modal('Trains &amp; ships', html, true);
    this.trainsOpen = true;
    document.querySelectorAll('[data-tr]').forEach(r => r.onclick = () => {
      const t = g.vehicles().find(x => x.id === r.dataset.tr); this.closeModals(); this.inspect(t); this.api.follow = t;
    });
  }

  openSaves() {
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };
    const rows = SLOTS.map(sl => {
      const m = slotMeta(sl.id);
      return `<tr><td><b>${sl.label}</b>${sl.hint ? `<br><small class="muted">${sl.hint}</small>` : ''}</td>
        <td>${m ? `${m.date}${m.map ? ` · map #${m.map}` : ""} · ${moneyShort(m.value)} · ${m.trains} trains<br><small class="muted">saved ${ago(m.savedAt)}</small>` : '<span class="muted">empty</span>'}</td>
        <td class="slot-btns">${sl.id !== 'auto' ? `<button data-save="${sl.id}">Save</button>` : ''}<button data-load="${sl.id}" ${m ? '' : 'disabled'} class="primary">Load</button>${m ? `<button data-del="${sl.id}" class="danger">×</button>` : ''}</td></tr>`;
    }).join('');
    const m = this.modal('Save &amp; load', `
      <table class="tbl saves">${rows}</table>
      <div class="btns" style="justify-content:space-between">
        <div><button id="sv-export">⬇ Export to file</button> <button id="sv-import">⬆ Import file</button><input type="file" id="sv-file" accept=".json,application/json" hidden></div>
        <button id="sv-new">New game</button>
      </div>
      <p class="muted">Saves are kept in this browser. Export a file to back them up or move them to another computer. Loading rebuilds the map and pauses the game.</p>`, true);
    m.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { if (!this.api.save(b.dataset.save)) this.openSaves(); });
    m.querySelectorAll('[data-load]').forEach(b => b.onclick = () => this.api.load(b.dataset.load));
    m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { deleteSlot(b.dataset.del); this.openSaves(); });
    $('#sv-export').onclick = () => download(this.game.serialize(this.api.view()));
    $('#sv-import').onclick = () => $('#sv-file').click();
    $('#sv-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = await readFile(f); if (![3, 4, SAVE_VERSION].includes(d.v) || !d.actions) throw new Error('Not an Iron Horizon save (or an incompatible version)'); this.api.loadData(d); }
      catch (err) { this.toast(err.message, true); }
    };
    $('#sv-new').onclick = () => this.api.newGame();
  }
  openLedger() {
    const g = this.game;
    const years = [...g.history.slice(-3), g.ledger];
    const v = (l, k) => l[k] || 0;
    const costs = ['trainUpkeep', 'shipUpkeep', 'planeUpkeep', 'trackUpkeep', 'warehouseUpkeep', 'industryUpkeep', 'interest', 'salary', 'trackageFees', 'truckUpkeep'];
    const net = (l) => v(l, 'revenue') + v(l, 'industryIncome') + v(l, 'trackageIncome') - costs.reduce((s, k) => s + v(l, k), 0);
    const cargos = [...new Set(years.flatMap(l => Object.keys(l.byCargo)))].sort((a, b) => (g.ledger.byCargo[b] || 0) - (g.ledger.byCargo[a] || 0));
    const row = (name, f, cls = '') => `<tr class="${cls}"><td>${name}</td>${years.map(l => `<td>${money(f(l))}</td>`).join('')}</tr>`;
    const owned = g.world.industries.filter(i => i.owner === 'P');
    this.modal('Company ledger', `
      <div class="kpis"><div><small>Cash</small><b>${money(g.cash)}</b></div><div><small>Bonds</small><b>${money(g.loan)}</b></div>
      <div><small>Company value</small><b>${money(g.companyValue())}</b></div><div><small>Trains / ships / aircraft</small><b>${g.vehiclesOf(g.player).filter(v => v.type === 'train').length} / ${g.vehiclesOf(g.player).filter(v => v.type === 'ship').length} / ${g.vehiclesOf(g.player).filter(v => v.type === 'plane').length}</b></div>
      <div><small>Industries owned</small><b>${owned.length}</b></div><div><small>Price level</small><b>${Math.round(g.infl() * 100)}%</b></div></div>
      <table class="tbl"><tr><th></th>${years.map(l => `<th>${l.year}</th>`).join('')}</tr>
      ${cargos.map(c => row('&nbsp;&nbsp;' + chip(c), l => l.byCargo[c] || 0)).join('')}
      ${row('<b>Freight revenue</b>', l => v(l, 'revenue'), 'sum')}
      ${row('Industry income', l => v(l, 'industryIncome'))}${row('Crossing &amp; trackage fees received', l => v(l, 'trackageIncome'))}
      ${row('Train upkeep', l => -v(l, 'trainUpkeep'))}${row('Ship upkeep', l => -v(l, 'shipUpkeep'))}${row('Aircraft upkeep', l => -v(l, 'planeUpkeep'))}${row('Road vehicle upkeep', l => -v(l, 'truckUpkeep'))}${row('Track upkeep', l => -v(l, 'trackUpkeep'))}${row('Warehouse, harbor &amp; airfield upkeep', l => -v(l, 'warehouseUpkeep'))}${row('Industry upkeep', l => -v(l, 'industryUpkeep'))}${row('Bond interest', l => -v(l, 'interest'))}${row('Chairman salary &amp; bonus', l => -v(l, 'salary'))}${row('Trackage fees paid', l => -v(l, 'trackageFees'))}
      ${row('<b>Operating profit</b>', net, 'sum')}
      ${row('Construction (investment)', l => -v(l, 'construction'))}${row('Land grants', l => v(l, 'landGrants'))}${row('Race prizes', l => v(l, 'prizes'))}${row('Rolling stock (investment)', l => -v(l, 'vehicles'))}${row('Industries bought/expanded', l => -v(l, 'industries'))}${row('Dividends paid', l => -v(l, 'dividends'))}${row('Shares issued / bought back', l => v(l, 'equity'))}${row('Dividends from shares held', l => v(l, 'shareIncome'))}${row('Patents bought at auction', l => -v(l, 'patents'))}${row('Industries sold at auction', l => v(l, 'assetSales'))}${row('Shares in other companies (bought − sold)', l => v(l, 'investments'))}</table>
      ${owned.length ? `<h4>Your industries</h4><table class="tbl">${owned.map(i => `<tr><td>${i.name} (level ${i.level})</td><td>${money(i.incomeMonth || 0)}/month</td><td>this year ${money(i.incomeYear || 0)}</td></tr>`).join('')}</table>` : ''}
      <p class="muted">Borrowing, shares and dividends are in the Finance screen (F).</p>`, true);
  }

  openFinance(refresh = false) {
    const g = this.game, f = g.fin, I = g.infl();
    const pct = (x) => (x * 100).toFixed(1) + '%';
    const h = f.hist.slice(-60), lo = Math.min(...h), hi = Math.max(...h), W = 380, H = 90;
    const pts = h.map((v, i) => `${(i / Math.max(1, h.length - 1) * (W - 40) + 30).toFixed(1)},${(H - 12 - (v - lo) / Math.max(0.01, hi - lo) * (H - 24)).toFixed(1)}`).join(' ');
    const chart = `<svg class="pricechart" width="${W}" height="${H}"><text x="0" y="12">$${hi.toFixed(2)}</text><text x="0" y="${H - 12}">$${lo.toFixed(2)}</text><polyline points="${pts}"/><text x="30" y="${H}">${h.length} months</text></svg>`;
    const lotQ = (n) => { n = n > 0 ? Math.min(n, f.publicShares) : -Math.min(-n, f.playerShares); if (!n) return '—'; const q = f.quote(n); return money(Math.abs(n) * q.avg * (1 + Math.sign(n) * FIN.fee)); };
    const own = f.ownership;
    const html = `
      <div class="kpis"><div><small>Share price</small><b>$${f.price.toFixed(2)}</b></div><div><small>Market value</small><b>${moneyShort(f.marketCap())}</b></div>
        <div><small>Book value / share</small><b>$${(g.companyValue() / f.shares).toFixed(2)}</b></div><div><small>P/E</small><b>${f.pe() ? f.pe().toFixed(1) : '—'}</b></div>
        <div><small>Dividend yield</small><b>${pct(f.yieldPct())}</b></div><div><small>Credit rating</small><b>${f.rating()}</b></div></div>
      <div class="fin-grid">
        <div>
          <h4>Share price</h4>${chart}
          <h4>Shareholders · ${f.shares.toLocaleString()} shares</h4>
          ${this.holdersBar(g.player)}
          <p class="sub">${this.holdersText(g.player)}. ${g.competition === 'friendly' ? 'Friendly game: rivals never buy your shares.' : 'If a rival ends up with over 50%, you are out as chairman — keep your own stake up.'}</p>
          <h4>Company actions</h4>
          <div class="btns" style="justify-content:flex-start;flex-wrap:wrap">
            <button id="fx-issue" ${f.canIssue() ? '' : 'disabled title="One share issue per year"'}>Issue ${pct(FIN.issuePct)} new shares · ≈${moneyShort(f.shares * FIN.issuePct * f.price * (1 - FIN.fee - 0.05))}</button>
            <button id="fx-buyback">Buy back ${pct(FIN.buybackPct)} · ≈${moneyShort(f.shares * FIN.buybackPct * f.price * (1 + FIN.fee + 0.03))}</button>
          </div>
          <p>Dividend: <input id="fx-div" type="number" min="0" step="0.05" value="${f.dividend.toFixed(2)}" style="width:80px"> $ per share per year <button id="fx-divset">Set</button>
            <span class="sub">= ${money(f.dividend * f.shares)}/yr, paid quarterly; you receive ${money(f.dividend * f.playerShares)}/yr</span></p>
          <h4>Bonds · rating ${f.rating()} · new bonds at ${pct(f.bondRate())}</h4>
          <table class="mini">${f.bonds.map(b => `<tr><td>${money(b.amount)}</td><td>${pct(b.rate)}</td><td class="sub">issued ${b.year}</td></tr>`).join('') || '<tr><td class="muted">No bonds</td></tr>'}</table>
          <div class="btns" style="justify-content:flex-start"><button id="fx-bond">Issue bond · ${money(Math.round(FIN.bondSize * I / 1000) * 1000)}</button><button id="fx-repay" ${f.bonds.length ? '' : 'disabled'}>Repay dearest bond</button></div>
        </div>
        <div>
          <h4>You, the chairman</h4>
          <table class="mini"><tr><td>Personal cash</td><td><b>${money(f.personalCash)}</b></td></tr>
            <tr><td>Your shares</td><td>${f.playerShares.toLocaleString()} · ${money(f.playerShares * f.price)}</td></tr>
            <tr><td><b>Net worth</b></td><td><b>${money(f.netWorth())}</b></td></tr>
            <tr><td>Salary</td><td>${money(FIN.salary * I * 12)}/yr + ${FIN.bonus * 100}% of operating profit</td></tr></table>
          ${this.brokerHtml()}
          <h4>Trade your company's shares</h4>
          <div class="btns" style="justify-content:flex-start;flex-wrap:wrap">
            <button id="fx-b1">Buy 1,000 · ${lotQ(FIN.lot)}</button><button id="fx-b10">Buy 10,000 · ${lotQ(FIN.lot * 10)}</button>
            <button id="fx-s1">Sell 1,000 · ${lotQ(-FIN.lot)}</button><button id="fx-s10">Sell 10,000 · ${lotQ(-FIN.lot * 10)}</button>
          </div>
          <p class="sub">Broker fee ${FIN.fee * 100}%. Big trades move the price against you. The share price follows book value, profits and dividends, plus market mood and the occasional panic.</p>
        </div>
      </div>`;
    if (refresh) { const b = document.querySelector('.modal .mbody'); if (!b) return; b.innerHTML = html; }
    else this.modal('Finance', html, true);
    const act = (id, fn, ok) => { const b = document.getElementById(id); if (b) b.onclick = () => { const e = fn(); if (e) this.toast(e, true); else if (ok) this.toast(ok); this.openFinance(true); this.topbar(); }; };
    act('fx-issue', () => f.issueShares());
    act('fx-buyback', () => f.buyBack());
    act('fx-bond', () => f.issueBond());
    act('fx-repay', () => f.repayBond());
    act('fx-divset', () => { f.setDividend(+document.getElementById('fx-div').value || 0); return null; }, 'Dividend set');
    act('fx-b1', () => f.buyShares(FIN.lot)); act('fx-b10', () => f.buyShares(FIN.lot * 10));
    act('fx-s1', () => f.sellShares(FIN.lot)); act('fx-s10', () => f.sellShares(FIN.lot * 10));
    act('fx-mb', () => g.market.borrowMargin(Math.min(100000 * I, g.market.marginLimit())), 'Margin loan taken');
    act('fx-mr', () => g.market.repayMargin(100000 * I), 'Margin loan repaid');
    document.querySelectorAll('[data-cover]').forEach(b => b.onclick = () => { const e = g.market.cover(g.comp(b.dataset.cover)); if (e) this.toast(e, true); this.openFinance(true); this.topbar(); });
  }

  // ---------- companies & the stock market (phase C) ----------
  holders(t) { // [{key, label, color, n}] for a company's shareholders, biggest first, public last
    const g = this.game, f = t.fin, out = [];
    out.push({ key: t === g.player ? 'you' : t.id, label: t === g.player ? 'you' : `${t.name} (founder)`, color: t === g.player ? 'var(--gold)' : t.color, n: f.playerShares });
    for (const [k, n] of Object.entries(f.stakes)) out.push({ key: k, label: k === 'you' ? 'you' : k === g.player.id ? 'your company' : g.comp(k).name, color: k === 'you' ? 'var(--gold)' : k === g.player.id ? '#a8843a' : g.comp(k).color, n });
    out.sort((x, y) => y.n - x.n);
    out.push({ key: 'public', label: 'public', color: '#556', n: f.publicShares });
    return out.filter(h => h.n > 0);
  }
  holdersBar(t) { return `<div class="own-bar">${this.holders(t).map(h => `<b style="width:${h.n / t.fin.shares * 100}%;background:${h.color}" title="${h.label} ${(h.n / t.fin.shares * 100).toFixed(1)}%"></b>`).join('')}</div>`; }
  holdersText(t) { return this.holders(t).map(h => `${h.label} ${(h.n / t.fin.shares * 100).toFixed(1)}%`).join(' · '); }

  openRivals(refresh = false) {
    const g = this.game, M = g.market, C = M.control(), cos = g.active, me = g.player;
    const rows = cos.map(c => {
      const L = c.history[c.history.length - 1] || c.ledger, f = c.fin;
      return { c, value: g.companyValue(c), cash: c.cash, debt: f.debt(), price: f.price, rating: f.rating(), stations: g.stationsOf(c).length,
        trains: g.vehiclesOf(c).filter(v => v.type !== 'truck').length, track: g.net.edges.filter(e => e.owner === c.id).reduce((s, e) => s + e.length, 0) / ECON.unitsPerMile,
        rev: L.revenue || 0, profit: f.profit12(), inds: g.world.industries.filter(i => i.owner === c.id).length };
    }).sort((a, b) => b.value - a.value);
    const top = Math.max(1, ...rows.map(r => r.value));
    const ctlName = (t) => { const k = M.controller(t, C); return k === 'you' ? '<b class="gold">you</b>' : k ? `<b style="color:${g.comp(k).color}">${g.comp(k).name}</b>` : 'independent'; };
    const name = (c) => `<i class="dot" style="background:${c.color}"></i><b>${c.name}</b>${c === me ? ' <small class="muted">(you)</small>' : c.ai ? ` <small class="muted">${({ builder: 'empire builder', industrialist: 'industrialist', financier: 'financier' })[c.ai.personality] || c.ai.personality}</small>` : ''}`;
    const q = (k, t, n) => { const x = M.quote(k, t, n); return x ? moneyShort(x.total) : '—'; };
    const lot = FIN.lot, big = FIN.lot * 5;
    const stock = cos.filter(t => t !== me).map(t => {
      const f = t.fin, mine = M.share('you', t, C), ctl = M.controller(t, C) === 'you';
      const you = f.stakes.you || 0, co = f.stakes[me.id] || 0;
      let extra = '';
      if (ctl) {
        const err = M.canMerge(me, t, C), terms = M.mergeTerms(me, t, C);
        const newShares = Math.round((f.shares - co) * terms.ratio);
        extra = `<div class="sub" style="margin-top:4px">🏛 <b class="gold">You control ${t.name}.</b> Its managers keep running it as your subsidiary.</div>
          <div class="btns" style="justify-content:flex-start;flex-wrap:wrap">
            <button data-mk="merge" data-t="${t.id}" ${err ? `disabled title="${err}"` : ''}>Merge into your company · ≈${newShares.toLocaleString()} new shares${terms.prem ? ` (+${terms.prem * 100}% premium below ${MARKET.mergeFree * 100}%)` : ''}</button>
            <button data-mk="special" data-t="${t.id}" ${f.lastSpecial === g.year ? 'disabled title="Once a year"' : ''}>Special dividend · ${moneyShort(Math.max(0, t.cash) * MARKET.specialDiv)} to all holders</button>
            <span>Dividend <input data-div="${t.id}" type="number" min="0" step="0.05" value="${f.dividend.toFixed(2)}" style="width:64px"> $/share/yr <button data-mk="div" data-t="${t.id}">Set</button></span>
          </div>`;
      }
      { const b = M.buyoutTerms(me, t, C), err = M.canBuyout(me, t, C);
        extra += `<div class="btns" style="justify-content:flex-start;flex-wrap:wrap;align-items:center">
          <button data-mk="buyout" data-t="${t.id}" ${err ? `disabled title="${err}"` : ''}>💼 Buy out ${t.name} · ${moneyShort(b.cost)}</button>
          <span class="sub">${b.outside.toLocaleString()} shares at $${b.px.toFixed(2)} (${Math.round(MARKET.buyoutPremium * 100)}% over price or value), company cash; it merges into yours with its ${moneyShort(Math.max(0, t.cash))} cash and its bonds${err ? ` — <span class="bad">${err}</span>` : ''}</span></div>`; }
      return `<div class="stock-row">
        <div class="stock-head">${name(t)} <b>$${f.price.toFixed(2)}</b> <span class="sub">value/share $${f.fundamental().toFixed(2)} · ${f.shares.toLocaleString()} shares · control: ${ctlName(t)}</span></div>
        ${this.holdersBar(t)}
        <div class="sub">${this.holdersText(t)} · your bloc ${(mine * 100).toFixed(1)}%</div>
        <div class="btns" style="justify-content:flex-start;flex-wrap:wrap;align-items:center">
          <span class="sub">You (${you.toLocaleString()}):</span>
          <button data-mk="buy" data-k="you" data-t="${t.id}" data-n="${lot}">Buy 1% · ${q('you', t, lot)}</button>
          <button data-mk="buy" data-k="you" data-t="${t.id}" data-n="${-lot}" ${you ? '' : 'disabled'}>Sell 1% · ${q('you', t, -lot)}</button>
          <span class="sub">Company (${co.toLocaleString()}):</span>
          <button data-mk="buy" data-k="${me.id}" data-t="${t.id}" data-n="${big}">Buy 5% · ${q(me.id, t, big)}</button>
          <button data-mk="buy" data-k="${me.id}" data-t="${t.id}" data-n="${-big}" ${co ? '' : 'disabled'}>Sell 5% · ${q(me.id, t, -big)}</button>
          ${g.competition === 'cutthroat' ? `<span class="sub">Short (${(me.fin.shorts?.[t.id]?.n || 0).toLocaleString()}):</span><button data-mk="short" data-t="${t.id}">Short 1%</button><button data-mk="cover" data-t="${t.id}" ${me.fin.shorts?.[t.id] ? '' : 'disabled'}>Cover</button>` : ''}
        </div>${extra}</div>`;
    }).join('');
    const gone = g.companies.filter(c => c.gone);
    const html = `
      <p class="muted">Rival companies build their own stations, track and fleets with the same rules as you. Where you serve the same town or industry, its output is split by how well each company picks it up. ${g.net.legacy ? '' : ` Where your track crosses another company's line at the same level you pay it ${money(XING.fee)} for the crossing.`}</p>
      ${rows.map((r, i) => `<div class="bar"><span>${i + 1}. ${r.c.name}</span><div><b style="width:${Math.max(1, r.value / top * 100)}%;background:${r.c.color}"></b></div><em>${moneyShort(r.value)}</em></div>`).join('')}
      <table class="tbl"><tr><th>Company</th><th>Value</th><th>Cash</th><th>Bonds</th><th>Share</th><th>Stations</th><th>Vehicles</th><th>Track</th><th>Revenue ${g.year - (rows[0].c.history.length ? 1 : 0)}</th><th>Profit/yr</th><th>Industries</th></tr>
      ${rows.map(r => `<tr><td>${name(r.c)}</td><td>${moneyShort(r.value)}</td><td>${moneyShort(r.cash)}</td><td>${moneyShort(r.debt)} <small class="muted">${r.rating}</small></td><td>$${r.price.toFixed(2)}</td><td>${r.stations}</td><td>${r.trains}</td><td>${r.track.toFixed(0)} mi</td><td>${moneyShort(r.rev)}</td><td class="${r.profit >= 0 ? 'ok' : 'bad'}">${moneyShort(r.profit)}</td><td>${r.inds}</td></tr>`).join('')}</table>
      ${this.trackageHtml()}
      ${this.rateWarsHtml()}
      ${gone.length ? `<p class="sub">Merged: ${gone.map(c => `${c.name} → ${g.comp(c.gone.into).name} (${c.gone.year})`).join(', ')}</p>` : ''}
      ${stock ? `<h4>Stock market</h4>
      <p class="sub">Buy shares personally (your cash ${money(me.fin.personalCash)}) or with company money (${money(me.cash)}). Over 50% of a company between you, your company and its subsidiaries gives you control: run it as a subsidiary or merge it. Broker fee ${FIN.fee * 100}%; big trades move the price.${g.competition === 'friendly' ? ' Friendly game: rivals never buy shares.' : ' Rivals trade too — watch who is buying into your company (Finance, F).'}</p>
      ${stock}` : ''}`;
    if (refresh) { const b = document.querySelector('#modals .rivals-body'); if (!b) return; b.innerHTML = html; }
    else this.modal('Companies &amp; stock market', `<div class="rivals-body">${html}</div>`, true);
    const body = document.querySelector('#modals .rivals-body');
    if (!body) return;
    const tb = body.querySelector('#tr-rights');
    if (tb) tb.onclick = () => { g.setRights(g.rightsOf(me) === 'open' ? 'closed' : 'open', me); this.openRivals(true); };
    body.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => {
      const t = g.comp(b.dataset.t), kind = b.dataset.mk;
      let err = null, ok = null;
      if (kind === 'buy') err = M.trade(b.dataset.k, t, +b.dataset.n);
      else if (kind === 'merge') { err = M.merge(me, t); ok = `${t.name} merged into your company`; }
      else if (kind === 'buyout') {
        const b = M.buyoutTerms(me, t);
        if (!confirm(`Buy out ${t.name} for ${money(b.cost)} of company cash? Its network, trains, industries, cash (${money(Math.max(0, t.cash))}) and bonds (${money(t.fin.debt())}) become yours.`)) return;
        err = M.buyout(me, t); ok = `You bought out ${t.name}`;
      }
      else if (kind === 'special') err = M.specialDividend(t, 'you');
      else if (kind === 'short') err = M.short(t, FIN.lot);
      else if (kind === 'cover') err = M.cover(t);
      else if (kind === 'div') { err = M.setSubsidiaryDividend(t, 'you', +body.querySelector(`[data-div="${t.id}"]`).value || 0); ok = 'Dividend set'; }
      if (err) this.toast(err, true); else if (ok) this.toast(ok);
      this.openRivals(true); this.topbar();
    });
  }
  // ---------- trackage rights ----------
  trackageHtml() {
    const g = this.game, me = g.player;
    if (g.net.legacy) return '';
    const sum = (c, k) => [...c.history.slice(-1), c.ledger].reduce((s, l) => s + (l[k] || 0), 0);
    const rows = g.active.filter(c => c !== me).map(c => `<tr><td><i class="dot" style="background:${c.color}"></i>${c.name}</td><td>${g.rightsOf(c) === 'open' ? '<span class="ok">open to you</span>' : '<span class="muted">closed</span>'}</td></tr>`).join('');
    return `<h4>Trackage rights</h4>
      <p class="sub">A company can open its track to others. You can then build a junction onto its line and run your trains over it between your own stations, paying it ${money(ECON.trackageRate * g.infl())} per train-mile. Trains never stop at or pass through another company's stations.</p>
      <table class="mini">${rows}<tr><td><b>Your track</b></td><td>${g.rightsOf(me) === 'open' ? '<span class="ok">open to other companies</span>' : 'closed'} <button id="tr-rights">${g.rightsOf(me) === 'open' ? 'Close it' : 'Open it'}</button></td></tr>
        <tr><td>Fees this year and last</td><td>received ${money(sum(me, 'trackageIncome'))} · paid ${money(sum(me, 'trackageFees'))} <small class="muted">(received: crossings and trackage; paid: trackage)</small></td></tr></table>`;
  }
  // ---------- cut-throat (phase E) ----------
  rateWarsHtml() {
    const g = this.game, R = g.rateWars;
    if (g.competition !== 'cutthroat' && !R.list.length) return '';
    const nm = (id) => `<b style="color:${g.comp(id).color}">${id === g.player.id ? 'You' : g.comp(id).name}</b>`;
    const live = R.list.filter(w => !w.pending).map(w => { const t = R.town(w.town), sa = R.share(w, w.a); return `<div class="bar"><span>⚔ ${t.name}</span><div><b style="width:${(1 - sa) * 100}%;background:${g.comp(w.b).color}"></b></div><em>${Math.round((1 - sa) * 100)}%</em></div><p class="sub">${nm(w.b)} (newcomer, ${Math.round((1 - sa) * 100)}%) vs ${nm(w.a)} (${Math.round(sa * 100)}%) until ${g.auctions.dateOf(w.end)}</p>`; }).join('');
    const done = R.done.slice().reverse().slice(0, 6).map(r => `${r.year} ${R.town(r.town).name}: ${nm(r.winner)} beat ${nm(r.loser)} (${r.share}%)`).join(' · ');
    return `<h4>Rate wars</h4><p class="sub">Cut-throat game: carrying traffic from a new station in a town another company serves starts a two-year rate war. Both sides earn ${RATEWAR.cut * 100}% less there; the one that carries more keeps the town, and the loser's stations lose it.</p>${live || '<p class="sub">No rate wars right now.</p>'}${done ? `<p class="sub">Past: ${done}</p>` : ''}`;
  }
  brokerHtml() {
    const g = this.game, M = g.market, f = g.player.fin, a = M.account();
    if (g.competition === 'friendly' && !f.margin) return '';
    const shorts = Object.entries(f.shorts || {});
    return `<h4>Your broker</h4>
      <table class="mini"><tr><td>Margin loan</td><td><b>${money(f.margin || 0)}</b> at ${MARKET.marginRate * 100}% · can borrow ${money(M.marginLimit())} more</td></tr>
        ${shorts.map(([id, s]) => { const t = g.comp(id); return `<tr><td>Short ${t.name}</td><td>${s.n.toLocaleString()} shares sold at $${s.price.toFixed(2)}, now $${t.fin.price.toFixed(2)} · ${t.fin.price > s.price ? '<span class="bad">' : '<span class="ok">'}${money((s.price - t.fin.price) * s.n)}</span> <button data-cover="${id}">Cover</button></td></tr>`; }).join('')}
        <tr><td>Equity</td><td class="${a.ratio < MARKET.marginCall + 0.1 ? 'bad' : ''}">${Math.round(a.ratio * 100)}% of your assets${a.debts > 0 ? ` · margin call below ${MARKET.marginCall * 100}%` : ''}</td></tr></table>
      <div class="btns" style="justify-content:flex-start"><button id="fx-mb" ${M.marginLimit() < 1000 || g.competition === 'friendly' ? 'disabled' : ''}>Borrow on margin · ${money(Math.min(100000 * g.infl(), M.marginLimit()))}</button><button id="fx-mr" ${f.margin ? '' : 'disabled'}>Repay</button></div>
      <p class="sub">Borrow against your shares to buy more. If your equity falls below ${MARKET.marginCall * 100}% of what you hold, the broker sells your shares: rivals' first, then your own company's.${g.competition === 'cutthroat' ? ` Short selling (Companies screen): sell shares you don't own and buy them back later; ${MARKET.shortFee * 100}% a month, bought back by force if the price doubles.` : ''}</p>`;
  }
  // ---------- auctions (phase D) ----------
  openAuctions(refresh = false) {
    const g = this.game, A = g.auctions, me = g.player;
    const who = (id) => !id ? '—' : id === me.id ? '<b class="gold">you</b>' : `<b style="color:${g.comp(id).color}">${g.comp(id).name}</b>`;
    const open = A.open.map(a => {
      const mine = a.bids[me.id] || 0, n = Object.keys(a.bids).length, ind = a.kind === 'industry' ? A.ind(a.ref) : null;
      const what = a.kind === 'tech' ? `💡 <b>${INVENTIONS[a.ref].name}</b><br><span class="sub">${INVENTIONS[a.ref].desc}; yours alone for ${AUCTION.patentYears} years</span>`
        : `🏭 <b>${ind.name}</b> (level ${ind.level})<br><span class="sub">${Object.keys(ind.def.out).map(c => CARGO[c].name).join(', ')} · list price ${money(g.industryPrice(ind))}${a.seller ? ` · sold by ${who(a.seller)}` : ' · newly founded'}</span>`;
      const own = a.seller === me.id;
      return `<tr><td>${what}</td><td>${money(a.reserve)}</td><td>${A.dateOf(a.closes)}</td><td>${n} sealed bid${n === 1 ? '' : 's'}</td>
        <td>${own ? '<span class="sub">your sale</span>' : `<input data-bid="${a.id}" type="number" min="0" step="1000" value="${mine || a.reserve}" style="width:96px"> <button data-ab="${a.id}">${mine ? 'Change' : 'Bid'}</button>${mine ? ` <button data-aw="${a.id}">Withdraw</button><br><span class="sub">your bid ${money(mine)}</span>` : ''}`}</td></tr>`;
    }).join('');
    const techs = Object.entries(INVENTIONS).map(([id, d]) => {
      const t = A.techs[id], until = A.exclusiveUntil(id);
      const st = !t ? (d.year <= g.year ? 'at auction' : `from ${d.year}`) : !t.holder ? 'everyone (unsold)' : g.year >= until ? `everyone (patent ran out ${until})` : `${who(t.holder)} until ${until} (paid ${money(t.price)})`;
      return `<tr class="${t && A.has(id, me) ? '' : 'locked'}"><td>${d.name}</td><td class="sub">${d.desc}</td><td>${st}</td><td>${t && A.has(id, me) ? '✓' : ''}</td></tr>`;
    }).join('');
    const done = A.closed.slice().reverse().slice(0, 10).map(r => `<tr><td>${r.year}</td><td>${r.kind === 'tech' ? INVENTIONS[r.ref].name : (A.ind(r.ref)?.name || r.ref)}</td><td>${r.winner ? who(r.winner) : 'no bids'}</td><td>${r.winner ? money(r.price) : ''}</td><td class="sub">${r.bids} bid${r.bids === 1 ? '' : 's'}${r.mine ? ` · you bid ${money(r.mine)}` : ''}</td></tr>`).join('');
    const html = `
      <p class="muted">Sealed bids: every company bids once (you can change or withdraw yours until the auction closes). The highest bidder wins and pays the second-highest bid + ${money(AUCTION.step)} — never more than they bid, never less than the reserve. So bid what the lot is really worth to you. Your cash: ${money(me.cash)}.</p>
      <h4>Open auctions</h4>
      ${open ? `<table class="tbl"><tr><th>Lot</th><th>Reserve</th><th>Closes</th><th>Bids</th><th>Your bid</th></tr>${open}</table>` : '<p class="sub">Nothing for sale right now. New inventions come up as the years pass; newly founded industries and any industry a company sells are auctioned too.</p>'}
      <h4>Inventions</h4><table class="tbl"><tr><th>Invention</th><th>Effect</th><th>Who has it</th><th>You</th></tr>${techs}</table>
      ${done ? `<h4>Recent results</h4><table class="tbl">${done}</table>` : ''}`;
    if (refresh) { const b = document.querySelector('#modals .auctions-body'); if (!b) return; b.innerHTML = html; }
    else this.modal('Auctions', `<div class="auctions-body">${html}</div>`, true);
    const body = document.querySelector('#modals .auctions-body');
    if (!body) return;
    const after = (err, ok) => { if (err) this.toast(err, true); else this.toast(ok); this.openAuctions(true); };
    body.querySelectorAll('[data-ab]').forEach(b => b.onclick = () => { const a = A.byId(b.dataset.ab); after(A.bid(a, me, +body.querySelector(`[data-bid="${b.dataset.ab}"]`).value), 'Bid placed'); });
    body.querySelectorAll('[data-aw]').forEach(b => b.onclick = () => after(A.bid(A.byId(b.dataset.aw), me, 0), 'Bid withdrawn'));
  }
  // a rival holds 40%+ of your company
  openDefend(c, s) {
    const g = this.game, f = g.player.fin;
    this.setSpeed(0);
    const m = this.modal('⚠ Takeover threat', `
      <p><b style="color:${c.color}">${c.name}</b> now controls <b>${Math.round(s * 100)}%</b> of your company. If it passes 50%, you are out as chairman and the game is over.</p>
      ${this.holdersBar(g.player)}<p class="sub">${this.holdersText(g.player)}</p>
      <p>How to defend:</p>
      <ul class="sub"><li><b>Buy shares yourself</b> (Finance, F) with your personal cash: ${money(f.personalCash)}.</li>
        <li><b>Raise the dividend</b>: a higher share price makes every further share dearer for the raider.</li>
        <li><b>Buy back shares</b> takes them off the market, but it also raises the raider's percentage, so only do it while your stake is bigger.</li>
        <li><b>Issue new shares</b> dilutes everyone, the raider included, but you too.</li></ul>
      <div class="btns"><button id="df-fin">Open Finance</button><button id="df-ok">Close</button></div>`);
    m.querySelector('#df-fin').onclick = () => this.openFinance();
    m.querySelector('#df-ok').onclick = () => this.closeModals();
  }
  openOusted(c) {
    const g = this.game, f = g.player.fin;
    this.setSpeed(0);
    const m = this.modal('Taken over', `
      <p><b style="color:${c.color}">${c.name}</b> has bought control of your company. The board has replaced you as chairman.</p>
      <p>You leave with your personal fortune: <b>${money(f.netWorth())}</b> (cash ${money(f.personalCash)} plus your shares).</p>
      <p class="sub">The game is over. Load a save to fight back from an earlier position, or start a new company.</p>
      <div class="btns"><button id="ou-load">Load a save</button><button id="ou-new">New game</button></div>`);
    m.querySelector('.x').remove();
    m.querySelector('#ou-load').onclick = () => this.openSaves();
    m.querySelector('#ou-new').onclick = () => { location.href = location.pathname + location.search; };
  }
  openMarkets() {
    const g = this.game, I = g.infl();
    const rows = Object.entries(CARGO).sort((a, b) => a[1].tier - b[1].tier || a[1].value - b[1].value).map(([k, c]) => {
      const [wt, cap] = Object.entries(c.cap)[0];
      const perMile = cap * (c.wt * ECON.tonRate * I + c.value * I * ECON.valueRate);
      const avail = !c.year || c.year <= g.year;
      return `<tr class="${avail ? '' : 'locked'}"><td>${chip(k)}</td><td>${['Raw', 'Tier 1', 'Tier 2', 'Tier 3'][c.tier]}</td><td>${money(c.value * I)} / ${c.unit.replace(/s$/, '')}</td>
        <td>${c.wt} t</td><td>${WAGONS[wt].name} × ${cap}${Object.keys(c.cap).filter(w => !WAGONS[w].road && !WAGONS[w].air).length > 1 ? ` <span class="sub">(+${Object.keys(c.cap).slice(1).filter(w => !WAGONS[w].road && !WAGONS[w].air).map(w => WAGONS[w].name.toLowerCase()).join(', ')})</span>` : ''}</td>
        <td>${money(cap * c.value * I)}</td><td>${Math.round(cap * c.wt)} t</td><td><b>${money(perMile)}</b></td><td>${avail ? '✓' : c.year}${WAGONS[wt].year > g.year ? ` <span class="sub">(wagon ${WAGONS[wt].year})</span>` : ''}</td></tr>`;
    }).join('');
    this.modal('Cargo &amp; markets', `
      <p class="muted">Each product is worth its inputs × a markup that grows with each tier, and all values inflate about ${ECON.inflation * 100}% a year. Freight pay per unit-mile = weight × $${ECON.tonRate} + value × ${ECON.valueRate * 100}%, × speed bonus × the price the receiver pays (shown in station, town and industry panels).</p>
      <table class="tbl market"><tr><th>Cargo</th><th>Tier</th><th>Value now</th><th>Weight/unit</th><th>Wagon × capacity</th><th>Value / wagon</th><th>Weight / wagon</th><th>Pay / wagon-mile</th><th>Available</th></tr>${rows}</table>`, true);
  }

  openChain() {
    const cols = [[], [], [], []];
    for (const [k, d] of Object.entries(INDUSTRY)) cols[d.tier].push(k);
    const g = this.game;
    const colX = [20, 300, 580, 860, 1140], W = 1380, nodeW = 220, nodeH = 34, gap = 10, top = 40;
    const pos = {};
    const maxRows = Math.max(...cols.map(c => c.length));
    const H = top + maxRows * (nodeH + gap) + 20;
    cols.forEach((c, ci) => {
      const off = top + (maxRows - c.length) * (nodeH + gap) / 2;
      c.forEach((k, ri) => pos[k] = { x: colX[ci], y: off + ri * (nodeH + gap) });
    });
    pos.__town = { x: colX[4], y: H / 2 - 80 };
    const outs = (k) => Object.keys(INDUSTRY[k].out);
    let paths = '', boosts = '';
    for (const [k] of Object.entries(INDUSTRY)) for (const c of outs(k)) {
      const a = pos[k];
      const targets = Object.entries(INDUSTRY).filter(([, x]) => x.in && x.in[c] !== undefined).map(([kk]) => kk);
      if (TOWN_ACCEPTS.includes(c)) targets.push('__town');
      for (const t of targets) {
        const b = pos[t];
        const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + (t === '__town' ? 80 : nodeH / 2);
        paths += `<path data-from="${k}" data-to="${t}" d="M${x1},${y1} C${x1 + 50},${y1} ${x2 - 50},${y2} ${x2},${y2}" stroke="${lift(CARGO[c].color)}"><title>${CARGO[c].name}</title></path>`;
      }
      const bt = Object.entries(INDUSTRY).filter(([, x]) => x.boost && x.boost[c] !== undefined).map(([kk]) => kk);
      for (const t of bt) {
        const b = pos[t];
        const x1 = a.x + nodeW / 2, y1 = a.y + nodeH, x2 = b.x + nodeW / 2, y2 = b.y + nodeH;
        boosts += `<path class="boost" data-from="${k}" data-to="${t}" d="M${x1},${y1} C${x1},${H + 40} ${x2},${H + 40} ${x2},${y2}" stroke="${lift(CARGO[c].color)}"><title>${CARGO[c].name} boost</title></path>`;
      }
    }
    let nodes = '';
    for (const [k, d] of Object.entries(INDUSTRY)) {
      const p = pos[k], c0 = outs(k)[0], future = d.year && d.year > g.year;
      const ins = d.in ? Object.keys(d.in).map(c => `<tspan fill="${lift(CARGO[c].color)}">●</tspan>`).join('') : '';
      nodes += `<g class="node${future ? ' future' : ''}" data-k="${k}" transform="translate(${p.x},${p.y})"><rect width="${nodeW}" height="${nodeH}" rx="7"/>
        <text x="10" y="15" class="n">${d.name}${d.year ? ` <tspan class="yr">${d.year}</tspan>` : ''}</text><text x="10" y="28" class="s">${d.consumer ? `buys ${ins}${d.premium && d.premium !== 1 ? ` <tspan class="val">pays ×${d.premium}</tspan>` : ''}` : `${ins}${d.in ? ' → ' : ''}${outs(k).map(c => `<tspan fill="${lift(CARGO[c].color)}">${CARGO[c].name}</tspan>`).join(', ')} <tspan class="val">${moneyShort(g.value(c0))}/${CARGO[c0].unit.replace(/s$/, '')}</tspan>`}</text></g>`;
    }
    const tl = TOWN_ACCEPTS.filter(c => c !== 'passengers' && c !== 'mail');
    nodes += `<g class="node town" data-k="__town" transform="translate(${pos.__town.x},${pos.__town.y})"><rect width="${nodeW}" height="${40 + tl.length * 13}" rx="9"/>
      <text x="12" y="24" class="n">🏘 Towns</text>${tl.map((c, i) => `<text x="12" y="${44 + i * 13}" class="s" fill="${lift(CARGO[c].color)}">${CARGO[c].name}</text>`).join('')}</g>`;
    const heads = ['Raw resources', 'Tier 1 processing', 'Tier 2 manufacturing', Object.values(INDUSTRY).some(d => d.consumer) ? 'Army, wharf & mint' : 'Tier 3', 'Towns'].map((t, i) => `<text class="head" x="${colX[i]}" y="22">${t}</text>`).join('');
    const m = this.modal(`Production chain — ${Object.keys(CARGO).length} cargo types`, `
      <p class="muted">Solid lines: inputs. Dashed lines underneath: productivity boosters fed back to raw producers. Values per unit at today's prices; years mark industries that appear later. Hover an industry to trace its chain.</p>
      <div class="chain-wrap"><svg viewBox="0 0 ${W} ${H + 60}" width="${W}" height="${H + 60}" class="chain">${heads}<g class="edges">${boosts}${paths}</g>${nodes}</svg></div>`, true);
    const svg = m.querySelector('svg');
    svg.querySelectorAll('.node').forEach(n => {
      n.onmouseenter = () => {
        const k = n.dataset.k; const on = new Set([k]);
        const edges = [...svg.querySelectorAll('path')];
        let changed = true;
        const up = new Set([k]), down = new Set([k]);
        while (changed) { changed = false; for (const e of edges) { if (e.classList.contains('boost')) continue; if (down.has(e.dataset.from) && !down.has(e.dataset.to)) { down.add(e.dataset.to); changed = true; } if (up.has(e.dataset.to) && !up.has(e.dataset.from)) { up.add(e.dataset.from); changed = true; } } }
        for (const x of [...up, ...down]) on.add(x);
        svg.classList.add('focus');
        svg.querySelectorAll('.node').forEach(q => q.classList.toggle('hl', on.has(q.dataset.k)));
        edges.forEach(e => e.classList.toggle('hl', (on.has(e.dataset.from) && on.has(e.dataset.to)) && (!e.classList.contains('boost') || e.dataset.from === k || e.dataset.to === k)));
      };
      n.onmouseleave = () => svg.classList.remove('focus');
    });
  }
}
