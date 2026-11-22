// Stock market between companies (phase C of COMPETITION_PLAN.md): trading other companies'
// shares, control, subsidiaries, mergers and being taken over.
//
// Holders: 'you' (the player in person, paying from personal cash) and companies (paying from
// company cash). A company's founder holds `fin.playerShares` — the player for your company, the
// rival's baron for a rival (who votes with that company's board). Everyone else's holdings are in
// `fin.stakes[holder]`. Votes are counted by bloc: a company controlled by someone votes with them.
// Control = more than half of all shares.
import { FIN } from './finance.js';
import { money } from './util.js';

export const MARKET = {
  rivalFounder: 0.35,  // a rival's baron starts with this share of the company (you found yours with 50%)
  warn: 0.30,          // a rival bloc this big in your company: warning in the news
  defend: 0.40,        // … and this big: the defend prompt
  mergeFree: 0.75,     // holding this much, a merger needs no premium
  premium: 0.2,        // otherwise minority holders get this premium, paid in the acquirer's shares
  specialDiv: 0.5,     // a subsidiary may pay one special dividend a year, up to this share of its cash
  cooldown: 365,       // days between two mergers by the same company
  buyoutPremium: 0.3,  // a buyout pays this much over the higher of the share price and the value per share
  // phase E (the player in person)
  marginMax: 1,        // a broker lends up to 1× your equity
  marginRate: 0.08,    // yearly interest on margin loans
  marginCall: 0.3,     // equity below this share of your assets: margin call
  shortFee: 0.006,     // monthly fee for borrowing shares you sold short, × their value
  shortStop: 2,        // a short is bought back by force when the price doubles
  ownHaircut: 0.5,     // your own company's shares count for half as collateral
};

export class Market {
  constructor(game) { this.g = game; }

  founderKey(t) { return t === this.g.player ? 'you' : t.id; }
  keyOf(c) { return c === this.g.player ? 'you' : c.id; } // the bloc a company's own decisions belong to
  label(k) { return k === 'you' ? 'you' : this.g.comp(k).name; }

  // who controls whom: { ctrl: {companyId: bloc key or null}, votes: {companyId: {key: shares}} }
  control() {
    const g = this.g, cos = g.active, ctrl = {};
    let votes = {};
    const pid = g.player.id; // your company votes with you (until you are ousted)
    const top = (k) => {
      for (let i = 0; i < 6; i++) { if (k === 'you') return k; if (ctrl[k]) k = ctrl[k]; else return k === pid && !g.ousted ? 'you' : k; }
      return k;
    };
    for (let pass = 0; pass < 4; pass++) {
      votes = {};
      for (const t of cos) {
        const v = votes[t.id] = {}, f = t.fin;
        const fk = this.founderKey(t);
        v[fk] = (v[fk] || 0) + f.playerShares; // the founder (you, or the rival's baron) votes for the company's own board
        for (const [k, n] of Object.entries(f.stakes)) { const b = top(k) === t.id ? t.id : top(k); v[b] = (v[b] || 0) + n; }
      }
      let changed = false;
      for (const t of cos) {
        let best = null;
        for (const [k, n] of Object.entries(votes[t.id])) if (n > t.fin.shares / 2) best = k;
        if (best === t.id) best = null; // independent
        if (t === g.player && best === 'you') best = null;
        if (ctrl[t.id] !== best) { ctrl[t.id] = best; changed = true; }
      }
      if (!changed) break;
    }
    return { ctrl, votes, top };
  }
  // the share of company t voted by bloc k (0..1)
  share(k, t, C = this.control()) { return (C.votes[t.id]?.[k] || 0) / t.fin.shares; }
  controller(t, C = this.control()) { return C.ctrl[t.id] || null; }
  // the biggest bloc in t that isn't t's own board: [key, share]
  biggestOutsider(t, C = this.control()) {
    const own = t === this.g.player ? 'you' : t.id;
    let best = [null, 0];
    for (const [k, n] of Object.entries(C.votes[t.id] || {})) if (k !== own && n / t.fin.shares > best[1]) best = [k, n / t.fin.shares];
    return best;
  }

