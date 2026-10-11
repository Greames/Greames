/* RasoiNet front-end: a small hash-routed SPA with no build step. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = (n) => `₹${nf0.format(Math.round(n || 0))}`;
const inr2 = (n) => `₹${nf2.format(n || 0)}`;
const num = (n, d = 0) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(n || 0);
const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
// Lakh / crore shorthand used across Indian business reporting.
function inrShort(n) {
  const a = Math.abs(n || 0);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} K`;
  return `${sign}₹${Math.round(a)}`;
}
const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', opts);
const weekdayShort = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const state = { meta: null, outlet: 'all', from: null, to: null, month: null, tab: {} };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const qs = (extra = {}) => new URLSearchParams({ outlet: state.outlet, from: state.from, to: state.to, month: state.month, ...extra }).toString();

function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${error ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}

function openModal(html) {
  $('#modalBody').innerHTML = html;
  const m = $('#modal');
  if (!m.open) m.showModal();
}
const closeModal = () => $('#modal').close();
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

// Tooltips: any element with data-tip shows it on hover / focus.
const tip = $('#tooltip');
function showTip(el, x, y) {
  tip.innerHTML = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  $$('.mark.hover').forEach((m) => m.classList.remove('hover'));
  if (!el) { tip.hidden = true; return; }
  if (el.dataset.mark) $(`#${el.dataset.mark}`)?.classList.add('hover');
  showTip(el, e.clientX, e.clientY);
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); }
});
document.addEventListener('focusout', () => { tip.hidden = true; });

/* ---------- Charts ---------- */

