import { CARGO, INDUSTRY, LOCOS, ECON, WAGONS, SHIPS, PLANES, ROAD_VEHICLES, FEATURES, RULES, TOWN_ACCEPTS, TOWN_GROWTH, TOWN_DEMAND, LEVEL_MUL, AUCTION, LOCO_LEN, WAGON_LEN } from './data.js';
import { CompanyAI, DIFFICULTY, PERSONALITIES } from './ai.js';
import { findAirportSite, flightPath } from './planes.js';
import { Finance, opTotal, FIN } from './finance.js';
import { Market, MARKET } from './market.js';
import { Auctions } from './auctions.js';
import { RateWars } from './ratewars.js';
import { Frontier } from './frontier.js';
import { Race } from './race.js';
import { Vec3 } from './math.js';
import { clamp, money, smoothstep, MAP_GEN } from './util.js';
import { PLATFORM2, DOUBLE_OFF, SWITCH_LEN, SIGNAL_COST, XING } from './track.js';
import { RoadNetwork } from './road.js';

const START = new Date(1850, 0, 1);
export { LEVEL_MUL };
const HALF = ECON.platformLen / 2, BACK = 90, MAX_WAGONS = 6;
const PLAT_OFFS = [0, PLATFORM2, PLATFORM2 * 2];
export const SAVE_VERSION = 5; // 4: level crossings (v3 saves replay without them) · 5: roads and road vehicles
const JZONE = 40;
const GEAR = { biplane: 1.6, trimotor: 2.1, twin: 2.3, freighter: 3.0 }; // plane origin height above the runway // switch area around a junction, protected by its lock // main, 2nd platform, passing siding
const _ta = new Vec3(), _tb = new Vec3();
const STATION_NAMES_SUFFIX = ['Junction', 'Halt', 'Yard', 'Crossing', 'Siding', 'Depot'];

