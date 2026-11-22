// Company AI (phase B of COMPETITION_PLAN.md): plays one company the way a sensible player would.
// Rival companies run it every quarter; the balance bot (tools/balance-bot.js) runs it for the player.
//
// Each quarter: manage bonds, add trains or ships where cargo piles up, build warehouses where
// output is lost, buy well-served industries, and build the best new route it can afford
// (town↔town passengers, producer → consumer freight, river ships), ranked by yearly revenue
// per dollar invested. A personality changes how aggressive it is.
import { CARGO, ECON, SHIPS, TOWN_ACCEPTS, LEVEL_MUL, FEATURES } from './data.js';
import { FIN } from './finance.js';
import { clamp } from './util.js';

export const PERSONALITIES = {
  // the balance bot's expert player (balance figures in BALANCE.md come from this one)
  // rights: whether it opens its track to other companies (trackage rights, paid per train-mile)
  expert:        { label: 'Expert',        routesPerQ: 1, minRatio: 0.12, paxW: 1, freightW: 1, buyPayback: 5, borrowYears: 8, payout: 0, every: 1, raid: 0, bidW: 1, rights: 'closed', race: 0 },
  builder:       { label: 'Empire builder', routesPerQ: 1, minRatio: 0.10, paxW: 1.1, freightW: 1, buyPayback: 4, borrowYears: 12, payout: 0.1, every: 1, raid: 0.15, bidW: 0.9, rights: 'closed', race: 1 },
  industrialist: { label: 'Industrialist', routesPerQ: 1, minRatio: 0.12, paxW: 0.9, freightW: 1.15, buyPayback: 6, borrowYears: 8, payout: 0.2, every: 1, raid: 0.1, bidW: 1.5, rights: 'open', race: 0 },
  financier:     { label: 'Financier',     routesPerQ: 1, minRatio: 0.14, paxW: 1, freightW: 1, buyPayback: 4, borrowYears: 4, payout: 0.25, every: 1, raid: 0.5, bidW: 0.8, rights: 'open', race: 0.5 },
};