// Vertical bar chart: one series, rounded data-ends, recessive grid, hover tooltips.
let chartSeq = 0;
function barChart(data, { label, value, tipFn, width = 720, height = 220, labelEvery = 1 }) {
  if (!data.length) return '<div class="empty">No data for this period</div>';
  const id = `c${++chartSeq}`;
  // Narrow screens get a narrower viewBox so axis labels stay legible.
  const W = window.innerWidth < 600 ? Math.min(width, 380) : width; const H = height; const pad = { l: 56, r: 8, t: 10, b: 26 };
  const max = Math.max(...data.map(value)) || 1;
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const bw = iw / data.length;
  const gap = Math.min(6, Math.max(2, bw * 0.25));
  const y = (v) => pad.t + ih - (v / top) * ih;
  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${inrShort(v).replace('₹', '')}</text>`;
  }
  data.forEach((d, i) => {
    const v = value(d);
    const x = pad.l + i * bw + gap / 2;
    const w = Math.max(1, bw - gap);
    const h = Math.max(0, (v / top) * ih);
    const r = Math.min(4, w / 2, h);
    const yb = pad.t + ih;
    svg += `<path id="${id}-${i}" class="mark" d="M${x},${yb} V${yb - h + r} Q${x},${yb - h} ${x + r},${yb - h} H${x + w - r} Q${x + w},${yb - h} ${x + w},${yb - h + r} V${yb} Z"/>`;
    svg += `<rect class="hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}" data-mark="${id}-${i}" data-tip="${esc(tipFn(d))}"/>`;
    if (i % labelEvery === 0) svg += `<text class="axis-label" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(label(d))}</text>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${svg}</svg></div>`;
}
// Every hour of service, so quiet hours show as gaps rather than disappearing.
function fillHours(rows) {
  const by = Object.fromEntries(rows.map((r) => [r.hour, r]));
  const lo = Math.min(11, ...rows.map((r) => r.hour));
  const hi = Math.max(23, ...rows.map((r) => r.hour));
  return Array.from({ length: hi - lo + 1 }, (_, i) => by[lo + i] || { hour: lo + i, netSales: 0, orders: 0 });
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
// Horizontal bars for category shares; labels and values are text, the bar only carries magnitude.
function hbars(rows, { label, value, display }) {
  const max = Math.max(...rows.map(value), 1);
  const total = rows.reduce((s, r) => s + value(r), 0) || 1;
  return `<div class="bars">${rows.map((r) => `<div class="bar-row"><span>${esc(label(r))}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${(value(r) / max) * 100}%"></div></div>
    <span class="num">${display(r)} · ${((value(r) / total) * 100).toFixed(1)}%</span></div>`).join('')}</div>`;
}

function table(cols, rows, { foot, empty = 'Nothing to show' } = {}) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  const th = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('');
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.v(r)}</td>`).join('')}</tr>`).join('');
  const tf = foot ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.num ? 'num' : ''}">${foot[i] ?? ''}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${tf}</table></div>`;
}
const card = (title, body, { sub = '', actions = '' } = {}) => `<section class="card"><div class="card-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${actions}</div>${body}</section>`;
const kpi = (label, value, sub = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const vegMark = (veg) => `<span class="veg-mark${veg ? '' : ' non'}" title="${veg ? 'Veg' : 'Non-veg'}" aria-label="${veg ? 'Veg' : 'Non-veg'}"></span>`;
const statusBadge = (s) => ({ expired: '<span class="badge bad">✕ Expired</span>', due: '<span class="badge warn">! Due ≤30 days</span>', upcoming: '<span class="badge info">◷ ≤90 days</span>', valid: '<span class="badge good">✓ Valid</span>' }[s]);
const outletName = (id) => state.meta.outlets.find((o) => o.id === Number(id))?.name || '';
function tabs(key, list) {
  const cur = state.tab[key] || list[0][0];
  return { cur, html: `<div class="tabs" role="tablist">${list.map(([k, l]) => `<button role="tab" data-tab="${key}:${k}" class="${k === cur ? 'active' : ''}" aria-selected="${k === cur}">${l}</button>`).join('')}</div>` };
}
// Views that work on one outlet fall back to the first outlet when "All outlets" is selected.
const singleOutlet = () => (state.outlet === 'all' ? state.meta.outlets[0].id : Number(state.outlet));
const singleOutletNote = () => (state.outlet === 'all' ? `<div class="callout">Showing <strong>${esc(state.meta.outlets[0].name)}</strong>. Pick an outlet above to switch.</div>` : '');

/* ---------- Views ---------- */

const views = {};

views.dashboard = {
  title: 'Dashboard', filters: 'range',
  async render() {
    const d = await api(`/api/dashboard?${qs()}`);
    const k = d.kpis;
    const change = k.salesChangePct === null ? '' : `<span class="${k.salesChangePct >= 0 ? 'delta-up' : 'delta-down'}">${k.salesChangePct >= 0 ? '▲' : '▼'} ${Math.abs(k.salesChangePct).toFixed(1)}%</span> vs previous ${d.days} days`;
    const status = (v, good, warn) => (v <= good ? 'good' : v <= warn ? 'warn' : 'bad');
    const flag = (v, good, warn) => { const s = status(v, good, warn); return `<span class="badge ${s}">${s === 'good' ? '✓ On target' : s === 'warn' ? '! Watch' : '✕ Over target'}</span>`; };
    return `
      <div class="kpis">
        ${kpi('Net sales', inrShort(k.netSales), change)}
        ${kpi('Orders', num(k.orders), `Avg ticket ${inr(k.avgTicket)}`)}
        ${kpi('Dine-in covers', num(k.covers), `${inr(k.perCover)} per cover`)}
        ${kpi('Food cost (theoretical)', pct(k.foodCostPct), `${inrShort(k.foodCost)} · ${flag(k.foodCostPct, 32, 36)}`)}
        ${kpi('Labour cost', pct(k.labourPct), `${inrShort(k.labourCost)} · ${flag(k.labourPct, 18, 24)}`)}
        ${kpi('Prime cost', pct(k.primeCostPct), `Food + labour · ${flag(k.primeCostPct, 55, 62)}`)}
        ${kpi('Aggregator fees', pct(k.aggregatorFeesPct), `${inrShort(k.aggregatorFees)} incl. 18% GST`)}
        ${kpi('GST collected', inrShort(k.gstCollected), `+ ${inrShort(k.ecoGst)} paid by aggregators u/s 9(5)`)}
      </div>
      <div class="grid cols-2-1">
        ${card('Daily net sales', barChart(d.daily, { label: (r) => fmtDate(r.date, { day: 'numeric' }), value: (r) => r.netSales, labelEvery: Math.ceil(d.daily.length / 15),
          tipFn: (r) => `<strong>${fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</strong><br>${inr(r.netSales)} · ${num(r.orders)} orders` }), { sub: 'Taxable value after discounts, excluding GST' })}
        ${card('Sales by channel', hbars(d.byChannel, { label: (r) => r.channel, value: (r) => r.netSales, display: (r) => inrShort(r.netSales) }), { sub: 'Dine-in, takeaway and aggregator apps' })}
      </div>
      <div class="grid cols-3">
        ${card('Payment modes', hbars(d.byPayment, { label: (r) => r.payment_mode, value: (r) => r.amount, display: (r) => inrShort(r.amount) }), { sub: 'Collected amount incl. GST' })}
        ${card('Sales by hour', barChart(fillHours(d.byHour), { label: (r) => `${r.hour}`, value: (r) => r.netSales, width: 360, height: 200, labelEvery: 2, tipFn: (r) => `<strong>${r.hour}:00–${r.hour + 1}:00</strong><br>${inr(r.netSales)} · ${num(r.orders)} orders` }), { sub: 'Lunch and dinner peaks' })}
        ${card('Top items', table([
          { h: 'Item', v: (r) => esc(r.name) }, { h: 'Qty', num: 1, v: (r) => num(r.qty) }, { h: 'Revenue', num: 1, v: (r) => inrShort(r.revenue) },
        ], d.topItems))}
      </div>
      ${card('Outlet comparison', table([
        { h: 'Outlet', v: (r) => `<strong>${esc(r.name)}</strong> <span class="muted">${esc(r.city)}</span>` },
        { h: 'Net sales', num: 1, v: (r) => inr(r.netSales) }, { h: 'Orders', num: 1, v: (r) => num(r.orders) },
        { h: 'Avg ticket', num: 1, v: (r) => inr(r.avgTicket) }, { h: 'Covers', num: 1, v: (r) => num(r.covers) },
        { h: 'Food %', num: 1, v: (r) => pct(r.foodCostPct) }, { h: 'Labour %', num: 1, v: (r) => pct(r.labourPct) },
        { h: 'Prime %', num: 1, v: (r) => `${pct(r.primeCostPct)} ${flag(r.primeCostPct, 55, 62)}` },
      ], d.byOutlet), { sub: 'Targets: food ≤32%, labour ≤18%, prime cost ≤55%' })}
      ${card('Aggregator settlements', table([
        { h: 'Channel', v: (r) => esc(r.channel) }, { h: 'Orders', num: 1, v: (r) => num(r.orders) }, { h: 'Gross sales', num: 1, v: (r) => inr(r.gross) },
        { h: 'Commission', num: 1, v: (r) => `${inr(r.commission)} <span class="muted">(${r.commissionPct}%)</span>` }, { h: 'GST on commission', num: 1, v: (r) => inr(r.commissionGst) },
        { h: 'TDS 194-O', num: 1, v: (r) => inr(r.tds) }, { h: 'Net payout', num: 1, v: (r) => `<strong>${inr(r.net)}</strong>` },
      ], d.aggregators.byChannel, { foot: ['Total', '', inr(d.aggregators.gross), inr(d.aggregators.commission), inr(d.aggregators.commissionGst), inr(d.aggregators.tds), inr(d.aggregators.net)] }),
      { sub: 'Expected payout after commission, 18% GST on commission and 0.1% TDS under Section 194-O' })}`;
  },
};

views.sales = {
  title: 'Sales', filters: 'range',
  async render() {
    const t = tabs('sales', [['daily', 'Daily sales report'], ['orders', 'Invoices']]);
    if (t.cur === 'orders') {
      const orders = await api(`/api/orders?${qs({ limit: 200 })}`);
      return t.html + card('Invoices', table([
        { h: 'Invoice no.', v: (r) => `<button class="btn link" data-invoice="${r.id}">${esc(r.invoice_no)}</button>` },
        { h: 'Date', v: (r) => `${fmtDate(r.date)} ${esc(r.time)}` }, { h: 'Outlet', v: (r) => esc(r.outlet) }, { h: 'Channel', v: (r) => esc(r.channel) },
        { h: 'Payment', v: (r) => esc(r.payment_mode) }, { h: 'Taxable', num: 1, v: (r) => inr2(r.taxable) },
        { h: 'CGST + SGST', num: 1, v: (r) => (r.gst_by_eco ? '<span class="muted">by aggregator</span>' : inr2(r.cgst + r.sgst)) }, { h: 'Total', num: 1, v: (r) => inr(r.total) },
      ], orders), { sub: 'Latest 200 invoices in the selected range' });
    }
    const d = await api(`/api/sales/daily?${qs()}`);
    const byDate = {};
    d.rows.forEach((r) => { (byDate[r.date] ||= { date: r.date, ch: {}, net: 0, cgst: 0, sgst: 0, eco: 0, collected: 0, discount: 0, orders: 0, covers: 0, pay: {} }); const x = byDate[r.date];
      x.ch[r.channel] = r.net; x.net += r.net; x.cgst += r.cgst; x.sgst += r.sgst; x.eco += r.ecoGst; x.collected += r.collected; x.discount += r.discount; x.orders += r.orders; x.covers += r.covers; });
    d.payments.forEach((p) => { if (byDate[p.date]) byDate[p.date].pay[p.payment_mode] = p.amount; });
    const rows = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
    const chans = d.channels.map((c) => c.name);
    const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
    const cols = [
      { h: 'Date', v: (r) => `${fmtDate(r.date)} <span class="muted">${weekdayShort(r.date)}</span>` },
      ...chans.map((c) => ({ h: c, num: 1, v: (r) => inr(r.ch[c] || 0) })),
      { h: 'Net sales', num: 1, v: (r) => `<strong>${inr(r.net)}</strong>` }, { h: 'Discounts', num: 1, v: (r) => inr(r.discount) },
      { h: 'CGST', num: 1, v: (r) => inr2(r.cgst) }, { h: 'SGST', num: 1, v: (r) => inr2(r.sgst) },
      { h: 'Orders', num: 1, v: (r) => num(r.orders) }, { h: 'Covers', num: 1, v: (r) => num(r.covers) },
      { h: 'UPI', num: 1, v: (r) => inr(r.pay.UPI) }, { h: 'Card', num: 1, v: (r) => inr(r.pay.Card) }, { h: 'Cash', num: 1, v: (r) => inr(r.pay.Cash) },
    ];
    const foot = ['Total', ...chans.map((c) => inr(sum((r) => r.ch[c] || 0))), inr(sum((r) => r.net)), inr(sum((r) => r.discount)), inr2(sum((r) => r.cgst)), inr2(sum((r) => r.sgst)),
      num(sum((r) => r.orders)), num(sum((r) => r.covers)), inr(sum((r) => r.pay.UPI || 0)), inr(sum((r) => r.pay.Card || 0)), inr(sum((r) => r.pay.Cash || 0))];
    return t.html + card('Daily sales report', table(cols, rows, { foot }), { sub: 'Net sales by channel and collections by payment mode. Use this to reconcile the cash drawer, UPI settlements and card batches.' });
  },
};

async function showInvoice(id) {
  const o = await api(`/api/orders/${id}`);
  const ou = o.outlet;
  const eco = o.gst_by_eco;
  openModal(`<div class="modal-inner"><div class="invoice">
    <header><h2>${esc(`${state.meta.brand} · ${ou.name}`)}</h2><div>${esc(ou.address)}</div>
      <div>GSTIN: <strong>${esc(ou.gstin)}</strong> · FSSAI Lic. No. ${esc(ou.fssai_no)}</div>
      <div style="margin-top:6px;font-weight:600">${eco ? 'ORDER SUMMARY (tax invoice issued by e-commerce operator)' : ou.gst_scheme === 'composition' ? 'BILL OF SUPPLY' : 'TAX INVOICE'}</div></header>
    <div class="meta"><div>Invoice no.: <strong>${esc(o.invoice_no)}</strong></div><div>Date: ${fmtDate(o.date, { day: '2-digit', month: 'short', year: 'numeric' })} ${esc(o.time)}</div>
      <div>Channel: ${esc(o.channel)}</div><div>Payment: ${esc(o.payment_mode)}</div><div>Place of supply: ${esc(state.meta.states[ou.state_code]?.name || ou.state)} (${esc(ou.state_code)})</div><div>SAC: ${esc(o.sac)}</div></div>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
      ${o.lines.map((l) => `<tr><td>${vegMark(l.veg)}${esc(l.name)}</td><td class="num">${l.qty}</td><td class="num">${inr2(l.price)}</td><td class="num">${inr2(l.qty * l.price)}</td></tr>`).join('')}
    </tbody></table>
    <div class="totals">
      <span>Subtotal</span><span class="num">${inr2(o.subtotal)}</span>
      ${o.discount ? `<span>Discount</span><span class="num">− ${inr2(o.discount)}</span>` : ''}
      <span>Taxable value</span><span class="num">${inr2(o.taxable)}</span>
      ${eco ? `<span>GST 5% (paid by ${esc(o.channel)} u/s 9(5))</span><span class="num">${inr2(o.eco_gst)}</span>`
        : `<span>CGST @ 2.5%</span><span class="num">${inr2(o.cgst)}</span><span>SGST @ 2.5%</span><span class="num">${inr2(o.sgst)}</span>`}
      ${o.round_off ? `<span>Round off</span><span class="num">${inr2(o.round_off)}</span>` : ''}
      <span class="grand">Total</span><span class="num grand">${inr(eco ? o.total + o.eco_gst : o.total)}</span>
    </div>
    <footer>Restaurant service · GST @ 5% without input tax credit${o.covers ? ` · ${o.covers} guests` : ''}<br>Thank you! Please visit again.</footer>
  </div><div class="row no-print"><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" onclick="window.print()">Print</button></div></div>`);
}

views.billing = {
  title: 'Billing (POS)', filters: 'none',
  cart: new Map(),
  async render() {
    const menu = (this.menu ||= await api('/api/menu'));
    const cats = [...new Set(menu.filter((m) => m.active).map((m) => m.category))];
    const outlet = state.meta.outlets.find((o) => o.id === singleOutlet());
    return `${singleOutletNote()}<div class="pos">
      <div class="grid">${cats.map((c) => card(esc(c), `<div class="menu-grid">${menu.filter((m) => m.category === c && m.active).map((m) => `
        <button class="menu-tile" data-add="${m.id}"><span>${vegMark(m.veg)}${esc(m.name)}</span><span class="price">${inr(m.price)}</span></button>`).join('')}</div>`)).join('')}</div>
      <section class="card cart"><div class="card-head"><div><h2>New bill</h2><p>${esc(outlet.name)} · GSTIN ${esc(outlet.gstin)}</p></div></div>
        <div class="form-grid">
          <label>Channel <select id="posChannel">${state.meta.channels.map((c) => `<option>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Payment <select id="posPayment"><option>UPI</option><option>Card</option><option>Cash</option></select></label>
          <label>Guests <input id="posCovers" type="number" min="0" value="2"></label>
          <label>Discount (₹) <input id="posDiscount" type="number" min="0" value="0"></label>
        </div>
        <div id="cartLines" style="margin-top:12px"></div>
        <div id="cartTotals"></div>
        <div class="row"><button class="btn" id="posClear">Clear</button><span class="spacer"></span><button class="btn primary" id="posSave">Save &amp; print invoice</button></div>
      </section></div>`;
  },
  after() {
    const menu = this.menu;
    const draw = () => {
      const lines = [...this.cart.entries()].map(([id, qty]) => ({ m: menu.find((x) => x.id === id), qty }));
      $('#cartLines').innerHTML = lines.length ? lines.map(({ m, qty }) => `<div class="cart-line"><span>${vegMark(m.veg)}${esc(m.name)}</span>
        <span class="qty"><button data-dec="${m.id}" aria-label="Less">−</button>${qty}<button data-add="${m.id}" aria-label="More">+</button></span><span class="num">${inr(m.price * qty)}</span></div>`).join('')
        : '<p class="hint">Tap menu items to add them to the bill.</p>';
      const channel = state.meta.channels.find((c) => c.name === $('#posChannel').value);
      const subtotal = lines.reduce((s, l) => s + l.m.price * l.qty, 0);
      const discount = Math.min(subtotal, Number($('#posDiscount').value) || 0);
      const taxable = subtotal - discount;
      const gst = channel.is_aggregator ? 0 : Math.round(taxable * 2.5) / 100;
      const exact = taxable + gst * 2;
      $('#cartTotals').innerHTML = `<div class="totals"><span>Subtotal</span><span class="num">${inr2(subtotal)}</span><span>Discount</span><span class="num">− ${inr2(discount)}</span>
        ${channel.is_aggregator ? `<span class="muted">GST 5% collected by ${esc(channel.name)}</span><span class="num muted">${inr2(taxable * 0.05)}</span>` : `<span>CGST 2.5%</span><span class="num">${inr2(gst)}</span><span>SGST 2.5%</span><span class="num">${inr2(gst)}</span>`}
        <span>Round off</span><span class="num">${inr2(Math.round(exact) - exact)}</span><span class="grand">Total</span><span class="num grand">${inr(Math.round(exact))}</span></div>`;
      $('#posPayment').disabled = !!channel.is_aggregator;
    };
    $('#view').addEventListener('click', this.onClick = (e) => {
      const add = e.target.closest('[data-add]'); const dec = e.target.closest('[data-dec]');
      if (add) { const id = Number(add.dataset.add); this.cart.set(id, (this.cart.get(id) || 0) + 1); draw(); }
      if (dec) { const id = Number(dec.dataset.dec); const q = (this.cart.get(id) || 0) - 1; if (q > 0) this.cart.set(id, q); else this.cart.delete(id); draw(); }
    });
    ['#posChannel', '#posDiscount'].forEach((s) => $(s).addEventListener('input', draw));
    $('#posClear').onclick = () => { this.cart.clear(); draw(); };
    $('#posSave').onclick = async () => {
      if (!this.cart.size) return toast('Add at least one item', true);
      try {
        const o = await api('/api/orders', { method: 'POST', body: { outlet_id: singleOutlet(), channel: $('#posChannel').value, payment_mode: $('#posPayment').value,
          covers: Number($('#posCovers').value) || 0, discount: Number($('#posDiscount').value) || 0, lines: [...this.cart.entries()].map(([menu_item_id, qty]) => ({ menu_item_id, qty })) } });
        this.cart.clear(); draw(); toast(`Saved ${o.invoice_no}`); showInvoice(o.id);
      } catch (err) { toast(err.message, true); }
    };
    draw();
  },
  cleanup() { $('#view').removeEventListener('click', this.onClick); },
};

views.menu = {
  title: 'Menu & recipes', filters: 'range',
  async render() {
    const menu = await api(`/api/menu?${qs()}`);
    views.billing.menu = null;
    const classBadge = { Star: 'good', Plowhorse: 'info', Puzzle: 'warn', Dog: 'bad' };
    const classHint = { Star: 'Popular & profitable: keep', Plowhorse: 'Popular, low margin: re-cost or nudge price', Puzzle: 'Profitable, slow seller: promote', Dog: 'Neither: rework or drop' };
    return card('Recipe costing & menu engineering', table([
      { h: 'Item', v: (m) => `${vegMark(m.veg)}<button class="btn link" data-recipe="${m.id}">${esc(m.name)}</button>` },
      { h: 'Category', v: (m) => esc(m.category) },
      { h: 'Price', num: 1, v: (m) => `<input class="small num" type="number" min="1" value="${m.price}" data-price="${m.id}" aria-label="Price of ${esc(m.name)}">` },
      { h: 'Plate cost', num: 1, v: (m) => inr2(m.plateCost) },
      { h: 'Food cost %', num: 1, v: (m) => `<span class="badge ${m.foodCostPct <= 30 ? 'good' : m.foodCostPct <= 38 ? 'warn' : 'bad'}">${pct(m.foodCostPct)}</span>` },
      { h: 'Margin', num: 1, v: (m) => inr2(m.margin) },
      { h: 'Sold', num: 1, v: (m) => num(m.sold) }, { h: 'Mix', num: 1, v: (m) => pct(m.mix) },
      { h: 'Class', v: (m) => (m.class ? `<span class="badge ${classBadge[m.class]}" data-tip="${esc(classHint[m.class])}" tabindex="0">${m.class}</span>` : '—') },
    ], menu), { sub: 'Plate cost uses current landed ingredient cost (GST included, since restaurants at 5% get no ITC). Sales mix uses the selected date range. Edit a price and press Enter to save.' });
  },
  after() {
    $$('[data-price]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await api(`/api/menu/${inp.dataset.price}`, { method: 'PUT', body: { price: Number(inp.value) } }); toast('Price updated'); render(); } catch (err) { toast(err.message, true); }
    }));
    $$('[data-recipe]').forEach((b) => b.addEventListener('click', async () => {
      const m = (await api('/api/menu')).find((x) => x.id === Number(b.dataset.recipe));
      openModal(`<div class="modal-inner"><h2>${vegMark(m.veg)}${esc(m.name)}</h2><p class="hint">Recipe card · per portion</p>
        ${table([{ h: 'Ingredient', v: (r) => esc(r.name) }, { h: 'Qty', num: 1, v: (r) => `${num(r.qty, 3)} ${esc(r.unit)}` }, { h: 'Cost', num: 1, v: (r) => inr2(r.cost) }], m.recipe,
          { foot: ['Plate cost', '', inr2(m.plateCost)] })}
        <div class="row"><span>Menu price ${inr(m.price)} · food cost ${pct(m.foodCostPct)} · margin ${inr2(m.margin)}</span><span class="spacer"></span><button class="btn" data-close>Close</button></div></div>`);
    }));
  },
};

views.inventory = {
  title: 'Inventory', filters: 'none',
  async render() {
    const outlet = singleOutlet();
    const t = tabs('inv', [['stock', 'Stock on hand'], ['count', 'Stock count'], ['variance', 'Actual vs theoretical']]);
    if (t.cur === 'variance') {
      const v = await api(`/api/inventory/variance?outlet=${outlet}&from=${state.tab.varFrom || ''}&to=${state.tab.varTo || ''}`);
      if (!v.totals) return singleOutletNote() + t.html + card('Variance', '<div class="empty">Record at least two stock counts to see variance.</div>');
      const opts = (sel) => v.dates.map((d) => `<option ${d === sel ? 'selected' : ''}>${d}</option>`).join('');
      const tt = v.totals;
      return singleOutletNote() + t.html + `<div class="kpis">
          ${kpi('Sales in window', inrShort(tt.sales), `${fmtDate(v.from)} → ${fmtDate(v.to)}`)}
          ${kpi('Theoretical food cost', pct(tt.theoreticalPct), inrShort(tt.theoreticalValue))}
          ${kpi('Actual food cost', pct(tt.actualPct), inrShort(tt.actualValue))}
          ${kpi('Variance', inrShort(tt.varianceValue), `${(tt.actualPct - tt.theoreticalPct).toFixed(2)} pts of sales`)}
        </div>` + card('Usage variance by ingredient', table([
        { h: 'Item', v: (r) => esc(r.name) }, { h: 'Opening', num: 1, v: (r) => `${num(r.open, 2)} ${r.unit}` }, { h: 'Purchased', num: 1, v: (r) => num(r.purchased, 2) },
        { h: 'Closing', num: 1, v: (r) => num(r.close, 2) }, { h: 'Actual use', num: 1, v: (r) => num(r.actual, 2) }, { h: 'Theoretical', num: 1, v: (r) => num(r.theoretical, 2) },
        { h: 'Variance', num: 1, v: (r) => `${r.varianceQty > 0 ? '+' : ''}${num(r.varianceQty, 2)} ${r.unit}` },
        { h: 'Variance %', num: 1, v: (r) => (r.variancePct === null ? '—' : `<span class="badge ${Math.abs(r.variancePct) <= 3 ? 'good' : Math.abs(r.variancePct) <= 7 ? 'warn' : 'bad'}">${pct(r.variancePct)}</span>`) },
        { h: 'Value', num: 1, v: (r) => inr(r.varianceValue) },
      ], v.items), { sub: 'Actual = opening + purchases − closing. Theoretical = recipes × items sold. Positive variance points to wastage, over-portioning, pilferage or missing recipes.',
        actions: `<div class="row"><label>From <select id="varFrom">${opts(v.from)}</select></label><label>To <select id="varTo">${opts(v.to)}</select></label></div>` });
    }
    const inv = await api(`/api/inventory?outlet=${outlet}`);
    if (t.cur === 'count') {
      return singleOutletNote() + t.html + card('Stock count sheet', `
        <div class="row" style="margin-bottom:12px"><label>Count date <input type="date" id="countDate" value="${state.meta.today}"></label><span class="hint">Count after the day's deliveries and before service starts.</span><span class="spacer"></span><button class="btn primary" id="saveCount">Save count</button></div>
        ${table([{ h: 'Item', v: (i) => esc(i.name) }, { h: 'Category', v: (i) => esc(i.category) }, { h: 'Unit', v: (i) => esc(i.unit) },
          { h: 'Expected', num: 1, v: (i) => num(i.onHand, 2) },
          { h: 'Counted', num: 1, v: (i) => `<input class="small num" type="number" min="0" step="0.01" data-count="${i.id}" placeholder="${num(i.onHand, 2)}" aria-label="Count for ${esc(i.name)}">` }], inv.items)}`,
      { sub: 'Leave a field blank to use the expected quantity.' });
    }
    const value = inv.items.reduce((s, i) => s + i.value, 0);
    const low = inv.items.filter((i) => i.belowPar);
    return singleOutletNote() + t.html + `<div class="kpis">${kpi('Stock value', inrShort(value), 'At landed cost')}${kpi('Below par', num(low.length), 'Items to reorder')}${kpi('Last count', inv.countDate ? fmtDate(inv.countDate) : '—', 'Estimated on-hand since then')}</div>`
      + card('Stock on hand', table([
        { h: 'Item', v: (i) => esc(i.name) }, { h: 'HSN', v: (i) => esc(i.hsn) }, { h: 'Unit', v: (i) => esc(i.unit) },
        { h: 'Last count', num: 1, v: (i) => (i.lastCount === null ? '—' : num(i.lastCount, 2)) }, { h: '+ Received', num: 1, v: (i) => num(i.received, 2) }, { h: '− Used', num: 1, v: (i) => num(i.used, 2) },
        { h: 'On hand', num: 1, v: (i) => `<strong>${num(i.onHand, 2)}</strong>` }, { h: 'Par', num: 1, v: (i) => num(i.par_level, 2) },
        { h: 'Status', v: (i) => (i.belowPar ? `<span class="badge warn">! Order ${num(i.suggestedOrder)} ${esc(i.unit)}</span>` : '<span class="badge good">✓ OK</span>') },
        { h: 'Landed cost', num: 1, v: (i) => `${inr2(i.landedCost)}/${esc(i.unit)}` }, { h: 'Value', num: 1, v: (i) => inr(i.value) },
      ], inv.items), { sub: 'On hand = last count + purchases received − theoretical usage from sales' });
  },
  after() {
    $('#varFrom')?.addEventListener('change', (e) => { state.tab.varFrom = e.target.value; render(); });
    $('#varTo')?.addEventListener('change', (e) => { state.tab.varTo = e.target.value; render(); });
    $('#saveCount')?.addEventListener('click', async () => {
      const counts = $$('[data-count]').map((i) => ({ item_id: Number(i.dataset.count), qty: i.value === '' ? Number(i.placeholder.replace(/,/g, '')) : Number(i.value) }));
      try { await api('/api/stock-counts', { method: 'POST', body: { outlet_id: singleOutlet(), date: $('#countDate').value, counts } }); toast('Stock count saved'); state.tab.inv = 'stock'; render(); } catch (err) { toast(err.message, true); }
    });
  },
};

views.purchases = {
  title: 'Purchases & vendors', filters: 'range',
  async render() {
    const t = tabs('pur', [['list', 'Goods received (GRN)'], ['new', 'Record purchase'], ['vendors', 'Vendors']]);
    if (t.cur === 'vendors') {
      const vendors = await api('/api/vendors');
      return t.html + card('Add vendor', `<form id="vendorForm" class="form-grid">
          <label>Name <input name="name" required></label><label>GSTIN <input name="gstin" id="gstinInput" required maxlength="15" style="text-transform:uppercase"></label>
          <label>Category <input name="category" placeholder="Dairy, Meat…"></label><label>Phone <input name="phone"></label>
          <button class="btn primary">Add vendor</button></form><p id="gstinMsg" class="hint" style="margin-top:8px">GSTIN is checked for format, state code and check digit.</p>`)
        + card('Vendors', table([{ h: 'Name', v: (v) => esc(v.name) }, { h: 'GSTIN', v: (v) => `<code>${esc(v.gstin)}</code>` },
          { h: 'State', v: (v) => esc(state.meta.states[v.state_code]?.name || v.state_code) }, { h: 'Category', v: (v) => esc(v.category) }, { h: 'Phone', v: (v) => esc(v.phone) }], vendors));
    }
    if (t.cur === 'new') {
      const [vendors, inv] = await Promise.all([api('/api/vendors'), api(`/api/inventory?outlet=${singleOutlet()}`)]);
      this.items = inv.items;
      return singleOutletNote() + t.html + card('Record purchase (GRN)', `<form id="poForm" class="grid">
        <div class="form-grid"><label>Vendor <select name="vendor_id" required>${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label>
          <label>Supplier invoice no. <input name="invoice_no" required></label><label>Invoice date <input type="date" name="date" value="${state.meta.today}" required></label></div>
        <div id="poLines"></div><div class="row"><button type="button" class="btn" id="addLine">+ Add line</button><span class="spacer"></span><strong id="poTotal"></strong><button class="btn primary">Save GRN</button></div>
        <p class="hint">Inter-state vendors are taxed as IGST, same-state as CGST + SGST. The rate you enter becomes the item's latest cost.</p></form>`);
    }
    const list = await api(`/api/purchases?${qs()}`);
    const sum = (k) => list.reduce((s, p) => s + p[k], 0);
    return t.html + card('Goods received', table([
      { h: 'Date', v: (p) => fmtDate(p.date) }, { h: 'Outlet', v: (p) => esc(p.outlet) }, { h: 'Vendor', v: (p) => esc(p.vendor) },
      { h: 'Invoice', v: (p) => `<button class="btn link" data-po="${p.id}">${esc(p.invoice_no)}</button>` }, { h: 'Lines', num: 1, v: (p) => p.lines },
      { h: 'Taxable', num: 1, v: (p) => inr2(p.taxable) }, { h: 'GST', num: 1, v: (p) => inr2(p.cgst + p.sgst + p.igst) }, { h: 'Total', num: 1, v: (p) => inr2(p.total) },
    ], list, { foot: ['Total', '', '', '', '', inr2(sum('taxable')), inr2(sum('cgst') + sum('sgst') + sum('igst')), inr2(sum('total'))] }));
  },
  after() {
    $$('[data-po]').forEach((b) => b.addEventListener('click', async () => {
      const p = await api(`/api/purchases/${b.dataset.po}`);
      openModal(`<div class="modal-inner"><h2>${esc(p.vendor)}</h2><p class="hint">Invoice ${esc(p.invoice_no)} · ${fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })} · GSTIN ${esc(p.vendor_gstin)}</p>
        ${table([{ h: 'Item', v: (l) => esc(l.name) }, { h: 'HSN', v: (l) => esc(l.hsn) }, { h: 'Qty', num: 1, v: (l) => `${num(l.qty, 2)} ${esc(l.unit)}` }, { h: 'Rate', num: 1, v: (l) => inr2(l.rate) },
          { h: 'GST', num: 1, v: (l) => `${l.gst_rate}%` }, { h: 'Amount', num: 1, v: (l) => inr2(l.qty * l.rate) }], p.lines,
          { foot: ['Total', '', '', '', p.igst ? `IGST ${inr2(p.igst)}` : `CGST+SGST ${inr2(p.cgst + p.sgst)}`, inr2(p.total)] })}
        <div class="row"><span class="spacer"></span><button class="btn" data-close>Close</button></div></div>`);
    }));
    const gstinInput = $('#gstinInput');
    if (gstinInput) {
      gstinInput.addEventListener('input', async () => {
        const v = gstinInput.value.trim();
        const msg = $('#gstinMsg');
        if (v.length < 15) { msg.className = 'hint'; msg.textContent = `${15 - v.length} characters to go`; return; }
        const r = await api(`/api/gstin/${encodeURIComponent(v)}`);
        msg.className = r.valid ? 'ok-text' : 'err-text';
        msg.textContent = r.valid ? `✓ Valid GSTIN · ${r.state} · PAN ${r.pan}` : `✕ ${r.reason}`;
      });
      $('#vendorForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/api/vendors', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Vendor added'); render(); } catch (err) { toast(err.message, true); }
      });
    }
    const form = $('#poForm');
    if (form) {
      const items = this.items;
      const addLine = () => {
        const row = document.createElement('div');
        row.className = 'form-grid po-line';
        row.style.marginBottom = '8px';
        row.innerHTML = `<label>Item <select class="li-item">${items.map((i) => `<option value="${i.id}" data-cost="${i.cost}" data-unit="${esc(i.unit)}" data-gst="${i.gst_rate}">${esc(i.name)}</option>`).join('')}</select></label>
          <label>Qty <input class="li-qty" type="number" min="0" step="0.01" required></label><label>Rate (₹, ex-GST) <input class="li-rate" type="number" min="0" step="0.01" required></label>
          <label>Amount <input class="li-amt" disabled></label><button type="button" class="btn li-del">Remove</button>`;
        const sync = () => { const o = row.querySelector('.li-item').selectedOptions[0]; if (!row.querySelector('.li-rate').dataset.touched) row.querySelector('.li-rate').value = o.dataset.cost; total(); };
        row.querySelector('.li-item').addEventListener('change', sync);
        row.querySelector('.li-rate').addEventListener('input', (e) => { e.target.dataset.touched = 1; total(); });
        row.querySelector('.li-qty').addEventListener('input', total);
        row.querySelector('.li-del').addEventListener('click', () => { row.remove(); total(); });
        $('#poLines').append(row);
        sync();
      };
      const total = () => {
        let t = 0;
        $$('.po-line').forEach((r) => {
          const o = r.querySelector('.li-item').selectedOptions[0];
          const amt = (Number(r.querySelector('.li-qty').value) || 0) * (Number(r.querySelector('.li-rate').value) || 0);
          r.querySelector('.li-amt').value = `${inr2(amt)} + ${o.dataset.gst}% GST`;
          t += amt * (1 + Number(o.dataset.gst) / 100);
        });
        $('#poTotal').textContent = `Total ${inr2(t)}`;
      };
      $('#addLine').onclick = addLine;
      addLine();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form));
        const lines = $$('.po-line').map((r) => ({ item_id: Number(r.querySelector('.li-item').value), qty: Number(r.querySelector('.li-qty').value), rate: Number(r.querySelector('.li-rate').value) }));
        try { const p = await api('/api/purchases', { method: 'POST', body: { ...fd, outlet_id: singleOutlet(), lines } }); toast(`GRN saved · ${inr2(p.total)}`); state.tab.pur = 'list'; render(); } catch (err) { toast(err.message, true); }
      });
    }
  },
};

