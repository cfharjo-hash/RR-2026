// Rate wars (phase E, Cut-throat games only; COMPETITION_PLAN.md §2.7.2).
// When a company opens a station in a town another company already serves, a rate war starts
// between the newcomer and the town's main incumbent. For two years both earn 25% less on
// everything they carry from or to that town; the company that carried more (by value, before the
// cut) wins the town. The loser's stations there lose the town from their catchment (the station
// stays, for any industries it still covers), and the winner pays the loser a little compensation.
import { ECON } from './data.js';
import { money } from './util.js';

// compensation: × station cost per station lost, paid only to a loser that carried at least minShare;
// the loser may not serve the town again for barYears (new stations it builds there leave the town out).
// A war is declared by the newcomer's first delivery from or to the town (a station alone does nothing);
// a claim nobody acts on lapses after `days`.
// homeBonus: the town's incumbent counts its traffic × this (an attacker must clearly out-carry it)
export const RATEWAR = { days: 730, cut: 0.25, compensation: 0.5, minShare: 0.25, barYears: 10, homeBonus: 1.3 };

export class RateWars {
  constructor(game) { this.g = game; this.list = []; this.done = []; this.seq = 1; }
  serialize() { return JSON.parse(JSON.stringify({ list: this.list, done: this.done, seq: this.seq })); }
  load(d) { if (d) Object.assign(this, { list: d.list || [], done: d.done || [], seq: d.seq || 1 }); }

  town(id) { return this.g.world.towns.find(t => t.id === id); }
  at(town) { return this.list.find(w => w.town === town.id); }
  barred(town, c) { return this.done.some(r => r.town === town.id && r.loser === c.id && this.g.year < r.year + RATEWAR.barYears); }
  name(id) { const g = this.g; return id === g.player.id ? 'you' : g.comp(id).name; }

  // a station has just been built (not while a save is being rebuilt)
  onStation(st) {
    const g = this.g;
    if (g.competition !== 'cutthroat' || g.muted) return;
    for (const town of st.cov.towns) {
      if (this.at(town) || (town.stations || []).some(s => s.owner === st.owner && s !== st)) continue; // not a newcomer
      const count = {};
      for (const s of town.stations || []) if (s.owner !== st.owner) count[s.owner] = (count[s.owner] || 0) + 1;
      const order = (id) => g.companies.findIndex(c => c.id === id);
      const inc = Object.keys(count).sort((x, y) => count[y] - count[x] || order(x) - order(y))[0];
      if (inc) this.start(town, inc, st.owner);
    }
  }
  start(town, a, b) {
    const g = this.g;
    const w = { id: 'W' + this.seq++, town: town.id, a, b, start: g.day, end: g.day + RATEWAR.days, score: { [a]: 0, [b]: 0 }, pending: true };
    this.list.push(w);
    return w;
  }
  declare(w) {
    const g = this.g, town = this.town(w.town), a = w.a, b = w.b;
    Object.assign(w, { pending: false, start: g.day, end: g.day + RATEWAR.days });
    const you = [a, b].includes(g.player.id);
    g.newsFor(null, `⚔ Rate war in <b>${town.name}</b>: ${this.name(b)} vs ${this.name(a)}. For two years both earn ${RATEWAR.cut * 100}% less there; whoever carries more wins the town${you ? ' — the loser’s stations lose it' : ''}.`);
    g.emit('changed');
    return w;
  }

  // a delivery by company c: returns the pay multiplier and counts the full pay towards the war
  onDeliver(c, origin, dest, pay) {
    let mul = 1;
    for (const w of this.list) {
      if (w.a !== c.id && w.b !== c.id) continue;
      const t = this.town(w.town);
      if (!origin.cov.towns.includes(t) && !dest.cov.towns.includes(t)) continue;
      if (w.pending) { if (c.id !== w.b) continue; this.declare(w); } // the newcomer's first delivery there
      w.score[c.id] = (w.score[c.id] || 0) + pay * (c.id === w.a ? RATEWAR.homeBonus : 1); // the defender's traffic counts extra
      mul = 1 - RATEWAR.cut;
    }
    return mul;
  }
  share(w, id) { const tot = (w.score[w.a] || 0) + (w.score[w.b] || 0); return tot ? (w.score[id] || 0) / tot : 0.5; }

  monthly() {
    const g = this.g;
    for (const w of this.list.filter(w => w.end <= g.day)) {
      this.list = this.list.filter(x => x !== w);
      if (w.pending) continue; // the newcomer never delivered: the claim lapses
      const town = this.town(w.town);
      const winner = (w.score[w.b] || 0) > (w.score[w.a] || 0) ? w.b : w.a, loser = winner === w.a ? w.b : w.a; // ties: the incumbent keeps it
      const W = g.comp(winner), L = g.comp(loser);
      const lost = g.as(L, () => g.loseTown(town));
      const comp = this.share(w, loser) < RATEWAR.minShare ? 0 : Math.max(0, Math.min(Math.round(lost * ECON.stationCost * g.infl() * RATEWAR.compensation), W.cash));
      if (comp) { W.cash -= comp; L.cash += comp; }
      this.done.push({ id: w.id, town: w.town, winner, loser, year: g.year, share: Math.round(this.share(w, winner) * 100) });
      while (this.done.length > 200 || (this.done.length && this.done[0].year + RATEWAR.barYears < g.year - 5)) this.done.shift();
      g.newsFor(null, `⚔ ${winner === g.player.id ? '<b class="gold">You</b> won' : `<b style="color:${W.color}">${W.name}</b> won`} the rate war in <b>${town.name}</b> (${Math.round(this.share(w, winner) * 100)}% of the traffic). ${loser === g.player.id ? 'Your' : `${L.name}'s`} ${lost} station${lost === 1 ? '' : 's'} there lose${lost === 1 ? 's' : ''} the town${comp ? `; compensation ${money(comp)}` : ''}.`);
    }
  }
  // a merger: the absorbed company's wars pass to the acquirer (a war between the two just ends)
  merge(from, to) {
    for (const w of this.list) {
      if (w.a === from.id) w.a = to.id;
      if (w.b === from.id) w.b = to.id;
      if (w.score[from.id] !== undefined) { w.score[to.id] = (w.score[to.id] || 0) + w.score[from.id]; delete w.score[from.id]; }
    }
    this.list = this.list.filter(w => w.a !== w.b);
    for (const r of this.done) { if (r.loser === from.id) r.loser = to.id; if (r.winner === from.id) r.winner = to.id; } // bars pass on too
  }
}
