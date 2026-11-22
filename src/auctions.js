// Auctions (phase D of COMPETITION_PLAN.md): industries and inventions are sold by sealed bid.
// Every company may place one bid (and change or withdraw it) while an auction is open; when it
// closes, the highest bidder that can pay wins and pays the second-highest bid plus a step, never
// below the reserve (a second-price auction: bidding what it is really worth to you is safe).
//
// What is auctioned:
//  * an industry founded in a later era (unsold: it stays unowned and can be bought later at list price)
//  * an industry a company sells (unsold: the market takes it at the reserve, the old floor price)
//  * an invention when its year comes: the winner has it alone for AUCTION.patentYears, then everyone
//    does (unsold: everyone has it at once)
import { INVENTIONS, AUCTION, CARGO, FEATURES } from './data.js';
import { money } from './util.js';

export class Auctions {
  constructor(game) {
    this.g = game;
    this.open = [];    // { id, kind: 'industry'|'tech', ref, reserve, seller, opens, closes, bids: {companyId: $} }
    this.closed = [];  // recent results { id, kind, ref, winner, price, bids, year }
    this.techs = {};   // invention id → { holder: companyId|null, year, price }
    this.seq = 1;
  }
  serialize() { return JSON.parse(JSON.stringify({ open: this.open, closed: this.closed, techs: this.techs, seq: this.seq })); }
  load(d) {
    if (!d) return;
    Object.assign(this, { open: d.open || [], closed: d.closed || [], techs: d.techs || {}, seq: d.seq || 1 });
    for (const i of this.g.world.industries) i.auction = null;
    for (const a of this.open) if (a.kind === 'industry') { const i = this.ind(a.ref); if (i) i.auction = a.id; }
  }

  // a save from before auctions: inventions whose year has passed are free for all (no flood of auctions)
  grandfather() { for (const [id, d] of Object.entries(INVENTIONS)) if (d.year <= this.g.year && !this.techs[id]) this.techs[id] = { holder: null, year: this.g.year, price: 0 }; }
  ind(id) { return this.g.world.industries.find(i => i.id === id); }
  title(a) { return a.kind === 'tech' ? INVENTIONS[a.ref].name : (this.ind(a.ref)?.name || a.ref); }
  byId(id) { return this.open.find(a => a.id === id); }
  // does company c have invention id? (its own patent, an expired patent, or an unsold invention)
  has(id, c = this.g.co) {
    const t = this.techs[id];
    if (!t) return false;
    return !t.holder || this.g.year >= t.year + AUCTION.patentYears || t.holder === c.id;
  }
  exclusiveUntil(id) { const t = this.techs[id]; return t && t.holder ? t.year + AUCTION.patentYears : null; }

  start(kind, ref, reserve, seller = null) {
    const g = this.g;
    const a = { id: 'A' + this.seq++, kind, ref, reserve: Math.max(1000, Math.round(reserve / 1000) * 1000), seller, opens: g.day, closes: g.day + AUCTION.days, bids: {} };
    this.open.push(a);
    if (kind === 'industry') this.ind(ref).auction = a.id;
    const what = kind === 'tech' ? `the patent for <b>${INVENTIONS[ref].name}</b> (${INVENTIONS[ref].desc.toLowerCase()})` : `<b>${this.title(a)}</b>${seller ? ` (sold by ${seller === g.player.id ? 'you' : g.comp(seller).name})` : ', a newly founded industry'}`;
    g.newsFor(null, `🔨 Auction: ${what} — sealed bids until ${this.dateOf(a.closes)}, reserve ${money(a.reserve)}. Bid in Auctions (A).`);
    g.emit('changed');
    return a;
  }
  dateOf(day) { const d = new Date(1850, 0, 1); d.setDate(d.getDate() + Math.floor(day)); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }

