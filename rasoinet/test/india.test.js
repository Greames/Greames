const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGstin, makeGstin, computeBill, aggregatorPayout, landedCost } = require('../src/india/gst');
const { computePayslip, professionalTax } = require('../src/india/payroll');
const { filingCalendar, licenseStatus } = require('../src/india/compliance');

test('GSTIN validation checks format and check digit', () => {
  assert.equal(validateGstin('27AAPFU0939F1ZV').valid, true);
  assert.equal(validateGstin('27AAPFU0939F1ZV').state, 'Maharashtra');
  assert.equal(validateGstin('27aapfu0939f1zv').valid, true);
  assert.equal(validateGstin('27AAPFU0939F1ZX').valid, false);
  assert.match(validateGstin('27AAPFU0939F1Z').reason, /Format/);
  const made = makeGstin('29', 'AAKCR4821M');
  assert.equal(validateGstin(made).valid, true);
  assert.equal(validateGstin(made).stateCode, '29');
});

test('dine-in bill charges CGST + SGST at 2.5% each and rounds to the rupee', () => {
  const b = computeBill({ subtotal: 845, discount: 0, channel: 'Dine-in' });
  assert.equal(b.taxable, 845);
  assert.equal(b.cgst, 21.13);
  assert.equal(b.sgst, 21.13);
  assert.equal(b.total, 887);
  assert.equal(b.roundOff, -0.26);
  assert.equal(b.gstByEco, 0);
});

test('aggregator orders: GST is paid by the operator under Section 9(5)', () => {
  const b = computeBill({ subtotal: 1000, discount: 100, channel: 'Swiggy' });
  assert.equal(b.taxable, 900);
  assert.equal(b.cgst, 0);
  assert.equal(b.total, 900);
  assert.equal(b.gstByEco, 1);
  assert.equal(b.ecoGst, 45);
});

test('composition outlets issue a bill of supply without tax', () => {
  const b = computeBill({ subtotal: 500, channel: 'Dine-in', scheme: 'composition' });
  assert.equal(b.cgst, 0);
  assert.equal(b.total, 500);
});

test('aggregator payout deducts commission, GST on commission and 194-O TDS', () => {
  const p = aggregatorPayout(10000, 22);
  assert.deepEqual(p, { gross: 10000, commission: 2200, commissionGst: 396, tds: 10, net: 7394 });
});

test('landed cost includes GST when ITC is not available', () => {
  assert.equal(landedCost(100, 5), 105);
  assert.equal(landedCost(100, 5, 'hotel'), 100);
});

test('payslip: ESI-covered steward in Karnataka', () => {
  const emp = { basic: 9000, hra: 3600, allowances: 2400, pf_enabled: 1, pf_capped: 1, state: 'KA', gender: 'M' };
  const s = computePayslip(emp, { month: 10, monthDays: 31 });
  assert.equal(s.gross, 15000);
  assert.equal(s.pfEmployee, 1080);
  assert.equal(s.eps, 750);
  assert.equal(s.pfEmployer, 330);
  assert.equal(s.esiCovered, true);
  assert.equal(s.esiEmployee, 113);
  assert.equal(s.esiEmployer, 488);
  assert.equal(s.pt, 0);
  assert.equal(s.net, 15000 - 1080 - 113);
  assert.equal(s.wageCodeOk, true);
});

test('payslip: manager above ESI and PF ceilings, with loss of pay', () => {
  const emp = { basic: 30000, hra: 12000, allowances: 8000, pf_enabled: 1, pf_capped: 1, state: 'KA', gender: 'F' };
  const s = computePayslip(emp, { month: 2, monthDays: 28, lopDays: 2 });
  assert.equal(s.basic, Math.round((30000 * 26) / 28));
  assert.equal(s.pfEmployee, 1800);
  assert.equal(s.esiCovered, false);
  assert.equal(s.esiEmployee, 0);
  assert.equal(s.pt, 300);
});

test('wage code flags basic below 50% of pay', () => {
  const s = computePayslip({ basic: 6500, hra: 4500, allowances: 3000, pf_enabled: 1, pf_capped: 1, state: 'TS' });
  assert.equal(s.wageCodeOk, false);
});

test('professional tax slabs by state', () => {
  assert.equal(professionalTax('TS', 15000), 0);
  assert.equal(professionalTax('TS', 18000), 150);
  assert.equal(professionalTax('TS', 25000), 200);
  assert.equal(professionalTax('MH', 9000, { gender: 'M' }), 175);
  assert.equal(professionalTax('MH', 20000, { gender: 'F' }), 0);
  assert.equal(professionalTax('MH', 30000, { month: 2 }), 300);
  assert.equal(professionalTax('DL', 50000), 0);
});

test('filing calendar lists GST, PF and ESI due dates in range', () => {
  const cal = filingCalendar('2026-10-11', 30, ['KA']);
  const names = cal.map((e) => `${e.due} ${e.name}`);
  assert.ok(names.includes('2026-10-11 GSTR-1 (outward supplies)'));
  assert.ok(names.includes('2026-10-15 PF ECR & payment'));
  assert.ok(names.includes('2026-10-20 GSTR-3B (summary return & tax)'));
  assert.ok(names.includes('2026-10-20 Professional Tax (KA)'));
  assert.ok(names.includes('2026-11-07 TDS deposit (Challan 281)'));
  assert.ok(cal.every((e) => e.due >= '2026-10-11' && e.due <= '2026-11-10'));
});

test('licence status thresholds', () => {
  assert.equal(licenseStatus('2026-10-01', '2026-10-11').status, 'expired');
  assert.equal(licenseStatus('2026-11-01', '2026-10-11').status, 'due');
  assert.equal(licenseStatus('2026-12-15', '2026-10-11').status, 'upcoming');
  assert.equal(licenseStatus('2027-06-01', '2026-10-11').status, 'valid');
});
