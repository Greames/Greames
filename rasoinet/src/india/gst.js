// GST rules for Indian restaurants.
// Rates and thresholds are defaults — verify against current CBIC notifications.

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const STATES = {
  '07': { name: 'Delhi', code: 'DL' },
  '19': { name: 'West Bengal', code: 'WB' },
  '24': { name: 'Gujarat', code: 'GJ' },
  '27': { name: 'Maharashtra', code: 'MH' },
  '29': { name: 'Karnataka', code: 'KA' },
  '32': { name: 'Kerala', code: 'KL' },
  '33': { name: 'Tamil Nadu', code: 'TN' },
  '36': { name: 'Telangana', code: 'TS' },
};

// SAC for restaurant services.
const RESTAURANT_SAC = '996331';

// Restaurant service rates. Standalone restaurants: 5% without ITC.
// Restaurants in hotels with room tariff > ₹7,500: 18% with ITC.
const SCHEMES = {
  regular: { rate: 5, itc: false, label: 'Regular (5%, no ITC)' },
  hotel: { rate: 18, itc: true, label: 'Hotel restaurant (18%, with ITC)' },
  composition: { rate: 5, itc: false, label: 'Composition (5% on turnover, bill of supply)' },
};

// Sales through e-commerce operators (Swiggy, Zomato, ONDC apps): GST is
// collected and paid by the operator under Section 9(5), not the restaurant.
const ECO_CHANNELS = new Set(['Swiggy', 'Zomato', 'ONDC']);

// Section 194-O TDS deducted by the operator on gross sales.
const TDS_194O_RATE = 0.1;
// GST charged on the operator's commission.
const GST_ON_COMMISSION = 18;

function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

function validateGstin(raw) {
  const gstin = String(raw || '').trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, gstin, reason: 'Format must be 15 characters: 2-digit state code, PAN, entity number, Z, check digit' };
  const state = STATES[gstin.slice(0, 2)];
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, gstin, reason: 'Check digit does not match' };
  return { valid: true, gstin, stateCode: gstin.slice(0, 2), state: state ? state.name : 'Other', pan: gstin.slice(2, 12) };
}

// Builds a valid GSTIN from a state code, PAN and entity number (used by the seed).
function makeGstin(stateCode, pan, entity = '1') {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Tax for a restaurant bill. Intra-state supply, so tax splits into CGST + SGST.
function computeBill({ subtotal, discount = 0, channel, scheme = 'regular' }) {
  const taxable = round2(Math.max(0, subtotal - discount));
  const { rate } = SCHEMES[scheme] || SCHEMES.regular;
  const byEco = ECO_CHANNELS.has(channel);
  // Composition dealers cannot collect tax; ECO sales are taxed by the operator.
  const charged = byEco || scheme === 'composition' ? 0 : rate;
  const cgst = round2((taxable * charged) / 200);
  const sgst = cgst;
  const exact = taxable + cgst + sgst;
  const total = Math.round(exact);
  return {
    taxable, rate: charged, cgst, sgst,
    roundOff: round2(total - exact), total,
    gstByEco: byEco ? 1 : 0,
    ecoGst: byEco ? round2((taxable * rate) / 100) : 0,
  };
}

// What the aggregator actually pays out to the restaurant.
function aggregatorPayout(gross, commissionPct) {
  const commission = round2((gross * commissionPct) / 100);
  const commissionGst = round2((commission * GST_ON_COMMISSION) / 100);
  const tds = round2((gross * TDS_194O_RATE) / 100);
  return { gross: round2(gross), commission, commissionGst, tds, net: round2(gross - commission - commissionGst - tds) };
}

// Landed cost of an input. Without ITC, GST paid on purchases is part of cost.
function landedCost(cost, gstRate, scheme = 'regular') {
  const s = SCHEMES[scheme] || SCHEMES.regular;
  return s.itc ? cost : cost * (1 + gstRate / 100);
}

module.exports = {
  STATES, SCHEMES, ECO_CHANNELS, RESTAURANT_SAC, TDS_194O_RATE, GST_ON_COMMISSION,
  validateGstin, makeGstin, gstinCheckChar, computeBill, aggregatorPayout, landedCost, round2,
};