  // company c bids amount (0 withdraws its bid)
  bid(a, c, amount) {
    if (!a || !this.open.includes(a)) return 'This auction has closed';
    if (c.gone) return 'No such company';
    if (a.seller === c.id) return 'You cannot bid in your own sale';
    amount = Math.round((amount || 0) / 1000) * 1000;
    if (amount <= 0) { delete a.bids[c.id]; this.g.emit('changed'); return null; }
    if (amount < a.reserve) return `The reserve is ${money(a.reserve)}`;
    if (amount > c.cash + 50000) return `Not enough cash to back a bid of ${money(amount)}`;
    a.bids[c.id] = amount;
    this.g.emit('changed');
    return null;
  }

  // ---------- monthly: new invention auctions, close the auctions that are due ----------
  monthly() {
    const g = this.g;
    for (const [id, d] of Object.entries(INVENTIONS))
      if (d.year <= g.year && !this.techs[id] && (id !== 'jet' || FEATURES.planes) && !this.open.some(a => a.kind === 'tech' && a.ref === id)) this.start('tech', id, d.reserve * g.infl());
    for (const a of this.open.filter(a => a.closes <= g.day)) this.close(a);
  }
  close(a) {
    const g = this.g;
    this.open = this.open.filter(x => x !== a);
    // highest first; ties go to the company listed first (the player, then rivals in order)
    const order = (id) => g.companies.findIndex(c => c.id === id);
    const bids = Object.entries(a.bids).filter(([id]) => !g.comp(id).gone && id !== a.seller)
      .sort((x, y) => y[1] - x[1] || order(x[0]) - order(y[0]));
    let winner = null, price = 0;
    for (let i = 0; i < bids.length; i++) {
      const c = g.comp(bids[i][0]);
      const p = Math.min(bids[i][1], Math.max(a.reserve, (bids[i + 1]?.[1] ?? 0) + AUCTION.step));
      if (c.cash - p >= -50000) { winner = c; price = p; break; }
      g.newsFor(c, `⚠ Your winning bid for ${this.title(a)} was void — not enough cash`);
    }
    const seller = a.seller ? g.comp(a.seller) : null;
    if (a.kind === 'tech') {
      this.techs[a.ref] = { holder: winner ? winner.id : null, year: g.year, price };
      if (winner) g.spend(price, 'patents', winner);
    } else {
      const ind = this.ind(a.ref);
      ind.auction = null;
      if (winner) {
        g.spend(price, 'industries', winner);
        Object.assign(ind, { owner: winner.id, incomeYear: 0, incomeMonth: 0, incomeAcc: 0, paid: price });
      } else if (seller) ind.owner = null; // the market buys it at the reserve
      if (seller) { const got = winner ? price : a.reserve; seller.cash += got; seller.ledger.assetSales = (seller.ledger.assetSales || 0) + got; }
    }
    this.closed.push({ id: a.id, kind: a.kind, ref: a.ref, winner: winner ? winner.id : null, price, bids: bids.length, year: g.year, seller: a.seller, mine: a.bids[g.player.id] || 0 });
    if (this.closed.length > 20) this.closed.shift();
    const who = (c) => c === g.player ? '<b class="gold">You</b>' : `<b style="color:${c.color}">${c.name}</b>`;
    const what = a.kind === 'tech' ? `the ${INVENTIONS[a.ref].name} patent` : `<b>${this.title(a)}</b>`;
    g.newsFor(null, winner ? `🔨 ${who(winner)} won ${what} for ${money(price)} (${bids.length} bid${bids.length > 1 ? 's' : ''})`
      : a.kind === 'tech' ? `🔨 No bids for the ${INVENTIONS[a.ref].name} patent — every company may use it` : `🔨 No bids for ${what}${seller ? ` — the market bought it for ${money(a.reserve)}` : ''}`);
    g.emit('changed');
  }

  // a merger: patents, bids and sales of `from` pass to `to`
  merge(from, to) {
    for (const t of Object.values(this.techs)) if (t.holder === from.id) t.holder = to.id;
    for (const a of this.open) {
      if (a.seller === from.id) a.seller = to.id;
      const b = a.bids[from.id]; delete a.bids[from.id];
      if (b && to.id !== a.seller) a.bids[to.id] = Math.max(a.bids[to.id] || 0, b);
    }
  }
  // perishable goods (for the refrigeration patent's description)
  static perishables() { return Object.keys(CARGO).filter(c => CARGO[c].perish); }
}