// rival difficulty: how quickly and how selectively rivals expand (the player's balance bot uses 'hard')
export const DIFFICULTY = {
  // raid: how much of their spare cash rivals put into other companies' shares (phase C)
  easy:   { label: 'Easy',   every: 3, minRatio: 0.06, cash: 0.5,  raid: 0 },
  normal: { label: 'Normal', every: 2, minRatio: 0.03, cash: 0.75, raid: 1 },
  hard:   { label: 'Hard',   every: 1, minRatio: 0,    cash: 1,    raid: 1.5 },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const miles = (a, b) => dist(a, b) / ECON.unitsPerMile;
const covers = (s, t) => t.type === 'town' ? s.cov.towns.includes(t) : s.cov.inds.includes(t);

export class CompanyAI {
  // opts: { personality, casual, ships, log, mem }
  constructor(game, company, opts = {}) {
    this.g = game; this.c = company;
    const base = PERSONALITIES[opts.personality || company.ai?.personality || 'expert'];
    const d = DIFFICULTY[opts.difficulty || company.ai?.difficulty || 'hard'] || DIFFICULTY.normal;
    this.p = { ...base, every: Math.max(base.every, d.every), minRatio: base.minRatio + d.minRatio, raid: base.raid * (d.raid ?? 1) };
    this.casual = !!(opts.casual ?? company.ai?.casual);
    this.useShips = FEATURES.ships && (opts.ships ?? company.ai?.ships) !== false;
    this.log = opts.log || (() => {});
    this.routes = [];          // {key, kind, c, a, b, src, trains:[], invest, built, est}
    this.failed = new Set();   // candidate keys that could not be built
    this.waterCache = new Map();
    this.startYear = company.ai?.start ?? game.year;
    this.restore(opts.mem || company.ai?.mem);
  }

  // ---------- memory (saved with the game) ----------
  serialize() {
    const ref = (s) => s ? (s.planned ? { ...s } : { id: s.id }) : null;
    return {
      routes: this.routes.map(r => ({ ...r, a: r.a.id, b: r.b.id, src: r.src.id, dst: r.dst ? r.dst.id : null, trains: r.trains.map(t => t.id) })),
      failed: [...this.failed], water: [...this.waterCache].map(([t, s]) => [t.id, ref(s)]), start: this.startYear,
    };
  }
  restore(m) {
    if (!m) return;
    const g = this.g, W = g.world, st = (id) => W.stations.find(s => s.id === id);
    const place = (id) => W.towns.find(t => t.id === id) || W.industries.find(i => i.id === id);
    const veh = (id) => g.vehicles().find(v => v.id === id);
    this.routes = m.routes.map(r => ({ ...r, a: st(r.a), b: st(r.b), src: place(r.src), dst: r.dst ? place(r.dst) : null, trains: r.trains.map(veh).filter(Boolean) })).filter(r => r.a && r.b && r.src && r.trains.length);
    this.failed = new Set(m.failed);
    this.waterCache = new Map((m.water || []).map(([id, s]) => [place(id), s ? (s.planned ? s : st(s.id)) : null]).filter(([t, s]) => t && s !== undefined));
    this.startYear = m.start ?? this.startYear;
  }

  // ---------- helpers ----------
  bestLoco() { return this.g.availableLocos().sort((a, b) => b.power * b.speed - a.power * a.speed)[0]; }
  own(s) { return s.owner === this.c.id; }
  stationFor(target, toward) {
    const g = this.g, world = g.world;
    const existing = world.stations.find(s => this.own(s) && !s.depot && covers(s, target));
    if (existing) return existing;
    for (let r = 60; r < 175; r += 10) for (let k = 0; k < 24; k++) {
      const ang = Math.atan2(toward.z - target.z, toward.x - target.x) + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.26;
      const x = target.x + Math.cos(ang) * r, z = target.z + Math.sin(ang) * r;
      if (world.stationCheck(x, z) || !g.net.stationClear(x, z, Math.atan2(toward.z - z, toward.x - x))) continue;
      if (!covers({ cov: world.coverage(x, z) }, target)) continue;
      return { planned: true, x, z, angle: Math.atan2(toward.z - z, toward.x - x) };
    }
    return null;
  }
  planLink(a, b, dbl) {
    // a, b: real stations. Direct, else one waypoint around the obstacle.
    const net = this.g.net;
    const pl = net.plan(a, [], b, dbl);
    if (!pl.bad) return pl;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    // (with level crossings more links need a detour: more offsets to try; games from before keep the old set)
    const offs = [100, -100, 220, -220, 360, -360, ...(net.legacy ? [] : [60, -60, 160, -160, 290, -290, 480, -480])];
    for (const off of offs) {
      const p = net.plan(a, [{ x: mx - dz / L * off, z: mz + dx / L * off }], b, dbl);
      if (!p.bad) return p;
    }
    return null;
  }
  realize(s) { return s.planned ? this.g.buildStation(s.x, s.z, s.angle) : s; }
  // a station (existing or planned) for the target that can have a harbor
  waterStationFor(target) {
    const g = this.g, world = g.world;
    const ex = world.stations.find(s => this.own(s) && !s.depot && covers(s, target) && (s.harbor || g.harborSpot(s)));
    if (ex) return ex;
    if (this.waterCache.has(target)) {
      const c = this.waterCache.get(target);
      // a remembered site may have become illegal (e.g. a station was built next to it)
      if (!c || !c.planned || (!world.stationCheck(c.x, c.z) && g.net.stationClear(c.x, c.z, c.angle))) return c;
      this.waterCache.delete(target);
    }
    let res = null;
    for (let r = 40; r < 200 && !res; r += 10) for (let k = 0; k < 36; k++) {
      const a = k / 36 * Math.PI * 2, x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r;
      if (world.stationCheck(x, z)) continue;
      if (!covers({ cov: world.coverage(x, z) }, target)) continue;
      const w = g.water.nearestWater(x, z, ECON.harborReach); if (!w) continue;
      if (!g.net.stationClear(x, z, Math.atan2(w.z - z, w.x - x) + Math.PI / 2)) continue;
      res = { planned: true, x, z, angle: Math.atan2(w.z - z, w.x - x) + Math.PI / 2, berth: { x: w.x, z: w.z } };
      break;
    }
    this.waterCache.set(target, res);
    return res;
  }
  berthOf(s) { return s.harbor ? s.harbor.berth : (s.planned ? s.berth : this.g.harborSpot(s)); }
  holdsCap(def, c) { return Object.entries(def.holds).reduce((sum, [t, n]) => sum + n * (CARGO[c].cap[t] || 0), 0); }
  bestShip(c) {
    const g = this.g;
    return g.availableShips().map(k => ({ k, d: SHIPS[k], cap: this.holdsCap(SHIPS[k], c) })).filter(o => o.cap > 0)
      .sort((a, b) => b.cap * b.d.speed / g.shipCost(b.k) - a.cap * a.d.speed / g.shipCost(a.k))[0];
  }
  shipYear(sh, len, wait) { return 365 / (2 * len / (sh.d.speed * 0.5 * ECON.daySeconds * 0.9) + 6 + wait); }

  // ---------- revenue estimate ----------
  payPerUnit(c, m) { const g = this.g; return m * (CARGO[c].wt * ECON.tonRate * g.infl() + g.value(c) * ECON.valueRate) * 1.05; }
  trainTrips(loco, m) {
    const unitsPerDay = loco.speed * 0.5 * ECON.daySeconds * 0.6; // slack for grades, curves and waits
    return 365 / (2 * m * ECON.unitsPerMile / unitsPerDay + 6);
  }
  // what a receiver takes in a year before its price collapses
  absorb(dst, c) { return dst.type === 'town' ? Infinity : this.g.demandCap(dst, c) * 12 * 1.5; }
  // the receiver's price index now (below 1 when others already flood it; read only, so no market is created)
  priceIdx(dst, c) { return dst.type === 'town' ? 1 : Math.min(1.2, dst.market?.[c]?.p ?? 1); }
  // the price a receiver would settle at with u units a month delivered (the market rule in Game.monthly/priceAt):
  // the month's level falls as deliveries pass half its demand, and each delivery pushes it down within the month
  priceFor(dst, c, u) {
    if (dst.type === 'town') return 1;
    const cap = Math.max(1e-6, this.g.demandCap(dst, c)), x = u / cap;
    const level = Math.min(this.priceIdx(dst, c), clamp(1.45 - 0.9 * x, ECON.priceFloor.industry, 1.2));
    return level * Math.max(ECON.priceFloor.industry, 1 - 0.25 * Math.min(2, x));
  }
  // share of a place's output this company can expect: rivals already there take part of it
  share(place) { return (place.stations || []).some(s => !this.own(s)) ? 0.5 : 1; }
  // monthly supply a source offers for cargo c
  supply(src, c) {
    if (src.type === 'town') return (c === 'passengers' ? src.pop * ECON.paxPerPop : src.pop * ECON.mailPerPop) * this.share(src);
    const d = src.def, lv = LEVEL_MUL[src.level];
    if (!d.in) return d.out[c] * lv * this.share(src);
    // processing: limited by what it currently receives (last month)
    return (src.producedLastMonth[c] || 0) * this.share(src);
  }

  // ---------- candidate routes ----------
  candidates() {
    const g = this.g, world = g.world, out = [], P = this.p;
    // not towns it lost a rate war for; in Cut-throat games not towns held by a stronger company either
    const myValue = g.companyValue(this.c);
    const val = {}, valueOf = (id) => val[id] ??= g.companyValue(g.comp(id));
    const strongerHere = (t) => g.competition === 'cutthroat' && (t.stations || []).some(s => !this.own(s) && valueOf(s.owner) > myValue * 0.8)
      && !(t.stations || []).some(s => this.own(s));
    const towns = world.towns.filter(t => !g.rateWars.barred(t, this.c) && !strongerHere(t));
    const has = (key) => this.failed.has(key) || this.routes.some(r => r.key === key);
    // lines we already run from a source / into a receiver share its output / demand
    const fromN = (src, c) => 1 + this.routes.filter(r => r.src === src && r.c === c).length;
    const intoN = (dst, c) => 1 + this.routes.filter(r => r.dst === dst && r.c === c).length;
    const loco = this.bestLoco();
    const W = Math.min(loco.maxCars, 6);
    const avail = g.wagonsAvailable();
    // freight: producer -> consumer
    for (const src of world.industries) {
      if (src.dormant) continue;
      for (const c of Object.keys(src.def.out)) {
        const wagon = Object.keys(CARGO[c].cap).find(w => avail.includes(w));
        if (!wagon) continue;
        const s = this.supply(src, c); if (s < 5) continue;
        const dests = [...world.industries.filter(i => !i.dormant && i !== src && ((i.def.in && i.def.in[c] !== undefined))),
                       ...(TOWN_ACCEPTS.includes(c) ? towns : [])];
        for (const dst of dests) {
          const d = dist(src, dst); if (d < 350 || d > 1300) continue;
          const key = `${src.id}>${dst.id}:${c}`; if (has(key)) continue;
          const m = miles(src, dst), cap = CARGO[c].cap[wagon];
          const units = Math.min(s * 12 / fromN(src, c), this.trainTrips(loco, m) * W * cap, this.absorb(dst, c) / intoN(dst, c));
          out.push({ key, kind: 'freight', src, dst, c, wagon, consist: Array(W).fill(wagon), rev: units * this.payPerUnit(c, m) * this.priceFor(dst, c, units / 12 * intoN(dst, c)) * P.freightW, m });
        }
      }
    }
    // passengers between towns
    const coachW = Math.min(W, 4);
    for (const a of towns) for (const b of towns) {
      if (a.id >= b.id) continue;
      const d = dist(a, b); if (d < 400 || d > 1300) continue;
      const key = `${a.id}<>${b.id}:pax`; if (has(key)) continue;
      const m = miles(a, b), trips = this.trainTrips(loco, m), sh = Math.min(this.share(a), this.share(b));
      const consist = [...Array(coachW).fill('coach'), ...Array(W - coachW).fill('van')];
      const pax = Math.min((a.pop + b.pop) * ECON.paxPerPop * 12 * sh, trips * 2 * coachW * 40);
      const mail = Math.min((a.pop + b.pop) * ECON.mailPerPop * 12 * sh, trips * 2 * (W - coachW) * 150);
      out.push({ key, kind: 'pax', src: a, dst: b, c: 'passengers', consist, rev: (pax * this.payPerUnit('passengers', m) + mail * this.payPerUnit('mail', m)) * P.paxW, m });
    }
    if (this.useShips && g.water) {
      // packet steamers between river towns
      for (const a of towns) for (const b of towns) {
        if (a.id >= b.id) continue;
        const key = `${a.id}~${b.id}:shippax`; if (has(key)) continue;
        const sa = this.waterStationFor(a), sb = this.waterStationFor(b); if (!sa || !sb) continue;
        const path = g.water.path(this.berthOf(sa), this.berthOf(sb)); if (!path) { this.failed.add(key); continue; }
        const sh = this.bestShip('passengers'); if (!sh) continue;
        const m = miles(a, b), trips = this.shipYear(sh, path.length, 0), share = Math.min(this.share(a), this.share(b));
        const pax = Math.min((a.pop + b.pop) * ECON.paxPerPop * 12 * share, trips * 2 * this.holdsCap(sh.d, 'passengers'));
        const mail = Math.min((a.pop + b.pop) * ECON.mailPerPop * 12 * share, trips * 2 * (sh.d.holds.van || 0) * CARGO.mail.cap.van);
        out.push({ key, kind: 'ship-pax', src: a, dst: b, c: 'passengers', ship: sh.k, ws: [sa, sb], rev: (pax * this.payPerUnit('passengers', m) * 0.95 + mail * this.payPerUnit('mail', m) * 0.95) * P.paxW, m });
      }
      // freight between river industries / towns
      for (const src of world.industries) {
        if (src.dormant) continue;
        for (const c of Object.keys(src.def.out)) {
          const s = this.supply(src, c); if (s < 5) continue;
          const sh = this.bestShip(c); if (!sh) continue;
          const sa = this.waterStationFor(src); if (!sa) continue;
          const dests = [...world.industries.filter(i => !i.dormant && i !== src && i.def.in && i.def.in[c] !== undefined), ...(TOWN_ACCEPTS.includes(c) ? world.towns : [])];
          for (const dst of dests) {
            const d = dist(src, dst); if (d < 300 || d > 2400) continue;
            const key = `${src.id}~${dst.id}:${c}`; if (has(key)) continue;
            const sb = this.waterStationFor(dst); if (!sb) continue;
            const path = g.water.path(this.berthOf(sa), this.berthOf(sb)); if (!path) { this.failed.add(key); continue; }
            const m = miles(src, dst), trips = this.shipYear(sh, path.length, sh.d.fullLoad ? 10 : 0);
            const units = Math.min(s * 12 / fromN(src, c), trips * sh.cap, this.absorb(dst, c) / intoN(dst, c));
            out.push({ key, kind: 'ship-freight', src, dst, c, ship: sh.k, ws: [sa, sb], rev: units * this.payPerUnit(c, m) * this.priceIdx(dst, c) * 0.95 * P.freightW, m });
          }
        }
      }
    }
    return out;
  }

  tryBuild(cand) {
    const g = this.g, net = g.net, P = this.p;
    if (cand.kind.startsWith('ship')) {
      const [sa0, sb0] = cand.ws;
      const hcost = (s) => (s.planned || !s.harbor ? ECON.harborCost * g.infl() : 0) + (s.planned ? ECON.stationCost : 0);
      const invest = g.shipCost(cand.ship) + hcost(sa0) + hcost(sb0);
      if (cand.rev / invest < P.minRatio) return 'poor return';
      if (g.cash - invest < 30000) return 'cash';
      const sA = this.realize(sa0), sB = this.realize(sb0);
      if (typeof sA === 'string' || typeof sB === 'string') return 'station failed';
      this.waterCache.set(cand.src, sA); this.waterCache.set(cand.dst, sB);
      for (const s of [sA, sB]) if (!s.harbor) { const e = g.buildHarbor(s); if (e) return e; }
      const sh = g.buyShip(cand.ship, [sA, sB]);
      if (typeof sh === 'string') return sh;
      this.routes.push({ key: cand.key, kind: cand.kind, c: cand.c, a: sA, b: sB, src: cand.src, dst: cand.dst, trains: [sh], invest, built: g.year, est: cand.rev, ship: true });
      this.log(`${g.year}: ship route ${cand.key} (${cand.m.toFixed(1)} mi) ${cand.ship} est ${Math.round(cand.rev)}/yr invest ${Math.round(invest)}`);
      return null;
    }
    const loco = this.bestLoco();
    const sA0 = cand.sA || this.stationFor(cand.src, cand.dst), sB0 = this.stationFor(cand.dst, cand.src);
    if (!sA0 || !sB0) return 'no station site';
    const trainCost = g.locoCost(loco) + cand.consist.reduce((s, t) => s + g.wagonCost(t), 0);
    const stCost = (sA0.planned ? ECON.stationCost : 0) + (sB0.planned ? ECON.stationCost : 0);
    const guessTrack = dist(sA0, sB0) * ECON.trackPerUnit * 1.4; // straight-line guess
    const invest = trainCost + stCost + guessTrack;
    if (!cand.race && cand.rev / invest < P.minRatio) return 'poor return'; // (the race west is its own reward)
    if (g.cash - invest < 30000) return 'cash';
    // freight gets double track with signals so several trains can share it; passengers single
    const dbl = cand.kind === 'freight';
    const link = (a, b) => this.planLink(a, b, dbl) || (dbl ? this.planLink(a, b, false) : null);
    const existing = !sA0.planned && !sB0.planned ? net.route(sA0, sB0, g.trackRule(this.c, true)) : null;
    const needTrack = !existing || existing.length > 1;
    if (needTrack && !net.legacy) {
      // plan the track before building anything (stand-ins for stations not built yet), so a link that can't be
      // made (crossings, grades) costs nothing
      const stub = (s) => s.planned ? g.world.stationStub(s.x, s.z, s.angle) : s;
      const pre = link(stub(sA0), stub(sB0));
      if (!pre) return 'no track';
      if (g.cash - stCost - g.trackCost(pre) - trainCost < 0) return 'cash';
    }
    const sA = this.realize(sA0), sB = this.realize(sB0);
    if (typeof sA === 'string' || typeof sB === 'string') return 'station failed';
    let trackCost = 0;
    if (needTrack) {
      const pl = link(sA, sB);
      if (!pl) return 'no track';
      const tc = net.legacy ? pl.cost : g.trackCost(pl); // (pre-crossing games keep their old accounting)
      if (g.cash - tc - trainCost < 0) return 'cash';
      const e = g.buildTrack(pl); if (typeof e === 'string') return e;
      trackCost = tc;
      if (e.double) for (let d = 300; d < e.length - 300; d += 300) if (!g.addSignal(e, d)) trackCost += 6000;
    }
    const tr = g.buyTrain(loco.id, cand.consist, [sA, sB]);
    if (typeof tr === 'string') return tr;
    this.routes.push({ key: cand.key, kind: cand.kind, c: cand.c, a: sA, b: sB, src: cand.src, dst: cand.dst, trains: [tr], invest: trainCost + stCost + trackCost, built: g.year, est: cand.rev });
    this.log(`${g.year}: built ${cand.key} (${cand.m.toFixed(1)} mi) est ${Math.round(cand.rev)}/yr invest ${Math.round(trainCost + stCost + trackCost)}`);
    return null;
  }

  invest(q) {
    const g = this.g, world = g.world, P = this.p, casual = this.casual;
    if (casual && q % 4 !== 0) return;
    // 0) a route whose stations no longer serve its towns (a lost rate war) only loses money: sell its fleet
    for (const r of [...this.routes]) {
      if (covers(r.a, r.src) && (!r.dst || covers(r.b, r.dst))) continue;
      for (const v of r.trains) v.type === 'ship' ? g.sellShip(v) : v.type === 'plane' ? g.sellPlane(v) : g.sellTrain(v);
      this.routes = this.routes.filter(x => x !== r);
      this.log(`${g.year}: closed ${r.key} (lost its town)`);
    }
    // 0b) a line with more trains than it can pay for: sell one (they cost more to run than they earn)
    for (const r of this.routes) {
      if (r.kind !== 'freight' || r.trains.length < 2 || g.year - r.built < 3) continue;
      const t = r.trains[r.trains.length - 1];
      const pt = this.perTrain(r);
      if ((t.ageDays || 0) < 730 || pt === null) continue; // judge a train only after two full years
      if (pt < 1.3 * t.loco.upkeep * g.infl() && !g.sellTrain(t)) { r.trains.pop(); this.log(`${g.year}: sold a surplus train on ${r.key}`); }
    }
    // 1) more trains where the source station overflows
    for (const r of this.routes) {
      if (r.kind === 'ship-freight') {
        // another ship only if the source produces more than the fleet can carry (and at most 2)
        const sh0 = r.trains[0], cap = sh0.wagons.reduce((s, w) => s + (CARGO[r.c].cap[w.type] || 0), 0);
        const path = g.water.path(r.a.harbor.berth, r.b.harbor.berth);
        const perYear = cap * this.shipYear({ d: sh0.def }, path ? path.length : 2000, 10) * r.trains.length;
        if (r.trains.length >= 2 || this.supply(r.src, r.c) * 12 < perYear * 1.3 || g.cash < 300000) continue;
        const sh = g.buyShip(r.trains[0].kind, [r.a, r.b]);
        if (typeof sh !== 'string') { r.trains.push(sh); r.invest += sh.value; this.log(`${g.year}: extra ship on ${r.key}`); }
        continue;
      }
      if (r.kind !== 'freight' || r.trains.length >= 3) continue;
      if (g.year === r.built) continue; // (a new line's station is full of stock that built up before it opened)
      const pt = this.perTrain(r);
      if (pt !== null && pt < 2 * this.bestLoco().upkeep * g.infl()) continue; // the line doesn't pay for another train
      const st = r.a, c = r.c;
      // only if the line is not congested: existing trains must not be waiting much
      const congested = r.trains.some(t => (t.wait || 0) > 8) || !(r.trains[0].legs || []).every(l => l.edge.double);
      if (!congested && g.stored(st, c) > g.storageCap(st, c) * 0.9 && g.cash > 250000) {
        const loco = this.bestLoco(); const t0 = r.trains[0];
        const tr = g.buyTrain(loco.id, t0.wagons.map(w => w.type), [r.a, r.b]);
        if (typeof tr !== 'string') { r.trains.push(tr); r.invest += tr.value; this.log(`${g.year}: extra train on ${r.key}`); }
      }
    }
    // 1b) rate wars: another train on our lines into a town we are fighting for and losing
    for (const w of g.rateWars.list) {
      if (w.pending || ![w.a, w.b].includes(this.c.id) || g.rateWars.share(w, this.c.id) >= 0.6 || g.cash - this.committed() < 250000 * g.infl()) continue;
      const town = g.rateWars.town(w.town);
      const r = this.routes.find(r => r.kind === 'pax' && r.trains.length < 3 && (covers(r.a, town) || covers(r.b, town)));
      if (!r) continue;
      const tr = g.buyTrain(this.bestLoco().id, r.trains[0].wagons.map(x => x.type), [r.a, r.b]);
      if (typeof tr !== 'string') { r.trains.push(tr); r.invest += tr.value; this.log(`${g.year}: rate war in ${town.name}: extra train on ${r.key}`); }
    }
    // 2) warehouses where output is being lost
    if (!casual) for (const r of this.routes) {
      if ((r.kind !== 'freight' && r.kind !== 'ship-freight') || (r.a.warehouse || 0) >= 1) continue;
      const src = r.src, c = r.c, p = src.producedLastMonth[c] || 0, sh = src.transportedLastMonth[c] || 0;
      if (p > 0 && sh / p < 0.6 && g.cash > 300000) { if (!g.buildWarehouse(r.a)) { r.invest += ECON.warehouseCost[1]; this.log(`${g.year}: warehouse at ${r.a.name}`); } }
    }
    // 3) buy well-served industries that pay back in time
    if (!casual) for (const ind of world.industries) {
      if (ind.owner || ind.dormant || !ind.history || ind.history.length < 12) continue;
      if ((ind.stations || []).some(s => !this.own(s))) continue; // its income would only come from our own pickups
      const served = ind.history.reduce((a, b) => a + b, 0) / ind.history.length;
      if (served < 0.7) continue;
      const price = g.industryPrice(ind);
      const inc = Object.entries(ind.transportedLastMonth).reduce((s, [c, u]) => s + u * g.value(c), 0) * ECON.industryMargin * 12 - price * 0.048;
      if (inc > price / P.buyPayback && g.cash > price * 1.5) {
        if (!g.buyIndustry(ind)) { this.log(`${g.year}: bought ${ind.name} for ${price} (est ${Math.round(inc)}/yr)`); this.announce(`bought <b>${ind.name}</b>`); }
      }
    }
    // 4) new routes, best return on the money it needs (stations it lacks, track, train)
    if (q % P.every !== 0) return;
    const loco = this.bestLoco();
    const needSt = (t) => world.stations.some(s => this.own(s) && !s.depot && covers(s, t)) ? 0 : ECON.stationCost;
    const cands = this.candidates().map(c => {
      const est = c.kind.startsWith('ship')
        ? g.shipCost(c.ship) + c.ws.reduce((s, w) => s + (w.planned ? ECON.stationCost : 0) + (w.planned || !w.harbor ? ECON.harborCost * g.infl() : 0), 0)
        : needSt(c.src) + needSt(c.dst) + c.m * ECON.unitsPerMile * ECON.trackPerUnit * 1.4 + g.locoCost(loco) + c.consist.reduce((s, t) => s + g.wagonCost(t), 0);
      return { ...c, score: c.rev * this.calibration(c.kind) / est };
    }).sort((a, b) => b.score - a.score).slice(0, 12);
    let built = 0;
    const committed = this.committed();
    for (const c of cands) {
      if (g.cash - committed < 150000 * g.infl()) break;
      const err = this.tryBuild(c);
      if (err && err !== 'cash' && err !== 'station failed') this.failed.add(c.key);
      if (!err) {
        this.announce(c.kind.startsWith('ship') ? `opened a ship line ${c.src.name} → ${c.dst.name}` : `opened a line ${c.src.name} → ${c.dst.name}`);
        if (++built >= P.routesPerQ) break;
      }
    }
  }

  // cash promised to our open auction bids
  committed() { return this.g.auctions.open.reduce((s, a) => s + (a.bids[this.c.id] || 0), 0); }
  // revenue per train on a route last year
  // revenue per train last year, over the trains that ran all of last year (null: no evidence yet)
  perTrain(r) {
    const old = r.trains.filter(t => (t.ageDays || 0) >= 730);
    return old.length ? old.reduce((s, t) => s + (t.revenueLast || 0), 0) / old.length : null;
  }
  // how far our estimates for a kind of route have been off: actual revenue per train ÷ the estimate
  // (without the personality weight), over routes that have run a full year. 1 when there is no evidence yet.
  calibration(kind) {
    const g = this.g, w = kind.includes('pax') ? this.p.paxW : this.p.freightW;
    // prior: freight estimates run high (receivers saturate, rivals share the source), so start at 70%
    const prior = kind.includes('freight') ? 0.7 : 1, k = 2;
    const rs = this.routes.filter(r => r.kind === kind && g.year - r.built >= 2 && r.est > 0);
    const ev = rs.map(r => [r, this.perTrain(r)]).filter(([, pt]) => pt !== null);
    const sum = ev.reduce((s, [r, pt]) => s + Math.max(0.2, Math.min(1.5, pt / (r.est / w))), 0);
    return Math.max(0.35, Math.min(1.3, (prior * k + sum) / (k + ev.length)));
  }
  finances() {
    const g = this.g, f = this.c.fin;
    if (g.cash < 100000 && g.loan + ECON.loanStep <= ECON.maxLoan && g.year < this.startYear + this.p.borrowYears) g.borrow();
    if (g.cash > 1500000 && g.loan > 0) g.repay();
    // dividends: a share of earnings, reviewed every quarter (a subsidiary's parent sets its dividend)
    // (this also resets a dividend a former parent set once the company is independent again)
    if (!g.market.controller(this.c) && (this.p.payout > 0 || f.dividend > 0)) {
      const eps = f.eps(), target = this.p.payout > 0 && eps > 0 && g.cash > 200000 ? Math.floor(eps * this.p.payout * 100) / 100 : 0;
      if (Math.abs(target - f.dividend) > 0.05) f.setDividend(target);
    }
  }
  // rivals report big moves to the player
  announce(what) { if (this.c !== this.g.player) this.g.newsFor(null, `<b style="color:${this.c.color}">${this.c.name}</b> ${what}`); }

  // the stock market (phase C): merge companies it controls, buy into undervalued rivals,
  // take profits on stakes that are going nowhere. Never in Friendly games or as a subsidiary.
  market() {
    const g = this.g, M = g.market, c = this.c, lot = FIN.lot;
    if (c === g.player || !this.p.raid || g.competition === 'friendly') return;
    let C = M.control();
    if (M.controller(c, C)) return; // a subsidiary: its cash belongs to the parent's plans
    for (const t of g.rivals) if (t !== c && !M.canMerge(c, t, C)) {
      const err = M.merge(c, t);
      if (!err) { this.log(`${g.year}: merged ${t.name}`); return; }
    }
    const reserve = 400000 * g.infl() + c.fin.annualInterest(), spare = c.cash - reserve;
    let budget = spare * this.p.raid;
    const key = c.id;
    // rough cost of buying control of t (price impact included)
    const need = (t) => Math.max(0, 0.51 - M.share(key, t, C)) * t.fin.shares * t.fin.price * 1.3;
    // going for control: only with twice the money it needs to spare, and of a company under a third of its own size
    // (on the continent the leader's cash otherwise buys up every rival by the 1870s)
    const reach = (t) => this.p.raid >= 0.15 && t.fin.publicShares / t.fin.shares + M.share(key, t, C) > 0.51 && need(t) * 2 < spare
      && g.companyValue(t) < g.companyValue(c) / 3;
    const score = (t) => {
      const f = t.fin, mine = M.share(key, t, C), val = f.fundamental() / f.price;
      if (M.controller(t, C) === key || f.publicShares < lot) return -1;
      if (mine + f.publicShares / f.shares <= 0.5 && val < 1.3) return -1; // control is out of reach and it isn't cheap
      if (mine >= 0.3 && !reach(t)) return -1; // a stake, not a creeping takeover: control only when it qualifies (above)
      return val + mine * 3 + (reach(t) ? 1 : 0);
    };
    // take profits: a small stake well above its value
    for (const t of g.active) {
      if (t === c) continue;
      const f = t.fin, n = f.stakes[key] || 0;
      if (n && M.share(key, t, C) < 0.25 && f.price > 1.6 * f.fundamental()) { M.trade(key, t, -n); this.log(`${g.year}: sold out of ${t.name}`); }
    }
    if (spare < 50000 * g.infl()) return;
    const t = g.active.filter(t => t !== c).map(t => [t, score(t)]).filter(([, v]) => v >= 0.9).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!t) return;
    const before = M.share(key, t, C), all = reach(t);
    if (all) budget = spare; // control is within reach: go all in
    let bought = 0;
    for (let i = 0; i < (all ? 60 : 12); i++) {
      const q = M.quote(key, t, lot);
      if (!q || q.total > budget || q.after > 1.4 * t.fin.fundamental() && before < 0.4) break;
      if (M.trade(key, t, lot)) break;
      budget -= q.total; bought += lot;
    }
    if (!bought) return;
    C = M.control();
    const now = M.share(key, t, C);
    this.log(`${g.year}: bought ${bought} shares of ${t.name} → ${Math.round(now * 100)}%`);
    if (now >= 0.2 && before < 0.2) this.announce(`is buying into <b>${t === g.player ? 'your company' : t.name}</b> (${Math.round(now * 100)}%)`);
  }

  // ---------- auctions (phase D): sealed bids at what a lot is worth to this company ----------
  auctions() {
    const g = this.g, c = this.c, A = g.auctions;
    if (this.casual) return;
    let borrowed = false;
    for (const a of A.open) {
      if (a.seller === c.id || a.bids[c.id]) continue;
      const v = Math.round(this.worth(a) / 1000) * 1000;
      const free = () => c.cash - 150000 * g.infl() - A.open.reduce((s, x) => s + (x.bids[c.id] || 0), 0);
      const bond = FIN.bondSize * g.infl();
      if (!borrowed && free() < a.reserve && free() + bond >= a.reserve && v >= a.reserve * 1.3 && g.year < this.startYear + this.p.borrowYears) {
        borrowed = true; g.borrow(); // a lot well worth having: one bond, if the bank allows
      }
      const spare = free();
      const bid = Math.min(v, spare);
      if (bid >= a.reserve && !A.bid(a, c, bid)) this.log(`${g.year}: bid ${bid} for ${A.title(a)} (worth ${v})`);
    }
  }
  worth(a) {
    const g = this.g, P = this.p, L = this.c.history[this.c.history.length - 1] || this.c.ledger;
    if (a.kind === 'industry') {
      const ind = g.auctions.ind(a.ref), d = ind.def;
      // a processor only earns when supplied: count on 30% of capacity
      const perMonth = Object.entries(d.out).reduce((s, [k, q]) => s + q * (d.in ? d.cap * 0.3 : 1) * g.value(k), 0) * LEVEL_MUL[ind.level];
      const served = g.world.stations.some(s => this.own(s) && s.cov.inds.includes(ind));
      const inc = perMonth * 12 * ECON.industryMargin * (served ? 0.7 : 0.4) - g.industryPrice(ind) * 0.048;
      return Math.max(0, inc) * P.buyPayback * 0.8 * P.bidW;
    }
    // an invention: its yearly benefit over the years before everyone has it, discounted
    const rev = L.revenue || 0, up = L.trainUpkeep || 0, build = L.construction || 0;
    const perish = Object.entries(L.byCargo || {}).reduce((s, [k, v]) => s + (CARGO[k].perish ? v : 0), 0);
    const planes = g.vehiclesOf(this.c).some(v => v.type === 'plane');
    const yearly = { truss: build * 0.05, telegraph: rev * 0.03, airbrake: rev * 0.05, compound: up * 0.15, reefer: perish * 0.15, diesel: up * 0.2, jet: planes ? rev * 0.03 : 0 }[a.ref] || 0;
    return yearly * 4 * P.bidW;
  }

  // one quarter's decisions (acting for this company)
  tick(q) { this.g.as(this.c, () => { this.finances(); this.auctions(); this.invest(q); this.raceStep(q); this.market(); }); }

  // ---------- the race west (phase 4) ----------
  // A personality with `race` pushes a trunk line west from its Atlantic network, a town at a time, while the Golden
  // Spike is still to win: from the westernmost station it can reach, to a town 400–2600 m further west, with a
  // passenger train on each new stretch: one stretch every 2 / race quarters, from 1855.
  raceStep(q) {
    const g = this.g, R = g.race, P = this.p, I = g.infl();
    if (!R?.active || R.spike || !P.race || g.year < 1855 || q % Math.round(2 / P.race)) return;
    if (g.cash - this.committed() < 1200000 * I) return; // (a trunk west is built from spare money)
    const reached = R.reached(this.c).filter(s => !s.depot && s.cov.towns.length); // (a route's ends are towns)
    const towns = g.world.towns;
    let head = reached.length ? reached.reduce((a, b) => (b.x < a.x ? b : a)) : null, headTown;
    if (!head) { // first a station at the Atlantic port city furthest inland
      headTown = towns.filter(t => t.port === 'east').sort((a, b) => a.x - b.x)[0];
      if (!headTown) return;
    } else headTown = head.cov.towns.slice().sort((a, b) => b.pop - a.pop)[0];
    const from = head || headTown;
    const cands = towns.filter(t => t !== headTown && t.x < from.x - 250 && !this.failed.has(`race:${from.id}>${t.id}`) && !(head && reached.some(s => covers(s, t))))
      .map(t => ({ t, d: dist(from, t) })).filter(o => o.d >= 400 && o.d <= 2600)
      .map(o => ({ ...o, score: (from.x - o.t.x) / o.d + Math.min(0.3, o.t.pop / 20000) - (o.d > 1600 ? 0.15 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    for (const { t } of cands) {
      const err = this.tryBuild({ key: `${headTown.id}<>${t.id}:race`, kind: 'pax', race: true, src: headTown, dst: t, sA: head, c: 'passengers',
        consist: ['coach', 'coach', 'coach', 'van'].slice(0, Math.min(4, this.bestLoco().maxCars)), rev: 0, m: dist(from, t) / ECON.unitsPerMile });
      if (!err) { this.announce(`pushes its line west to <b>${t.name}</b>`); return; }
      if (err !== 'cash' && err !== 'station failed') this.failed.add(`race:${from.id}>${t.id}`); // (saved with the AI's memory)
      else return;
    }
  }
}
