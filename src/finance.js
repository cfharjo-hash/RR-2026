// Company finance and the chairman (phase A of COMPETITION_PLAN.md).
// The company has shares, a share price, bonds with a credit rating, and pays dividends.
// The player is the chairman: a separate person with their own cash and shares.
import { ECON } from './data.js';
import { clamp, money } from './util.js';

export const FIN = {
  shares: 100000,          // founding share count
  founderShare: 0.5,       // the chairman founds the company with half the shares
  lot: 1000,               // trading lot (1%)
  fee: 0.03,               // broker fee per trade
  impact: 0.6,             // price impact of trading the whole public float
  issuePct: 0.10,          // a share issue sells 10% new shares
  buybackPct: 0.05,        // a buyback retires 5% of shares
  bondSize: 250000,        // 1850 dollars, inflates
  baseRate: 0.05,          // bond interest before the credit spread
  maxLeverage: 0.6,        // bonds may not exceed this share of company assets
  salary: 1500,            // chairman's salary per month, 1850 dollars
  bonus: 0.01,             // + this share of yearly operating profit
  personalStart: 25000,
  bookWeight: 0.8, earningsMultiple: 8, dividendMultiple: 10, // fundamental share value
  convergence: 0.2,        // monthly pull of the price toward its fundamental value
};
export const RATINGS = ['C', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
const COSTS = ['trainUpkeep', 'shipUpkeep', 'planeUpkeep', 'trackUpkeep', 'warehouseUpkeep', 'industryUpkeep', 'interest', 'salary', 'trackageFees', 'truckUpkeep'];
// operating result of a ledger year (revenue + industry income - running costs)
export const opTotal = (l) => (l.revenue || 0) + (l.industryIncome || 0) + (l.trackageIncome || 0) - COSTS.reduce((s, k) => s + (l[k] || 0), 0);
const SPREAD = { C: 0.09, B: 0.055, BB: 0.035, BBB: 0.02, A: 0.012, AA: 0.006, AAA: 0.002 };
// financial panics (generic, history-inspired): year → share of market value lost
const PANICS = { 1857: -0.3, 1873: -0.4, 1893: -0.35, 1907: -0.3, 1929: -0.55 };

export class Finance {
  constructor(game, company, seed) {
    this.g = game; this.c = company;
    this.shares = FIN.shares;
    this.playerShares = Math.round(FIN.shares * FIN.founderShare);
    this.price = ECON.startCash / FIN.shares;      // $10 at the start: book value per share
    this.hist = [this.price];                       // monthly closing prices (last 120)
    this.personalCash = FIN.personalStart;
    this.dividend = 0;                              // $ per share per year, paid quarterly
    this.bonds = [];                                // { amount, rate, year }
    this.mood = 1;                                  // market mood: multiplies fundamental value; panics knock it down
    this.rngState = seed ?? 20261120;
    this.profitHist = [];                           // monthly operating profit, last 12
    this.divHist = [];                              // dividends paid per share, last 12 months
    this.snap = null;                               // ledger totals at the last month end
    this.passed = 0;                                // dividends skipped for lack of cash (hurts the rating for a year)
    this.lastIssueDay = -1e9;                       // share issues are limited to one per year
    this.stakes = {};                               // shares held by others: 'you' (the player in person) or a company id (market.js)
    this.lastMerge = -1e9; this.lastSpecial = 0;    // merger cooldown, one special dividend a year
    this.alert = 0;                                 // takeover warnings shown (1 = warning, 2 = defend prompt)
    this.margin = 0; this.shorts = {};              // the chairman's margin loan and short positions (phase E, market.js)
  }

  // seeded random numbers (state is saved, so loaded games continue identically)
  rng() {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- figures ----------
  get publicShares() { return Math.max(0, this.shares - this.playerShares - Object.values(this.stakes).reduce((a, b) => a + b, 0)); }
  get ownership() { return this.playerShares / this.shares; }
  debt() { return this.bonds.reduce((s, b) => s + b.amount, 0); }
  annualInterest() { return this.bonds.reduce((s, b) => s + b.amount * b.rate, 0); }
  bookValue() { return this.g.companyValue(this.c); }
  news(msg) { this.g.newsFor(this.c, msg); }
  marketCap() { return this.price * this.shares; }
  profit12() { return this.profitHist.reduce((a, b) => a + b, 0) * (12 / Math.max(1, this.profitHist.length)); }
  eps() { return this.profit12() / this.shares; }
  pe() { const e = this.eps(); return e > 0 ? this.price / e : null; }
  yieldPct() { return this.price > 0 ? this.dividend / this.price : 0; }
  netWorth() {
    const M = this.g.market, me = this.c === this.g.player;
    return this.personalCash + this.playerShares * this.price + (me ? M.stakeValue('you') - (this.margin || 0) - M.shortLiability() : 0);
  }
  rating() {
    const assets = Math.max(1, this.bookValue() + this.debt());
    const lev = this.debt() / assets, interest = this.annualInterest();
    const cover = interest > 0 ? this.profit12() / interest : 99;
    let s = 3;
    if (lev < 0.1) s += 2; else if (lev < 0.25) s += 1; else if (lev > 0.45) s -= 1;
    if (lev > 0.65) s -= 1;
    if (cover > 8) s += 1; else if (cover < 2) s -= 1;
    if (cover < 1) s -= 1;
    if (this.passed) s -= 1;
    return RATINGS[clamp(s, 0, RATINGS.length - 1)];
  }
  bondRate() { return FIN.baseRate + SPREAD[this.rating()]; }
  fundamental() {
    const bv = Math.max(0, this.bookValue());
    // dividends only add value up to what the company earns (paying out capital adds nothing)
    const div12 = Math.min(this.divHist.reduce((a, b) => a + b, 0), Math.max(0, this.eps()));
    return Math.max(0.25, (FIN.bookWeight * bv + FIN.earningsMultiple * Math.max(0, this.profit12())) / this.shares + FIN.dividendMultiple * div12);
  }

  // ---------- company actions ----------
  issueBond(auto = false) {
    const size = Math.round(FIN.bondSize * this.g.infl() / 1000) * 1000;
    const assets = Math.max(0, this.bookValue() + this.debt());
    if (this.debt() + size > Math.max(ECON.maxLoan * this.g.infl(), 0) || this.debt() + size > (assets + size) * FIN.maxLeverage) return 'No bank will lend more — credit limit reached';
    const rate = this.bondRate();
    this.bonds.push({ amount: size, rate, year: this.g.year });
    this.c.cash += size; this.sync();
    this.g.spend(size * rate / 12, 'interest', this.c); // the first month's interest is due at once
    this.news(`${auto ? '⚠ Emergency bond' : '🏦 Bond issued'}: ${money(size)} at ${(rate * 100).toFixed(1)}% (${this.rating()})`);
    this.g.emit('changed');
    return null;
  }
  repayBond() {
    if (!this.bonds.length) return 'No bonds outstanding';
    const b = this.bonds.reduce((m, x) => x.rate > m.rate ? x : m, this.bonds[0]); // dearest first
    if (this.c.cash < b.amount) return `Not enough cash (${money(b.amount)})`;
    this.c.cash -= b.amount; this.bonds = this.bonds.filter(x => x !== b); this.sync();
    this.news(`🏦 Bond of ${money(b.amount)} at ${(b.rate * 100).toFixed(1)}% repaid`);
    this.g.emit('changed');
    return null;
  }
  canIssue() { return this.g.day - this.lastIssueDay >= 365; }
  issueShares() {
    if (!this.canIssue()) return 'Investors allow only one share issue per year';
    const n = Math.round(this.shares * FIN.issuePct / FIN.lot) * FIN.lot;
    const proceeds = Math.round(n * this.price * (1 - FIN.fee - 0.05)); // 5% issue discount
    if (proceeds < 1000) return 'The share price is too low to raise money';
    // new price: the old market value plus the cash raised, spread over the larger share count
    this.price = (this.price * this.shares + proceeds) / (this.shares + n);
    this.shares += n; this.lastIssueDay = this.g.day;
    this.c.cash += proceeds; this.c.ledger.equity = (this.c.ledger.equity || 0) + proceeds;
    this.news(`📈 ${n.toLocaleString()} new shares issued, raising ${money(proceeds)} — your stake is now ${(this.ownership * 100).toFixed(0)}%`);
    this.g.emit('changed');
    return null;
  }
  buyBack() {
    const n = Math.min(Math.round(this.shares * FIN.buybackPct / FIN.lot) * FIN.lot, this.publicShares);
    if (n <= 0) return 'No shares in public hands to buy back';
    const cost = Math.round(n * this.price * (1 + FIN.fee + 0.03));
    if (this.c.cash - cost < 0) return `Not enough company cash (${money(cost)})`;
    this.c.cash -= cost; this.shares -= n; this.price *= 1.03;
    this.c.ledger.equity = (this.c.ledger.equity || 0) - cost;
    this.news(`📉 Bought back ${n.toLocaleString()} shares for ${money(cost)} — your stake is now ${(this.ownership * 100).toFixed(0)}%`);
    this.g.emit('changed');
    return null;
  }
  setDividend(perShare) {
    this.dividend = clamp(Math.round(perShare * 100) / 100, 0, 1000);
    if (this.dividend === 0) this.passed = 0;
    this.g.emit('changed');
  }

  // ---------- chairman trading (own company) ----------
  quote(n) { // average price and price after trading n shares (+ buy, - sell)
    // exponential impact over the total share count is path-independent:
    // selling then buying back returns to the same price, so only the fees are lost
    const x = FIN.impact * n / this.shares;
    const after = this.price * Math.exp(x);
    const avg = Math.abs(x) < 1e-9 ? this.price : this.price * (Math.exp(x) - 1) / x;
    return { avg, after };
  }
  buyShares(n) {
    n = Math.min(n, this.publicShares);
    if (n <= 0) return 'No shares available to buy';
    const q = this.quote(n), cost = Math.round(n * q.avg * (1 + FIN.fee));
    if (cost > this.personalCash) return `You need ${money(cost)} of your own money`;
    this.personalCash -= cost; this.playerShares += n; this.price = q.after;
    this.g.emit('changed');
    return null;
  }
  sellShares(n) {
    n = Math.min(n, this.playerShares);
    if (n <= 0) return 'You hold no shares to sell';
    const q = this.quote(-n), got = Math.round(n * q.avg * (1 - FIN.fee));
    this.personalCash += got; this.playerShares -= n; this.price = q.after;
    this.g.emit('changed');
    return null;
  }

  // ---------- monthly ----------
  monthly(month) {
    const g = this.g, c = this.c, L = c.ledger;
    // operating profit this month (ledger totals reset each new year)
    // the chairman's pay is a company cost
    const pay = FIN.salary * g.infl();
    g.spend(pay, 'salary', c); this.personalCash += pay;
    // (called before the New Year rollover, so the ledger is the year this month belongs to)
    const now = { year: L.year, total: opTotal(L) };
    const monthProfit = this.snap && this.snap.year === now.year ? now.total - this.snap.total : now.total;
    this.snap = now;
    this.profitHist.push(monthProfit); if (this.profitHist.length > 12) this.profitHist.shift();

    // dividends every quarter
    let paid = 0;
    if (month % 3 === 0 && this.dividend > 0) {
      const perShare = this.dividend / 4, totalDiv = perShare * this.shares;
      if (c.cash - totalDiv > 0) {
        c.cash -= totalDiv; L.dividends = (L.dividends || 0) + totalDiv;
        g.market.payout(c, perShare); paid = perShare; this.passed = 0;
      } else { this.passed++; this.mood -= 0.08; this.news('⚠ Not enough cash — the dividend was passed. The market is not pleased.'); }
    }
    this.divHist.push(paid); if (this.divHist.length > 12) this.divHist.shift();


    // share price: drifts toward fundamental value × market mood. Panics knock the mood down;
    // it recovers over a year or two, with a little monthly noise.
    if (month === 9 && PANICS[g.year]) {
      this.mood *= 1 + PANICS[g.year]; this.price *= 1 + PANICS[g.year] * 0.6;
      this.news(`📉 Financial panic of ${g.year}! Share prices collapse across the market.`);
    }
    this.mood = clamp(this.mood + (1 - this.mood) * 0.05 + (this.rng() - 0.5) * 0.03, 0.4, 1.4);
    const f = this.fundamental() * this.mood;
    this.price = Math.max(0.25, this.price + (f - this.price) * FIN.convergence);
    this.hist.push(Math.round(this.price * 100) / 100); if (this.hist.length > 120) this.hist.shift();

    // interest is charged by the game's monthly costs (annualInterest / 12); emergency credit if broke
    if (c.cash < -50000 * g.infl()) {
      if (this.issueBond(true)) this.emergencyIssue();
    }
  }
  // no credit left: the company sells new shares far below market to stay afloat
  emergencyIssue() {
    const g = this.g, c = this.c, need = -c.cash + 100000 * g.infl();
    const px = Math.max(0.25, this.price * 0.5);
    const n = Math.ceil(need / px / FIN.lot) * FIN.lot;
    this.shares += n; c.cash += n * px; c.ledger.equity = (c.ledger.equity || 0) + n * px;
    this.price = Math.max(0.25, this.price * 0.6); this.mood -= 0.15;
    this.emergencies = (this.emergencies || 0) + 1;
    this.news(`🚨 Bankruptcy averted: ${n.toLocaleString()} emergency shares sold at ${money(px)} — your stake falls to ${(this.ownership * 100).toFixed(0)}%`);
  }
  yearly() {
    const L = this.c.history[this.c.history.length - 1];
    if (!L) return;
    const op = opTotal(L);
    this.passed = Math.max(0, this.passed - 1);
    if (op > 0) { const b = op * FIN.bonus; this.g.spend(b, 'salary', this.c); this.personalCash += b; this.news(`💼 Chairman's bonus: ${money(b)}`); }
  }
  sync() { this.c.loan = this.debt(); }

  serialize() {
    const { g, c, ...rest } = this;
    return JSON.parse(JSON.stringify(rest));
  }
  load(d) { if (d) Object.assign(this, d); this.sync(); }
}