views.schedule = {
  title: 'Staff schedule', filters: 'none',
  async render() {
    const s = await api(`/api/schedule?outlet=${singleOutlet()}&week=${state.tab.week || state.meta.today}`);
    this.data = s;
    const days = s.daily.map((d) => d.date);
    // Shops & Establishments Acts cap regular work at 48 hours a week; beyond that is overtime at twice the wage rate.
    const weekHours = (id) => {
      const h = s.shifts.filter((x) => x.employee_id === id).reduce((a, x) => a + x.hours, 0);
      return h > 48 ? `<span class="badge warn" data-tip="Over 48 h/week: overtime payable at 2× wages" tabindex="0">! ${num(h, 1)} h</span>` : `${num(h, 1)} h`;
    };
    const rows = s.employees.map((e) => `<tr><td><strong>${esc(e.name)}</strong><br><span class="muted">${esc(e.role)}</span></td>${days.map((d) => {
      const sh = s.shifts.find((x) => x.employee_id === e.id && x.date === d);
      return `<td class="${d === state.meta.today ? 'today-col' : ''}">${sh ? `<button class="shift" data-del="${sh.id}" data-tip="${esc(`${sh.station || 'Shift'} · ${sh.hours} h<br>Click to remove`)}">${sh.start}–${sh.end}</button>` : `<button class="add-shift" data-emp="${e.id}" data-date="${d}" aria-label="Add shift">+</button>`}</td>`;
    }).join('')}<td class="num">${weekHours(e.id)}</td></tr>`).join('');
    const foot = (label, f) => `<tr class="strong"><td>${label}</td>${s.daily.map((d) => `<td class="num ${d.date === state.meta.today ? 'today-col' : ''}">${f(d)}</td>`).join('')}<td></td></tr>`;
    return singleOutletNote() + card(`Week of ${fmtDate(s.monday, { day: 'numeric', month: 'short', year: 'numeric' })}`, `<div class="table-wrap"><table class="sched">
        <thead><tr><th>Employee</th>${days.map((d) => `<th class="${d === state.meta.today ? 'today-col' : ''}">${weekdayShort(d)}<br><span class="muted">${fmtDate(d)}</span></th>`).join('')}<th class="num">Hours</th></tr></thead>
        <tbody>${rows}</tbody><tfoot>
        ${foot('Staff on shift', (d) => d.staff)}${foot('Scheduled hours', (d) => num(d.hours, 1))}${foot('Labour cost', (d) => inr(d.cost))}
        ${foot('Forecast sales', (d) => inrShort(d.forecastSales))}${foot('Labour % of forecast', (d) => (d.labourPct === null ? '—' : `<span class="badge ${d.labourPct <= 18 ? 'good' : d.labourPct <= 24 ? 'warn' : 'bad'}">${pct(d.labourPct)}</span>`))}
        </tfoot></table></div>`, {
      sub: 'Forecast = average of the same weekday over the last 4 weeks. Labour cost includes employer PF and ESI. Weekly hours above 48 are flagged as overtime.',
      actions: '<div class="row"><button class="btn" id="prevWeek">← Previous</button><button class="btn" id="thisWeek">This week</button><button class="btn" id="nextWeek">Next →</button></div>',
    });
  },
  after() {
    const go = (n) => { state.tab.week = n === 0 ? state.meta.today : addDays(this.data.monday, n * 7); render(); };
    $('#prevWeek').onclick = () => go(-1); $('#nextWeek').onclick = () => go(1); $('#thisWeek').onclick = () => go(0);
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/shifts/${b.dataset.del}`, { method: 'DELETE' }); render(); }));
    $$('[data-emp]').forEach((b) => b.addEventListener('click', () => {
      const e = this.data.employees.find((x) => x.id === Number(b.dataset.emp));
      openModal(`<form class="modal-inner" id="shiftForm"><h2>Add shift</h2><p class="hint">${esc(e.name)} · ${fmtDate(b.dataset.date, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
        <div class="form-grid"><label>Start <input type="time" name="start" value="09:00" required></label><label>End <input type="time" name="end" value="17:30" required></label>
        <label>Station <select name="station"><option>Kitchen</option><option>Floor</option><option>Front desk</option><option>Dispatch</option></select></label></div>
        <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add shift</button></div></form>`);
      $('#shiftForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await api('/api/shifts', { method: 'POST', body: { ...Object.fromEntries(new FormData(ev.target)), employee_id: e.id, date: b.dataset.date } }); closeModal(); render(); } catch (err) { toast(err.message, true); }
      });
    }));
  },
};

views.payroll = {
  title: 'Payroll (PF/ESI/PT)', filters: 'month',
  async render() {
    const t = tabs('pay', [['register', 'Salary register'], ['staff', 'Add employee']]);
    if (t.cur === 'staff') {
      return t.html + card('Add employee', `<form id="empForm" class="form-grid">
        <label>Outlet <select name="outlet_id">${state.meta.outlets.map((o) => `<option value="${o.id}" ${o.id === singleOutlet() ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label>Name <input name="name" required></label><label>Role <input name="role" required placeholder="Steward"></label>
        <label>Gender <select name="gender"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
        <label>Basic (₹/month) <input type="number" name="basic" required min="0"></label><label>HRA <input type="number" name="hra" min="0" value="0"></label>
        <label>Other allowances <input type="number" name="allowances" min="0" value="0"></label><label>UAN <input name="uan"></label><label>ESIC IP no. <input name="esic_no"></label>
        <label>Phone <input name="phone"></label><button class="btn primary">Add employee</button></form>
        <p class="hint" style="margin-top:8px">Keep basic at 50% or more of total pay to meet the Code on Wages. ESI applies when monthly pay is ₹21,000 or less.</p>`);
    }
    const p = await api(`/api/payroll?${qs()}`);
    const tt = p.totals;
    const flags = p.rows.filter((r) => !r.wageCodeOk).length;
    return t.html + `<div class="kpis">
        ${kpi('Gross salaries', inrShort(tt.gross), `${p.rows.length} employees`)}
        ${kpi('Net pay', inrShort(tt.net), 'Bank transfer')}
        ${kpi('PF to deposit (ECR)', inrShort(tt.pfEmployee + tt.pfEmployer + tt.eps + tt.edli + tt.pfAdmin), 'Due 15th · EE + ER + EDLI + admin')}
        ${kpi('ESI to deposit', inrShort(tt.esiEmployee + tt.esiEmployer), 'Due 15th · 0.75% + 3.25%')}
        ${kpi('Professional tax', inr(tt.pt), 'State-wise slabs')}
        ${kpi('Employer cost (CTC)', inrShort(tt.employerCost), flags ? `<span class="badge warn">! ${flags} below 50% basic</span>` : '')}
      </div>` + card(`Salary register · ${new Date(`${p.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`, table([
      { h: 'Code', v: (r) => esc(r.employee.code) }, { h: 'Name', v: (r) => `<button class="btn link" data-slip="${r.employee.id}">${esc(r.employee.name)}</button><br><span class="muted">${esc(r.employee.role)} · ${esc(r.employee.outlet)}</span>` },
      { h: 'LOP days', num: 1, v: (r) => `<input class="small num" type="number" min="0" max="${p.monthDays}" step="0.5" value="${r.lopDays}" data-lop="${r.employee.id}" aria-label="Loss of pay days">` },
      { h: 'Bonus', num: 1, v: (r) => `<input class="small num" type="number" min="0" value="${r.bonus}" data-bonus="${r.employee.id}" aria-label="Bonus">` },
      { h: 'Gross', num: 1, v: (r) => inr(r.gross) }, { h: 'PF (EE)', num: 1, v: (r) => inr(r.pfEmployee) },
      { h: 'ESI (EE)', num: 1, v: (r) => (r.esiCovered ? inr(r.esiEmployee) : '<span class="muted">n/a</span>') }, { h: 'PT', num: 1, v: (r) => inr(r.pt) },
      { h: 'Net pay', num: 1, v: (r) => `<strong>${inr(r.net)}</strong>` }, { h: 'PF (ER)', num: 1, v: (r) => inr(r.pfEmployer + r.eps) },
      { h: 'ESI (ER)', num: 1, v: (r) => inr(r.esiEmployer) }, { h: 'CTC', num: 1, v: (r) => inr(r.employerCost) },
      { h: 'Wage code', v: (r) => (r.wageCodeOk ? '<span class="badge good">✓ OK</span>' : '<span class="badge warn" data-tip="Basic is below 50% of total pay" tabindex="0">! Basic &lt; 50%</span>') },
    ], p.rows, { foot: ['Total', '', '', '', inr(tt.gross), inr(tt.pfEmployee), inr(tt.esiEmployee), inr(tt.pt), inr(tt.net), inr(tt.pfEmployer + tt.eps), inr(tt.esiEmployer), inr(tt.employerCost), ''] }),
    { sub: 'EPF 12% on basic capped at ₹15,000 (EPS 8.33% from employer share). ESI when monthly pay ≤ ₹21,000. Edit LOP or bonus and tab out to recalculate.' });
  },
  after() {
    const save = async (id) => {
      try { await api('/api/payroll/adjust', { method: 'POST', body: { employee_id: Number(id), month: state.month, lop_days: Number($(`[data-lop="${id}"]`).value), bonus: Number($(`[data-bonus="${id}"]`).value) } }); render(); } catch (err) { toast(err.message, true); }
    };
    $$('[data-lop],[data-bonus]').forEach((i) => i.addEventListener('change', () => save(i.dataset.lop || i.dataset.bonus)));
    $('#empForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/employees', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Employee added'); state.tab.pay = 'register'; render(); } catch (err) { toast(err.message, true); }
    });
    $$('[data-slip]').forEach((b) => b.addEventListener('click', async () => {
      const p = await api(`/api/payroll?${qs()}`);
      const r = p.rows.find((x) => x.employee.id === Number(b.dataset.slip));
      const e = r.employee;
      const line = (l, v) => `<tr><td>${l}</td><td class="num">${inr(v)}</td></tr>`;
      openModal(`<div class="modal-inner"><div class="invoice"><header><h2>Payslip · ${new Date(`${p.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2><div>${esc(e.outlet)} outlet</div></header>
        <div class="meta"><div>Name: <strong>${esc(e.name)}</strong></div><div>Code: ${esc(e.code)}</div><div>Designation: ${esc(e.role)}</div><div>UAN: ${esc(e.uan)}</div>
        <div>ESIC IP: ${esc(e.esic_no || 'Not covered')}</div><div>Paid days: ${r.paidDays} / ${p.monthDays}</div></div>
        <div class="grid cols-2"><table><thead><tr><th>Earnings</th><th class="num">₹</th></tr></thead><tbody>${line('Basic', r.basic)}${line('HRA', r.hra)}${line('Other allowances', r.allowances)}${r.bonus ? line('Bonus', r.bonus) : ''}</tbody><tfoot><tr><td>Gross</td><td class="num">${inr(r.gross)}</td></tr></tfoot></table>
        <table><thead><tr><th>Deductions</th><th class="num">₹</th></tr></thead><tbody>${line('Provident Fund (12%)', r.pfEmployee)}${line('ESI (0.75%)', r.esiEmployee)}${line('Professional Tax', r.pt)}</tbody><tfoot><tr><td>Total</td><td class="num">${inr(r.deductions)}</td></tr></tfoot></table></div>
        <div class="totals"><span class="grand">Net pay</span><span class="num grand">${inr(r.net)}</span></div>
        <footer>Employer contributions: EPF ${inr(r.pfEmployer)} · EPS ${inr(r.eps)} · EDLI ${inr(r.edli)} · ESI ${inr(r.esiEmployer)}</footer></div>
        <div class="row no-print"><span class="spacer"></span><button class="btn" data-close>Close</button><button class="btn primary" onclick="window.print()">Print</button></div></div>`);
    }));
  },
};

views.pnl = {
  title: 'Profit & loss', filters: 'range',
  async render() {
    const p = await api(`/api/pnl?${qs()}`);
    const L = p.lines;
    const total = (f) => L.reduce((s, l) => s + f(l), 0);
    const cats = [...new Set(L.flatMap((l) => Object.keys(l.expenses)))].sort();
    const cols = L.length > 1;
    const row = (label, f, { cls = '', showPct = true, neg = false } = {}) => {
      const vals = L.map(f);
      const all = [...vals, ...(cols ? [total(f)] : [])];
      const sales = [...L.map((l) => l.sales.net), ...(cols ? [total((l) => l.sales.net)] : [])];
      return `<tr class="${cls}"><td>${label}</td>${all.map((v, i) => `<td class="num">${neg && v ? '(' : ''}${inr(v)}${neg && v ? ')' : ''}</td>${showPct ? `<td class="num muted">${sales[i] ? pct((v / sales[i]) * 100) : '—'}</td>` : '<td></td>'}`).join('')}</tr>`;
    };
    const heads = [...p.outlets.map((o) => esc(o.name)), ...(cols ? ['All outlets'] : [])].map((h) => `<th class="num">${h}</th><th class="num">%</th>`).join('');
    const sec = (label) => `<tr class="section"><td colspan="${1 + (L.length + (cols ? 1 : 0)) * 2}">${label}</td></tr>`;
    return card(`Profit & loss · ${fmtDate(p.from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(p.to, { day: 'numeric', month: 'short', year: 'numeric' })}`, `<div class="table-wrap"><table>
      <thead><tr><th></th>${heads}</tr></thead><tbody>
      ${sec('Revenue')}${row('Gross sales', (l) => l.sales.gross)}${row('Less: discounts', (l) => l.sales.discount, { neg: true })}${row('Net sales (excl. GST)', (l) => l.sales.net, { cls: 'strong' })}
      ${sec('Cost of sales')}${row('Food & beverage cost', (l) => l.cogs)}${row('Aggregator commission', (l) => l.aggregatorCommission)}${row('GST on commission (no ITC)', (l) => l.aggregatorCommissionGst)}
      ${row('Gross profit', (l) => l.grossProfit, { cls: 'strong' })}
      ${sec('Operating expenses')}${row('Salaries, PF & ESI', (l) => l.labour)}${cats.map((c) => row(esc(c), (l) => l.expenses[c] || 0)).join('')}
      ${row('Total operating expenses', (l) => l.labour + l.opex, { cls: 'strong' })}
      ${row('EBITDA', (l) => l.ebitda, { cls: 'strong' })}
      </tbody></table></div>
      <p class="hint" style="margin-top:12px">Food cost basis: ${L.map((l) => `${esc(outletName(l.outletId))}: ${esc(l.cogsBasis)}`).join(' · ')}. TDS u/s 194-O deducted by aggregators (${inr(total((l) => l.tds194O))}) is claimable against income tax and not an expense.</p>`,
    { sub: 'Management P&L. Purchase GST is part of food cost because restaurants at 5% cannot claim input tax credit.' });
  },
};

views.gst = {
  title: 'GST returns', filters: 'month',
  async render() {
    const g = await api(`/api/gst?${qs()}`);
    const monthName = new Date(`${g.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return `<div class="callout">Restaurant service (SAC 996331) at 5% without input tax credit. Swiggy, Zomato and ONDC orders are taxed by the e-commerce operator under Section 9(5); report them in GSTR-1 Table 15 but pay no tax on them.</div>`
      + g.outlets.map((o) => {
        const ecoTaxable = o.eco.reduce((s, e) => s + e.taxable, 0);
        const ecoGst = o.eco.reduce((s, e) => s + e.gst, 0);
        return card(`${esc(o.outlet.name)} · ${esc(o.outlet.gstin)}`, `<div class="grid gst-grid">
          <div><h3>GSTR-1 · B2C supplies (Table 7)</h3><table class="kv"><tbody><tr><td>Rate</td><td class="num">5% (2.5% + 2.5%)</td></tr><tr><td>Taxable value</td><td class="num">${inr2(o.direct.taxable)}</td></tr>
            <tr><td>CGST</td><td class="num">${inr2(o.direct.cgst)}</td></tr><tr><td>SGST</td><td class="num">${inr2(o.direct.sgst)}</td></tr></tbody></table>
            <p class="hint">${num(o.direct.invoices)} invoices · series ${esc(o.invoiceRange.first || '—')} to ${esc(o.invoiceRange.last || '—')} (Table 13)</p></div>
          <div><h3>GSTR-1 · supplies through e-commerce operators, u/s 9(5)</h3>${table([{ h: 'Operator', v: (r) => esc(r.channel) }, { h: 'Orders', num: 1, v: (r) => num(r.orders) }, { h: 'Taxable', num: 1, v: (r) => inr2(r.taxable) }, { h: 'GST paid by operator', num: 1, v: (r) => inr2(r.gst) }], o.eco,
            { foot: ['Total', '', inr2(ecoTaxable), inr2(ecoGst)] })}</div>
          <div><h3>GSTR-3B · tax payable</h3><table class="kv"><tbody>
            <tr><td>3.1(a) Outward taxable</td><td class="num">${inr2(o.direct.taxable)}</td></tr>
            <tr><td>3.1.1(ii) Supplies via ECO</td><td class="num">${inr2(ecoTaxable)}</td></tr>
            <tr><td>CGST</td><td class="num">${inr2(o.direct.cgst)}</td></tr><tr><td>SGST</td><td class="num">${inr2(o.direct.sgst)}</td></tr>
            <tr><td>Input tax credit</td><td class="num">${inr2(o.itc)}</td></tr>
            <tr><td>Ineligible ITC (purchases + commission)</td><td class="num muted">${inr2(o.ineligibleItc)}</td></tr>
            <tr class="strong"><td>Net cash payable</td><td class="num">${inr2(o.netPayable)}</td></tr>
            <tr><td>TDS u/s 194-O (income-tax credit)</td><td class="num">${inr2(o.tds194O)}</td></tr></tbody></table></div></div>`,
        { sub: `${monthName} · ${esc(o.scheme)} · inward supplies: ${num(o.inward.bills)} bills, ${inr2(o.inward.taxable)} taxable` });
      }).join('');
  },
};

views.compliance = {
  title: 'Licences & filings', filters: 'none',
  async render() {
    const c = await api(`/api/compliance?outlet=${state.outlet}`);
    const alerts = c.licenses.filter((l) => l.status === 'expired' || l.status === 'due');
    const dueBadge = (d) => `<span class="badge ${d <= 3 ? 'bad' : d <= 7 ? 'warn' : 'neutral'}">${d === 0 ? 'Today' : `${d} days`}</span>`;
    return (alerts.length ? `<div class="callout warn">${alerts.length} licence${alerts.length > 1 ? 's' : ''} expired or due within 30 days: ${alerts.map((l) => `${esc(l.type)} (${esc(l.outlet)})`).join(', ')}</div>` : '')
      + card('Filing calendar', table([
        { h: 'Due', v: (e) => `${fmtDate(e.due)} ${dueBadge(e.daysLeft)}` }, { h: 'Filing', v: (e) => esc(e.name) }, { h: 'Authority', v: (e) => esc(e.authority) }, { h: 'Period', v: (e) => esc(e.period) },
      ], c.calendar), { sub: 'Next 45 days. Monthly GST filers; dates move when the government extends them.' })
      + card('Licences & registrations', table([
        { h: 'Outlet', v: (l) => esc(l.outlet) }, { h: 'Licence', v: (l) => esc(l.type) }, { h: 'Number', v: (l) => `<code>${esc(l.number)}</code>` },
        { h: 'Authority', v: (l) => esc(l.authority), cls: 'wrap' }, { h: 'Expiry', v: (l) => fmtDate(l.expiry, { day: 'numeric', month: 'short', year: 'numeric' }) },
        { h: 'Status', v: (l) => statusBadge(l.status) }, { h: '', v: (l) => `<button class="btn link" data-renew="${l.id}" data-type="${esc(l.type)}" data-expiry="${l.expiry}">Renew</button>` },
      ], c.licenses), { actions: '<button class="btn" id="addLicense">+ Add licence</button>' });
  },
  after() {
    $$('[data-renew]').forEach((b) => b.addEventListener('click', () => {
      const next = addDays(b.dataset.expiry > state.meta.today ? b.dataset.expiry : state.meta.today, 365);
      openModal(`<form class="modal-inner" id="renewForm"><h2>Renew ${esc(b.dataset.type)}</h2><div class="form-grid"><label>New expiry <input type="date" name="expiry" value="${next}" required></label>
        <label>New number (optional) <input name="number"></label></div><div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
      $('#renewForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api(`/api/licenses/${b.dataset.renew}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Licence renewed'); render(); } catch (err) { toast(err.message, true); }
      });
    }));
    $('#addLicense').onclick = async () => {
      const c = await api('/api/compliance');
      openModal(`<form class="modal-inner" id="licForm"><h2>Add licence</h2><div class="form-grid">
        <label>Outlet <select name="outlet_id">${state.meta.outlets.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
        <label>Type <select name="type">${c.licenseTypes.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <label>Number <input name="number" required></label><label>Authority <input name="authority"></label><label>Expiry <input type="date" name="expiry" required></label></div>
        <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`);
      $('#licForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/api/licenses', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Licence added'); render(); } catch (err) { toast(err.message, true); }
      });
    };
  },
};