export class Game {
  // the simulation (pure: no rendering). this.view, when set, is told about changes it should show.
  constructor(world, net) {
    this.world = world; this.net = net; this.view = null;
    this.day = 0;
    // companies: the player (always first) and rivals. Money, ledgers and finance belong to a company;
    // `this.co` is the company the code is currently acting for (see as()), the player by default.
    this.companies = []; this.coById = {}; this.brains = new Map(); this.quarter = 0;
    this.market = new Market(this);
    this.auctions = new Auctions(this); // industry and invention auctions (phase D)
    this.rateWars = new RateWars(this); // rate wars for towns (phase E, Cut-throat games)
    this.frontier = new Frontier(this); // territories, land grants, wartime (phase 3 of the continent)
    this.race = new Race(this); // the transcontinental race (phase 4)
    this.competition = 'competitive'; // 'friendly': rivals never buy shares (no hostile takeovers); 'cutthroat': + rate wars, short selling
    this.ousted = null;               // set when a rival takes control of your company
    this.co = this.addCompany({ id: 'P', name: 'Iron Horizon Co.', color: '#5f8fc9' });
    this.trains = []; this.trainSeq = 1;
    this.ships = []; this.shipSeq = 1; this.water = null;
    this.trucks = []; this.truckSeq = 1; this.roads = new RoadNetwork(world.terrain, world, net);
    // a road split by a new junction: road vehicles on it follow its two halves
    this.roads.onSplit = (E, E1, E2) => {
      for (const rv of this.trucks) if (rv.path?.legs?.some(l => l.edge === E))
        rv.path.legs = rv.path.legs.flatMap(l => l.edge !== E ? [l] : (l.forward ? [{ edge: E1, forward: true }, { edge: E2, forward: true }] : [{ edge: E2, forward: false }, { edge: E1, forward: false }]));
    };
    this.planes = []; this.planeSeq = 1; // set by main once the terrain exists
    this.listeners = {};
    this.lastMonth = 0; this.lastYear = 1850;
    // scenario medals: company value by the deadline
    // (the continent's economy is several times bigger: its targets are set so the balance bot earns Bronze about 1860,
    // Silver about 1871 and misses Gold, as on the classic map — see BALANCE.md)
    const [b, s, g] = world.terrain?.cont ? [8e6, 60e6, 150e6] : [3e6, 12e6, 35e6];
    this.medalTiers = [{ name: 'Bronze', icon: '🥉', value: b }, { name: 'Silver', icon: '🥈', value: s }, { name: 'Gold', icon: '🥇', value: g }];
    this.deadline = 1880;
    this.medals = []; // [{name, year}]
    this.announcedLocos = new Set(LOCOS.filter(l => l.year <= 1850).map(l => l.id));
    this.announcedWagons = new Set(Object.keys(WAGONS).filter(k => WAGONS[k].year <= 1850));
    this.demand = new Map(); // station -> {cargo: mul}
    this.blocks = new Map(); // block id -> Set(train)
    this.throats = new Map();
    this.actions = []; // construction history (for save files) // station end -> train (switch area beyond the platforms)
    net.onSplit = (E, E1, E2) => this.remapSplit(E, E1, E2);
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  // news, floating numbers and goals are for the player: rivals act quietly (they report through newsFor)
  emit(ev, ...a) {
    if (this.muted && ev !== 'changed') return;
    if (this.co !== this.player && (ev === 'news' || ev === 'float' || ev === 'goal')) return;
    (this.listeners[ev] || []).forEach(f => f(...a));
  }
  newsFor(c, msg) { if (c === this.player || c === null) this.as(this.player, () => this.emit('news', msg)); }

  // ---------------- companies ----------------
  addCompany(o) {
    const c = { id: o.id, name: o.name, color: o.color, ai: o.ai || null, cash: o.cash ?? ECON.startCash, loan: 0, ledger: this.newLedger(this.year), history: [] };
    c.fin = new Finance(this, c, o.seed);
    this.companies.push(c); this.coById[c.id] = c;
    return c;
  }
  // rival companies for a new game (original names; personalities from ai.js)
  // opts (for balance runs): personalities: ['financier', …] per rival slot, seed: varies the random streams
  addRivals(n = 2, difficulty = 'normal', opts = {}) {
    const R = [
      { id: 'R1', name: 'Northern Star Railway', color: '#d9a441', ai: { personality: 'builder' }, seed: 1851 },
      { id: 'R2', name: 'Great Valley Lines', color: '#d0605a', ai: { personality: 'industrialist' }, seed: 1852 },
      { id: 'R3', name: 'Atlantic & Western', color: '#5cb96f', ai: { personality: 'financier' }, seed: 1853 },
    ];
    if (!DIFFICULTY[difficulty]) difficulty = 'normal';
    const D = DIFFICULTY[difficulty];
    for (const d of R.slice(0, n)) if (!this.coById[d.id]) {
      const i = R.indexOf(d), pers = opts.personalities?.[i] && PERSONALITIES[opts.personalities[i]] ? opts.personalities[i] : d.ai.personality;
      const c = this.addCompany({ ...d, seed: d.seed + (opts.seed || 0) * 7919, cash: Math.round(ECON.startCash * D.cash), ai: { ...d.ai, personality: pers, difficulty, start: this.year } });
      c.fin.playerShares = Math.round(c.fin.shares * MARKET.rivalFounder / FIN.lot) * FIN.lot; // the baron keeps 35%, the rest is public
    }
    this.emit('changed');
  }
  brain(c) {
    let b = this.brains.get(c.id);
    if (!b) { b = new CompanyAI(this, c); this.brains.set(c.id, b); }
    return b;
  }
  get player() { return this.companies[0]; }
  get rivals() { return this.companies.slice(1).filter(c => !c.gone); }
  get active() { return this.companies.filter(c => !c.gone); } // (merged companies stay in the list, marked gone)
  comp(id) { return this.coById[id] || this.player; }
  ownerOf(x) { return this.comp(x && x.owner); }
  mine(x, c = this.co) { return !!x && x.owner === c.id; }
  // run fn acting for company c (its cash, ledger and finance)
  as(c, fn) { const p = this.co; this.co = c; try { return fn(); } finally { this.co = p; } }
  get cash() { return this.co.cash; } set cash(v) { this.co.cash = v; }
  get loan() { return this.co.loan; } set loan(v) { this.co.loan = v; }
  get ledger() { return this.co.ledger; } set ledger(v) { this.co.ledger = v; }
  get history() { return this.co.history; } set history(v) { this.co.history = v; }
  get fin() { return this.co.fin; }
  newLedger(year) { return { year, revenue: 0, byCargo: {}, industryIncome: 0, trainUpkeep: 0, trackUpkeep: 0, interest: 0, industryUpkeep: 0, warehouseUpkeep: 0, shipUpkeep: 0, planeUpkeep: 0, salary: 0, construction: 0, vehicles: 0, industries: 0, dividends: 0, equity: 0 }; }

  // next medal to aim for (or the last one when all are won)
  get goal() {
    const t = this.medalTiers.find(m => !this.medals.some(x => x.name === m.name)) || this.medalTiers[this.medalTiers.length - 1];
    return { ...t, year: this.deadline };
  }
  get date() { const d = new Date(START); d.setDate(d.getDate() + Math.floor(this.day)); return d; }
  get year() { return this.date.getFullYear(); }
  dateStr() { return this.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  spend(amount, cat, c = this.co) { c.cash -= amount; c.ledger[cat] = (c.ledger[cat] || 0) + amount; }
  canAfford(a) { return this.cash - a >= -50000; }
  // what a track plan costs this company (truss bridges patent: bridges 30% cheaper)
  trackCost(plan, c = this.co) {
    const fees = this.crossingFees(plan, c).reduce((s, f) => s + f.amount, 0);
    if (!plan.bridgeLen || !this.auctions.has('truss', c)) return plan.cost + fees;
    return Math.round(plan.cost - plan.bridgeLen * ECON.bridgePerUnit * (plan.double ? 1.75 : 1) * 0.3) + fees;
  }
  // ---- trackage rights: a company may open its track to others, who pay per train-mile to run on it ----
  rightsOf(c) {
    if (c.rights) return c.rights;
    if (!c.ai) return 'closed';
    return this.competition === 'friendly' ? 'open' : (PERSONALITIES[c.ai.personality]?.rights || 'closed');
  }
  trackOpen(ownerId, c = this.co) {
    if (this.net.legacy || !ownerId || ownerId === c.id) return false;
    const o = this.comp(ownerId);
    return !!o && !o.gone && this.rightsOf(o) === 'open';
  }
  setRights(mode, c = this.co) {
    c.rights = mode === 'open' ? 'open' : 'closed';
    this.emit('news', `🛤 ${c === this.player ? 'Your' : `${c.name}'s`} track is now ${c.rights === 'open' ? `open to other companies (they pay ${money(ECON.trackageRate * this.infl())} per train-mile)` : 'closed to other companies'}`);
    this.emit('changed');
  }
  // which track company c's trains may use: its own, and open companies' lines (dearer, so own track is preferred);
  // never through another company's station. ownOnly: the rival AI doesn't use trackage rights
  trackRule(c, ownOnly = false) {
    return {
      use: (e) => e.owner === c.id || (!ownOnly && this.trackOpen(e.owner, c)),
      through: (n) => n.type !== 'station' || n.owner === c.id,
      cost: (e) => e.owner === c.id ? e.length : e.length * 1.5,
    };
  }
  // a train setting off pays the owners of the foreign track on its trip
  chargeTrackage(tr) {
    const c = this.comp(tr.owner), by = {};
    for (const l of tr.legs || []) if (l.edge.owner !== tr.owner) by[l.edge.owner] = (by[l.edge.owner] || 0) + l.edge.length;
    for (const [id, len] of Object.entries(by)) {
      const o = this.comp(id); if (!o) continue;
      const fee = Math.round(len / ECON.unitsPerMile * ECON.trackageRate * this.infl());
      this.spend(fee, 'trackageFees', c); o.cash += fee; o.ledger.trackageIncome = (o.ledger.trackageIncome || 0) + fee;
    }
  }
  // a level crossing over another company's line pays that company a fee
  crossingFees(plan, c = this.co) {
    const by = {};
    for (const x of plan.crossings || []) if (x.owner && x.owner !== c.id) by[x.owner] = (by[x.owner] || 0) + XING.fee;
    return Object.entries(by).map(([owner, amount]) => ({ owner, amount }));
  }

  trackValue(c = this.co) { return [...this.net.edges, ...this.roads.edges].reduce((s, e) => s + (e.owner === c.id ? e.cost : 0), 0); }
  trainValue(c = this.co) { return this.vehicles().reduce((s, t) => s + (t.owner === c.id ? t.value * Math.max(0.3, 1 - t.ageDays / 365 / 30) : 0), 0); }
  industryValue(c = this.co) { return this.world.industries.filter(i => i.owner === c.id).reduce((s, i) => s + this.industryPrice(i) * 0.8, 0); }
  warehouseValue(c = this.co) { return this.world.stations.reduce((s, st) => s + (st.owner === c.id ? ECON.warehouseCost.slice(0, (st.warehouse || 0) + 1).reduce((a, b) => a + b, 0) * 0.5 : 0), 0); }
  stationsOf(c = this.co) { return this.world.stations.filter(s => s.owner === c.id); }
  vehiclesOf(c = this.co) { return this.vehicles().filter(v => v.owner === c.id); }
  companyValue(c = this.co) { return c.cash - c.loan + this.trainValue(c) + this.trackValue(c) * 0.6 + this.stationsOf(c).length * ECON.stationCost * 0.6 + this.industryValue(c) + this.warehouseValue(c) + this.market.stakeValue(c.id); }

  // ---------------- economy ----------------
  infl() { return Math.pow(1 + ECON.inflation, this.day / 365); }
  value(c) { return CARGO[c].value * this.infl(); }
  wagonCost(type) { return Math.round(WAGONS[type].cost * this.infl() / 100) * 100; }
  locoCost(l) { return Math.round(l.cost * this.infl() / 100) * 100; }
  wagonsAvailable() { return Object.keys(WAGONS).filter(k => WAGONS[k].year <= this.year); }
  // ---- changing a train's wagons: done at its next stop, after unloading; wagons that go are sold at half price ----
  consistCost(tr, consist) {
    const have = {}, want = {};
    for (const t of this.baseOf(tr)) have[t] = (have[t] || 0) + 1; // (what it owns, whatever the yard swapped in)
    for (const t of consist) want[t] = (want[t] || 0) + 1;
    let buy = 0, sell = 0, bought = 0, sold = 0;
    for (const t of new Set([...Object.keys(have), ...Object.keys(want)])) {
      const d = (want[t] || 0) - (have[t] || 0);
      if (d > 0) { buy += d * this.wagonCost(t); bought += d; } else if (d < 0) { sell += -d * Math.round(this.wagonCost(t) * 0.5); sold -= d; }
    }
    return { buy, sell, net: buy - sell, bought, sold };
  }
  setConsist(tr, consist) {
    if (!this.mine(tr) || tr.type !== 'train') return 'Not your train';
    const max = Math.min(tr.loco.maxCars, MAX_WAGONS);
    if (!consist || !consist.length) return 'Keep at least one wagon';
    if (consist.length > max) return `${tr.loco.name} pulls at most ${max} wagons`;
    if (consist.some(t => !WAGONS[t] || WAGONS[t].air || WAGONS[t].road || WAGONS[t].year > this.year)) return 'Wagon not available yet';
    const base = this.baseOf(tr), same = consist.length === base.length && consist.every((t, i) => t === base[i]);
    if (same) { tr.newConsist = null; this.emit('changed'); return null; }
    const c = this.consistCost(tr, consist);
    if (c.net > 0 && !this.canAfford(c.net)) return 'Not enough money';
    tr.newConsist = [...consist];
    this.emit('changed');
    return null;
  }
  applyConsist(tr) {
    const consist = tr.newConsist; tr.newConsist = null;
    const c = this.consistCost(tr, consist);
    if (c.net > 0 && !this.canAfford(c.net)) { this.newsFor(this.ownerOf(tr), `${tr.name}: not enough money to change its wagons`); return; }
    // keep wagons (and their load) where the type stays; new ones arrive empty
    const pool = [...tr.wagons], lost = {};
    tr.wagons = consist.map(type => { const i = pool.findIndex(w => w.type === type); return i >= 0 ? pool.splice(i, 1)[0] : { type, cargo: null, units: 0, origin: null, day: 0 }; });
    for (const w of pool) if (w.cargo) lost[w.cargo] = (lost[w.cargo] || 0) + w.units;
    if (c.buy) this.spend(c.buy, 'vehicles', this.ownerOf(tr));
    this.ownerOf(tr).cash += c.sell;
    tr.value = Math.max(Math.round(tr.value * 0.2), tr.value + c.buy - c.sell * 2); // (the wagons sold took their purchase price with them)
    tr.len = LOCO_LEN + tr.wagons.length * WAGON_LEN;
    if (tr.base) tr.base = [...consist];
    this.view?.consistChanged?.(tr);
    const names =Object.entries(tr.wagons.reduce((o, w) => (o[w.type] = (o[w.type] || 0) + 1, o), {})).map(([t, n]) => `${n} ${WAGONS[t].name.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ');
    const gone = Object.entries(lost).map(([k, u]) => `${Math.round(u)} ${CARGO[k].unit} of ${CARGO[k].name.toLowerCase()}`).join(', ');
    this.newsFor(this.ownerOf(tr), `🔧 ${tr.name} now runs ${names}${c.net ? ` (${c.net > 0 ? 'cost' : 'refund'} ${money(Math.abs(c.net))})` : ''}${gone ? ` — ${gone} in the wagons that went was lost` : ''}`);
  }
  // ---- the yard: a train may leave each stop with its own set of wagons (a free swap, a little extra stop time) ----
  // A train owns its bought set (`base`: what Change wagons buys and sells); a stop's set uses at most that many
  // wagons. `plan[i]` is the set it leaves stop i with (null: as it arrived).
  baseOf(tr) { return tr.base || tr.wagons.map(w => w.type); }
  setStopConsist(tr, i, consist) {
    if (!this.mine(tr) || tr.type !== 'train') return 'Not your train';
    if (!(i >= 0 && i < tr.orders.length)) return 'No such stop';
    if (consist) {
      const n = this.baseOf(tr).length;
      if (!consist.length) return 'Keep at least one wagon';
      if (consist.length > n) return `${tr.name} owns ${n} wagon${n > 1 ? 's' : ''}: buy more with Change wagons`;
      if (consist.some(t => !WAGONS[t] || WAGONS[t].air || WAGONS[t].road || WAGONS[t].year > this.year)) return 'Wagon not available yet';
    }
    if (!tr.base) tr.base = this.baseOf(tr);
    tr.plan ||= tr.orders.map(() => null);
    tr.plan[i] = consist ? [...consist] : null;
    if (tr.plan.every(p => !p)) { tr.plan = null; if (tr.base.length === tr.wagons.length && tr.base.every((t, k) => t === tr.wagons[k].type)) tr.base = null; }
    this.emit('changed');
    return null;
  }
  // swap to this stop's set: wagons of a kind it keeps stay (with their load); a wagon that goes to the yard
  // leaves its load in the station's storage (paid to whoever carries it on) or, with no room, loses it
  yardSwap(tr, st, want) {
    want = want.slice(0, this.baseOf(tr).length);
    if (want.length === tr.wagons.length && want.every((t, k) => t === tr.wagons[k].type)) return 0;
    const pool = [...tr.wagons];
    let added = 0;
    tr.wagons = want.map(type => { const i = pool.findIndex(w => w.type === type); if (i >= 0) return pool.splice(i, 1)[0]; added++; return { type, cargo: null, units: 0, origin: null, day: 0 }; });
    const lost = {};
    for (const w of pool) {
      if (!w.cargo) continue;
      const u = Math.min(w.units, Math.max(0, this.storageCap(st, w.cargo) - this.stored(st, w.cargo)));
      if (u > 0) {
        st.transfer ||= [];
        const lot = st.transfer.find(l => l.c === w.cargo && l.origin === w.origin);
        if (lot) { lot.day = (lot.day * lot.units + w.day * u) / (lot.units + u); lot.units += u; } else st.transfer.push({ c: w.cargo, units: u, origin: w.origin, day: w.day });
        this.lineStop(tr, st).x += u;
      }
      if (w.units - u >= 0.5) lost[w.cargo] = (lost[w.cargo] || 0) + w.units - u;
    }
    tr.len = LOCO_LEN + tr.wagons.length * WAGON_LEN;
    this.view?.consistChanged?.(tr);
    const gone = Object.entries(lost).map(([k, u]) => `${Math.round(u)} ${CARGO[k].unit} of ${CARGO[k].name.toLowerCase()}`).join(', ');
    if (gone) this.newsFor(this.ownerOf(tr), `🔧 ${tr.name} left ${gone} at ${st.name}'s yard with no room to store it — lost`);
    return pool.length + added; // (wagons moved in the yard)
  }
  // a vehicle's line record: running cost this/last year, and per stop what it loaded, delivered, earned, stored
  lineOf(v) { return v.ln ||= { cy: 0, cl: 0, sy: {}, sl: {} }; }
  lineStop(v, st) { return this.lineOf(v).sy[st.id] ||= { u: {}, d: {}, e: 0, x: 0 }; }
  maxLoad(c) { return Math.max(...Object.values(CARGO[c].cap)); }
  storageCap(st, c) { return ECON.storage[st.warehouse || 0] * this.maxLoad(c); }
  stored(st, c) { return (st.waiting[c] || 0) + (st.transfer || []).reduce((s, l) => s + (l.c === c ? l.units : 0), 0); }
  isHub(st) { return (st.warehouse || 0) > 0; }
  trainTons(tr) { return 50 + 25 * tr.loco.power + tr.wagons.reduce((s, w) => s + WAGONS[w.type].tare + (w.cargo ? w.units * CARGO[w.cargo].wt : 0), 0); }
  // how much a consumer (town or industry) wants per month
  demandCap(cons, c) {
    if (cons.type === 'town') return (TOWN_DEMAND[c] ?? 0) * cons.pop / 1000;
    const d = cons.def, lv = LEVEL_MUL[cons.level];
    if (d.in && d.in[c] !== undefined) return d.in[c] * d.cap * lv * (d.army ? this.frontier.armyMul(cons) : 1);
    if (d.boost && d.boost[c] !== undefined) return this.maxLoad(c);
    return 0;
  }
  mkt(cons, c) { cons.market ||= {}; return cons.market[c] ||= { p: 1, recv: 0, hist: [] }; }
  // price index a consumer pays now: scarcity raises it over months, deliveries this month push it down
  priceAt(cons, c) {
    if (c === 'passengers' || c === 'mail') return 1;
    const m = this.mkt(cons, c), cap = Math.max(1e-6, this.demandCap(cons, c));
    const floor = ECON.priceFloor[cons.type === 'town' ? 'town' : 'industry'];
    return m.p * Math.max(Math.min(1, floor + 0.05), 1 - 0.5 * m.recv / cap) * (cons.def?.premium || 1) * this.frontier.armyPremium(cons); // (the army pays extra, more in wartime)
  }
  consumers(st, c) {
    const out = [];
    for (const i of st.cov.inds) if (!i.dormant && ((i.def.in && i.def.in[c] !== undefined) || (i.def.boost && i.def.boost[c] !== undefined))) out.push(i);
    if (TOWN_ACCEPTS.includes(c)) for (const t of st.cov.towns) out.push(t);
    return out;
  }
  bestConsumer(st, c) { let b = null, bp = -1; for (const x of this.consumers(st, c)) { const p = this.priceAt(x, c); if (p > bp) { bp = p; b = x; } } return b; }
  marketList(cons) {
    if (cons.type === 'town') return TOWN_ACCEPTS.filter(c => c !== 'passengers' && c !== 'mail' && (!CARGO[c].year || CARGO[c].year <= this.year));
    const list = [...Object.keys(cons.def.in || {}), ...Object.keys(cons.def.boost || {})];
    return cons.def.consumer ? list.filter(c => !CARGO[c].year || CARGO[c].year <= this.year) : list; // (customers don't price a cargo before it exists)
  }

  // ---- owned industries ----
  industryPrice(ind) {
    const d = ind.def;
    const perMonth = Object.entries(d.out).reduce((s, [c, q]) => s + q * (d.in ? d.cap : 1) * this.value(c), 0);
    return Math.round(perMonth * 12 * ECON.industryPriceYears * LEVEL_MUL[ind.level] / 1000) * 1000;
  }
  buyIndustry(ind) {
    if (ind.def.consumer) return 'Customers cannot be bought';
    if (ind.owner) return ind.owner === this.co.id ? 'You already own it' : `Owned by ${this.comp(ind.owner).name}`;
    if (ind.dormant) return 'Not founded yet';
    if (ind.auction) return 'It is up for auction — bid in Auctions (I)';
    const p = this.industryPrice(ind);
    if (!this.canAfford(p)) return `Not enough money (${money(p)})`;
    this.spend(p, 'industries'); ind.paid = p;
    ind.owner = this.co.id; ind.incomeYear = 0; ind.incomeMonth = 0; ind.incomeAcc = 0;
    this.emit('news', `🏭 You bought <b>${ind.name}</b> for ${money(p)}`);
    this.emit('changed');
    return null;
  }
  expandIndustry(ind) {
    if (ind.owner !== this.co.id) return 'You must own it first';
    if (ind.auction) return 'It is up for auction';
    if (ind.level >= 4) return 'Already at maximum size';
    const cost = Math.round(this.industryPrice(ind) * ECON.expandCost / 1000) * 1000;
    if (!this.canAfford(cost)) return `Not enough money (${money(cost)})`;
    this.spend(cost, 'industries'); ind.paid = (ind.paid ?? this.industryPrice(ind)) + cost;
    ind.level++;
    this.emit('news', `🏗 <b>${ind.name}</b> expanded to level ${ind.level}`);
    this.emit('changed');
    return null;
  }
  // selling puts it up for auction; it keeps earning for you until the sale closes,
  // and if nobody bids, the market buys it at the reserve (70% of its price)
  // the reserve (and the market's floor) when an industry is sold: 70% of its price, but never more
  // than the owner paid for it (no buying a new industry cheaply at auction and selling it to the market)
  saleReserve(ind) { return Math.min(this.industryPrice(ind) * AUCTION.sellReserve, ind.paid ?? Infinity); }
  sellIndustry(ind) {
    if (ind.owner !== this.co.id) return 'Not yours';
    if (ind.auction) return 'Already up for auction';
    this.auctions.start('industry', ind.id, this.saleReserve(ind), this.co.id);
    return null;
  }
  buildWarehouse(st) {
    if (!this.mine(st)) return 'Not your station';
    if (st.depot) return 'Road depots have no warehouse';
    const level = (st.warehouse || 0) + 1;
    if (level >= ECON.storage.length) return 'Warehouse is at maximum size';
    const cost = Math.round(ECON.warehouseCost[level] * this.infl() / 1000) * 1000;
    if (!this.canAfford(cost)) return `Not enough money (${money(cost)})`;
    this.spend(cost, 'construction');
    st.warehouse = level;
    this.world.setWarehouse(st, level);
    this.log({ t: 'warehouse', id: st.id });
    this.emit('news', `📦 ${level === 1 ? 'Warehouse built' : 'Warehouse upgraded'} at <b>${st.name}</b> (level ${level})`);
    this.emit('changed');
    return null;
  }
  activateIndustry(ind) {
    ind.dormant = false;
    this.world.activateIndustry(ind);
    if (!this.replaying && !this.muted && !ind.def.consumer) this.auctions.start('industry', ind.id, this.industryPrice(ind) * AUCTION.newReserve);
    const near = [...this.world.towns].sort((a, b) => Math.hypot(a.x - ind.x, a.z - ind.z) - Math.hypot(b.x - ind.x, b.z - ind.z))[0];
    this.emit('news', ind.def.consumer ? `🏛 New customer: <b>${ind.name}</b> near ${near.name} — buys ${Object.keys(ind.def.in).map(c => CARGO[c].name).join(', ')}`
      : `🏭 New industry: <b>${ind.name}</b> founded near ${near.name} — ${Object.keys(ind.def.out).map(c => CARGO[c].name).join(', ')} now available`);
  }

  // ---------------- construction ----------------
  stationName(x, z) {
    const near = [...this.world.towns].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    const ind = [...this.world.industries].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (near && Math.hypot(near.x - x, near.z - z) < 260) {
      // the first name not in use (the same as before unless a station was taken down)
      const taken = new Set(this.world.stations.map(s => s.name)), L = STATION_NAMES_SUFFIX.length;
      const n0 = this.world.stations.filter(s => s.name.startsWith(near.name)).length;
      for (let k = 0; k < L + 1; k++) { const n = (n0 + k) % (L + 1), nm = n ? `${near.name} ${STATION_NAMES_SUFFIX[n % L]}` : near.name; if (!taken.has(nm)) return nm; }
      return `${near.name} ${STATION_NAMES_SUFFIX[n0 % L]}`;
    }
    return `${ind.name.split(' ')[0]} ${STATION_NAMES_SUFFIX[this.world.stations.length % STATION_NAMES_SUFFIX.length]}`.replace(/^(\w)/, c => c.toUpperCase());
  }
  // cov: the catchment recorded in a save (towns grow, so recomputing it on replay could differ)
  buildStation(x, z, angle, cov = null) {
    const err = this.world.stationCheck(x, z) || (this.net.stationClear(x, z, angle) ? null : 'The station would sit on existing track');
    if (err) return err;
    if (!this.canAfford(ECON.stationCost)) return 'Not enough money';
    const st = this.world.addStation(x, z, angle, this.stationName(x, z));
    st.owner = this.co.id;
    if (cov) {
      const W = this.world;
      st.cov = { towns: cov.towns.map(id => W.towns.find(t => t.id === id)).filter(Boolean), inds: cov.inds.map(id => W.industries.find(i => i.id === id)).filter(Boolean) };
    } else st.cov.towns = st.cov.towns.filter(t => !this.rateWars.barred(t, this.co)); // a town lost in a rate war stays lost for a while
    this.net.stationTrack(st);
    this.spend(ECON.stationCost, 'construction');
    for (const i of st.cov.inds) (i.stations ||= []).push(st);
    for (const t of st.cov.towns) (t.stations ||= []).push(st);
    this.rateWars.onStation(st);
    this.demand.set(st, {});
    this.log({ t: 'station', x, z, angle, cov: { towns: st.cov.towns.map(t => t.id), inds: st.cov.inds.map(i => i.id) } });
    this.emit('news', `New station: <b>${st.name}</b>`);
    this.emit('changed');
    return st;
  }
  buildTrack(plan) {
    if (!plan || !plan.b) return 'Track must end at a station or on another track';
    if (plan.bad) return plan.bad;
    // your own stations and track, or a junction on a line its owner has opened (trackage rights)
    const lineOf = (n) => n.type === 'jc' ? (n.edge ? n.edge.owner : n.owner) : n.owner;
    const own = (n) => lineOf(n) === this.co.id || (n.type !== 'station' && (this.trackOpen(lineOf(n)) || (this.muted && !this.net.legacy)));
    if (!own(plan.a) || !own(plan.b)) return 'You can only connect your own stations and track (or a line opened to you)';
    if (plan.a.depot || plan.b.depot) return 'Road depots have no rail platforms';
    if (!this.canAfford(this.trackCost(plan))) return 'Not enough money';
    const A = plan.a.type === 'jc' ? this.net.split(plan.a) : plan.a;
    const B = plan.b.type === 'jc' ? this.net.split(plan.b) : plan.b;
    if (!A || !B) return 'Could not place the junction here';
    // points are rounded to 1 mm before building, so the save (which stores them rounded) rebuilds exactly this track
    const q = (v) => Math.round(v * 1000) / 1000;
    for (const p of plan.pts) p.set(q(p.x), q(p.y), q(p.z));
    const ref = (n, raw) => n.type === 'station' ? { s: n.id } : { p: [raw.p.x, raw.p.y, raw.p.z].map(q), ...(lineOf(n) !== this.co.id ? { o: lineOf(n) } : {}) };
    const entry = { t: 'track', a: ref(plan.a, plan.a), b: ref(plan.b, plan.b), pts: plan.pts.map(p => [p.x, p.y, p.z]), bridge: plan.bridge, cost: plan.cost, maxGrade: plan.maxGrade, sideA: plan.sideA, sideB: plan.sideB, double: !!plan.double };
    // a land grant for track in a territory (a replay uses the recorded one: the frontier may have moved on since)
    const grant = plan.grant ?? this.frontier.grantFor(plan, this.trackCost(plan));
    if (grant) entry.grant = grant;
    const e = this.net.build(plan, A, B, this.co.id);
    for (const x of e.xings) x.x.built ??= this.day;
    this.log(entry);
    if (grant) { this.cash += grant; this.ledger.landGrants = (this.ledger.landGrants || 0) + grant; }
    const fees = this.crossingFees(plan);
    this.spend(this.trackCost(plan) - fees.reduce((s, f) => s + f.amount, 0), 'construction');
    // (the crossing fees below are construction too; the other company books them as income)
    for (const f of fees) { this.spend(f.amount, 'construction'); const o = this.comp(f.owner); o.cash += f.amount; o.ledger.trackageIncome = (o.ledger.trackageIncome || 0) + f.amount; }
    // trains already running on the lines it crosses now have to take the crossing into account
    for (const o of this.net.edges) if (o !== e && o.xings?.some(y => e.xings.some(z => z.x === y.x))) this.refreshEdge(o);
    const nm = (n) => n.type === 'junction' ? 'junction' : n.name;
    const nx = e.xings.length;
    this.emit('news', `${plan.double ? 'Double' : 'Single'} track: ${nm(A)} ↔ ${nm(B)} (${(e.length / ECON.unitsPerMile).toFixed(1)} mi, ${money(this.trackCost(plan))}${nx ? `, ${nx} level crossing${nx > 1 ? 's' : ''}` : ''}${grant ? `, land grant ${money(grant)}` : ''})`);
    this.emit('changed');
    return e;
  }
  // take down one of your stations, with your track that ends there (a quarter of the cost back). Refused while a
  // vehicle calls there or still carries cargo loaded there, or while another company's track joins it.
  removeStation(st) {
    if (!this.mine(st)) return 'Not your station';
    if (st.depot) return 'Road depots can’t be removed';
    const calls = this.vehicles().filter(v => v.orders.includes(st));
    if (calls.length) return `${calls.length} vehicle${calls.length > 1 ? 's' : ''} still call${calls.length > 1 ? '' : 's'} here (${calls.slice(0, 3).map(v => v.name).join(', ')}) — change their orders or sell them first`;
    if (this.vehicles().some(v => v.wagons.some(w => w.origin === st && w.units > 0)) || this.world.stations.some(s => (s.transfer || []).some(l => l.origin === st)))
      return 'Cargo loaded here is still on its way — try again when it has been delivered';
    if (st.edges.some(e => !this.mine(e))) return 'Another company’s track joins this station';
    if (st.redges?.length) return 'A road joins this station — remove the road first'; // (roads are public)
    if (this.trains.some(t => t.legs && t.legs.some(l => st.edges.includes(l.edge)))) return 'A train is using its track';
    for (const e of st.edges.slice()) { const err = this.removeTrack(e); if (err) return err; }
    this.log({ t: 'removeStation', id: st.id });
    this.world.removeStation(st); this.net.stationRemoved(st);
    this.demand.delete(st);
    const back = Math.round(ECON.stationCost * 0.25 * this.infl());
    this.cash += back;
    this.emit('news', `Station ${st.name} taken down (${money(back)} salvage)`);
    this.emit('changed');
    return null;
  }
  // a second track alongside a single-track line: 75% of what it cost (a double line costs 1.75×)
  doubleCost(edge) { return Math.round(edge.cost * 0.75 / 100) * 100; } // (of what the line cost, switches and crossings included)
  doubleTrack(edge) {
    if (!this.mine(edge)) return 'Not your track';
    const err = this.net.canDouble(edge); if (err) return err;
    const cost = this.doubleCost(edge);
    if (!this.canAfford(cost)) return 'Not enough money';
    this.log({ t: 'double', id: edge.id });
    this.net.makeDouble(edge);
    edge.cost += cost;
    this.spend(cost, 'construction');
    this.refreshEdge(edge); // (trains on it reserve it the double-track way from now on)
    this.emit('news', `Double track: ${edge.a.name || 'junction'} ↔ ${edge.b.name || 'junction'} (${money(cost)})`);
    this.emit('changed');
    return null;
  }
  removeTrack(edge) {
    if (!this.mine(edge)) return 'Not your track';
    if (this.trains.some(t => t.legs && t.legs.some(l => l.edge === edge))) return 'A train is using this track';
    this.clearBlocks(edge);
    this.log({ t: 'removeTrack', id: edge.id });
    for (const o of this.net.remove(edge)) this.refreshEdge(o); // lines that lost a crossing
    this.cash += Math.round(edge.cost * 0.25);
    this.emit('news', `Track removed (${money(edge.cost * 0.25)} salvage)`);
    this.emit('changed');
    return null;
  }
  addSignal(edge, d) {
    if (!this.mine(edge)) return 'Not your track';
    const err = this.net.signalSpotOk(edge, d);
    if (err) return err;
    if (!this.canAfford(SIGNAL_COST)) return 'Not enough money';
    this.net.addSignal(edge, d);
    this.log({ t: 'signal', id: edge.id, d });
    this.spend(SIGNAL_COST, 'construction');
    this.refreshEdge(edge);
    return null;
  }
  removeSignal(edge, d) {
    if (!this.mine(edge)) return 'Not your track';
    this.net.removeSignal(edge, d);
    this.log({ t: 'removeSignal', id: edge.id, d });
    this.cash += SIGNAL_COST * 0.25;
    this.refreshEdge(edge);
  }
  clearBlocks(edge) { for (const k of [...this.blocks.keys()]) if (k.startsWith(edge.id + '#')) this.blocks.delete(k); }
  refreshEdge(edge) {
    this.clearBlocks(edge);
    for (const tr of this.trains) if (tr.legs && tr.legs.some(l => l.edge === edge)) this.rebuildUnits(tr);
    this.emit('changed');
  }
  remapSplit(E, E1, E2) {
    this.clearBlocks(E);
    E1.owner = E2.owner = E.owner;
    for (const tr of this.trains) {
      if (!tr.legs || !tr.legs.some(l => l.edge === E)) continue;
      tr.legs = tr.legs.flatMap(l => l.edge !== E ? [l] : (l.forward ? [{ edge: E1, forward: true }, { edge: E2, forward: true }] : [{ edge: E2, forward: false }, { edge: E1, forward: false }]));
      this.rebuildUnits(tr);
    }
  }
  // loans are bonds now (see finance.js); these stay for the balance bot and old callers
  borrow() { return this.fin.issueBond(); }
  repay() { return this.fin.repayBond(); }

  // ---------------- trains ----------------
  availableLocos() { return LOCOS.filter(l => l.year <= this.year); }
  buyTrain(locoId, consist, orders) {
    const loco = LOCOS.find(l => l.id === locoId);
    if (!loco || loco.year > this.year) return 'Locomotive not available';
    if (!consist.length) return 'Add at least one wagon';
    if (consist.length > Math.min(loco.maxCars, MAX_WAGONS)) return `This locomotive pulls at most ${Math.min(loco.maxCars, MAX_WAGONS)} wagons`;
    if (consist.some(t => !WAGONS[t] || WAGONS[t].year > this.year)) return 'Wagon type not available yet';
    if (orders.some(o => o.owner !== this.co.id)) return 'Trains can only stop at your own stations';
    if (orders.some(o => o.depot)) return 'Trains cannot stop at road depots';
    for (let i = 0; i < orders.length; i++) {
      const a = orders[i], b = orders[(i + 1) % orders.length];
      if (a === b) return 'Consecutive stops must differ';
      if (!this.net.route(a, b, this.net.legacy ? null : this.trackRule(this.co, !!this.co.ai))) return `No track between ${a.name} and ${b.name}`;
    }
    const cost = this.locoCost(loco) + consist.reduce((s, t) => s + this.wagonCost(t), 0);
    if (!this.canAfford(cost)) return 'Not enough money';
    this.spend(cost, 'vehicles');
    const tr = this.makeTrain(loco, consist, orders, cost);
    tr.at = orders[0];
    tr.curPlat = this.freePlat(orders[0], tr, true);
    orders[0].plats[tr.curPlat].add(tr);
    this.startLeg(tr);
    this.handleStop(tr);
    this.emit('news', `New train <b>${tr.name}</b> enters service`);
    this.emit('changed');
    return tr;
  }
  makeTrain(loco, consist, orders, cost) {
    const tr = {
      id: 'TR' + this.trainSeq, type: 'train', owner: this.co.id, name: `${loco.name.split(' ')[0]} #${this.trainSeq++}`, loco, value: cost,
      wagons: consist.map(type => ({ type, cargo: null, units: 0, origin: null, day: 0 })),
      orders: [...orders], idx: 0, state: 'loading', dwell: 1, speed: 0, s: 0, ageDays: 0, wait: 0,
      revenueYear: 0, revenueLast: 0, lifetime: 0, trips: 0, arrDir: null,
    };
    tr.len = LOCO_LEN + consist.length * WAGON_LEN;
    this.trains.push(tr);
    return tr;
  }
  sellTrain(tr) {
    if (!this.mine(tr)) return 'Not yours';
    for (const u of tr.units || []) if (u.held && !u.released) this.releaseUnit(tr, u);
    this.freeCrossings(tr, true);
    for (const st of this.world.stations) if (st.plats) st.plats.forEach(p => p.delete(tr));
    this.trains = this.trains.filter(t => t !== tr);
    const v = Math.round(tr.value * 0.5 * Math.max(0.3, 1 - tr.ageDays / 365 / 30));
    this.ownerOf(tr).cash += v;
    this.emit('news', `${tr.name} sold for ${money(v)}`);
    this.emit('changed');
  }
  dirAt(st, a, b) { // station axis signed to match direction a->b
    const s = Math.sign((b.x - a.x) * st.axis.x + (b.z - a.z) * st.axis.z) || 1;
    return st.axis.clone().multiplyScalar(s);
  }

  // ---- platforms, blocks, reservations ----
  // A train reserves the track ahead in chunks that end at a safe waiting point:
  // a station platform (2 per station) or a signal on double track. Single track
  // is therefore claimed station-to-station, so opposing trains can never meet head-on.
  freePlat(st, tr, force) {
    st.plats ||= PLAT_OFFS.map(() => new Set());
    for (let i = 0; i < st.plats.length; i++) { const p = st.plats[i]; if (p.size === 0 || (p.size === 1 && p.has(tr))) return i; }
    if (force) { let b = 0; st.plats.forEach((p, i) => { if (p.size < st.plats[b].size) b = i; }); return b; }
    return -1;
  }
  platVec(st) { return new Vec3(-st.axis.z, 0, st.axis.x); }
  acquireUnit(tr, u) {
    u.held = true; u.released = false;
    if (u.kind === 'block') { let o = this.blocks.get(u.id); if (!o) this.blocks.set(u.id, o = new Set()); o.add(tr); }
    else if (u.kind === 'junction') u.node.lock = tr;
    else if (u.kind === 'throat') this.throats.set(u.key, tr);
    else { u.node.plats ||= PLAT_OFFS.map(() => new Set()); u.node.plats[u.plat].add(tr); }
  }
  releaseUnit(tr, u) {
    u.released = true;
    // the same block/junction/platform may appear twice in one trip: keep it while a later use is pending
    const same = (v) => v !== u && v.held && !v.released && v.kind === u.kind && (u.kind === 'block' ? v.id === u.id : u.kind === 'throat' ? v.key === u.key : v.node === u.node);
    if (tr.units && tr.units.includes(u) && tr.units.some(same)) return;
    if (u.kind === 'block') { const o = this.blocks.get(u.id); if (o) { o.delete(tr); if (!o.size) this.blocks.delete(u.id); } }
    else if (u.kind === 'junction') { if (u.node.lock === tr) u.node.lock = null; }
    else if (u.kind === 'throat') { if (this.throats.get(u.key) === tr) this.throats.delete(u.key); }
    else if (u.node.plats && u.plat != null) u.node.plats[u.plat].delete(tr);
  }
  buildUnits(tr) {
    const net = this.net, from = tr.from;
    const units = [{ kind: 'station', node: from, s: BACK, s0: BACK - HALF, s1: BACK + HALF, rel: BACK + HALF + 2, vec: this.platVec(from) }];
    units.push(this.throatUnit(tr, from, BACK, true));
    tr.legRanges = [];
    const xunits = []; // level crossings on the way (locked separately: see crossLimit)
    let s = BACK;
    tr.legs.forEach((lg, k) => {
      const e = lg.edge, f = lg.forward, s0 = s;
      const bounds = [0, ...e.signals, e.length], nb = bounds.length - 1;
      const order = [...Array(nb).keys()]; if (!f) order.reverse();
      for (const x of e.xings || []) { const xs = f ? s0 + x.d : s0 + (e.length - x.d); xunits.push({ node: x.x, s: xs, s0: xs - XING.zone, s1: xs + XING.zone, rel: xs + XING.zone + 2 }); }
      for (const b of order) {
        const d0 = bounds[b], d1 = bounds[b + 1];
        const a = f ? s0 + d0 : s0 + (e.length - d1), z = f ? s0 + d1 : s0 + (e.length - d0);
        units.push({ kind: 'block', id: net.blockId(e, b, f ? 1 : -1), s0: a, s1: z, rel: z + 2, safe: e.double });
      }
      tr.legRanges.push({ edge: e, f, s0, s1: s0 + e.length });
      s += e.length;
      const node = f ? e.b : e.a;
      if (node.type === 'junction') units.push({ kind: 'junction', node, s, s0: s - JZONE, s1: s + JZONE, rel: s + JZONE + 2 });
      else {
        const final = k === tr.legs.length - 1;
        units.push(this.throatUnit(tr, node, s, false));
        units.push({ kind: 'station', node, s, s0: s - HALF, s1: s + HALF, rel: final ? Infinity : s + HALF + 2, final, vec: this.platVec(node) });
        if (!final) units.push(this.throatUnit(tr, node, s, true));
      }
    });
    for (let i = 0; i < units.length - 2; i++) if (units[i].kind === 'block' && units[i + 1].kind === 'throat' && units[i + 2].kind === 'station') units[i].rel = units[i + 2].s - HALF - 2;
    tr.units = units;
    tr.xunits = xunits.sort((a, b) => a.s - b.s);
  }
  rebuildUnits(tr) {
    const old = tr.units || [];
    for (const u of old) if (u.held && !u.released) this.releaseUnit(tr, u);
    this.buildUnits(tr);
    // take any crossing it is standing on (a crossing just built under it)
    for (const x of tr.xunits) if (x.s0 <= tr.s && tr.s - tr.len <= x.s1 && (!x.node.lock || x.node.lock === tr)) this.lockCrossing(tr, x.node);
    const U = tr.units; tr.next = 0;
    for (let i = 0; i < U.length; i++) {
      const u = U[i];
      if (i > 0 && u.s0 > tr.limit + 0.01) break;
      if (u.kind === 'station') {
        const o = old.find(x => x.kind === 'station' && x.node === u.node && Math.abs(x.s - u.s) < 1);
        u.plat = o && o.plat != null ? o.plat : this.freePlat(u.node, tr, true);
      }
      // already behind the tail: count it as used, never re-claim it (that would clear another train's claim)
      if (i > 0 && tr.s - tr.len > u.rel) { u.held = true; u.released = true; } else this.acquireUnit(tr, u);
      tr.next = i + 1;
    }
    if (tr.next > 1) tr.limit = Math.max(tr.s, this.limitFor(tr, U[tr.next - 1]));
    this.releasePassed(tr);
  }
  tryReserve(tr) {
    const U = tr.units; if (tr.next >= U.length) return true;
    const chunk = [];
    for (let i = tr.next; i < U.length; i++) { chunk.push(U[i]); if (U[i].kind === 'station' || (U[i].kind === 'block' && U[i].safe)) break; }
    const force = tr.wait > 240, platForce = tr.wait > 90;
    if (!force) for (const u of chunk) {
      if (u.kind === 'block') { const o = this.blocks.get(u.id); if (o && [...o].some(x => x !== tr)) return false; }
      else if (u.kind === 'junction') { if (u.node.lock && u.node.lock !== tr) return false; }
      else if (u.kind === 'throat') { const o = this.throats.get(u.key); if (o && o !== tr) return false; }
    }
    const last = chunk[chunk.length - 1];
    if (last.kind === 'station') {
      let p = this.freePlat(last.node, tr, false);
      if (p < 0 && (platForce || force)) { p = this.freePlat(last.node, tr, true); this.emit('news', `🚦 <b>${last.node.name}</b> is congested — ${tr.name} squeezes in. Build more stations or passing points.`); }
      if (p < 0) return false; last.plat = p;
    }
    for (const u of chunk) this.acquireUnit(tr, u);
    tr.next += chunk.length;
    tr.limit = this.limitFor(tr, last);
    if (force) this.emit('news', `⚠ ${tr.name} was blocked for 240 days — the dispatcher waved it through`);
    return true;
  }
  limitFor(tr, u) {
    if (u.kind === 'station') return u.final ? tr.sStop : u.s + HALF - 2;
    if (u.kind === 'block') {
      // never wait inside a switch area: stop short of junctions and station throats
      const nx = tr.units[tr.units.indexOf(u) + 1];
      if (nx && nx.kind === 'junction') return u.s1 - JZONE - 5;
      if (nx && nx.kind === 'throat') return nx.s0 - 6;
      return u.s1 - 4;
    }
    return u.s1;
  }
  // the switch area at one end of a station; out = leaving the station, else arriving
  throatUnit(tr, st, s, out) {
    const a = new Vec3(), b = new Vec3();
    this.pointAt(tr, s - 4, a); this.pointAt(tr, s + 4, b);
    const dir = Math.sign((b.x - a.x) * st.axis.x + (b.z - a.z) * st.axis.z) || 1;
    const Z = SWITCH_LEN * 1.6 + 10;
    return out
      ? { kind: 'throat', key: st.id + ':' + dir, s0: s + HALF - 2, s1: s + HALF + Z, rel: s + HALF + Z + 2 }
      : { kind: 'throat', key: st.id + ':' + (-dir), s0: s - HALF - Z, s1: s - HALF, rel: s - HALF - 3 };
  }
  releasePassed(tr) {
    const tail = tr.s - tr.len;
    for (let i = 0; i < tr.next; i++) { const u = tr.units[i]; if (u.held && !u.released && tail > u.rel) this.releaseUnit(tr, u); }
  }
  // Level crossings: a train takes a crossing as it approaches, together with any just after it that it could not
  // stop between, and only once the track it needs to clear them is reserved. So whoever holds a crossing can always
  // clear it (no deadlock), and holds it only briefly; otherwise the train waits at the crossing's signal.
  // A crossing stays locked while any part of the train is on it (also while it stands at a station), see freeCrossings.
  // Returns how far the train may run.
  crossLimit(tr, brake) {
    const X = tr.xunits, tail = tr.s - tr.len, seen = new Set();
    for (const x of X) {
      if (x.held) { seen.add(x.node); continue; }
      if (x.s1 < tail) { x.held = true; seen.add(x.node); continue; } // passed
      // the lock it holds covers the first pass over a crossing still ahead, not a later pass over the same one
      if (!seen.has(x.node) && (tr.xlocks || []).includes(x.node)) x.held = true;
      seen.add(x.node);
    }
    const k = X.findIndex(x => !x.held);
    if (k < 0) return tr.limit;
    const x = X[k];
    if (x.s0 - 5 > tr.s + brake + 80 || x.s0 - 5 > tr.limit) return tr.limit; // not near yet, or beyond what it may run to
    // the crossings it must clear in one go: those too close together for the train to stop between them
    const group = [x];
    for (let i = k + 1; i < X.length; i++) { if (X[i].s0 - 5 < group[group.length - 1].rel + tr.len + 2) group.push(X[i]); else break; }
    const need = group[group.length - 1].rel + tr.len + 2; // where its tail has cleared them
    if (need > tr.limit && tr.next < tr.units.length) this.tryReserve(tr);
    const fits = need <= tr.limit || tr.next >= tr.units.length;
    const free = group.every(y => !y.node.lock || y.node.lock === tr);
    // (after 240 days the dispatcher waves it through a crossing held by a train that is not on it yet, with room to clear)
    const wave = !free && tr.wait > 240 && group.every(y => !y.node.lock || y.node.lock === tr || !this.onCrossing(y.node.lock, y.node));
    if (fits && (free || wave)) {
      for (const y of group) {
        const o = y.node.lock;
        if (o && o !== tr) { o.xlocks = o.xlocks.filter(D => D !== y.node); for (const z of o.xunits || []) if (z.node === y.node) z.held = false; } // it asks again
        this.lockCrossing(tr, y.node); y.held = true;
      }
      tr.wait = 0; return tr.limit;
    }
    return Math.max(tr.s, x.s0 - 5); // wait at the crossing's signal
  }
  lockCrossing(tr, D) { D.lock = tr; tr.xlocks ||= []; if (!tr.xlocks.includes(D)) tr.xlocks.push(D); }
  // is any part of the train within r of crossing D?
  onCrossing(tr, D, r = XING.zone) {
    if (!tr.path) return false;
    const p = _ta;
    for (let k = 0; k <= tr.len + 0.01; k += 3) { this.pointAt(tr, tr.s - Math.min(k, tr.len), p); if ((p.x - D.x) ** 2 + (p.z - D.z) ** 2 < r * r) return true; }
    return false;
  }
  // let go of the crossings no part of the train is on any more
  freeCrossings(tr, all = false) {
    if (!tr.xlocks?.length) return;
    const tail = tr.s - tr.len;
    tr.xlocks = tr.xlocks.filter(D => {
      const first = (tr.xunits || []).find(x => x.node === D && tail <= x.rel); // its next (or current) pass over D
      if (!all && first && first.s0 - 5 <= tr.limit) return true; // still ahead of or under it on this trip
      if (!all && this.onCrossing(tr, D)) return true;
      if (D.lock === tr) D.lock = null;
      return false;
    });
  }

  startLeg(tr) {
    const from = tr.at || tr.orders[tr.idx];
    let to = tr.orders[(tr.idx + 1) % tr.orders.length];
    const co = this.comp(tr.owner);
    let legs = this.net.route(from, to, this.net.legacy ? null : this.trackRule(co, !!co.ai)); // (rival AIs don't take trackage rights)
    if (!legs) { tr.state = 'stuck'; return false; }
    // a reversal inside the route becomes a short operational stop at that station
    tr.via = false;
    for (let k = 0; k < legs.length - 1; k++) {
      const a = legs[k], b = legs[k + 1], node = a.forward ? a.edge.b : a.edge.a;
      if (node.type !== 'station') continue;
      const arr = a.forward ? a.edge.sideB : a.edge.sideA, ex = b.forward ? b.edge.sideA : b.edge.sideB;
      if (arr === ex) { legs = legs.slice(0, k + 1); to = node; tr.via = true; break; }
    }
    return this.setupLeg(tr, from, to, legs, tr.via);
  }
  setupLeg(tr, from, to, legs, via) {
    tr.via = via;
    if (tr.units) for (const u of tr.units) if (u.held && !u.released && !(u.kind === 'station' && u.node === from)) this.releaseUnit(tr, u);
    tr.legs = legs; tr.from = from; tr.to = to;
    const core = this.net.routePath(legs);
    const n = core.length;
    const d0 = this.dirAt(from, core[0], core[Math.min(4, n - 1)]);
    const d1 = this.dirAt(to, core[Math.max(0, n - 5)], core[n - 1]);
    const pts = [];
    for (let k = BACK; k > 0; k -= 3) pts.push(new Vec3(from.x, from.y, from.z).addScaledVector(d0, -k));
    pts.push(...core);
    for (let k = 3; k <= HALF + 12; k += 3) pts.push(new Vec3(to.x, to.y, to.z).addScaledVector(d1, k));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    tr.path = pts; tr.cum = cum; tr.dEnd = d1;
    const same = !tr.arrDir || tr.arrDir.dot(d0) > 0;
    tr.s = BACK + (same ? HALF - 1 : tr.len - (HALF - 1));
    tr.sStop = BACK + legs.reduce((a, l) => a + l.edge.length, 0) + HALF - 1;
    this.buildUnits(tr);
    const u0 = tr.units[0]; u0.held = true; u0.released = false; u0.plat = tr.curPlat ?? 0;
    tr.next = 1; tr.limit = tr.s; tr.wait = 0;
    return true;
  }
  pointAt(tr, s, out) {
    const cum = tr.cum, p = tr.path;
    s = clamp(s, 0, cum[cum.length - 1]);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
    return out.lerpVectors(p[lo], p[hi], t);
  }
  // lateral displacement: second platform track, and the right-hand line of double track
  offsetAt(tr, s, out) {
    out.set(0, 0, 0);
    for (const u of tr.units) if (u.kind === 'station' && u.plat) {
      const d = Math.abs(s - u.s), sw = SWITCH_LEN * (u.plat === 2 ? 1.6 : 1);
      const w = d <= HALF ? 1 : smoothstep(HALF + sw, HALF, d);
      if (w > 0) out.addScaledVector(u.vec, w * PLAT_OFFS[u.plat]);
    }
    for (const r of tr.legRanges) if (r.edge.double && s > r.s0 && s < r.s1) {
      const w = this.net.doubleW(r.edge, r.f ? s - r.s0 : r.s1 - s);
      if (w <= 0) continue;
      this.pointAt(tr, s + 1.5, _ta); this.pointAt(tr, s - 1.5, _tb);
      _ta.sub(_tb).setY(0).normalize();
      out.x += -_ta.z * DOUBLE_OFF * w; out.z += _ta.x * DOUBLE_OFF * w;
    }
    return out;
  }
  // a point on a ship's or plane's path (s = distance along it)
  pathAt(p, s, out) {
    s = clamp(s, 0, p.length);
    let lo = 0, hi = p.cum.length - 1;
    while (hi - lo > 1) { const k = (lo + hi) >> 1; if (p.cum[k] <= s) lo = k; else hi = k; }
    return out.lerpVectors(p.pts[lo], p.pts[hi], (s - p.cum[lo]) / Math.max(1e-6, p.cum[hi] - p.cum[lo]));
  }
  // where a vehicle is (for labels): the locomotive's centre, or a ship's or plane's point on its path
  vehiclePos(v) {
    const out = new Vec3(), st = v.at || v.orders[v.idx];
    if (v.type === 'train') { if (!v.path) return out.set(st.x, st.y, st.z); const s = v.s - LOCO_LEN / 2; this.pointAt(v, s, out).add(this.offsetAt(v, s, new Vec3())); out.y += 0.6; return out; }
    if (!v.path) return out.set(st.x, st.y, st.z);
    return this.pathAt(v.path, v.s, out);
  }
  gradeAt(tr, s) {
    const a = new Vec3(), b = new Vec3();
    this.pointAt(tr, s - 6, a); this.pointAt(tr, s + 6, b);
    return (b.y - a.y) / 12;
  }

  // ---------------- save / load ----------------
  // The map is generated from seeds (saved with the game), so a save stores the construction history
  // (replayed on a fresh map — this reproduces terraforming, trees and town clearing exactly)
  // plus all live state: finances, economy, and every train's position and reservations.
  log(action) { if (!this.replaying) this.actions.push(this.co === this.player ? action : { ...action, o: this.co.id }); }
  serialize(view) {
    const W = this.world, r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      ...(RULES.name !== 'classic' ? { rules: RULES.name } : {}), // (saves without it are classic)
      v: this.net.legacy ? 3 : (this.roads.edges.length || this.truckSeq > 1 || this.world.stations.some(s => s.depot) ? SAVE_VERSION : 4), seeds: { terrain: this.world.terrain.seed, world: this.world.seed, map: this.world.terrain.map, gen: MAP_GEN, ...(this.world.terrain.kind === 'continent' ? { kind: 'continent' } : {}) }, savedAt: Date.now(), view,
      meta: { map: this.world.terrain.map, date: this.dateStr(), value: Math.round(this.companyValue(this.player)), cash: Math.round(this.player.cash), trains: this.vehiclesOf(this.player).filter(v => v.type !== 'truck').length, stations: this.stationsOf(this.player).length },
      day: this.day, lastMonth: this.lastMonth, lastYear: this.lastYear, medals: this.medals, trainSeq: this.trainSeq, shipSeq: this.shipSeq, planeSeq: this.planeSeq,
      quarter: this.quarter,
      companies: this.companies.map(c => ({ id: c.id, name: c.name, color: c.color, ai: c.ai && { ...c.ai, mem: this.brains.has(c.id) ? this.brains.get(c.id).serialize() : c.ai.mem }, cash: c.cash, loan: c.loan, ledger: c.ledger, history: c.history, fin: c.fin.serialize(), gone: c.gone || null, ...(c.rights ? { rights: c.rights } : {}) })),
      competition: this.competition, ousted: this.ousted, auctions: this.auctions.serialize(), rateWars: this.rateWars.serialize(), ...(this.frontier.active ? { frontier: this.frontier.serialize() } : {}), ...(this.frontier.eras ? { eras: true } : {}), ...(this.race.active ? { race: this.race.serialize() } : {}),
      announced: [...this.announcedLocos], announcedWagons: [...this.announcedWagons], actions: this.actions,
      industries: W.industries.map(i => ({ stock: i.stock, level: i.level, producedLastMonth: i.producedLastMonth, transportedLastMonth: i.transportedLastMonth, boostStock: i.boostStock, active: i.active, history: i.history, firstDelivery: !!i.firstDelivery, boosted: !!i.boosted,
        dormant: !!i.dormant, owner: i.owner || null, incomeAcc: i.incomeAcc || 0, market: i.market || {}, incomeMonth: i.incomeMonth || 0, incomeYear: i.incomeYear || 0, incomeLast: i.incomeLast || 0, paid: i.paid ?? null })),
      towns: W.towns.map(t => ({ pop: t.pop, growth: t.growth, market: t.market || {} })),
      stations: W.stations.map(s => ({ id: s.id, waiting: s.waiting, svc: s.svc || {}, offered: s.offered || {}, taken: s.taken || {}, transfer: (s.transfer || []).map(l => ({ c: l.c, units: l.units, origin: l.origin.id, day: l.day })) })),
      ships: this.ships.map(t => ({
        id: t.id, owner: t.owner, name: t.name, kind: t.kind, value: t.value, orders: t.orders.map(s => s.id), idx: t.idx, at: t.at ? t.at.id : null, to: t.to ? t.to.id : null,
        state: t.state, dwell: t.dwell, speed: t.speed, s: t.s, dockDays: t.dockDays, ageDays: t.ageDays, revenueYear: t.revenueYear, revenueLast: t.revenueLast, lifetime: t.lifetime, trips: t.trips, handedOver: t.handedOver || 0, ...(t.ln ? { ln: t.ln } : {}),
        holds: t.wagons.map(w => ({ type: w.type, cargo: w.cargo, units: w.units, origin: w.origin ? w.origin.id : null, day: w.day })),
      })),
      ...(this.trucks.length ? { trucks: this.trucks.map(t => ({
        id: t.id, owner: t.owner, name: t.name, kind: t.kind, value: t.value, orders: t.orders.map(s => s.id), idx: t.idx, at: t.at ? t.at.id : null, to: t.to ? t.to.id : null,
        state: t.state, dwell: t.dwell, speed: t.speed, s: t.s, ageDays: t.ageDays, revenueYear: t.revenueYear, revenueLast: t.revenueLast, lifetime: t.lifetime, trips: t.trips, handedOver: t.handedOver || 0, ...(t.ln ? { ln: t.ln } : {}),
        legs: t.path ? t.path.legs.map(l => [l.edge.id, l.forward]) : null,
        holds: t.wagons.map(w => ({ type: w.type, cargo: w.cargo, units: w.units, origin: w.origin ? w.origin.id : null, day: w.day })),
      })) } : {}),
      ...(this.truckSeq > 1 ? { truckSeq: this.truckSeq } : {}),
      planes: this.planes.map(t => ({
        id: t.id, owner: t.owner, name: t.name, kind: t.kind, value: t.value, orders: t.orders.map(s => s.id), idx: t.idx, at: t.at ? t.at.id : null, to: t.to ? t.to.id : null,
        state: t.state, dwell: t.dwell, speed: t.speed, s: t.s, park: t.park, pathPark: t.pathPark || null, ageDays: t.ageDays, revenueYear: t.revenueYear, revenueLast: t.revenueLast, lifetime: t.lifetime, trips: t.trips, handedOver: t.handedOver || 0, ...(t.ln ? { ln: t.ln } : {}),
        holds: t.wagons.map(w => ({ type: w.type, cargo: w.cargo, units: w.units, origin: w.origin ? w.origin.id : null, day: w.day })),
      })),
      trains: this.trains.map(t => ({
        id: t.id, owner: t.owner, name: t.name, loco: t.loco.id, value: t.value, orders: t.orders.map(s => s.id), idx: t.idx,
        wagons: t.wagons.map(w => ({ type: w.type, cargo: w.cargo, units: w.units, origin: w.origin ? w.origin.id : null, day: w.day })),
        state: t.state, dwell: t.dwell, speed: t.speed, s: t.s, limit: t.limit, next: t.next ?? null, wait: t.wait || 0, waiting: !!t.waiting,
        at: t.at ? t.at.id : null, to: t.to ? t.to.id : null, via: !!t.via, curPlat: t.curPlat ?? 0,
        arrDir: t.arrDir ? [r3(t.arrDir.x), r3(t.arrDir.z)] : null,
        legs: t.legs ? t.legs.map(l => [l.edge.id, l.forward]) : null,
        plats: t.units ? t.units.map(u => u.kind === 'station' ? (u.plat ?? null) : null) : null,
        ...(t.newConsist ? { newConsist: t.newConsist } : {}),
        ...(t.plan ? { plan: t.plan } : {}), ...(t.base ? { base: t.base } : {}), ...(t.ln ? { ln: t.ln } : {}),
        ...(t.xlocks?.length ? { xl: t.xlocks.map(D => D.id) } : {}),
        handedOver: t.handedOver || 0, ageDays: t.ageDays, revenueYear: t.revenueYear, revenueLast: t.revenueLast, lifetime: t.lifetime, trips: t.trips,
      })),
    };
  }
  replay(a) {
    this.as(this.comp(a.o), () => this.replayAs(a));
  }
  replayAs(a) {
    const W = this.world, net = this.net, P = (p) => new Vec3(p[0], p[1], p[2]);
    const node = (r) => r.s ? W.stations.find(s => s.id === r.s) : { type: 'jc', p: P(r.p), bad: null, owner: r.o || this.co.id };
    const edge = (id) => net.edges.find(e => e.id === id);
    const rnode = (r) => r.s ? W.stations.find(s => s.id === r.s) : { type: 'rjc', p: P(r.p), bad: null };
    let r = null;
    if (a.t === 'station') r = this.buildStation(a.x, a.z, a.angle, a.cov);
    else if (a.t === 'track') {
      const pts = a.pts.map(P);
      r = this.buildTrack({ pts, bridge: a.bridge, cost: a.cost, maxGrade: a.maxGrade, sideA: a.sideA, sideB: a.sideB, double: a.double, grant: a.grant || 0, a: node(a.a), b: node(a.b), bad: null });
    } else if (a.t === 'double') { const e = edge(a.id); r = e ? this.doubleTrack(e) : 'missing track'; }
    else if (a.t === 'removeStation') { const s = W.stations.find(x => x.id === a.id); r = s ? this.removeStation(s) : 'missing station'; }
    else if (a.t === 'removeTrack') { const e = edge(a.id); r = e ? this.removeTrack(e) : 'missing track'; }
    else if (a.t === 'signal') { const e = edge(a.id); r = e ? this.addSignal(e, a.d) : 'missing track'; }
    else if (a.t === 'removeSignal') { const e = edge(a.id); if (e) this.removeSignal(e, a.d); else r = 'missing track'; }
    else if (a.t === 'airport') { const s = W.stations.find(x => x.id === a.id); r = s ? this.buildAirport(s, a.site) : 'missing station'; }
    else if (a.t === 'harbor') { const s = W.stations.find(x => x.id === a.id); r = s ? this.buildHarbor(s) : 'missing station'; }
    else if (a.t === 'warehouse') { const s = W.stations.find(x => x.id === a.id); r = s ? this.buildWarehouse(s) : 'missing station'; }
    else if (a.t === 'depot') r = this.buildDepot(a.x, a.z, a.angle, a.cov);
    else if (a.t === 'road') r = this.buildRoad({ pts: a.pts.map(P), bridge: a.bridge, cost: a.cost, a: rnode(a.a), b: rnode(a.b), bad: null });
    else if (a.t === 'removeRoad') { const e = this.roads.edges.find(x => x.id === a.id); r = e ? this.removeRoad(e) : 'missing road'; }
    else if (a.t === 'merge') { this.log({ t: 'merge', b: a.b }); this.mergeAssets(this.comp(a.b), this.co); } // (kept in the log, so a reloaded game saves it again)
    else if (a.t === 'found') { if (!this.frontier.found(a.r, a.k)) r = 'frontier site missing'; }
    else if (a.t === 'loseTown') this.loseTown(W.towns.find(t => t.id === a.town));
    if (typeof r === 'string' && r) throw new Error(`Save file could not be rebuilt (${a.t}: ${r})`);
  }
  load(data) {
    if (!data || ![2, 3, 4, SAVE_VERSION].includes(data.v)) throw new Error('This save is from an incompatible version');
    this.net.legacy = data.v < 4; // games from before level crossings replay (and play on) without them
    const W = this.world, st = (id) => W.stations.find(s => s.id === id);
    // version 2 saves have only the player's company, stored at the top level
    const cos = data.companies || [{ id: 'P', cash: data.cash, loan: data.loan, ledger: data.ledger, history: data.history, fin: data.fin, old: true }];
    for (const d of cos.slice(1)) if (!this.coById[d.id]) this.addCompany(d);
    this.muted = true; this.actions = [];
    for (const c of this.companies) c.cash = 1e15;
    this.competition = data.competition || 'competitive';
    for (const d of cos) if (d.rights) this.comp(d.id).rights = d.rights;
    try {
      for (const a of data.actions) this.replay(a);
      Object.assign(this, { day: data.day, quarter: data.quarter || 0, lastMonth: data.lastMonth, lastYear: data.lastYear, medals: data.medals || [], competition: data.competition || 'competitive', ousted: data.ousted || null });
      for (const d of cos) {
        const c = this.comp(d.id);
        Object.assign(c, { cash: d.cash, loan: d.loan, ledger: d.ledger, history: d.history, gone: d.gone || null });
        if (d.ai) c.ai = d.ai;
        if (d.rights) c.rights = d.rights;
        if (d.fin) c.fin.load(d.fin);
        else { // saves from before company finance
          if (d.loan > 0) { c.fin.bonds = [{ amount: d.loan, rate: ECON.interest, year: this.year }]; c.fin.sync(); }
          c.fin.snap = { year: c.ledger.year, total: opTotal(c.ledger) };
        }
      }
      this.announcedLocos = new Set(data.announced);
      this.announcedWagons = new Set(data.announcedWagons);
      data.industries.forEach((d, i) => {
        const ind = W.industries[i]; Object.assign(ind, d);
        if (d.owned !== undefined) { ind.owner = d.owned ? 'P' : null; delete ind.owned; } // version 2
        if (!ind.dormant) W.activateIndustry(ind);
      });
      this.auctions = new Auctions(this); this.auctions.load(data.auctions); // (after the industries)
      if (!data.auctions) this.auctions.grandfather(); // saves from before auctions
      this.rateWars = new RateWars(this); this.rateWars.load(data.rateWars);
      this.frontier.load(data.frontier); this.frontier.eras = !!data.eras; this.race.load(data.race); // (saves from before eras play on without wartime)
      for (const i of W.industries) if (i.paid === null) delete i.paid;
      data.towns.forEach((d, i) => { Object.assign(W.towns[i], d); W.updateTownSize(W.towns[i]); });
      for (const d of data.stations) {
        const s = st(d.id); if (!s) continue;
        s.waiting = d.waiting; s.svc = d.svc || {}; s.offered = d.offered || {}; s.taken = d.taken || {};
        s.transfer = (d.transfer || []).map(l => ({ c: l.c, units: l.units, origin: st(l.origin), day: l.day })).filter(l => l.origin);
      }
      for (const d of data.trains) this.as(this.comp(d.owner), () => this.restoreTrain(d, st));
      // the level crossings each train holds
      for (const d of data.trains) if (d.xl) { const tr = this.trains.find(t => t.id === d.id); for (const id of d.xl) { const D = this.net.diamonds.find(x => x.id === id); if (D && tr) this.lockCrossing(tr, D); } }
      for (const d of data.ships || []) this.as(this.comp(d.owner), () => this.restoreShip(d, st));
      for (const d of data.trucks || []) this.as(this.comp(d.owner), () => this.restoreTruck(d, st));
      this.truckSeq = data.truckSeq || this.trucks.length + 1;
      for (const d of data.planes || []) this.as(this.comp(d.owner), () => this.restorePlane(d, st));
      this.brains.clear(); // rebuilt from the saved memory on their next turn
      this.trainSeq = data.trainSeq; this.shipSeq = data.shipSeq || this.ships.length + 1; this.planeSeq = data.planeSeq || this.planes.length + 1;
    } finally { this.muted = false; }
    this.emit('changed');
  }
  restorePlane(d, st) {
    const orders = d.orders.map(st);
    const pl = this.makePlane(d.kind, orders, d.value);
    Object.assign(pl, { id: d.id, name: d.name, idx: d.idx, ageDays: d.ageDays, revenueYear: d.revenueYear, revenueLast: d.revenueLast, lifetime: d.lifetime, trips: d.trips, handedOver: d.handedOver || 0, ...(d.ln ? { ln: structuredClone(d.ln) } : {}) });
    d.holds.forEach((w, k) => Object.assign(pl.wagons[k], { cargo: w.cargo, units: w.units, origin: w.origin ? st(w.origin) : null, day: w.day }));
    pl.at = st(d.at) || orders[0];
    if (d.state === 'moving' && st(d.to)) {
      pl.park = d.pathPark || d.park; pl.idx = (orders.indexOf(pl.at) + orders.length) % orders.length;
      pl.idx = d.idx; // flight is from orders[idx] to the next stop
      this.startFlight(pl); pl.park = d.park;
      Object.assign(pl, { state: 'moving', s: d.s, speed: d.speed, dwell: d.dwell ?? pl.dwell });
    } else { pl.park = d.park; this.startFlight(pl); pl.state = d.state === 'stuck' ? 'stuck' : 'loading'; pl.dwell = d.dwell; }
    return pl;
  }
  restoreShip(d, st) {
    const orders = d.orders.map(st);
    const sh = this.makeShip(d.kind, orders, d.value);
    Object.assign(sh, { id: d.id, name: d.name, idx: d.idx, dockDays: d.dockDays || 0, ageDays: d.ageDays, revenueYear: d.revenueYear, revenueLast: d.revenueLast, lifetime: d.lifetime, trips: d.trips, handedOver: d.handedOver || 0, ...(d.ln ? { ln: structuredClone(d.ln) } : {}) });
    d.holds.forEach((w, k) => Object.assign(sh.wagons[k], { cargo: w.cargo, units: w.units, origin: w.origin ? st(w.origin) : null, day: w.day }));
    sh.at = st(d.at) || orders[0];
    if (d.state === 'moving' && st(d.to)) {
      sh.from = sh.at; sh.to = st(d.to);
      sh.path = this.water.path(sh.from.harbor.berth, sh.to.harbor.berth);
      Object.assign(sh, { state: 'moving', s: d.s, speed: d.speed, dwell: d.dwell ?? sh.dwell });
    } else { this.startVoyage(sh); sh.state = d.state === 'stuck' ? 'stuck' : 'loading'; sh.dwell = d.dwell; }
    return sh;
  }
  restoreTrain(d, st) {
    const loco = LOCOS.find(l => l.id === d.loco);
    const orders = d.orders.map(st);
    const tr = this.makeTrain(loco, d.wagons.map(w => w.type), orders, d.value);
    if (d.newConsist) tr.newConsist = d.newConsist;
    if (d.base) tr.base = [...d.base];
    if (d.plan && d.plan.length === orders.length) tr.plan = d.plan.map(p => p ? [...p] : null);
    Object.assign(tr, { id: d.id, name: d.name, idx: d.idx, handedOver: d.handedOver || 0, ...(d.ln ? { ln: structuredClone(d.ln) } : {}), ageDays: d.ageDays, revenueYear: d.revenueYear, revenueLast: d.revenueLast, lifetime: d.lifetime, trips: d.trips });
    d.wagons.forEach((w, k) => {
      Object.assign(tr.wagons[k], { cargo: w.cargo, units: w.units, origin: w.origin ? st(w.origin) : null, day: w.day });
    });
    tr.at = st(d.at) || orders[0]; tr.curPlat = d.curPlat;
    tr.arrDir = d.arrDir ? new Vec3(d.arrDir[0], 0, d.arrDir[1]) : null;
    tr.at.plats ||= PLAT_OFFS.map(() => new Set());
    tr.at.plats[tr.curPlat].add(tr);
    const legs = d.legs && d.legs.map(([id, f]) => ({ edge: this.net.edges.find(e => e.id === id), forward: f }));
    if (d.state === 'moving' && legs && legs.every(l => l.edge) && st(d.to)) {
      this.setupLeg(tr, tr.at, st(d.to), legs, d.via);
      if (d.plats) tr.units.forEach((u, k) => { if (u.kind === 'station' && d.plats[k] != null) u.plat = d.plats[k]; });
      Object.assign(tr, { state: 'moving', s: d.s, speed: d.speed, wait: d.wait, waiting: d.waiting, limit: d.limit, dwell: d.dwell ?? tr.dwell });
      if (d.next != null && d.next <= tr.units.length) {
        // take back exactly the reservations it held (a train waiting for a block must not get it on load)
        // (units its tail has already passed were released before the save: mark them, never re-acquire,
        // or this train would clear another train's claim on the same throat or junction)
        const tail = tr.s - tr.len;
        for (let i = 1; i < d.next; i++) { const u = tr.units[i]; if (tail > u.rel) { u.held = true; u.released = true; } else this.acquireUnit(tr, u); }
        tr.next = d.next; tr.limit = d.limit;
        this.releasePassed(tr);
      } else this.rebuildUnits(tr); // older saves
    } else {
      // standing at a station (loading, or the network changed under it): set up its next departure
      const ok = this.startLeg(tr);
      tr.state = ok ? (d.state === 'moving' ? 'loading' : d.state) : 'stuck';
      tr.dwell = d.dwell ?? 0.5;
    }
    return tr;
  }


  // ---------------- ships ----------------
  // A harbor is a station upgrade, so trains and ships share the station's storage (rail↔river transfer).
  // Ships reuse the cargo logic of trains: their hold is a list of wagon-equivalents.
  vehicles() { return [...this.trains, ...this.ships, ...this.planes, ...this.trucks]; }
  availableShips() { return Object.keys(SHIPS).filter(k => SHIPS[k].year <= this.year); }
  shipCost(id) { return Math.round(SHIPS[id].cost * this.infl() / 100) * 100; }
  harborSpot(st) {
    if (st.harbor) return st.harbor.berth;
    if (!this.water) return null;
    if (st._hb === undefined) { const w = this.water.nearestWater(st.x, st.z, ECON.harborReach); st._hb = w ? { x: w.x, z: w.z } : null; }
    return st._hb;
  }
  buildHarbor(st) {
    if (!FEATURES.ships && !this.muted) return 'Ships are not in this version';
    if (!this.mine(st)) return 'Not your station';
    if (st.depot) return 'A road depot cannot have a harbor';
    if (st.harbor) return 'This station already has a harbor';
    const berth = this.harborSpot(st);
    if (!berth) return `No navigable water within ${ECON.harborReach} m of this station`;
    const cost = Math.round(ECON.harborCost * this.infl() / 1000) * 1000;
    if (!this.canAfford(cost)) return `Not enough money (${money(cost)})`;
    this.spend(cost, 'construction');
    st.harbor = { berth };
    this.world.setHarbor(st, berth);
    this.log({ t: 'harbor', id: st.id });
    this.emit('news', `⚓ Harbor opened at <b>${st.name}</b> — ships can now call here`);
    this.emit('changed');
    return null;
  }
  buyShip(kind, orders) {
    if (!FEATURES.ships && !this.muted) return 'Ships are not in this version';
    const def = SHIPS[kind];
    if (!def || def.year > this.year) return 'Ship type not available yet';
    if (orders.length < 2) return 'A ship needs at least two harbors';
    for (const o of orders) if (!o.harbor) return `${o.name} has no harbor`;
    if (orders.some(o => o.owner !== this.co.id)) return 'Ships can only call at your own harbors';
    for (let i = 0; i < orders.length; i++) {
      const a = orders[i], b = orders[(i + 1) % orders.length];
      if (a === b) return 'Consecutive stops must differ';
      if (!this.water.path(a.harbor.berth, b.harbor.berth)) return `No waterway between ${a.name} and ${b.name}`;
    }
    const cost = this.shipCost(kind);
    if (!this.canAfford(cost)) return 'Not enough money';
    this.spend(cost, 'vehicles');
    const sh = this.makeShip(kind, orders, cost);
    sh.at = orders[0];
    this.startVoyage(sh);
    this.handleStop(sh);
    this.emit('news', `New ship <b>${sh.name}</b> enters service`);
    this.emit('changed');
    return sh;
  }
  makeShip(kind, orders, cost) {
    const def = SHIPS[kind];
    const holds = Object.entries(def.holds).flatMap(([type, n]) => Array.from({ length: n }, () => ({ type, cargo: null, units: 0, origin: null, day: 0 })));
    const sh = {
      id: 'SH' + this.shipSeq, type: 'ship', owner: this.co.id, kind, def, name: `${def.name.split(' ')[0]} ${String.fromCharCode(64 + ((this.shipSeq - 1) % 26) + 1)}${this.shipSeq > 26 ? Math.floor((this.shipSeq - 1) / 26) : ''}`, value: cost,
      wagons: holds, orders: [...orders], idx: 0, state: 'loading', dwell: 1, speed: 0, s: 0, ageDays: 0, dockDays: 0,
      revenueYear: 0, revenueLast: 0, lifetime: 0, trips: 0,
    };
    this.shipSeq++;
    this.ships.push(sh);
    return sh;
  }
  sellShip(sh) {
    if (!this.mine(sh)) return 'Not yours';
    this.ships = this.ships.filter(s => s !== sh);
    const v = Math.round(sh.value * 0.5 * Math.max(0.3, 1 - sh.ageDays / 365 / 30));
    this.ownerOf(sh).cash += v;
    this.emit('news', `${sh.name} sold for ${money(v)}`);
    this.emit('changed');
  }
  startVoyage(sh) {
    const from = sh.orders[sh.idx], to = sh.orders[(sh.idx + 1) % sh.orders.length];
    const p = from.harbor && to.harbor ? this.water.path(from.harbor.berth, to.harbor.berth) : null;
    if (!p) { sh.state = 'stuck'; sh.dwell = 10; return false; }
    sh.path = p; sh.from = from; sh.to = to; sh.s = 0;
    return true;
  }
  shipFill(sh) { return sh.wagons.reduce((s, w) => s + (w.cargo ? w.units / CARGO[w.cargo].cap[w.type] : 0), 0) / sh.wagons.length; }
  // fill of the holds that can take something this station supplies (null: nothing here for this ship)
  loadableFill(sh, st) {
    const sup = [...this.world.supplies(st), ...(st.transfer || []).map(l => l.c)];
    const holds = sh.wagons.filter(w => w.cargo || sup.some(c => CARGO[c].cap[w.type]));
    const usable = holds.filter(w => sup.some(c => CARGO[c].cap[w.type]));
    if (!usable.length) return null;
    return usable.reduce((s, w) => s + (w.cargo ? w.units / CARGO[w.cargo].cap[w.type] : 0), 0) / usable.length;
  }
  updateShip(sh, dt) {
    sh.ageDays += dt;
    if (sh.state === 'stuck') { sh.dwell -= dt; if (sh.dwell <= 0) { if (this.startVoyage(sh)) sh.state = 'moving'; else sh.dwell = 10; } return; }
    if (sh.state === 'loading') {
      sh.dwell -= dt; sh.dockDays += dt;
      if (sh.dwell <= 0) {
        // bulk ships wait (up to 25 days) for a mostly full hold, topping up as cargo arrives
        const f = sh.def.fullLoad ? this.loadableFill(sh, sh.orders[sh.idx]) : null;
        if (f !== null && f < 0.9 && sh.dockDays < 30) { this.handleStop(sh); sh.dwell = 2; }
        else if (this.startVoyage(sh)) { sh.state = 'moving'; sh.speed = 0; }
      }
      return;
    }
    const sec = dt * ECON.daySeconds;
    const remain = sh.path.length - sh.s;
    const vmax = Math.min(sh.def.speed * 0.5, Math.sqrt(2 * 0.35 * Math.max(0, remain)) + 0.3);
    if (sh.speed < vmax) sh.speed = Math.min(vmax, sh.speed + 0.5 * sec); else sh.speed = Math.max(vmax, sh.speed - 1 * sec);
    sh.s = Math.min(sh.path.length, sh.s + sh.speed * sec);
    if (sh.s >= sh.path.length - 0.3) {
      sh.speed = 0; sh.at = sh.to; sh.dockDays = 0;
      sh.idx = (sh.idx + 1) % sh.orders.length;
      this.handleStop(sh);
      this.startVoyage(sh); // next voyage set up on arrival (matches a loaded save)
    }
  }
  // ---------------- roads and road vehicles ----------------
  // Roads are public (anyone's road vehicles may use them; the builder pays and keeps them up). Road vehicles stop at
  // their company's road depots and at its rail stations that have a road (sharing the station's storage with trains,
  // so a horse wagon can feed a mine's coal to a railhead with a warehouse).
  buildDepot(x, z, angle = 0, cov = null) {
    if (!FEATURES.roads && !this.muted) return 'Roads are not in this version';
    const err = this.world.depotCheck(x, z) || (this.net.near({ x: x - 20, z: z - 20 }, { x: x + 20, z: z + 20 }, 0).some(({ e, j }) => [e.pts[j], e.pts[j + 1]].some(p => Math.hypot(p.x - x, p.z - z) < 20)) ? 'The depot would sit on existing track' : null);
    if (err) return err;
    const cost = Math.round(ECON.road.depotCost * this.infl() / 100) * 100;
    if (!this.canAfford(cost)) return 'Not enough money';
    const st = this.world.addDepot(x, z, angle, this.stationName(x, z) + ' Depot');
    st.owner = this.co.id;
    if (cov) {
      const W = this.world;
      st.cov = { towns: cov.towns.map(id => W.towns.find(t => t.id === id)).filter(Boolean), inds: cov.inds.map(id => W.industries.find(i => i.id === id)).filter(Boolean) };
    } else st.cov.towns = st.cov.towns.filter(t => !this.rateWars.barred(t, this.co));
    this.spend(cost, 'construction');
    for (const i of st.cov.inds) (i.stations ||= []).push(st);
    for (const t of st.cov.towns) (t.stations ||= []).push(st);
    this.rateWars.onStation(st);
    this.demand.set(st, {});
    this.log({ t: 'depot', x, z, angle, cov: { towns: st.cov.towns.map(t => t.id), inds: st.cov.inds.map(i => i.id) } });
    this.emit('news', `New road depot: <b>${st.name}</b>`);
    this.emit('changed');
    return st;
  }
  roadCost(plan) { return plan.cost; }
  buildRoad(plan) {
    if (!FEATURES.roads && !this.muted) return 'Roads are not in this version';
    if (!plan || !plan.b) return 'A road must end at a stop or on another road';
    if (plan.bad) return plan.bad;
    for (const n of [plan.a, plan.b]) if (n.type === 'station' && n.owner !== this.co.id) return 'Roads can only start or end at your own stops (they can join any road)';
    if (!this.canAfford(plan.cost)) return 'Not enough money';
    const R = this.roads;
    if ([plan.a, plan.b].some(n => n.type === 'rjc' && !R.nearestRoad(n.p, 3))) return 'Could not join the road here';
    const A = plan.a.type === 'rjc' ? R.split(plan.a) : plan.a, B = plan.b.type === 'rjc' ? R.split(plan.b) : plan.b;
    if (!A || !B) return 'Could not join the road here';
    const q = (v) => Math.round(v * 1000) / 1000;
    for (const p of plan.pts) p.set(q(p.x), q(p.y), q(p.z));
    const ref = (n) => n.type === 'station' ? { s: n.id } : { p: [n.p.x, n.p.y, n.p.z].map(q) };
    this.log({ t: 'road', a: ref(plan.a), b: ref(plan.b), pts: plan.pts.map(p => [p.x, p.y, p.z]), bridge: plan.bridge, cost: plan.cost });
    const e = R.build(plan, A, B, this.co.id);
    this.spend(plan.cost, 'construction');
    const nm = (n) => n.type === 'rjunction' ? 'road junction' : n.name;
    this.emit('news', `Road: ${nm(A)} ↔ ${nm(B)} (${(e.length / ECON.unitsPerMile).toFixed(1)} mi, ${money(plan.cost)})`);
    this.emit('changed');
    return e;
  }
  removeRoad(e) {
    if (!this.mine(e)) return 'Not your road';
    if (this.trucks.some(t => t.path?.legs?.some(l => l.edge === e))) return 'A road vehicle is using this road';
    this.log({ t: 'removeRoad', id: e.id });
    this.roads.remove(e);
    this.cash += Math.round(e.cost * 0.25);
    this.emit('news', `Road removed (${money(e.cost * 0.25)} salvage)`);
    this.emit('changed');
    return null;
  }
  availableTrucks() { return Object.keys(ROAD_VEHICLES).filter(k => ROAD_VEHICLES[k].year <= this.year); }
  truckCost(kind) { return Math.round(ROAD_VEHICLES[kind].cost * this.infl() / 100) * 100; }
  buyTruck(kind, orders) {
    if (!FEATURES.roads && !this.muted) return 'Roads are not in this version';
    const def = ROAD_VEHICLES[kind];
    if (!def || def.year > this.year) return 'Not available yet';
    if (orders.length < 2) return 'A road vehicle needs at least two stops';
    if (orders.some(o => o.owner !== this.co.id)) return 'Road vehicles stop only at your own stations and depots';
    for (const o of orders) if (!this.roads.served(o)) return `${o.name} has no road`;
    for (let i = 0; i < orders.length; i++) {
      const a = orders[i], b = orders[(i + 1) % orders.length];
      if (a === b) return 'Consecutive stops must differ';
      if (!this.roads.route(a, b)) return `No road between ${a.name} and ${b.name}`;
    }
    const cost = this.truckCost(kind);
    if (!this.canAfford(cost)) return 'Not enough money';
    this.spend(cost, 'vehicles');
    const rv = this.makeTruck(kind, orders, cost);
    rv.at = orders[0];
    this.startDrive(rv);
    this.handleStop(rv);
    this.emit('news', `New road vehicle <b>${rv.name}</b> on the road`);
    this.emit('changed');
    return rv;
  }
  makeTruck(kind, orders, cost) {
    const def = ROAD_VEHICLES[kind];
    const holds = Object.entries(def.holds).flatMap(([type, n]) => Array.from({ length: n }, () => ({ type, cargo: null, units: 0, origin: null, day: 0 })));
    const rv = {
      id: 'RV' + this.truckSeq, type: 'truck', owner: this.co.id, kind, def, name: `${def.name.split(' ').slice(-1)[0]} ${this.truckSeq}`, value: cost,
      wagons: holds, orders: [...orders], idx: 0, state: 'loading', dwell: 1, speed: 0, s: 0, ageDays: 0,
      revenueYear: 0, revenueLast: 0, lifetime: 0, trips: 0,
    };
    this.truckSeq++;
    this.trucks.push(rv);
    return rv;
  }
  sellTruck(rv) {
    if (!this.mine(rv)) return 'Not yours';
    this.trucks = this.trucks.filter(t => t !== rv);
    const v = Math.round(rv.value * 0.5 * Math.max(0.3, 1 - rv.ageDays / 365 / 20));
    this.ownerOf(rv).cash += v;
    this.emit('news', `${rv.name} sold for ${money(v)}`);
    this.emit('changed');
  }
  startDrive(rv) {
    const from = rv.orders[rv.idx], to = rv.orders[(rv.idx + 1) % rv.orders.length];
    const p = this.roads.path(from, to);
    if (!p) { rv.state = 'stuck'; rv.dwell = 10; rv.path = null; return false; }
    rv.path = p; rv.from = from; rv.to = to; rv.s = 0;
    return true;
  }
  updateTruck(rv, dt) {
    rv.ageDays += dt;
    if (rv.state === 'stuck') { rv.dwell -= dt; if (rv.dwell <= 0) { if (this.startDrive(rv)) rv.state = 'moving'; else rv.dwell = 10; } return; }
    if (rv.state === 'loading') {
      rv.dwell -= dt;
      if (rv.dwell <= 0) { if (this.startDrive(rv)) { rv.state = 'moving'; rv.speed = 0; } }
      return;
    }
    const sec = dt * ECON.daySeconds, remain = rv.path.length - rv.s;
    const vmax = Math.min(rv.def.speed * 0.5, Math.sqrt(2 * 2 * Math.max(0, remain)) + 0.3);
    if (rv.speed < vmax) rv.speed = Math.min(vmax, rv.speed + 1.5 * sec); else rv.speed = Math.max(vmax, rv.speed - 3 * sec);
    rv.s = Math.min(rv.path.length, rv.s + rv.speed * sec);
    if (rv.s >= rv.path.length - 0.3) {
      rv.speed = 0; rv.at = rv.to;
      rv.idx = (rv.idx + 1) % rv.orders.length;
      this.handleStop(rv);
      this.startDrive(rv); // next drive set up on arrival (matches a loaded save)
    }
  }
  restoreTruck(d, st) {
    const orders = d.orders.map(st);
    const rv = this.makeTruck(d.kind, orders, d.value);
    Object.assign(rv, { id: d.id, name: d.name, idx: d.idx, ageDays: d.ageDays, revenueYear: d.revenueYear, revenueLast: d.revenueLast, lifetime: d.lifetime, trips: d.trips, handedOver: d.handedOver || 0, ...(d.ln ? { ln: structuredClone(d.ln) } : {}) });
    d.holds.forEach((w, k) => Object.assign(rv.wagons[k], { cargo: w.cargo, units: w.units, origin: w.origin ? st(w.origin) : null, day: w.day }));
    rv.at = st(d.at) || orders[0];
    if (d.state === 'moving' && st(d.to)) {
      rv.from = rv.at; rv.to = st(d.to);
      // the route it was driving (rebuilt from its roads), else a fresh one
      const legs = d.legs?.map(([id, f]) => ({ edge: this.roads.edges.find(e => e.id === id), forward: f }));
      rv.path = legs?.length && legs.every(l => l.edge) ? this.roads.pathOf(legs) : this.roads.path(rv.from, rv.to);
      Object.assign(rv, { state: rv.path ? 'moving' : 'stuck', s: d.s, speed: d.speed, dwell: d.dwell ?? rv.dwell });
    } else { this.startDrive(rv); rv.state = d.state === 'stuck' ? 'stuck' : 'loading'; rv.dwell = d.dwell; }
    return rv;
  }

  // ---------------- planes ----------------
  // An airfield is a station upgrade (like a harbor): planes share the station's storage.
  availablePlanes() { return Object.keys(PLANES).filter(k => PLANES[k].year <= this.year); }
  planeCost(id) { return Math.round(PLANES[id].cost * this.infl() / 100) * 100; }
  aviationYear() { return Math.min(...Object.values(PLANES).map(p => p.year)); }
  airportSpot(st) {
    if (st.airport) return st.airport;
    const key = this.net.edges.length + ':' + this.world.stations.length + ':' + this.world.stations.filter(s => s.airport).length;
    if (!st._ap || st._ap.key !== key) st._ap = { key, site: findAirportSite(this.world, this.net, st) };
    return st._ap.site;
  }
  buildAirport(st, forcedSite = null) {
    if (!FEATURES.planes && !this.muted) return 'Aircraft are not in this version';
    if (!this.mine(st)) return 'Not your station';
    if (st.depot) return 'A road depot cannot have an airfield';
    if (st.airport) return 'This station already has an airfield';
    // a save replays its construction history from 1850 with the recorded site, so skip the era check then
    if (!forcedSite && this.year < this.aviationYear()) return `Aviation arrives in ${this.aviationYear()}`;
    const site = forcedSite || this.airportSpot(st);
    if (!site) return `No flat, open ground for a ${ECON.runwayLen} m runway within ${ECON.airportReach} m`;
    const cost = Math.round(ECON.airportCost * this.infl() / 1000) * 1000;
    if (!this.canAfford(cost)) return `Not enough money (${money(cost)})`;
    this.spend(cost, 'construction');
    st.airport = { x: site.x, z: site.z, y: site.y, dx: site.dx, dz: site.dz, len: site.len };
    this.world.setAirport(st, st.airport);
    this.log({ t: 'airport', id: st.id, site: { ...st.airport } });
    this.emit('news', `✈ Airfield opened at <b>${st.name}</b>`);
    this.emit('changed');
    return null;
  }
  buyPlane(kind, orders) {
    if (!FEATURES.planes && !this.muted) return 'Aircraft are not in this version';
    const def = PLANES[kind];
    if (!def || def.year > this.year) return 'Aircraft not available yet';
    if (orders.length < 2) return 'A plane needs at least two airfields';
    for (const o of orders) if (!o.airport) return `${o.name} has no airfield`;
    if (orders.some(o => o.owner !== this.co.id)) return 'Planes can only use your own airfields';
    for (let i = 0; i < orders.length; i++) {
      const a = orders[i], b = orders[(i + 1) % orders.length];
      if (a === b) return 'Consecutive stops must differ';
      if (Math.hypot(a.airport.x - b.airport.x, a.airport.z - b.airport.z) < 700) return `${a.name} and ${b.name} are too close for a flight`;
    }
    const cost = this.planeCost(kind);
    if (!this.canAfford(cost)) return 'Not enough money';
    this.spend(cost, 'vehicles');
    const pl = this.makePlane(kind, orders, cost);
    pl.at = orders[0]; pl.park = { x: orders[0].airport.x, z: orders[0].airport.z };
    this.startFlight(pl);
    this.handleStop(pl);
    this.emit('news', `New aircraft <b>${pl.name}</b> enters service`);
    this.emit('changed');
    return pl;
  }
  makePlane(kind, orders, cost) {
    const def = PLANES[kind];
    const holds = Object.entries(def.holds).flatMap(([type, n]) => Array.from({ length: n }, () => ({ type, cargo: null, units: 0, origin: null, day: 0 })));
    const pl = {
      id: 'PL' + this.planeSeq, type: 'plane', owner: this.co.id, kind, def, name: `${def.name.split(' ')[0]} ${100 + this.planeSeq}`, value: cost,
      wagons: holds, orders: [...orders], idx: 0, state: 'loading', dwell: 1, speed: 0, s: 0, ageDays: 0,
      revenueYear: 0, revenueLast: 0, lifetime: 0, trips: 0,
    };
    this.planeSeq++;
    this.planes.push(pl);
    return pl;
  }
  sellPlane(pl) {
    if (!this.mine(pl)) return 'Not yours';
    this.planes = this.planes.filter(p => p !== pl);
    const v = Math.round(pl.value * 0.5 * Math.max(0.3, 1 - pl.ageDays / 365 / 25));
    this.ownerOf(pl).cash += v;
    this.emit('news', `${pl.name} sold for ${money(v)}`);
    this.emit('changed');
  }
  startFlight(pl) {
    const from = pl.orders[pl.idx], to = pl.orders[(pl.idx + 1) % pl.orders.length];
    if (!from.airport || !to.airport) { pl.state = 'stuck'; pl.dwell = 10; return false; }
    pl.pathPark = pl.park ? { ...pl.park } : null;
    pl.path = flightPath(this.world.terrain, from.airport, to.airport, pl.park, GEAR[pl.def.model]);
    pl.from = from; pl.to = to; pl.s = 0;
    return true;
  }
  updatePlane(pl, dt) {
    pl.ageDays += dt;
    if (pl.state === 'stuck') { pl.dwell -= dt; if (pl.dwell <= 0) { if (this.startFlight(pl)) pl.state = 'moving'; else pl.dwell = 10; } return; }
    if (pl.state === 'loading') {
      pl.dwell -= dt;
      if (pl.dwell <= 0 && this.startFlight(pl)) { pl.state = 'moving'; pl.speed = 0; }
      return;
    }
    const p = pl.path, sec = dt * ECON.daySeconds, cruise = pl.def.speed * 0.5 * (this.auctions.has('jet') ? 1.25 : 1);
    let target;
    if (pl.s < p.sTaxi) target = 20;                                  // taxi
    else if (pl.s < p.sAir) target = cruise * 0.55;                   // take-off roll
    else if (pl.s < p.sLand) target = (p.sLand - pl.s < 450) ? cruise * 0.5 : cruise; // cruise, slow for approach
    else target = cruise * 0.4;                                       // roll-out (the braking curve below stops it at the end)
    const remain = p.length - pl.s;
    target = Math.min(target, Math.sqrt(2 * 6 * Math.max(0, remain)) + 0.5);
    if (pl.speed < target) pl.speed = Math.min(target, pl.speed + 10 * sec); else pl.speed = Math.max(target, pl.speed - 10 * sec);
    pl.s = Math.min(p.length, pl.s + pl.speed * sec);
    if (pl.s >= p.length - 0.3) {
      pl.speed = 0; pl.at = pl.to; pl.park = { x: p.park.x, z: p.park.z };
      pl.idx = (pl.idx + 1) % pl.orders.length;
      this.handleStop(pl);
      this.startFlight(pl); // next flight set up on arrival (matches a loaded save)
    }
  }
  handleStop(tr) {
    const st = tr.orders[tr.idx];
    let moved = 0, earned = 0, transferred = 0;
    const others = tr.orders.filter(o => o !== st);
    const acceptedElsewhere = (c) => others.some(o => this.consumers(o, c).length > 0);
    // unload: deliver what this station takes; at a warehouse, drop cargo no other stop takes (transfer)
    for (const w of tr.wagons) {
      if (!w.cargo || w.origin === st) continue;
      if (this.consumers(st, w.cargo).length) {
        const pay = this.deliver(w.cargo, w.units, w.origin, st, w.day);
        earned += pay; tr.revenueYear += pay; tr.lifetime += pay;
        const ls = this.lineStop(tr, st); ls.d[w.cargo] = (ls.d[w.cargo] || 0) + w.units; ls.e += pay;
      } else if (this.isHub(st) && !acceptedElsewhere(w.cargo)) {
        const room = Math.max(0, this.storageCap(st, w.cargo) - this.stored(st, w.cargo));
        const u = Math.min(w.units, room);
        if (u > 0) {
          st.transfer ||= [];
          const lot = st.transfer.find(l => l.c === w.cargo && l.origin === w.origin);
          if (lot) { lot.day = (lot.day * lot.units + w.day * u) / (lot.units + u); lot.units += u; }
          else st.transfer.push({ c: w.cargo, units: u, origin: w.origin, day: w.day });
          transferred += u; tr.handedOver = (tr.handedOver || 0) + u; this.lineStop(tr, st).x += u;
        }
      } else continue;
      w.cargo = null; w.units = 0; w.origin = null; moved++;
    }
    let swapped = 0;
    if (tr.type === 'train') {
      // (a purchase or sale works on the owned set: a train running a swapped set first takes its own wagons back
      // in the yard, which stores the cargo of the ones that go)
      if (tr.newConsist) { if (tr.base) swapped += this.yardSwap(tr, st, tr.base); this.applyConsist(tr); }
      // this stop's set; with the plan cleared, the train goes back to the wagons it owns
      const want = tr.plan ? tr.plan[tr.idx] : tr.base;
      if (want) swapped += this.yardSwap(tr, st, want);
      if (!tr.plan && tr.base && tr.base.length === tr.wagons.length && tr.base.every((t, k) => t === tr.wagons[k].type)) tr.base = null;
    }
    // load: fresh cargo goes to any stop that takes it (or to a warehouse further on);
    // transfer cargo only continues to a real consumer
    // fresh cargo may go to a hub on this route only if another train carries it on from there
    const hubs = others.filter(o => this.isHub(o));
    const onward = (c) => hubs.some(h => this.vehicles().some(t2 => t2 !== tr && t2.owner === tr.owner && t2.orders.includes(h) && t2.orders.some(o => o !== h && this.consumers(o, c).length > 0)));
    const lots = [];
    for (const c of Object.keys(st.waiting)) {
      if (st.waiting[c] < 1 || !(acceptedElsewhere(c) || onward(c))) continue;
      lots.push({ c, origin: st, day: this.day, avail: () => st.waiting[c], take: (n) => { st.waiting[c] -= n; (st.taken ||= {})[c] = (st.taken[c] || 0) + n; this.payOwners(st, c, n); } });
    }
    for (const l of st.transfer || []) {
      if (l.units < 1 || !acceptedElsewhere(l.c)) continue;
      lots.push({ c: l.c, origin: l.origin, day: l.day, avail: () => l.units, take: (n) => { l.units -= n; } });
    }
    lots.sort((a, b) => CARGO[b.c].value - CARGO[a.c].value);
    const rr = {};
    for (const w of tr.wagons) {
      if (w.cargo) continue;
      const fit0 = lots.filter(l => CARGO[l.c].cap[w.type] && l.avail() >= 1);
      if (!fit0.length) continue;
      // a wagon prefers the cargo it was built for (a coach takes passengers before mail)
      const own = fit0.filter(l => Object.keys(CARGO[l.c].cap)[0] === w.type);
      const fit = own.length ? own : fit0;
      rr[w.type] = (rr[w.type] ?? -1) + 1; // round-robin between cargo types for wagons of one type
      const l = fit[rr[w.type] % fit.length];
      const n = Math.min(CARGO[l.c].cap[w.type], Math.floor(l.avail()));
      l.take(n);
      Object.assign(w, { cargo: l.c, units: n, origin: l.origin, day: l.day });
      moved++;
      const ls = this.lineStop(tr, st); ls.u[l.c] = (ls.u[l.c] || 0) + n;
    }
    if (st.transfer) st.transfer = st.transfer.filter(l => l.units >= 0.5);
    this.view?.cargoChanged(tr);
    tr.state = 'loading'; tr.dwell = tr.type === 'plane' ? 1 + moved * 0.2 : tr.type === 'truck' ? 0.5 + moved * 0.1 : (tr.type === 'ship' ? 2 : 1.2) + moved * (tr.type === 'ship' ? 0.15 : 0.25);
    if (swapped) tr.dwell += swapped * 0.15; // (shunting in the yard)
    if (tr.type === 'train' && this.auctions.has('telegraph')) tr.dwell *= 0.85;
    if (earned > 0) { this.emit('float', this.vehiclePos(tr), '+' + money(earned)); tr.trips++; }
    if (transferred > 0) this.emit('float', this.vehiclePos(tr), `📦 ${Math.round(transferred)} stored`);
  }

  // owners of the producing industries earn a share of the value of what trains pick up
  // the owner of a producing industry earns from what its own company picks up there
  payOwners(st, c, n) {
    const prod = st.cov.inds.filter(i => !i.dormant && i.def.out[c] !== undefined);
    const owned = prod.filter(i => i.owner && i.owner === st.owner);
    if (!owned.length) return;
    const each = n * this.value(c) * ECON.industryMargin / prod.length;
    for (const i of owned) i.incomeAcc = (i.incomeAcc || 0) + each;
  }
  deliver(c, units, origin, dest, loadedDay) {
    const miles = Math.max(1, Math.hypot(dest.x - origin.x, dest.z - origin.z) / ECON.unitsPerMile);
    const days = Math.max(1, this.day - loadedDay);
    // passengers and mail pay for speed: their on-time standard is about twice as strict
    const expected = CARGO[c].speedy ? 2 + miles * 1.0 : 4 + miles * 1.8;
    let speedF = clamp(1.3 - 0.3 * days / expected, 0.5, 1.25);
    if (CARGO[c].perish) speedF *= clamp(1.25 - days / (this.auctions.has('reefer') ? 120 : 60), 0.35, 1);
    const cons = this.bestConsumer(dest, c);
    const price = cons ? this.priceAt(cons, c) : 0.5;
    let pay = Math.round(units * miles * (CARGO[c].wt * ECON.tonRate * this.infl() + this.value(c) * ECON.valueRate) * speedF * price);
    pay = Math.round(pay * this.rateWars.onDeliver(this.co, origin, dest, pay)); // rate wars cut what both sides earn there
    pay = Math.round(pay * this.race.payMul(this.co, miles)); // the Golden Spike's long-haul bonus
    this.cash += pay; this.ledger.revenue += pay;
    this.ledger.byCargo[c] = (this.ledger.byCargo[c] || 0) + pay;
    if (cons) {
      this.mkt(cons, c).recv += units;
      if (cons.type === 'town') cons.growth += (TOWN_GROWTH[c] || 0.5) * units / this.maxLoad(c);
      else if (cons.def.in && cons.def.in[c] !== undefined) {
        cons.stock[c] = Math.min(3 * this.demandCap(cons, c), (cons.stock[c] || 0) + units);
        if (!cons.firstDelivery) { cons.firstDelivery = true; this.emit('news', `First ${CARGO[c].name} delivered to <b>${cons.name}</b>`); }
      } else cons.boostStock[c] = (cons.boostStock[c] || 0) + units;
    }
    return pay;
  }

  // ---------------- simulation step ----------------
  update(dtGame) {
    // dtGame in game-days
    if (this.ousted) return; // the game is over (load a save or start again)
    this.day += dtGame;
    // longest-waiting trains get first pick of freed track (first come, first served)
    const order = [...this.trains].sort((a, b) => (b.waiting ? b.wait : -1) - (a.waiting ? a.wait : -1));
    try {
      for (const tr of order) { this.co = this.comp(tr.owner); this.updateTrain(tr, dtGame); }
      for (const sh of this.ships) { this.co = this.comp(sh.owner); this.updateShip(sh, dtGame); }
      for (const pl of this.planes) { this.co = this.comp(pl.owner); this.updatePlane(pl, dtGame); }
      for (const rv of this.trucks) { this.co = this.comp(rv.owner); this.updateTruck(rv, dtGame); }
    } finally { this.co = this.player; }
    const d = this.date;
    const mk = d.getFullYear() * 12 + d.getMonth();
    if (!this.lastMonth) this.lastMonth = mk;
    if (mk !== this.lastMonth) { this.lastMonth = mk; this.monthly(); }
  }
  updateTrain(tr, dt) {
    tr.ageDays += dt;
    if (tr.xlocks?.length) this.freeCrossings(tr);
    if (tr.state === 'stuck') {
      tr.dwell -= dt;
      if (tr.dwell <= 0) { tr.dwell = 5; if (this.startLeg(tr)) { tr.state = 'moving'; tr.speed = 0; this.chargeTrackage(tr); } }
      return;
    }
    if (tr.state === 'loading') {
      tr.dwell -= dt;
      if (tr.dwell <= 0) { if (this.startLeg(tr)) { tr.state = 'moving'; tr.speed = 0; this.chargeTrackage(tr); } else { tr.state = 'stuck'; tr.dwell = 5; } }
      return;
    }
    const sec = dt * ECON.daySeconds;
    const brake = tr.speed * tr.speed / (2 * 3.5);
    if (tr.next < tr.units.length && tr.limit - tr.s < brake + 60) { if (this.tryReserve(tr)) tr.wait = 0; }
    // heavy trains are slower, and much slower uphill
    const vBase = tr.loco.speed * 0.5 * (this.auctions.has('airbrake') ? 1.1 : 1);
    const grade = this.gradeAt(tr, tr.s);
    const loadF = this.trainTons(tr) / (tr.loco.power * 250);
    let vmax = vBase * (1 - clamp((loadF - 0.7) * 0.3, 0, 0.25)) * (1 - clamp(Math.max(0, grade) * 14 * loadF, 0, 0.7));
    const lim = tr.xunits?.length ? this.crossLimit(tr, brake) : tr.limit;
    const remain = lim - tr.s;
    vmax = Math.min(vmax, Math.sqrt(2 * 3.5 * Math.max(0, remain)) + (remain > 0.3 ? 0.6 : 0));
    if (tr.speed < vmax) tr.speed = Math.min(vmax, tr.speed + 2.5 * sec); else tr.speed = Math.max(vmax, tr.speed - 5 * sec);
    tr.s = Math.min(lim, tr.s + tr.speed * sec);
    tr.waiting = false;
    if (lim - tr.s < 0.05) {
      if (lim === tr.limit && tr.next >= tr.units.length && tr.s >= tr.sStop - 0.06) {
        tr.speed = 0;
        tr.curPlat = tr.units[tr.units.length - 1].plat; tr.arrDir = tr.dEnd; tr.at = tr.to;
        this.releasePassed(tr);
        if (tr.via) { tr.state = 'loading'; tr.dwell = 0.8; } // reversing, no cargo handling
        else { tr.idx = (tr.idx + 1) % tr.orders.length; this.handleStop(tr); }
        // set up the next departure right away, so a saved game rebuilds exactly this state
        const dwell = tr.dwell;
        if (this.startLeg(tr)) { tr.state = 'loading'; tr.dwell = dwell; } else { tr.state = 'stuck'; tr.dwell = 5; }
        return;
      }
      tr.speed = 0; tr.wait += dt; tr.waiting = true;
    }
    this.releasePassed(tr);
  }

  // put production into station storage; whatever does not fit is lost
  // Where several companies serve one place, each company's share follows its service there:
  // the best rating among its stations (how much of what is offered gets picked up), plus a base share.
  addToStations(list, c, amount) {
    if (!list || !list.length || amount <= 0) return 0;
    const owners = new Set(list.map(s => s.owner));
    let shareOf = () => 1 / list.length;
    if (owners.size > 1) {
      const w = {}, n = {};
      // a station that no vehicle calls at gets nothing (unless nobody serves the place at all)
      const served = this.servedStations();
      const live = list.some(s => served.has(s)) ? list.filter(s => served.has(s)) : list;
      for (const s of live) { w[s.owner] = Math.max(w[s.owner] || 0, 0.25 + this.service(s, c)); n[s.owner] = (n[s.owner] || 0) + 1; }
      const tot = Object.values(w).reduce((a, b) => a + b, 0);
      shareOf = (s) => live.includes(s) ? w[s.owner] / tot / n[s.owner] : 0;
    }
    let moved = 0;
    for (const st of list) {
      const each = amount * shareOf(st);
      (st.offered ||= {})[c] = (st.offered[c] || 0) + each;
      const room = Math.max(0, this.storageCap(st, c) - this.stored(st, c));
      const u = Math.min(each, room);
      st.waiting[c] = (st.waiting[c] || 0) + u; moved += u;
    }
    return moved;
  }
  servedStations() {
    if (this._servedDay !== this.day) { this._served = new Set(this.vehicles().flatMap(v => v.orders)); this._servedDay = this.day; }
    return this._served;
  }
  // service rating 0..1 of a station for a cargo (0.5 until it has a record)
  service(st, c) { return st.svc && st.svc[c] !== undefined ? st.svc[c] : 0.5; }
  updateService(st) {
    st.svc ||= {};
    for (const c of Object.keys(st.offered || {})) {
      const off = st.offered[c]; if (off < 0.5) continue;
      const r = clamp(((st.taken && st.taken[c]) || 0) / off, 0, 1);
      st.svc[c] = Math.round((this.service(st, c) * 0.7 + r * 0.3) * 1000) / 1000;
    }
    st.offered = {}; st.taken = {};
  }
  monthly() {
    const W = this.world, y = this.year;
    for (const st of W.stations) this.updateService(st); // last month's pickups vs what was offered
    // eras: new industries get founded
    for (const ind of W.industries) if (ind.dormant && (ind.def.year || 0) <= y && !this.frontier.holds(ind)) this.activateIndustry(ind); // (the frontier founds its own)
    for (const ind of W.industries) {
      if (ind.dormant) continue;
      const def = ind.def; ind.producedLastMonth = {}; ind.transportedLastMonth = {};
      const lv = LEVEL_MUL[ind.level];
      let mul = lv; ind.boosted = false;
      if (def.boost) for (const [c, b] of Object.entries(def.boost)) {
        const need = this.maxLoad(c);
        if ((ind.boostStock[c] || 0) >= need) { ind.boostStock[c] -= need; mul += b * lv; ind.boosted = true; }
      }
      let batches;
      if (def.consumer) { // a customer uses up each thing it buys on its own
        let used = 0;
        for (const c of Object.keys(def.in)) { const u = Math.min(ind.stock[c] || 0, this.demandCap(ind, c)); ind.stock[c] = (ind.stock[c] || 0) - u; used += u; }
        batches = used > 0 ? 1 : 0;
      } else if (def.in) {
        batches = Math.max(0, Math.min(def.cap * lv, ...Object.entries(def.in).map(([c, q]) => (ind.stock[c] || 0) / q)));
        for (const [c, q] of Object.entries(def.in)) ind.stock[c] = Math.max(0, (ind.stock[c] || 0) - batches * q);
      } else batches = mul * (0.85 + this.player.fin.rng() * 0.3);
      ind.active = batches > 0.01;
      let income = 0;
      const outs = Object.entries(def.out);
      for (const [c, q] of outs) {
        const p = q * batches;
        ind.producedLastMonth[c] = p;
        const moved = this.addToStations(ind.stations, c, p);
        ind.transportedLastMonth[c] = moved;
        if (c === outs[0][0]) { ind.history.push(p > 0 ? moved / p : 0); if (ind.history.length > 12) ind.history.shift(); }
      }
      if (ind.owner) {
        const oc = this.comp(ind.owner);
        income = ind.incomeAcc || 0; ind.incomeAcc = 0;
        const upkeep = this.industryPrice(ind) * 0.004;
        oc.cash += income; oc.ledger.industryIncome = (oc.ledger.industryIncome || 0) + income;
        this.spend(upkeep, 'industryUpkeep', oc);
        ind.incomeMonth = income - upkeep; ind.incomeYear = (ind.incomeYear || 0) + income - upkeep;
      }
      if (!def.in && ind.history.length === 12 && ind.level < 4) {
        const avg = ind.history.reduce((a, b) => a + b, 0) / 12;
        if (avg > 0.8) { ind.level++; ind.history = []; this.emit('news', `📈 <b>${ind.name}</b> expands production (level ${ind.level})`); }
      }
    }
    for (const t of W.towns) {
      this.addToStations(t.stations, 'passengers', t.pop * ECON.paxPerPop);
      this.addToStations(t.stations, 'mail', t.pop * ECON.mailPerPop);
      const before = t.pop;
      t.pop = Math.round(t.pop * 1.0015 + t.growth * 9);
      t.growth = 0;
      // (on the continent only towns you serve, and every 10,000 for the rest: dozens of towns grow)
      const step = !W.terrain.cont || (t.stations || []).some(s => s.owner === this.player.id) ? 1000 : 10000;
      if (Math.floor(t.pop / step) > Math.floor(before / step)) this.emit('news', `🏘 ${t.name} grows to ${t.pop.toLocaleString()} people`);
      W.updateTownSize(t);
    }
    // markets: scarcity raises prices, oversupply lowers them
    for (const cons of [...W.towns, ...W.industries.filter(i => !i.dormant)]) {
      for (const c of this.marketList(cons)) {
        const m = this.mkt(cons, c), cap = Math.max(1e-6, this.demandCap(cons, c));
        const target = clamp(1.45 - 0.9 * m.recv / cap, ECON.priceFloor[cons.type === 'town' ? 'town' : 'industry'], 1.5);
        m.p += (target - m.p) * 0.35;
        m.hist.push(Math.round(m.p * 100) / 100); if (m.hist.length > 36) m.hist.shift();
        m.recv = 0;
      }
    }
    // storage: stock slowly spoils; warehouses (cold storage from level 2) keep it longer
    const whUp = {};
    for (const st of W.stations) {
      const wh = st.warehouse || 0;
      const keep = (c) => CARGO[c].perish ? (wh >= 2 ? 0.95 : 0.8) : (wh >= 1 ? 0.99 : 0.95);
      for (const c of Object.keys(st.waiting)) st.waiting[c] *= keep(c);
      if (st.transfer) { for (const l of st.transfer) l.units *= keep(l.c); st.transfer = st.transfer.filter(l => l.units >= 0.5); }
      whUp[st.owner] = (whUp[st.owner] || 0) + ECON.warehouseUpkeep[wh];
    }
    // running costs and finance, for every company
    for (const c of this.active) this.as(c, () => this.monthlyCosts(c, whUp[c.id] || 0));
    const newYear = y !== this.lastYear;
    if (newYear) {
      for (const c of this.active) this.as(c, () => { this.history.push(this.ledger); this.ledger = this.newLedger(y); });
      this.lastYear = y;
      for (const t of this.vehicles()) { t.revenueLast = t.revenueYear; t.revenueYear = 0; const l = this.lineOf(t); l.cl = l.cy; l.cy = 0; l.sl = l.sy; l.sy = {}; }
      for (const i of W.industries) if (i.owner) { i.incomeLast = i.incomeYear; i.incomeYear = 0; }
      this.emit('news', `📅 Happy new year ${y}! Company value ${money(this.companyValue())}`);
      for (const c of this.active) this.as(c, () => this.fin.yearly());
    }
    // rival companies make their quarterly decisions, each in its own month (spreads the work)
    const mo = this.date.getMonth();
    this.companies.slice(1).forEach((c, i) => {
      if (c.gone || !c.ai || (mo - i % 3 + 3) % 3 !== 0) return;
      c.ai.q = (c.ai.q || 0) + 1;
      try { this.brain(c).tick(c.ai.q); } catch (err) { console.warn(`${c.name}: AI turn failed`, err); }
    });
    try { this.rateWars.monthly(); } catch (err) { console.warn('rate wars failed', err); }
    try { this.auctions.monthly(); } catch (err) { console.warn('auctions failed', err); }
    try { this.market.monthly(); } catch (err) { console.warn('stock market check failed', err); }
    try { this.frontier.monthly(); } catch (err) { console.warn('frontier failed', err); }
    try { this.race.monthly(); } catch (err) { console.warn('race failed', err); }
    this.monthlyNews(y);
    if (newYear) this.emit('year', y); // last, so the autosave holds the whole month
  }
  // a lost rate war: this company's stations no longer serve the town (also replayed from saves)
  loseTown(town) {
    const mine = (town.stations || []).filter(s => s.owner === this.co.id);
    for (const s of mine) s.cov.towns = s.cov.towns.filter(t => t !== town);
    town.stations = (town.stations || []).filter(s => s.owner !== this.co.id);
    this.log({ t: 'loseTown', town: town.id });
    return mine.length;
  }
  // a merger: everything company `from` owns passes to `to` (also replayed when a save is rebuilt)
  mergeAssets(from, to) {
    const re = (x) => { if (x.owner === from.id) x.owner = to.id; };
    this.world.stations.forEach(re); this.net.edges.forEach(re); this.net.junctions.forEach(re); this.roads.edges.forEach(re);
    this.vehicles().forEach(re); this.world.industries.forEach(re);
    this.auctions.merge(from, to); this.rateWars.merge(from, to);
    this.emit('merged', from, to);
  }
  monthlyCosts(c, whUpkeep) {
    const W = this.world, I = this.infl(), own = (x) => x.owner === c.id;
    const trains = this.trains.filter(own), ships = this.ships.filter(own), planes = this.planes.filter(own), stations = W.stations.filter(own);
    const tech = (this.auctions.has('compound', c) ? 0.85 : 1) * (this.auctions.has('diesel', c) ? 0.8 : 1);
    const upkeep = trains.reduce((s, t) => s + t.loco.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 40)), 0) * tech * I / 12;
    // (each vehicle's share, for the line manager: the same formulas, kept apart from the company totals)
    const share = (list, f) => { for (const t of list) this.lineOf(t).cy += f(t); };
    share(trains, t => t.loco.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 40)) * tech * I / 12);
    share(ships, t => t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 40)) * I / 12);
    share(planes, t => t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 30)) * I / 12);
    share(this.trucks.filter(own), t => t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 20)) * I / 12);
    const track = this.net.edges.filter(own).reduce((s, e) => s + e.length * (e.double ? 1.75 : 1), 0) * ECON.trackUpkeepPerUnit * I / 12;
    const interest = this.fin.annualInterest() / 12; // bonds (finance.js)
    const shipUp = ships.reduce((s, t) => s + t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 40)), 0) * I / 12;
    const harbors = stations.filter(s => s.harbor).length * ECON.harborUpkeep * I / 12;
    this.spend(upkeep, 'trainUpkeep'); this.spend(track, 'trackUpkeep'); this.spend(interest, 'interest');
    if (shipUp) this.spend(shipUp, 'shipUpkeep');
    const planeUp = planes.reduce((s, t) => s + t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 30)), 0) * I / 12;
    if (planeUp) this.spend(planeUp, 'planeUpkeep');
    const truckUp = this.trucks.filter(own).reduce((s, t) => s + t.def.upkeep * (1 + Math.min(0.5, t.ageDays / 365 / 20)), 0) * I / 12;
    if (truckUp) this.spend(truckUp, 'truckUpkeep');
    const roadUp = this.roads.edges.filter(own).reduce((s, e) => s + e.length, 0) * ECON.road.upkeepPerUnit * I / 12;
    if (roadUp) this.spend(roadUp, 'trackUpkeep');
    const airports = stations.filter(s => s.airport).length * ECON.airportUpkeep * I / 12;
    if (airports) this.spend(airports, 'warehouseUpkeep');
    if (harbors) this.spend(harbors, 'warehouseUpkeep');
    if (whUpkeep) this.spend(whUpkeep * this.infl() / 12, 'warehouseUpkeep');
    this.fin.monthly(this.date.getMonth());
  }
  monthlyNews(y) {
    for (const l of LOCOS) if (l.year <= y && !this.announcedLocos.has(l.id)) { this.announcedLocos.add(l.id); this.emit('news', `🚂 New locomotive available: <b>${l.name}</b>`); }
    for (const [k, w] of Object.entries(WAGONS)) if (w.year <= y && !this.announcedWagons.has(k)) { this.announcedWagons.add(k); this.emit('news', `🚃 New wagon type available: <b>${w.name}</b>`); }
    if (y <= this.deadline) for (const t of this.medalTiers) {
      if (this.medals.some(m => m.name === t.name) || this.companyValue() < t.value) continue;
      this.medals.push({ name: t.name, year: y });
      this.emit('goal', t);
    }
    this.emit('changed');
  }
}