  // shares of t held directly by k
  held(k, t) { return k === 'you' && t === this.g.player ? t.fin.playerShares : t.fin.stakes[k] || 0; }
  purse(k) { return k === 'you' ? this.g.player.fin.personalCash : this.g.comp(k).cash; }
  pay(k, amt, field = 'investments') {
    if (k === 'you') { this.g.player.fin.personalCash += amt; return; }
    const c = this.g.comp(k); c.cash += amt; c.ledger[field] = (c.ledger[field] || 0) + amt;
  }
  // value of every stake a holder has in other companies
  stakeValue(k) { return this.g.active.reduce((s, t) => s + (t.fin.stakes[k] || 0) * this.refPrice(t), 0); }
  // a price that buying cannot pump: the lower of today's price and the average of the last 12 monthly closes
  refPrice(t) { const h = t.fin.hist.slice(-12); return Math.min(t.fin.price, h.reduce((a, b) => a + b, 0) / Math.max(1, h.length)); }

  // price of trading n shares of t (+ buy, - sell), fee included
  quote(k, t, n) {
    const f = t.fin;
    n = n > 0 ? Math.min(n, f.publicShares) : -Math.min(-n, this.held(k, t));
    if (!n) return null;
    const q = f.quote(n);
    return { n, total: Math.round(Math.abs(n) * q.avg * (1 + Math.sign(n) * FIN.fee)), after: q.after };
  }
  // holder k buys (n > 0) or sells (n < 0) shares of company t
  trade(k, t, n) {
    const g = this.g, f = t.fin;
    if (t.gone) return 'That company no longer exists';
    if (k === 'you' && t === g.player) return n > 0 ? f.buyShares(n) : f.sellShares(-n);
    if (k === t.id) return 'A company cannot trade its own shares — use a buyback';
    const q = this.quote(k, t, n);
    if (!q) return n > 0 ? 'No shares for sale — the public holds none' : 'None held';
    if (q.n > 0 && q.total > this.purse(k)) return `Not enough ${k === 'you' ? 'personal ' : ''}cash (${money(q.total)})`;
    this.pay(k, q.n > 0 ? -q.total : q.total);
    f.stakes[k] = (f.stakes[k] || 0) + q.n;
    if (f.stakes[k] <= 0) delete f.stakes[k];
    f.price = q.after;
    g.emit('changed');
    return null;
  }

  // ---------- subsidiaries ----------
  // the controller of a subsidiary can take one special dividend a year; it goes to every shareholder
  specialDividend(t, by) {
    const g = this.g, f = t.fin, C = this.control();
    if (this.controller(t, C) !== by) return `You need control of ${t.name} (over 50%)`;
    if (f.lastSpecial === g.year) return 'Only one special dividend a year';
    const amt = Math.floor(Math.max(0, t.cash) * MARKET.specialDiv / f.shares * 100) / 100 * f.shares;
    if (amt < 1000) return `${t.name} has no spare cash`;
    this.payout(t, amt / f.shares);
    t.cash -= amt; t.ledger.dividends = (t.ledger.dividends || 0) + amt; f.lastSpecial = g.year;
    // (a one-off: not in divHist, so it doesn't lift the share price like a regular dividend)
    g.newsFor(by === 'you' ? g.player : g.comp(by), `💰 Special dividend from ${t.name}: ${money(amt)} in total`);
    g.emit('changed');
    return null;
  }
  // the controller sets a subsidiary's regular dividend, up to what it earns per share
  setSubsidiaryDividend(t, by, perShare) {
    if (this.controller(t) !== by) return `You no longer control ${t.name}`;
    const cap = Math.max(0, Math.floor(t.fin.eps() * 100) / 100);
    t.fin.setDividend(Math.min(perShare, cap));
    return perShare > cap ? `Capped at its earnings: $${cap.toFixed(2)} per share` : null;
  }
  // pay perShare to every holder of t except the public (whose share simply leaves the company)
  payout(t, perShare) {
    const f = t.fin;
    if (t === this.g.player) this.g.player.fin.personalCash += perShare * f.playerShares;
    else f.personalCash += perShare * f.playerShares; // the rival's baron
    for (const [k, n] of Object.entries(f.stakes)) this.pay(k, perShare * n, 'shareIncome');
  }

