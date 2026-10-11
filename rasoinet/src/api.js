const { transaction } = require('./db');
const { computeBill, aggregatorPayout, validateGstin, landedCost, round2, SCHEMES, RESTAURANT_SAC, STATES } = require('./india/gst');
const { computePayslip } = require('./india/payroll');
const { filingCalendar, licenseStatus, iso, LICENSE_TYPES } = require('./india/compliance');
const { financialYear, addDays } = require('./seed');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const plain = (rows) => rows.map((r) => ({ ...r }));
const monthDays = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const daysInclusive = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw new HttpError(400, `Missing: ${missing.join(', ')}`);
}

// Business date in India Standard Time (UTC+5:30).
const istToday = () => iso(new Date(Date.now() + 330 * 60000));

function createApi(db, { today = istToday, brand = process.env.BRAND || 'Spice Route' } = {}) {
  const q = (sql) => db.prepare(sql);
  const outletFilter = (outlet, alias = '') => (outlet && outlet !== 'all' ? { sql: ` AND ${alias}outlet_id = ${Number(outlet)}`, one: Number(outlet) } : { sql: '', one: null });

  const outlets = () => plain(q('SELECT * FROM outlets ORDER BY id').all());
  const outletById = (id) => {
    const o = q('SELECT * FROM outlets WHERE id = ?').get(Number(id));
    if (!o) throw new HttpError(404, 'Outlet not found');
    return { ...o };
  };
  const channels = () => plain(q('SELECT * FROM channels').all());

  // Landed cost per unit of each inventory item (GST is a cost without ITC).
  function itemCosts(scheme = 'regular') {
    const map = {};
    q('SELECT id, cost, gst_rate FROM inventory_items').all().forEach((r) => { map[r.id] = landedCost(r.cost, r.gst_rate, scheme); });
    return map;
  }

  function theoreticalUsage(outletId, from, toExclusive) {
    return plain(q(`SELECT r.item_id, SUM(ol.qty * r.qty) AS qty
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id JOIN recipes r ON r.menu_item_id = ol.menu_item_id
      WHERE o.outlet_id = ? AND o.date >= ? AND o.date < ? GROUP BY r.item_id`).all(outletId, from, toExclusive));
  }

  function theoreticalFoodCost(from, to, outlet) {
    const f = outletFilter(outlet, 'o.');
    const costs = itemCosts();
    let total = 0;
    q(`SELECT r.item_id, SUM(ol.qty * r.qty) AS qty FROM order_lines ol JOIN orders o ON o.id = ol.order_id
       JOIN recipes r ON r.menu_item_id = ol.menu_item_id WHERE o.date BETWEEN ? AND ?${f.sql} GROUP BY r.item_id`)
      .all(from, to).forEach((r) => { total += r.qty * costs[r.item_id]; });
    return round2(total);
  }

  function labourCost(from, to, outlet) {
    const f = outletFilter(outlet);
    const days = daysInclusive(from, to);
    let total = 0;
    q(`SELECT * FROM employees WHERE active = 1${f.sql}`).all().forEach((e) => { total += computePayslip(e).employerCost; });
    return round2((total * days) / 30);
  }

  function aggregatorCosts(from, to, outlet) {
    const f = outletFilter(outlet);
    const result = { gross: 0, commission: 0, commissionGst: 0, tds: 0, net: 0, byChannel: [] };
    q(`SELECT o.channel, c.commission_pct, SUM(o.taxable) AS gross, COUNT(*) AS orders FROM orders o JOIN channels c ON c.name = o.channel
       WHERE c.is_aggregator = 1 AND o.date BETWEEN ? AND ?${f.sql} GROUP BY o.channel`).all(from, to).forEach((r) => {
      const p = aggregatorPayout(r.gross, r.commission_pct);
      result.byChannel.push({ channel: r.channel, orders: r.orders, commissionPct: r.commission_pct, ...p });
      ['gross', 'commission', 'commissionGst', 'tds', 'net'].forEach((k) => { result[k] = round2(result[k] + p[k]); });
    });
    return result;
  }

  function dashboard({ from, to, outlet }) {
    const f = outletFilter(outlet);
    const totals = { ...q(`SELECT COUNT(*) AS orders, COALESCE(SUM(taxable),0) AS netSales, COALESCE(SUM(subtotal),0) AS grossSales,
      COALESCE(SUM(discount),0) AS discounts, COALESCE(SUM(cgst+sgst),0) AS gstCollected, COALESCE(SUM(eco_gst),0) AS ecoGst,
      COALESCE(SUM(covers),0) AS covers, COALESCE(SUM(CASE WHEN channel='Dine-in' THEN taxable END),0) AS dineInSales
      FROM orders WHERE date BETWEEN ? AND ?${f.sql}`).get(from, to) };
    const days = daysInclusive(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    const prev = q(`SELECT COALESCE(SUM(taxable),0) AS netSales, COUNT(*) AS orders FROM orders WHERE date BETWEEN ? AND ?${f.sql}`).get(prevFrom, prevTo);

    const foodCost = theoreticalFoodCost(from, to, outlet);
    const labour = labourCost(from, to, outlet);
    const agg = aggregatorCosts(from, to, outlet);
    const pct = (n) => (totals.netSales ? round2((n / totals.netSales) * 100) : 0);

    const byOutlet = outlets().filter((o) => !f.one || o.id === f.one).map((o) => {
      const s = q('SELECT COALESCE(SUM(taxable),0) AS netSales, COUNT(*) AS orders, COALESCE(SUM(covers),0) AS covers FROM orders WHERE outlet_id = ? AND date BETWEEN ? AND ?').get(o.id, from, to);
      const fc = theoreticalFoodCost(from, to, o.id);
      const lc = labourCost(from, to, o.id);
      return { id: o.id, name: o.name, city: o.city, ...s, avgTicket: s.orders ? round2(s.netSales / s.orders) : 0,
        foodCostPct: s.netSales ? round2((fc / s.netSales) * 100) : 0, labourPct: s.netSales ? round2((lc / s.netSales) * 100) : 0,
        primeCostPct: s.netSales ? round2(((fc + lc) / s.netSales) * 100) : 0 };
    });

    return {
      from, to, days,
      kpis: {
        ...totals,
        avgTicket: totals.orders ? round2(totals.netSales / totals.orders) : 0,
        perCover: totals.covers ? round2(totals.dineInSales / totals.covers) : 0,
        foodCost, foodCostPct: pct(foodCost), labourCost: labour, labourPct: pct(labour),
        primeCost: round2(foodCost + labour), primeCostPct: pct(foodCost + labour),
        aggregatorFees: round2(agg.commission + agg.commissionGst), aggregatorFeesPct: pct(agg.commission + agg.commissionGst),
        prevNetSales: prev.netSales, salesChangePct: prev.netSales ? round2(((totals.netSales - prev.netSales) / prev.netSales) * 100) : null,
      },
      daily: plain(q(`SELECT date, SUM(taxable) AS netSales, COUNT(*) AS orders FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY date ORDER BY date`).all(from, to)),
      byChannel: plain(q(`SELECT channel, SUM(taxable) AS netSales, COUNT(*) AS orders FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY channel ORDER BY netSales DESC`).all(from, to)),
      byPayment: plain(q(`SELECT payment_mode, SUM(total) AS amount, COUNT(*) AS orders FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY payment_mode ORDER BY amount DESC`).all(from, to)),
      byHour: plain(q(`SELECT CAST(substr(time,1,2) AS INTEGER) AS hour, SUM(taxable) AS netSales, COUNT(*) AS orders FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY hour ORDER BY hour`).all(from, to)),
      topItems: plain(q(`SELECT m.name, m.category, SUM(ol.qty) AS qty, SUM(ol.qty*ol.price) AS revenue FROM order_lines ol JOIN orders o ON o.id=ol.order_id
        JOIN menu_items m ON m.id=ol.menu_item_id WHERE o.date BETWEEN ? AND ?${outletFilter(outlet, 'o.').sql} GROUP BY m.id ORDER BY revenue DESC LIMIT 8`).all(from, to)),
      byOutlet,
      aggregators: agg,
    };
  }

  function dailySales({ from, to, outlet }) {
    const f = outletFilter(outlet);
    const rows = plain(q(`SELECT date, channel, COUNT(*) AS orders, SUM(subtotal) AS gross, SUM(discount) AS discount, SUM(taxable) AS net,
      SUM(cgst) AS cgst, SUM(sgst) AS sgst, SUM(eco_gst) AS ecoGst, SUM(total) AS collected, SUM(covers) AS covers
      FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY date, channel ORDER BY date DESC, channel`).all(from, to));
    const payments = plain(q(`SELECT date, payment_mode, SUM(total) AS amount FROM orders WHERE date BETWEEN ? AND ?${f.sql} GROUP BY date, payment_mode`).all(from, to));
    return { rows, payments, channels: channels() };
  }

  function listOrders({ from, to, outlet, limit = 100 }) {
    const f = outletFilter(outlet);
    return plain(q(`SELECT o.*, ou.name AS outlet FROM orders o JOIN outlets ou ON ou.id=o.outlet_id WHERE date BETWEEN ? AND ?${f.sql.replace('outlet_id', 'o.outlet_id')}
      ORDER BY date DESC, time DESC LIMIT ?`).all(from, to, Number(limit)));
  }

  function getOrder(id) {
    const order = q('SELECT * FROM orders WHERE id = ?').get(Number(id));
    if (!order) throw new HttpError(404, 'Order not found');
    const lines = plain(q('SELECT ol.*, m.name, m.veg FROM order_lines ol JOIN menu_items m ON m.id=ol.menu_item_id WHERE order_id = ?').all(order.id));
    return { ...order, lines, outlet: outletById(order.outlet_id), sac: RESTAURANT_SAC };
  }

  function createOrder(body) {
    requireFields(body, ['outlet_id', 'channel', 'lines']);
    const outlet = outletById(body.outlet_id);
    const channel = q('SELECT * FROM channels WHERE name = ?').get(body.channel);
    if (!channel) throw new HttpError(400, 'Unknown channel');
    if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, 'Add at least one item');
    const lines = body.lines.map((l) => {
      const m = q('SELECT * FROM menu_items WHERE id = ? AND active = 1').get(Number(l.menu_item_id));
      const qty = Math.floor(Number(l.qty));
      if (!m || !(qty > 0)) throw new HttpError(400, 'Invalid line item');
      return { menu_item_id: m.id, qty, price: m.price };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
    const discount = Math.min(subtotal, Math.max(0, Number(body.discount) || 0));
    const bill = computeBill({ subtotal, discount, channel: channel.name, scheme: outlet.gst_scheme });
    const date = body.date || today();
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const payment = channel.is_aggregator ? channel.name : body.payment_mode || 'UPI';
    return transaction(db, () => {
      const fy = financialYear(date);
      const prefix = `${outlet.code}/${fy}/`;
      const last = q('SELECT invoice_no FROM orders WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1').get(`${prefix}%`);
      const seq = last ? Number(last.invoice_no.slice(prefix.length)) + 1 : 1;
      const id = Number(q(`INSERT INTO orders (outlet_id,date,time,invoice_no,channel,payment_mode,covers,subtotal,discount,taxable,cgst,sgst,round_off,total,gst_by_eco,eco_gst)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(outlet.id, date, time, prefix + String(seq).padStart(6, '0'), channel.name, payment,
        Number(body.covers) || 0, subtotal, discount, bill.taxable, bill.cgst, bill.sgst, bill.roundOff, bill.total, bill.gstByEco, bill.ecoGst).lastInsertRowid);
      const insLine = q('INSERT INTO order_lines (order_id,menu_item_id,qty,price) VALUES (?,?,?,?)');
      lines.forEach((l) => insLine.run(id, l.menu_item_id, l.qty, l.price));
      return getOrder(id);
    });
  }

  function menu({ from, to, outlet } = {}) {
    const costs = itemCosts();
    const sold = {};
    if (from && to) {
      q(`SELECT ol.menu_item_id AS id, SUM(ol.qty) AS qty FROM order_lines ol JOIN orders o ON o.id=ol.order_id
         WHERE o.date BETWEEN ? AND ?${outletFilter(outlet, 'o.').sql} GROUP BY ol.menu_item_id`).all(from, to).forEach((r) => { sold[r.id] = r.qty; });
    }
    const lines = q('SELECT r.menu_item_id, r.item_id, r.qty, i.name, i.unit FROM recipes r JOIN inventory_items i ON i.id=r.item_id').all();
    const items = plain(q('SELECT * FROM menu_items ORDER BY category, name').all()).map((m) => {
      const recipe = lines.filter((l) => l.menu_item_id === m.id).map((l) => ({ itemId: l.item_id, name: l.name, unit: l.unit, qty: l.qty, cost: round2(l.qty * costs[l.item_id]) }));
      const plateCost = round2(recipe.reduce((s, r) => s + r.cost, 0));
      return { ...m, recipe, plateCost, foodCostPct: m.price ? round2((plateCost / m.price) * 100) : 0, margin: round2(m.price - plateCost), sold: sold[m.id] || 0 };
    });
    // Menu engineering: popularity vs contribution margin (Kasavana–Smith).
    const totalSold = items.reduce((s, m) => s + m.sold, 0);
    if (totalSold) {
      const popularityCut = (1 / items.length) * 0.7;
      const avgMargin = items.reduce((s, m) => s + m.margin * m.sold, 0) / totalSold;
      items.forEach((m) => {
        const popular = m.sold / totalSold >= popularityCut;
        const profitable = m.margin >= avgMargin;
        m.mix = round2((m.sold / totalSold) * 100);
        m.class = popular ? (profitable ? 'Star' : 'Plowhorse') : profitable ? 'Puzzle' : 'Dog';
      });
    }
    return items;
  }

  function updateMenuItem(id, body) {
    const m = q('SELECT * FROM menu_items WHERE id = ?').get(Number(id));
    if (!m) throw new HttpError(404, 'Menu item not found');
    const price = body.price !== undefined ? Number(body.price) : m.price;
    if (!(price > 0)) throw new HttpError(400, 'Price must be positive');
    q('UPDATE menu_items SET price = ?, active = ? WHERE id = ?').run(price, body.active !== undefined ? (body.active ? 1 : 0) : m.active, m.id);
    return menu({}).find((x) => x.id === m.id);
  }

  function lastCountDate(outletId, onOrBefore) {
    const r = q('SELECT MAX(date) AS d FROM stock_counts WHERE outlet_id = ? AND date <= ?').get(outletId, onOrBefore);
    return r && r.d;
  }

  // Estimated on-hand = last count + purchases received after it − theoretical usage since.
  function inventory({ outlet }) {
    const outletId = Number(outlet) || outlets()[0].id;
    const t = today();
    const countDate = lastCountDate(outletId, t);
    const items = plain(q('SELECT * FROM inventory_items ORDER BY category, name').all());
    const counts = {};
    const received = {};
    const used = {};
    if (countDate) {
      q('SELECT item_id, qty FROM stock_counts WHERE outlet_id = ? AND date = ?').all(outletId, countDate).forEach((r) => { counts[r.item_id] = r.qty; });
      q(`SELECT pl.item_id, SUM(pl.qty) AS qty FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id WHERE p.outlet_id = ? AND p.date > ? GROUP BY pl.item_id`)
        .all(outletId, countDate).forEach((r) => { received[r.item_id] = r.qty; });
      theoreticalUsage(outletId, countDate, addDays(t, 1)).forEach((r) => { used[r.item_id] = r.qty; });
    }
    const costs = itemCosts();
    return {
      outletId, countDate,
      items: items.map((i) => {
        const onHand = round2(Math.max(0, (counts[i.id] || 0) + (received[i.id] || 0) - (used[i.id] || 0)));
        return { ...i, landedCost: round2(costs[i.id]), lastCount: counts[i.id] ?? null, received: round2(received[i.id] || 0), used: round2(used[i.id] || 0),
          onHand, value: round2(onHand * costs[i.id]), belowPar: onHand < i.par_level, suggestedOrder: onHand < i.par_level ? Math.ceil(i.par_level * 2 - onHand) : 0 };
      }),
    };
  }

  function countDates(outletId) {
    return q('SELECT DISTINCT date FROM stock_counts WHERE outlet_id = ? ORDER BY date DESC').all(Number(outletId)).map((r) => r.date);
  }

  // Actual vs theoretical usage between two counts.
  // Convention: counts are taken after the day's deliveries and before service.
  function variance({ outlet, from, to }) {
    const outletId = Number(outlet) || outlets()[0].id;
    const dates = countDates(outletId);
    const end = dates.includes(to) ? to : dates[0];
    const start = dates.includes(from) && from < end ? from : dates.find((d) => d < end);
    if (!start || !end || start >= end) return { outletId, dates, from: start, to: end, items: [], totals: null };
    const open = {}; const close = {}; const purchased = {}; const theo = {};
    q('SELECT item_id, qty FROM stock_counts WHERE outlet_id=? AND date=?').all(outletId, start).forEach((r) => { open[r.item_id] = r.qty; });
    q('SELECT item_id, qty FROM stock_counts WHERE outlet_id=? AND date=?').all(outletId, end).forEach((r) => { close[r.item_id] = r.qty; });
    q(`SELECT pl.item_id, SUM(pl.qty) AS qty FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id WHERE p.outlet_id=? AND p.date > ? AND p.date <= ? GROUP BY pl.item_id`)
      .all(outletId, start, end).forEach((r) => { purchased[r.item_id] = r.qty; });
    theoreticalUsage(outletId, start, end).forEach((r) => { theo[r.item_id] = r.qty; });
    const costs = itemCosts();
    const sales = q('SELECT COALESCE(SUM(taxable),0) AS s FROM orders WHERE outlet_id=? AND date >= ? AND date < ?').get(outletId, start, end).s;
    const items = plain(q('SELECT * FROM inventory_items ORDER BY category, name').all()).map((i) => {
      const actual = round2((open[i.id] || 0) + (purchased[i.id] || 0) - (close[i.id] || 0));
      const theoretical = round2(theo[i.id] || 0);
      const varianceQty = round2(actual - theoretical);
      return { id: i.id, name: i.name, category: i.category, unit: i.unit, open: open[i.id] || 0, purchased: round2(purchased[i.id] || 0), close: close[i.id] || 0,
        actual, theoretical, varianceQty, varianceValue: round2(varianceQty * costs[i.id]), variancePct: theoretical ? round2((varianceQty / theoretical) * 100) : null,
        actualValue: round2(actual * costs[i.id]), theoreticalValue: round2(theoretical * costs[i.id]) };
    }).sort((a, b) => b.varianceValue - a.varianceValue);
    const sum = (k) => round2(items.reduce((s, i) => s + i[k], 0));
    const actualValue = sum('actualValue');
    const theoreticalValue = sum('theoreticalValue');
    return { outletId, dates, from: start, to: end, items, totals: { sales, actualValue, theoreticalValue, varianceValue: round2(actualValue - theoreticalValue),
      actualPct: sales ? round2((actualValue / sales) * 100) : 0, theoreticalPct: sales ? round2((theoreticalValue / sales) * 100) : 0 } };
  }

  function saveCounts(body) {
    requireFields(body, ['outlet_id', 'date', 'counts']);
    outletById(body.outlet_id);
    const stmt = q('INSERT INTO stock_counts (outlet_id,item_id,date,qty) VALUES (?,?,?,?) ON CONFLICT(outlet_id,item_id,date) DO UPDATE SET qty = excluded.qty');
    transaction(db, () => body.counts.forEach((c) => {
      const qty = Number(c.qty);
      if (!(qty >= 0)) throw new HttpError(400, 'Counts must be zero or more');
      stmt.run(Number(body.outlet_id), Number(c.item_id), body.date, qty);
    }));
    return { saved: body.counts.length };
  }

  function vendors() { return plain(q('SELECT * FROM vendors ORDER BY name').all()); }

  function createVendor(body) {
    requireFields(body, ['name', 'gstin']);
    const check = validateGstin(body.gstin);
    if (!check.valid) throw new HttpError(400, `Invalid GSTIN: ${check.reason}`);
    const id = Number(q('INSERT INTO vendors (name,gstin,state_code,phone,category) VALUES (?,?,?,?,?)').run(body.name, check.gstin, check.stateCode, body.phone || '', body.category || '').lastInsertRowid);
    return { ...q('SELECT * FROM vendors WHERE id = ?').get(id) };
  }

  function purchases({ from, to, outlet }) {
    const f = outletFilter(outlet, 'p.');
    return plain(q(`SELECT p.*, v.name AS vendor, v.gstin AS vendor_gstin, o.name AS outlet, (SELECT COUNT(*) FROM purchase_lines WHERE purchase_id=p.id) AS lines
      FROM purchases p JOIN vendors v ON v.id=p.vendor_id JOIN outlets o ON o.id=p.outlet_id WHERE p.date BETWEEN ? AND ?${f.sql} ORDER BY p.date DESC, p.id DESC`).all(from, to));
  }

  function getPurchase(id) {
    const p = q('SELECT p.*, v.name AS vendor, v.gstin AS vendor_gstin FROM purchases p JOIN vendors v ON v.id=p.vendor_id WHERE p.id=?').get(Number(id));
    if (!p) throw new HttpError(404, 'Purchase not found');
    return { ...p, lines: plain(q('SELECT pl.*, i.name, i.unit, i.hsn FROM purchase_lines pl JOIN inventory_items i ON i.id=pl.item_id WHERE purchase_id=?').all(p.id)) };
  }

  function createPurchase(body) {
    requireFields(body, ['outlet_id', 'vendor_id', 'date', 'invoice_no', 'lines']);
    const outlet = outletById(body.outlet_id);
    const vendor = q('SELECT * FROM vendors WHERE id = ?').get(Number(body.vendor_id));
    if (!vendor) throw new HttpError(400, 'Unknown vendor');
    if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, 'Add at least one line');
    const interState = vendor.state_code && vendor.state_code !== outlet.state_code;
    return transaction(db, () => {
      const pid = Number(q('INSERT INTO purchases (outlet_id,vendor_id,date,invoice_no,taxable,cgst,sgst,igst,total) VALUES (?,?,?,?,0,0,0,0,0)')
        .run(outlet.id, vendor.id, body.date, body.invoice_no).lastInsertRowid);
      let taxable = 0; let tax = 0;
      body.lines.forEach((l) => {
        const item = q('SELECT * FROM inventory_items WHERE id = ?').get(Number(l.item_id));
        const qty = Number(l.qty); const rate = Number(l.rate);
        if (!item || !(qty > 0) || !(rate >= 0)) throw new HttpError(400, 'Invalid purchase line');
        q('INSERT INTO purchase_lines (purchase_id,item_id,qty,rate,gst_rate) VALUES (?,?,?,?,?)').run(pid, item.id, qty, rate, item.gst_rate);
        taxable += qty * rate; tax += (qty * rate * item.gst_rate) / 100;
        q('UPDATE inventory_items SET cost = ? WHERE id = ?').run(rate, item.id);
      });
      const half = round2(tax / 2);
      q('UPDATE purchases SET taxable=?, cgst=?, sgst=?, igst=?, total=? WHERE id=?')
        .run(round2(taxable), interState ? 0 : half, interState ? 0 : half, interState ? round2(tax) : 0, round2(taxable + tax), pid);
      return getPurchase(pid);
    });
  }

  function employees({ outlet }) {
    const f = outletFilter(outlet);
    return plain(q(`SELECT e.*, o.name AS outlet FROM employees e JOIN outlets o ON o.id=e.outlet_id WHERE active=1${f.sql.replace('outlet_id', 'e.outlet_id')} ORDER BY e.outlet_id, e.code`).all());
  }

  function createEmployee(body) {
    requireFields(body, ['outlet_id', 'name', 'role', 'basic']);
    const outlet = outletById(body.outlet_id);
    const n = q('SELECT COUNT(*) AS n FROM employees WHERE outlet_id=?').get(outlet.id).n + 1;
    const id = Number(q(`INSERT INTO employees (outlet_id,code,name,role,gender,state,basic,hra,allowances,pf_enabled,pf_capped,uan,esic_no,phone,joined) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(outlet.id, `${outlet.code}-${String(n).padStart(3, '0')}`, body.name, body.role, body.gender || 'M', outlet.state, Number(body.basic), Number(body.hra) || 0,
        Number(body.allowances) || 0, body.pf_enabled === false ? 0 : 1, 1, body.uan || '', body.esic_no || '', body.phone || '', body.joined || today()).lastInsertRowid);
    return employees({ outlet: outlet.id }).find((e) => e.id === id);
  }

  function payroll({ month, outlet }) {
    const m = Number(month.slice(5, 7));
    const days = monthDays(month);
    const adj = {};
    q('SELECT * FROM payroll_adjustments WHERE month = ?').all(month).forEach((a) => { adj[a.employee_id] = a; });
    const rows = employees({ outlet }).map((e) => {
      const a = adj[e.id] || { lop_days: 0, bonus: 0 };
      return { employee: e, ...computePayslip(e, { month: m, monthDays: days, lopDays: a.lop_days, bonus: a.bonus }) };
    });
    const keys = ['gross', 'pfEmployee', 'pfEmployer', 'eps', 'edli', 'pfAdmin', 'esiEmployee', 'esiEmployer', 'pt', 'net', 'employerCost'];
    const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)]));
    return { month, monthDays: days, rows, totals };
  }

  function adjustPayroll(body) {
    requireFields(body, ['employee_id', 'month']);
    q(`INSERT INTO payroll_adjustments (employee_id, month, lop_days, bonus) VALUES (?,?,?,?)
       ON CONFLICT(employee_id, month) DO UPDATE SET lop_days=excluded.lop_days, bonus=excluded.bonus`)
      .run(Number(body.employee_id), body.month, Math.max(0, Number(body.lop_days) || 0), Math.max(0, Number(body.bonus) || 0));
    return { ok: true };
  }

  function schedule({ outlet, week }) {
    const outletId = Number(outlet) || outlets()[0].id;
    const t = week || today();
    const monday = addDays(t, -((new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7));
    const sunday = addDays(monday, 6);
    const emps = employees({ outlet: outletId });
    const shifts = plain(q('SELECT * FROM shifts WHERE outlet_id=? AND date BETWEEN ? AND ? ORDER BY start').all(outletId, monday, sunday));
    const hours = (s) => { const [a, b] = [s.start, s.end].map((x) => Number(x.slice(0, 2)) + Number(x.slice(3)) / 60); return b > a ? b - a : b + 24 - a; };
    const hourly = Object.fromEntries(emps.map((e) => [e.id, computePayslip(e).employerCost / (26 * 8)]));
    const daily = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      const dayShifts = shifts.filter((s) => s.date === date);
      return { date, staff: dayShifts.length, hours: round2(dayShifts.reduce((s, x) => s + hours(x), 0)), cost: round2(dayShifts.reduce((s, x) => s + hours(x) * (hourly[x.employee_id] || 0), 0)) };
    });
    // Forecast sales from the same weekday over the previous 4 weeks.
    daily.forEach((d) => {
      const r = q(`SELECT AVG(s) AS avg FROM (SELECT SUM(taxable) AS s FROM orders WHERE outlet_id=? AND date IN (?,?,?,?) GROUP BY date)`)
        .get(outletId, addDays(d.date, -7), addDays(d.date, -14), addDays(d.date, -21), addDays(d.date, -28));
      d.forecastSales = round2(r.avg || 0);
      d.labourPct = d.forecastSales ? round2((d.cost / d.forecastSales) * 100) : null;
    });
    return { outletId, monday, sunday, employees: emps, shifts: shifts.map((s) => ({ ...s, hours: round2(hours(s)) })), daily };
  }

  function createShift(body) {
    requireFields(body, ['employee_id', 'date', 'start', 'end']);
    const e = q('SELECT * FROM employees WHERE id=?').get(Number(body.employee_id));
    if (!e) throw new HttpError(400, 'Unknown employee');
    if (!/^\d{2}:\d{2}$/.test(body.start) || !/^\d{2}:\d{2}$/.test(body.end)) throw new HttpError(400, 'Times must be HH:MM');
    const clash = q('SELECT id FROM shifts WHERE employee_id=? AND date=?').get(e.id, body.date);
    if (clash) throw new HttpError(409, 'Employee already has a shift that day');
    const id = Number(q('INSERT INTO shifts (outlet_id,employee_id,date,start,end,station) VALUES (?,?,?,?,?,?)').run(e.outlet_id, e.id, body.date, body.start, body.end, body.station || '').lastInsertRowid);
    return { ...q('SELECT * FROM shifts WHERE id=?').get(id) };
  }

  function deleteShift(id) {
    q('DELETE FROM shifts WHERE id=?').run(Number(id));
    return { ok: true };
  }

  function expenses({ from, to, outlet }) {
    const f = outletFilter(outlet, 'e.');
    return plain(q(`SELECT e.*, o.name AS outlet FROM expenses e JOIN outlets o ON o.id=e.outlet_id WHERE e.date BETWEEN ? AND ?${f.sql} ORDER BY e.date DESC`).all(from, to));
  }

  function createExpense(body) {
    requireFields(body, ['outlet_id', 'date', 'category', 'amount']);
    outletById(body.outlet_id);
    const amount = Number(body.amount);
    if (!(amount > 0)) throw new HttpError(400, 'Amount must be positive');
    const id = Number(q('INSERT INTO expenses (outlet_id,date,category,amount,note) VALUES (?,?,?,?,?)').run(Number(body.outlet_id), body.date, body.category, amount, body.note || '').lastInsertRowid);
    return { ...q('SELECT * FROM expenses WHERE id=?').get(id) };
  }

  // Actual food cost % from the counted window inside (or just before) the period.
  function actualFoodCostPct(outletId, from, to) {
    const dates = countDates(outletId).filter((d) => d <= to);
    const end = dates[0];
    const start = dates.find((d) => d < end && d <= from) || dates[dates.length - 1];
    if (!start || !end || start >= end) return null;
    const v = variance({ outlet: outletId, from: start, to: end });
    return v.totals && v.totals.sales ? { pct: v.totals.actualPct, from: start, to: end } : null;
  }

  function pnl({ from, to, outlet }) {
    const ids = outlet && outlet !== 'all' ? [Number(outlet)] : outlets().map((o) => o.id);
    const lines = ids.map((id) => {
      const sales = q('SELECT COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(taxable),0) AS net FROM orders WHERE outlet_id=? AND date BETWEEN ? AND ?').get(id, from, to);
      const actual = actualFoodCostPct(id, from, to);
      const theoretical = theoreticalFoodCost(from, to, id);
      const cogs = actual ? round2((sales.net * actual.pct) / 100) : theoretical;
      const agg = aggregatorCosts(from, to, id);
      const labour = labourCost(from, to, id);
      const exp = {};
      q('SELECT category, SUM(amount) AS amount FROM expenses WHERE outlet_id=? AND date BETWEEN ? AND ? GROUP BY category').all(id, from, to).forEach((r) => { exp[r.category] = r.amount; });
      const opex = Object.values(exp).reduce((s, x) => s + x, 0);
      const grossProfit = round2(sales.net - cogs - agg.commission - agg.commissionGst);
      return { outletId: id, sales, cogs, cogsBasis: actual ? `Actual ${actual.pct}% (counts ${actual.from} → ${actual.to})` : 'Theoretical (no counts)',
        theoreticalCogs: theoretical, aggregatorCommission: agg.commission, aggregatorCommissionGst: agg.commissionGst, tds194O: agg.tds,
        grossProfit, labour, expenses: exp, opex: round2(opex), ebitda: round2(grossProfit - labour - opex) };
    });
    return { from, to, outlets: outlets().filter((o) => ids.includes(o.id)), lines };
  }

  function gstSummary({ month, outlet }) {
    const from = `${month}-01`;
    const to = `${month}-${String(monthDays(month)).padStart(2, '0')}`;
    const ids = outlet && outlet !== 'all' ? [Number(outlet)] : outlets().map((o) => o.id);
    return {
      month, from, to,
      outlets: ids.map((id) => {
        const o = outletById(id);
        const direct = q(`SELECT COUNT(*) AS invoices, COALESCE(SUM(taxable),0) AS taxable, COALESCE(SUM(cgst),0) AS cgst, COALESCE(SUM(sgst),0) AS sgst
          FROM orders WHERE outlet_id=? AND date BETWEEN ? AND ? AND gst_by_eco = 0`).get(id, from, to);
        const eco = plain(q(`SELECT channel, COUNT(*) AS orders, SUM(taxable) AS taxable, SUM(eco_gst) AS gst FROM orders WHERE outlet_id=? AND date BETWEEN ? AND ? AND gst_by_eco = 1 GROUP BY channel`).all(id, from, to));
        const inward = q(`SELECT COUNT(*) AS bills, COALESCE(SUM(taxable),0) AS taxable, COALESCE(SUM(cgst),0) AS cgst, COALESCE(SUM(sgst),0) AS sgst, COALESCE(SUM(igst),0) AS igst
          FROM purchases WHERE outlet_id=? AND date BETWEEN ? AND ?`).get(id, from, to);
        const agg = aggregatorCosts(from, to, id);
        const scheme = SCHEMES[o.gst_scheme] || SCHEMES.regular;
        const range = q('SELECT MIN(invoice_no) AS first, MAX(invoice_no) AS last FROM orders WHERE outlet_id=? AND date BETWEEN ? AND ?').get(id, from, to);
        const itc = scheme.itc ? round2(inward.cgst + inward.sgst + inward.igst + agg.commissionGst) : 0;
        const liability = round2(direct.cgst + direct.sgst);
        return { outlet: o, scheme: scheme.label, sac: RESTAURANT_SAC, direct: { ...direct }, eco, inward: { ...inward },
          ineligibleItc: scheme.itc ? 0 : round2(inward.cgst + inward.sgst + inward.igst + agg.commissionGst), itc,
          commissionGst: agg.commissionGst, tds194O: agg.tds, invoiceRange: { ...range }, netPayable: round2(Math.max(0, liability - itc)) };
      }),
    };
  }

  function compliance({ outlet }) {
    const t = today();
    const f = outletFilter(outlet, 'l.');
    const licenses = plain(q(`SELECT l.*, o.name AS outlet FROM licenses l JOIN outlets o ON o.id=l.outlet_id WHERE 1=1${f.sql} ORDER BY l.expiry`).all())
      .map((l) => ({ ...l, ...licenseStatus(l.expiry, t) }));
    const states = outlets().filter((o) => !f.one || o.id === f.one).map((o) => o.state);
    return { today: t, licenses, calendar: filingCalendar(t, 45, states), licenseTypes: LICENSE_TYPES };
  }

  function createLicense(body) {
    requireFields(body, ['outlet_id', 'type', 'number', 'expiry']);
    outletById(body.outlet_id);
    const id = Number(q('INSERT INTO licenses (outlet_id,type,number,authority,issued,expiry) VALUES (?,?,?,?,?,?)')
      .run(Number(body.outlet_id), body.type, body.number, body.authority || '', body.issued || today(), body.expiry).lastInsertRowid);
    return { ...q('SELECT * FROM licenses WHERE id=?').get(id) };
  }

  function renewLicense(id, body) {
    requireFields(body, ['expiry']);
    const l = q('SELECT * FROM licenses WHERE id=?').get(Number(id));
    if (!l) throw new HttpError(404, 'Licence not found');
    q('UPDATE licenses SET expiry=?, issued=?, number=? WHERE id=?').run(body.expiry, today(), body.number || l.number, l.id);
    return { ...q('SELECT * FROM licenses WHERE id=?').get(l.id) };
  }

  // Route table: [method, pattern, handler(params, query, body)].
  const routes = [
    ['GET', '/api/meta', () => ({ brand, today: today(), outlets: outlets(), channels: channels(), states: STATES, schemes: SCHEMES })],
    ['GET', '/api/dashboard', (_, qs) => dashboard(qs)],
    ['GET', '/api/sales/daily', (_, qs) => dailySales(qs)],
    ['GET', '/api/orders', (_, qs) => listOrders(qs)],
    ['POST', '/api/orders', (_, __, b) => createOrder(b)],
    ['GET', '/api/orders/:id', (p) => getOrder(p.id)],
    ['GET', '/api/menu', (_, qs) => menu(qs)],
    ['PUT', '/api/menu/:id', (p, _, b) => updateMenuItem(p.id, b)],
    ['GET', '/api/inventory', (_, qs) => inventory(qs)],
    ['GET', '/api/inventory/variance', (_, qs) => variance(qs)],
    ['POST', '/api/stock-counts', (_, __, b) => saveCounts(b)],
    ['GET', '/api/vendors', () => vendors()],
    ['POST', '/api/vendors', (_, __, b) => createVendor(b)],
    ['GET', '/api/gstin/:gstin', (p) => validateGstin(p.gstin)],
    ['GET', '/api/purchases', (_, qs) => purchases(qs)],
    ['POST', '/api/purchases', (_, __, b) => createPurchase(b)],
    ['GET', '/api/purchases/:id', (p) => getPurchase(p.id)],
    ['GET', '/api/employees', (_, qs) => employees(qs)],
    ['POST', '/api/employees', (_, __, b) => createEmployee(b)],
    ['GET', '/api/payroll', (_, qs) => payroll(qs)],
    ['POST', '/api/payroll/adjust', (_, __, b) => adjustPayroll(b)],
    ['GET', '/api/schedule', (_, qs) => schedule(qs)],
    ['POST', '/api/shifts', (_, __, b) => createShift(b)],
    ['DELETE', '/api/shifts/:id', (p) => deleteShift(p.id)],
    ['GET', '/api/expenses', (_, qs) => expenses(qs)],
    ['POST', '/api/expenses', (_, __, b) => createExpense(b)],
    ['GET', '/api/pnl', (_, qs) => pnl(qs)],
    ['GET', '/api/gst', (_, qs) => gstSummary(qs)],
    ['GET', '/api/compliance', (_, qs) => compliance(qs)],
    ['POST', '/api/licenses', (_, __, b) => createLicense(b)],
    ['PUT', '/api/licenses/:id', (p, _, b) => renewLicense(p.id, b)],
  ].map(([method, pattern, handler]) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    return { method, re, keys, handler };
  });

  // Defaults for date-range endpoints: the last 30 days.
  function withDefaults(qs) {
    const t = today();
    return { to: t, from: addDays(t, -29), month: t.slice(0, 7), ...qs };
  }

  function handle(method, path, query, body) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler(params, withDefaults(query), body || {});
    }
    throw new HttpError(404, 'Not found');
  }

  return { handle };
}

module.exports = { createApi, HttpError };
