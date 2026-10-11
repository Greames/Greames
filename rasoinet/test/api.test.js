const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApi } = require('../src/api');

const TODAY = '2026-10-11';
const db = openDb(':memory:');
seed(db, { today: TODAY });
const api = createApi(db, { today: () => TODAY });
const call = (method, path, query = {}, body) => api.handle(method, path, query, body);

test('dashboard KPIs are consistent', () => {
  const d = call('GET', '/api/dashboard', { outlet: 'all' });
  assert.ok(d.kpis.netSales > 0);
  assert.equal(d.byOutlet.length, 3);
  const channelTotal = d.byChannel.reduce((s, c) => s + c.netSales, 0);
  assert.ok(Math.abs(channelTotal - d.kpis.netSales) < 1);
  assert.ok(d.kpis.foodCostPct > 20 && d.kpis.foodCostPct < 45);
  assert.equal(d.daily.length, 30);
});

test('billing creates a sequential GST invoice', () => {
  const o = call('POST', '/api/orders', {}, { outlet_id: 1, channel: 'Dine-in', payment_mode: 'UPI', covers: 2, lines: [{ menu_item_id: 1, qty: 2 }] });
  assert.match(o.invoice_no, /^KRM\/2627\/\d{6}$/);
  assert.equal(o.cgst, o.sgst);
  assert.equal(o.total, Math.round(o.taxable * 1.05));
  const next = call('POST', '/api/orders', {}, { outlet_id: 1, channel: 'Zomato', lines: [{ menu_item_id: 2, qty: 1 }] });
  assert.equal(Number(next.invoice_no.slice(-6)), Number(o.invoice_no.slice(-6)) + 1);
  assert.equal(next.gst_by_eco, 1);
  assert.equal(next.payment_mode, 'Zomato');
  assert.throws(() => call('POST', '/api/orders', {}, { outlet_id: 1, channel: 'Dine-in', lines: [] }), /at least one/);
});

test('variance compares counted usage with recipe usage', () => {
  const v = call('GET', '/api/inventory/variance', { outlet: '1' });
  assert.ok(v.from < v.to);
  assert.ok(v.totals.actualValue > v.totals.theoreticalValue * 0.95);
  const item = v.items[0];
  assert.equal(item.actual, Math.round((item.open + item.purchased - item.close) * 100) / 100);
});

test('purchases split tax by vendor state', () => {
  const vendor = call('POST', '/api/vendors', {}, { name: 'Pune Spices', gstin: '27AAPFU0939F1ZV', category: 'Spices' });
  const p = call('POST', '/api/purchases', {}, { outlet_id: 1, vendor_id: vendor.id, date: TODAY, invoice_no: 'PS/1', lines: [{ item_id: 10, qty: 2, rate: 600 }] });
  assert.equal(p.igst, 60);
  assert.equal(p.cgst, 0);
  assert.equal(p.total, 1260);
  assert.throws(() => call('POST', '/api/vendors', {}, { name: 'Bad', gstin: '29ABCDE1234F1Z0' }), /Invalid GSTIN/);
});

test('payroll applies loss-of-pay adjustments', () => {
  const before = call('GET', '/api/payroll', { month: '2026-10', outlet: '1' });
  const emp = before.rows[0];
  call('POST', '/api/payroll/adjust', {}, { employee_id: emp.employee.id, month: '2026-10', lop_days: 3 });
  const after = call('GET', '/api/payroll', { month: '2026-10', outlet: '1' });
  assert.ok(after.rows[0].gross < emp.gross);
  assert.equal(after.rows[0].paidDays, 28);
});

test('schedule rejects double booking', () => {
  const s = call('GET', '/api/schedule', { outlet: '1' });
  const shift = s.shifts[0];
  assert.throws(() => call('POST', '/api/shifts', {}, { employee_id: shift.employee_id, date: shift.date, start: '09:00', end: '17:00' }), /already has a shift/);
  assert.equal(s.daily.length, 7);
});

test('GST summary reports ECO supplies separately and no ITC for 5% restaurants', () => {
  const g = call('GET', '/api/gst', { month: '2026-09', outlet: '1' });
  const o = g.outlets[0];
  assert.ok(o.eco.length >= 2);
  assert.equal(o.itc, 0);
  assert.ok(o.ineligibleItc > 0);
  assert.equal(o.netPayable, Math.round((o.direct.cgst + o.direct.sgst) * 100) / 100);
});

test('P&L and compliance endpoints respond', () => {
  const p = call('GET', '/api/pnl', { from: '2026-09-01', to: '2026-09-30', outlet: 'all' });
  assert.equal(p.lines.length, 3);
  p.lines.forEach((l) => assert.ok(l.sales.net > 0 && Number.isFinite(l.ebitda)));
  const c = call('GET', '/api/compliance', { outlet: 'all' });
  assert.ok(c.licenses.some((l) => l.status === 'expired'));
  assert.ok(c.calendar.length > 0);
});