  // ---------- mergers ----------
  canMerge(a, t, C = this.control()) {
    const g = this.g;
    if (!t || t.gone || a.gone || t === a) return 'Nothing to merge';
    if (t === g.player) return 'Your company cannot be merged away';
    if (this.controller(t, C) !== this.keyOf(a)) return `${a === g.player ? 'You need' : a.name + ' needs'} over 50% of ${t.name}`;
    if (g.day - (a.fin.lastMerge ?? -1e9) < MARKET.cooldown) return 'Only one merger a year';
    return null;
  }
  // new shares of a per share of t, and the premium paid
  mergeTerms(a, t, C = this.control()) {
    // priced off the reference price (the acquirer's own buying can't inflate it); the premium goes
    // only to holders outside the acquirer's bloc
    const prem = this.share(this.keyOf(a), t, C) >= MARKET.mergeFree ? 0 : MARKET.premium;
    return { prem, ratio: this.refPrice(t) / a.fin.price };
  }
  // a absorbs t: network, fleet, industries, cash and bonds; t's other shareholders get a's shares
  merge(a, t) {
    const g = this.g, C = this.control(), err = this.canMerge(a, t, C);
    if (err) return err;
    if (g.player.fin.shorts?.[t.id]) this.cover(t, Infinity, true); // shorts on t are settled before it disappears
    const fa = a.fin, ft = t.fin, { ratio, prem } = this.mergeTerms(a, t, C), mine = this.keyOf(a);
    const conv = (n, outside) => Math.round(n * ratio * (outside ? 1 + prem : 1));
    let issued = conv(ft.playerShares + ft.publicShares, true); // t's founder and the public get public shares of a
    for (const [k, n] of Object.entries(ft.stakes)) {
      if (k === a.id) continue;                           // a's own stake is cancelled
      const m = conv(n, C.top(k) !== mine); issued += m;
      if (k === 'you' && a === g.player) fa.playerShares += m;
      else fa.stakes[k] = (fa.stakes[k] || 0) + m;
    }
    fa.shares += issued;
    // t's stakes in other companies pass to a (shares of a itself are retired)
    for (const x of g.active) {
      const n = x.fin.stakes[t.id]; if (!n) continue;
      delete x.fin.stakes[t.id];
      if (x === a) fa.shares -= n; else x.fin.stakes[a.id] = (x.fin.stakes[a.id] || 0) + n;
    }
    a.cash += t.cash; fa.bonds.push(...ft.bonds); fa.sync();
    a.ledger.equity = (a.ledger.equity || 0); // (the merger moves no cash through the ledger)
    t.cash = 0; ft.bonds = []; ft.sync(); ft.shares = ft.playerShares = 0; ft.stakes = {}; ft.dividend = 0;
    t.gone = { into: a.id, year: g.year };
    fa.lastMerge = g.day;
    if (t.ai) { // the acquirer's AI takes over the routes t's AI was running
      const bt = g.brain(t);
      if (a.ai) g.brain(a).routes.push(...bt.routes);
      g.brains.delete(t.id); t.ai = { ...t.ai, mem: null };
    }
    g.as(a, () => g.log({ t: 'merge', b: t.id }));
    g.mergeAssets(t, a);
    const who = a === g.player ? 'You' : `<b style="color:${a.color}">${a.name}</b>`;
    g.newsFor(null, `🤝 ${who} merged <b>${t.name}</b> into ${a === g.player ? 'your company' : 'its company'}${prem ? ` (${Math.round(prem * 100)}% premium to minority holders)` : ''}${issued ? ` — ${issued.toLocaleString()} new shares issued` : ''}`);
    g.emit('changed');
    return null;
  }

  // ---------- buyout: a tender offer for every share outside the acquirer's bloc, then a merger ----------
  // The price is the higher of today's price and the company's value per share, plus MARKET.buyoutPremium;
  // every outside holder (the rival's baron, the public, other companies' stakes) sells at that price.
  buyoutTerms(a, t, C = this.control()) {
    const f = t.fin, mine = this.keyOf(a);
    // counted with the same test the payout uses (C.top), so counting and paying always agree
    const inside = Object.entries(f.stakes).reduce((s, [k, n]) => s + (k === a.id || C.top(k) === mine ? n : 0), 0);
    const outside = f.shares - inside;
    const px = Math.round(Math.max(f.price, f.fundamental()) * (1 + MARKET.buyoutPremium) * 100) / 100;
    return { outside, px, cost: Math.round(outside * px) };
  }
  canBuyout(a, t, C = this.control()) {
    const g = this.g;
    if (!t || t.gone || a.gone || t === a) return 'Nothing to buy';
    if (t === g.player) return 'Your company cannot be bought out';
    const ctl = this.controller(a, C);
    if (ctl && ctl === t.id) return `${t.name} controls ${a === g.player ? 'your company' : a.name}`;
    if (ctl || (a === g.player && g.ousted)) return `${a === g.player ? 'Your company' : a.name} is controlled by another company`; // (only a free company can buy out)
    if (g.day - (a.fin.lastMerge ?? -1e9) < MARKET.cooldown) return 'Only one merger a year';
    const { cost } = this.buyoutTerms(a, t, C);
    if (cost > a.cash) return `Needs ${money(cost)} of company cash`;
    return null;
  }
  buyout(a, t) {
    const g = this.g, C = this.control(), err = this.canBuyout(a, t, C);
    if (err) return err;
    const f = t.fin, mine = this.keyOf(a), { outside, px, cost } = this.buyoutTerms(a, t, C);
    // the rival's baron and every holder outside the bloc (other companies, you in person if outside) are paid out
    if (f.playerShares) { f.personalCash += f.playerShares * px; f.playerShares = 0; }
    for (const [k, n] of Object.entries(f.stakes)) if (k !== a.id && C.top(k) !== mine) { this.pay(k, n * px); delete f.stakes[k]; }
    f.stakes[a.id] = (f.stakes[a.id] || 0) + outside; // the public's shares, and everyone paid out above
    a.cash -= cost; a.ledger.investments = (a.ledger.investments || 0) - cost;
    f.price = Math.max(f.price, px);
    g.newsFor(null, `💼 ${a === g.player ? 'You' : `<b style="color:${a.color}">${a.name}</b>`} bought out <b>${t.name}</b> at $${px.toFixed(2)} a share — ${money(cost)}`);
    return this.merge(a, t);
  }

