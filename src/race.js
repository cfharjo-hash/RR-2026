// The transcontinental race (CONTINENT_PLAN.md §4, phase 4). Pure simulation, owned by the Game; continent only.
// Each month, for every company: which of its stations its trains can reach from a station at an Atlantic port
// city (not the gulf: that is half-way west already), over its own track and lines opened to it (trackage rights), never through another company's
// station. Milestones go to the first company to reach them; the first to reach a Pacific port city drives the Golden
// Spike: a large prize and, for good, a bonus on its long-haul traffic.
import { ECON } from './data.js';
import { westOfGreatRiver } from './continent.js';
import { money } from './util.js';

export const RACE = {
  milestonePrize: 250000, // 1850 dollars (inflated when paid)
  spikePrize: 2500000,
  bonus: 0.25,            // the winner's extra pay on hauls of `bonusMiles` or more
  bonusMiles: 60,
};
export const MILESTONES = [
  { id: 'river', name: 'Across the great river', test: (W, st) => westOfGreatRiver(st.x / W.terrain.half, st.z / W.terrain.half) },
  { id: 'plains', name: 'Out on the Great Plains', test: (W, st) => W.terrain.regionAt(st.x, st.z) === 'plains' },
  { id: 'west', name: 'Into the mountain west', test: (W, st) => ['mountains', 'southwest'].includes(W.terrain.regionAt(st.x, st.z)) },
];

export class Race {
  constructor(game) {
    this.g = game;
    this.won = {};      // milestone id → { by, year }
    this.spike = null;  // { by, year, from, to }
    this.reach = {};    // company id → { west: furthest west reached (normalised u), n: stations reached }
    this.off = false;   // a continent game saved before the race: it plays on without one
  }
  get active() { return !!this.g.world.terrain.cont && !this.off; }
  serialize() { return JSON.parse(JSON.stringify({ won: this.won, spike: this.spike, reach: this.reach })); }
  load(d) { if (d) Object.assign(this, { won: d.won || {}, spike: d.spike || null, reach: d.reach || {} }); else this.off = true; }

  port(st, side) { return st.cov.towns.some(t => t.port === (side === 'atlantic' ? 'east' : side)); }
  // the stations company c can reach from its Atlantic-side ports
  reached(c) {
    const g = this.g, rule = g.trackRule(c), seen = new Set(), out = [];
    const queue = g.world.stations.filter(s => s.owner === c.id && !s.depot && this.port(s, 'atlantic'));
    for (const s of queue) seen.add(s);
    while (queue.length) {
      const n = queue.pop();
      if (n.type === 'station') out.push(n);
      if (n.type === 'station' && n.owner !== c.id) continue;
      for (const e of n.edges || []) {
        if (!rule.use(e)) continue;
        const m = e.a === n ? e.b : e.a;
        if (seen.has(m) || !rule.through(m)) continue;
        seen.add(m); queue.push(m);
      }
    }
    return out;
  }
  monthly() {
    if (!this.active) return;
    const g = this.g, W = g.world;
    for (const c of g.active) {
      const R = this.reached(c);
      this.reach[c.id] = { west: R.length ? Math.round(Math.min(...R.map(s => s.x)) / W.terrain.half * 1000) / 1000 : null, n: R.length };
      for (const M of MILESTONES) if (!this.won[M.id] && R.some(s => M.test(W, s))) this.award(c, M.id, M.name, RACE.milestonePrize);
      const pac = !this.spike && R.find(s => this.port(s, 'pacific'));
      if (pac) {
        const from = R.find(s => this.port(s, 'atlantic'));
        this.spike = { by: c.id, year: g.year, from: from?.name, to: pac.name };
        this.award(c, 'spike', `the Golden Spike: ${from?.name} to ${pac.name}, coast to coast`, RACE.spikePrize);
      }
    }
  }
  award(c, id, name, prize) {
    const g = this.g, amount = Math.round(prize * g.infl());
    if (id !== 'spike') this.won[id] = { by: c.id, year: g.year };
    c.cash += amount; c.ledger.prizes = (c.ledger.prizes || 0) + amount;
    const who = c === g.player ? 'You' : `<b style="color:${c.color}">${c.name}</b>`;
    g.emit('news', `${id === 'spike' ? '🏆' : '🚩'} ${who} ${id === 'spike' ? 'drove' : 'won'} ${id === 'spike' ? name : `“${name}”`} — prize ${money(amount)}${id === 'spike' ? `, and ${Math.round(RACE.bonus * 100)}% more on long hauls for good` : ''}`);
    g.emit('race', c, id);
  }
  // the winner's bonus on a delivery
  payMul(c, miles) { return this.spike && this.spike.by === c.id && miles >= RACE.bonusMiles ? 1 + RACE.bonus : 1; }
}