/* ---------- Shell ---------- */

let current = null;
async function render() {
  const name = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
  const view = views[name] || views.dashboard;
  const prev = current;
  current = view;
  if (prev && prev.cleanup) prev.cleanup();
  $('#title').textContent = view.title;
  document.title = `${view.title} · RasoiNet`;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name}`));
  $$('.range').forEach((el) => { el.hidden = view.filters !== 'range'; });
  $('.month').hidden = view.filters !== 'month';
  $('#sidebar').classList.remove('open');
  const el = $('#view');
  if (!el.innerHTML) el.innerHTML = '<div class="empty">Loading…</div>';
  el.style.opacity = '0.6';
  try {
    el.innerHTML = await view.render();
    view.after && view.after();
  } catch (err) {
    el.innerHTML = `<div class="card empty">Could not load this page: ${esc(err.message)}</div>`;
  }
  el.style.opacity = '1';
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { const [k, v] = t.dataset.tab.split(':'); state.tab[k] = v; render(); }
  const inv = e.target.closest('[data-invoice]');
  if (inv) showInvoice(inv.dataset.invoice);
});

async function init() {
  state.meta = await api('/api/meta');
  const saved = (() => { try { return JSON.parse(localStorage.getItem('rasoinet') || '{}'); } catch { return {}; } })();
  state.outlet = saved.outlet && (saved.outlet === 'all' || state.meta.outlets.some((o) => String(o.id) === saved.outlet)) ? saved.outlet : 'all';
  state.to = state.meta.today;
  state.from = addDays(state.meta.today, -29);
  state.month = state.meta.today.slice(0, 7);
  $('#outlet').innerHTML = `<option value="all">All outlets</option>${state.meta.outlets.map((o) => `<option value="${o.id}">${esc(o.name)}, ${esc(o.city)}</option>`).join('')}`;
  $('#outlet').value = state.outlet;
  $('#from').value = state.from; $('#to').value = state.to; $('#month').value = state.month;
  $('#outlet').addEventListener('change', (e) => { state.outlet = e.target.value; views.billing.cart.clear(); try { localStorage.setItem('rasoinet', JSON.stringify({ outlet: state.outlet })); } catch { /* storage unavailable */ } render(); });
  $('#from').addEventListener('change', (e) => { if (e.target.value) { state.from = e.target.value; render(); } });
  $('#to').addEventListener('change', (e) => { if (e.target.value) { state.to = e.target.value; render(); } });
  $('#month').addEventListener('change', (e) => { if (e.target.value) { state.month = e.target.value; render(); } });
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  window.addEventListener('hashchange', render);
  render();
}
init();