  // ---------- margin and short selling (phase E: the player in person) ----------
  // fin.margin: money borrowed from the broker; fin.shorts: { companyId: { n, price } } (shares sold short)
  // what the broker counts your shares as worth: the reference price (buying can't pump it), and only
  // half for your own company's shares (no borrowing against shares you pushed up yourself)
  holdingsValue() { const me = this.g.player; return me.fin.playerShares * this.refPrice(me) * MARKET.ownHaircut + this.g.active.reduce((s, t) => s + (t === me ? 0 : (t.fin.stakes.you || 0) * this.refPrice(t)), 0); }
  shortLiability() { const f = this.g.player.fin; return Object.entries(f.shorts || {}).reduce((s, [id, x]) => s + x.n * this.g.comp(id).fin.price, 0); }
  // assets (cash + shares), debts (margin + shares owed + any negative cash) and equity
  account() {
    const f = this.g.player.fin, assets = Math.max(0, f.personalCash) + this.holdingsValue();
    const debts = (f.margin || 0) + this.shortLiability() + Math.max(0, -f.personalCash);
    return { assets, debts, equity: assets - debts, ratio: assets > 0 ? (assets - debts) / assets : debts > 0 ? 0 : 1 };
  }
  marginLimit() { return Math.max(0, MARKET.marginMax * this.account().equity - (this.g.player.fin.margin || 0)); }
  borrowMargin(amount) {
    const g = this.g, f = g.player.fin;
    if (g.competition === 'friendly') return 'No margin loans in Friendly games';
    amount = Math.floor(amount / 1000) * 1000;
    if (amount <= 0) return 'Nothing to borrow';
    if (amount > this.marginLimit()) return `Your broker lends at most ${money(this.marginLimit())} more (1× your equity)`;
    f.margin = (f.margin || 0) + amount; f.personalCash += amount;
    g.emit('changed'); return null;
  }
  repayMargin(amount) {
    const g = this.g, f = g.player.fin, n = Math.min(amount, f.margin || 0, Math.max(0, f.personalCash));
    if (n <= 0) return f.margin ? 'No personal cash to repay with' : 'No margin loan';
    f.margin -= n; f.personalCash -= n;
    g.emit('changed'); return null;
  }
  // sell n shares of t short (Cut-throat games): you get the money now and owe the shares
  short(t, n) {
    const g = this.g, f = g.player.fin, ft = t.fin;
    if (g.competition !== 'cutthroat') return 'Short selling is only allowed in Cut-throat games';
    if (t === g.player || t.gone) return 'You cannot short that company';
    if (this.controller(t) === 'you') return 'You cannot short a company you control';
    const owed = (f.shorts?.[t.id]?.n || 0) + n;
    if (owed > ft.publicShares) return 'Not enough shares to borrow';
    const q = ft.quote(-n), got = Math.round(n * q.avg * (1 - FIN.fee));
    // collateral: what you owe on all shorts may not exceed your equity
    if (this.shortLiability() + n * ft.price > Math.max(0, this.account().equity)) return 'Not enough equity to cover the short (collateral)';
    f.shorts ||= {};
    const s = f.shorts[t.id] || { n: 0, price: 0 };
    f.shorts[t.id] = { n: s.n + n, price: (s.n * s.price + n * q.avg) / (s.n + n) };
    f.personalCash += got; ft.price = q.after;
    g.emit('changed'); return null;
  }
  cover(t, n = Infinity, forced = false) {
    const g = this.g, f = g.player.fin, s = f.shorts?.[t.id];
    if (!s) return 'No short position';
    n = Math.min(n, s.n);
    const q = t.fin.quote(n), cost = Math.round(n * q.avg * (1 + FIN.fee));
    if (!forced && cost > f.personalCash) return `You need ${money(cost)} of personal cash to buy the shares back`;
    f.personalCash -= cost; t.fin.price = q.after;
    s.n -= n; if (s.n <= 0) delete f.shorts[t.id];
    g.emit('changed'); return null;
  }
  // monthly: margin interest, short fees, stop-loss on shorts, margin calls
  personalMonthly() {
    const g = this.g, me = g.player, f = me.fin;
    if (f.margin > 0) f.personalCash -= f.margin * MARKET.marginRate / 12;
    for (const [id, s] of Object.entries(f.shorts || {})) {
      const t = g.comp(id);
      if (t.gone) { delete f.shorts[id]; continue; } // (settled when it merged)
      f.personalCash -= s.n * t.fin.price * MARKET.shortFee;
      if (t.fin.price >= s.price * MARKET.shortStop) {
        this.cover(t, Infinity, true);
        g.newsFor(me, `🚨 ${t.name} has doubled since you shorted it: your broker bought the shares back`);
      }
    }
    // margin call: equity below 30% of assets. The broker uses your cash to repay the loan and buy back
    // shorted shares, then sells rivals' shares, then your own company's — but never your controlling
    // half — until 40%. If that isn't enough, all shorts are bought back by force.
    let a = this.account();
    if (a.debts > 0 && a.ratio < MARKET.marginCall) {
      const sold = [];
      const settle = () => {
        const pay = Math.min(f.margin || 0, Math.max(0, f.personalCash)); f.margin -= pay; f.personalCash -= pay;
        for (const [id, s] of Object.entries(f.shorts || {})) {
          const t = g.comp(id), n = Math.min(s.n, Math.floor(Math.max(0, f.personalCash) / (t.fin.price * 1.2) / 100) * 100);
          if (n > 0) this.cover(t, n);
        }
      };
      const sellable = () => [...g.active.filter(t => t !== me && (t.fin.stakes.you || 0) > 0), ...(f.playerShares - FIN.lot > f.shares / 2 ? [me] : [])];
      settle(); a = this.account();
      for (let i = 0; i < 400 && a.debts > 0 && a.ratio < MARKET.marginCall + 0.1; i++) {
        const t = sellable()[0];
        if (!t) break;
        if (this.trade('you', t, -Math.min(FIN.lot, t === me ? f.playerShares : t.fin.stakes.you))) break;
        sold.push(t.name);
        settle(); a = this.account();
      }
      if (sold.length) g.newsFor(me, `🚨 Margin call! Your broker sold ${sold.length.toLocaleString()} lots of your shares (${[...new Set(sold)].join(', ')}) to cover your debts.`);
      if (a.debts > 0 && a.ratio < MARKET.marginCall && Object.keys(f.shorts || {}).length) {
        for (const id of Object.keys(f.shorts)) this.cover(g.comp(id), Infinity, true);
        g.newsFor(me, '🚨 Margin call: your broker bought back all your short positions.');
      }
    }
  }

  // ---------- monthly: warnings, the defend prompt, being ousted ----------
  monthly() {
    const g = this.g, me = g.player, f = me.fin;
    if (g.ousted) return;
    this.personalMonthly();
    const C = this.control(), by = this.controller(me, C);
    if (by && by !== 'you') {
      g.ousted = { by, year: g.year, day: g.day };
      g.as(me, () => g.emit('news', `🚨 <b>${g.comp(by).name}</b> has taken control of your company. You are out as chairman.`));
      g.as(me, () => g.emit('ousted', g.comp(by)));
      return;
    }
    const [k, s] = this.biggestOutsider(me, C);
    if (!k || k === 'you') { f.alert = 0; return; }
    if (s < MARKET.warn - 0.05) f.alert = 0;
    if (s >= MARKET.warn && f.alert < 1) {
      f.alert = 1;
      g.as(me, () => g.emit('news', `⚠ <b>${this.label(k)}</b> now holds ${Math.round(s * 100)}% of your company. Over 50% and you are out.`));
    }
    if (s >= MARKET.defend && f.alert < 2) { f.alert = 2; g.as(me, () => g.emit('defend', g.comp(k), s)); }
  }
}
