// Eras and the frontier (CONTINENT_PLAN.md §3, phase 3). Pure simulation, owned by the Game.
//  * Territories (continent only): regions settled over the game. Their towns grow with rail service like any town;
//    as a territory's population grows, its held-back industries are founded and new towns appear on the sites the
//    map made for them. It becomes a state at its target population (or in its state year at the latest).
//  * Land grants: track built in a territory before statehood earns money per mile.
//  * Wartime: the army's customers buy several times as much and pay more for a few years (RULES.wars).
import { RULES, ECON } from './data.js';
import { TERRITORIES, FRONTIER } from './continent.js';
import { money } from './util.js';

export class Frontier {
  constructor(game) {
    this.g = game;
    // region → { pop0, target, opened, state (year or null), founded (towns) }
    this.t = {};
    this.eras = true; // wartime periods apply (false for saves from before them)
  }
  start() {
    const W = this.g.world;
    this.t = {};
    if (W.frontierSites) for (const [reg, T] of Object.entries(TERRITORIES)) {
      const pop0 = this.popOf(reg);
      this.t[reg] = { pop0, target: Math.round(Math.max(pop0 * T.grow, pop0 + 5000) / 100) * 100, opened: false, state: null, founded: 0 };
    }
  }
  serialize() { return JSON.parse(JSON.stringify(this.t)); }
  load(d) { if (!d) { this.t = {}; return; } for (const [reg, v] of Object.entries(d)) if (this.t[reg]) Object.assign(this.t[reg], v); } // (saves from before: no frontier)

  get active() { return Object.keys(this.t).length > 0; }
  regionOf(o) { return (o.region ??= this.g.world.terrain.regionAt?.(o.x, o.z) ?? null); }
  popOf(reg) { return this.g.world.towns.reduce((s, t) => s + (this.regionOf(t) === reg ? t.pop : 0), 0); }
  // settlement progress counts growth, not the settlers a founding brings (or one founding would set off the next)
  settled(reg) { return this.popOf(reg) - (this.t[reg]?.founded || 0) * FRONTIER.townPop; }
  // a territory not yet a state (land grants, held industries)
  isTerritory(reg) { const v = this.t[reg]; return !!v && !v.state; }
  // land grants: from its opening to statehood
  granting(reg) { const v = this.t[reg]; return !!v && v.opened && !v.state; }
  // an industry the frontier still holds back (the era rule must not found it)
  holds(ind) { return !!ind.frontier && this.isTerritory(ind.frontier); }

  // ---------- wartime ----------
  war(y = this.g.year) { return !this.eras ? null : RULES.wars?.find(w => y >= w.from && y <= w.to) || null; }
  nextWar(y = this.g.year) { return !this.eras ? null : RULES.wars?.find(w => w.from > y) || null; }
  // demand multiplier for an army customer: wartime, the two lean years after, and forts in a territory turned state
  armyMul(cons) {
    if (!cons.def?.army) return 1;
    const y = this.g.year, w = this.war(y);
    let m = w ? w.mul : this.eras && RULES.wars?.some(x => y > x.to && y <= x.to + 2) ? 0.6 : 1;
    if (cons.def.kind === 'fort' && this.t[this.regionOf(cons)]?.state) m *= 0.5; // (the frontier has moved on)
    return m;
  }
  // the army pays more while it is at war
  armyPremium(cons) { const w = cons.def?.army && this.war(); return w ? 1 + (w.mul - 1) * 0.15 : 1; }

  // ---------- land grants ----------
  // $ a track plan earns: per mile of it lying in a territory, at most half its cost
  grantFor(plan, cost) {
    if (!this.active) return 0;
    let len = 0;
    const pts = plan.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (this.granting(this.g.world.terrain.regionAt((a.x + b.x) / 2, (a.z + b.z) / 2))) len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    if (!len) return 0;
    return Math.round(Math.min(cost * 0.5, len / ECON.unitsPerMile * FRONTIER.landGrant * this.g.infl()));
  }

  // ---------- founding towns ----------
  found(reg, k) {
    const g = this.g, W = g.world, site = W.frontierSites?.[reg]?.[k];
    if (!site || W.towns.some(t => t.name === site.name)) return null;
    // lots stay clear of stations and track already there
    const near = (x, z) => W.stations.some(s => Math.hypot(s.x - x, s.z - z) < 60)
      || g.net.edges.some(e => Math.hypot(e.pts[0].x - x, e.pts[0].z - z) < e.length + 50 && e.pts.some(p => Math.hypot(p.x - x, p.z - z) < 16));
    const town = W.foundTown(site, near);
    town.region = reg;
    // stations already in reach serve it
    for (const st of W.stations) if (W.coverage(st.x, st.z).towns.includes(town)) { st.cov.towns.push(town); (town.stations ||= []).push(st); }
    this.t[reg].founded = Math.max(this.t[reg].founded, k + 1);
    g.log({ t: 'found', r: reg, k });
    g.emit('townFounded', town);
    return town;
  }

  // ---------- the month ----------
  monthly() {
    const g = this.g, y = g.year;
    // wartime news: announced a year ahead, at the start and at the end
    if (this.eras && g.date.getMonth() === 0) {
      const ahead = RULES.wars?.find(w => w.from === y + 1), now = RULES.wars?.find(w => w.from === y), over = RULES.wars?.find(w => w.to === y - 1);
      if (ahead) g.emit('news', `⚔ War clouds: ${ahead.name} is expected next year. Army bases and forts will buy ×${ahead.mul} weapons, ammunition, food, uniforms and horses, and pay more`);
      if (now) g.emit('news', `⚔ ${cap(now.name)} has begun: the army buys ×${now.mul} and pays ${Math.round((now.mul - 1) * 15)}% more until ${now.to}`);
      if (over) g.emit('news', `🕊 Peace: ${over.name} is over. Army demand falls back (×0.6 for two years)`);
    }
    for (const [reg, v] of Object.entries(this.t)) {
      if (v.state) continue;
      const T = TERRITORIES[reg], pop = this.settled(reg);
      if (!v.opened && y >= T.opens) { v.opened = true; g.emit('news', `🐂 ${T.name} opens to settlers. Track built there earns a land grant of ${money(FRONTIER.landGrant * g.infl())} a mile`); }
      if (!v.opened) continue;
      const share = Math.min(1, Math.max(0, (pop - v.pop0) / Math.max(1, v.target - v.pop0)));
      // industries: founded in step with the population (one a month at most)
      const held = g.world.industries.filter(i => i.frontier === reg), waiting = held.filter(i => i.dormant && (i.def.year || 0) <= y);
      const due = Math.ceil(held.length * (FRONTIER.keep + (1 - FRONTIER.keep) * share)) - held.filter(i => !i.dormant).length;
      if (due > 0 && waiting.length) g.activateIndustry(waiting[0]); // (its own news says where)
      // towns: one per step of growth
      const sites = g.world.frontierSites[reg] || [];
      if (v.founded < sites.length && share >= (v.founded + 1) / (sites.length + 1)) {
        const town = this.found(reg, v.founded);
        if (town) g.emit('news', `🏘 Settlers found <b>${town.name}</b> in ${T.name}`);
        else v.founded++; // (a site that can no longer be used)
      }
      if (pop >= v.target || y >= T.stateYear) {
        v.state = y;
        for (const i of held) if (i.dormant && (i.def.year || 0) <= y) g.activateIndustry(i);
        g.emit('news', `⭐ ${T.name} becomes a state (${this.popOf(reg).toLocaleString()} people). Its land grants end`);
      }
    }
  }
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
