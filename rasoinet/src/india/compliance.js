// Recurring statutory due dates and licence tracking for Indian restaurants.

const LICENSE_TYPES = [
  'FSSAI Licence', 'GST Registration', 'Shop & Establishment', 'Trade Licence',
  'Fire NOC', 'Eating House Licence', 'Health Trade Licence', 'Signage Licence',
  'Music Licence (PPL/IPRS)', 'Liquor Licence', 'Pollution Control (CTO)',
];

// day: day of the following month the filing for a period is due.
const MONTHLY_FILINGS = [
  { name: 'TDS deposit (Challan 281)', day: 7, authority: 'Income Tax' },
  { name: 'GSTR-1 (outward supplies)', day: 11, authority: 'GST' },
  { name: 'PF ECR & payment', day: 15, authority: 'EPFO' },
  { name: 'ESI contribution', day: 15, authority: 'ESIC' },
  { name: 'GSTR-3B (summary return & tax)', day: 20, authority: 'GST' },
];

// Professional tax payment day by state (monthly payers).
const PT_DUE_DAY = { KA: 20, TS: 10, MH: 31, WB: 21 };

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const monthLabel = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// Filings due in [from, from + horizonDays], for the states the business operates in.
function filingCalendar(fromIso, horizonDays = 45, states = []) {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const until = iso(new Date(from.getTime() + horizonDays * 86400000));
  const events = [];
  for (let offset = -1; offset <= 2; offset++) {
    const dueMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
    const y = dueMonth.getUTCFullYear();
    const m = dueMonth.getUTCMonth();
    const period = monthLabel(y, m - 1);
    const add = (name, day, authority) => {
      const due = iso(new Date(Date.UTC(y, m, Math.min(day, lastDay(y, m)))));
      if (due >= fromIso && due <= until) events.push({ name, period, due, authority, daysLeft: daysBetween(fromIso, due) });
    };
    MONTHLY_FILINGS.forEach((f) => add(f.name, f.day, f.authority));
    [...new Set(states)].forEach((s) => PT_DUE_DAY[s] && add(`Professional Tax (${s})`, PT_DUE_DAY[s], 'State'));
    if (m === 11) add('GSTR-9 annual return (previous FY)', 31, 'GST');
  }
  return events.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
}

function licenseStatus(expiry, todayIso) {
  const daysLeft = daysBetween(todayIso, expiry);
  let status = 'valid';
  if (daysLeft < 0) status = 'expired';
  else if (daysLeft <= 30) status = 'due';
  else if (daysLeft <= 90) status = 'upcoming';
  return { daysLeft, status };
}

module.exports = { LICENSE_TYPES, MONTHLY_FILINGS, filingCalendar, licenseStatus, daysBetween, iso };
