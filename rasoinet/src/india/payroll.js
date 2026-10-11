// Statutory payroll for Indian restaurant staff: EPF, ESI, Professional Tax.
// Rates are defaults — verify against current EPFO / ESIC / state notifications.

const PF_WAGE_CEILING = 15000;
const PF_EMPLOYEE_RATE = 0.12;
const PF_EMPLOYER_RATE = 0.12;
const EPS_RATE = 0.0833;
const EDLI_RATE = 0.005;
const PF_ADMIN_RATE = 0.005;

const ESI_WAGE_CEILING = 21000;
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_EMPLOYER_RATE = 0.0325;

// Monthly professional tax slabs by state: [upToGross, amount].
// `feb` overrides the amount for February where the state collects extra.
const PT_SLABS = {
  KA: { slabs: [[24999, 0], [Infinity, 200]], feb: { 200: 300 } },
  TS: { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  MH: {
    slabs: [[7500, 0], [10000, 175], [Infinity, 200]],
    femaleSlabs: [[25000, 0], [Infinity, 200]],
    feb: { 200: 300 },
  },
  WB: { slabs: [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [Infinity, 200]] },
  DL: { slabs: [[Infinity, 0]] },
};

function professionalTax(state, gross, { gender = 'M', month = 1 } = {}) {
  const rule = PT_SLABS[state];
  if (!rule) return 0;
  const slabs = gender === 'F' && rule.femaleSlabs ? rule.femaleSlabs : rule.slabs;
  const amount = slabs.find(([upTo]) => gross <= upTo)[1];
  if (month === 2 && rule.feb && rule.feb[amount]) return rule.feb[amount];
  return amount;
}

// paidDays / monthDays prorates fixed monthly salary for loss of pay.
function computePayslip(emp, { month = 1, monthDays = 30, lopDays = 0, bonus = 0 } = {}) {
  const paidDays = Math.max(0, monthDays - lopDays);
  const factor = paidDays / monthDays;
  const fixed = emp.basic + emp.hra + emp.allowances;
  const basic = Math.round(emp.basic * factor);
  const hra = Math.round(emp.hra * factor);
  const allowances = Math.round(emp.allowances * factor);
  const gross = basic + hra + allowances + bonus;

  // EPF: on basic (+DA), capped at the wage ceiling when the employee opts for it.
  const pfWage = emp.pf_capped ? Math.min(basic, PF_WAGE_CEILING) : basic;
  const pfEmployee = emp.pf_enabled ? Math.round(pfWage * PF_EMPLOYEE_RATE) : 0;
  const eps = emp.pf_enabled ? Math.round(Math.min(basic, PF_WAGE_CEILING) * EPS_RATE) : 0;
  const pfEmployer = emp.pf_enabled ? Math.round(pfWage * PF_EMPLOYER_RATE) - eps : 0;
  const edli = emp.pf_enabled ? Math.round(Math.min(basic, PF_WAGE_CEILING) * EDLI_RATE) : 0;
  const pfAdmin = emp.pf_enabled ? Math.round(pfWage * PF_ADMIN_RATE) : 0;

  // ESI: applies when the fixed monthly wage is within the ceiling. ESIC rounds up.
  const esiCovered = fixed <= ESI_WAGE_CEILING;
  const esiEmployee = esiCovered ? Math.ceil(gross * ESI_EMPLOYEE_RATE) : 0;
  const esiEmployer = esiCovered ? Math.ceil(gross * ESI_EMPLOYER_RATE) : 0;

  const pt = professionalTax(emp.state, gross, { gender: emp.gender, month });
  const deductions = pfEmployee + esiEmployee + pt;
  const employerCost = gross + pfEmployer + eps + edli + pfAdmin + esiEmployer;

  // Code on Wages: basic must be at least 50% of total remuneration.
  const wageCodeOk = emp.basic >= fixed * 0.5;

  return {
    paidDays, lopDays, basic, hra, allowances, bonus, gross,
    pfEmployee, pfEmployer, eps, edli, pfAdmin,
    esiCovered, esiEmployee, esiEmployer, pt,
    deductions, net: gross - deductions, employerCost, wageCodeOk,
  };
}

// Employer cost of a full month, used to spread labour over date ranges.
function monthlyEmployerCost(emp) {
  return computePayslip(emp).employerCost;
}

module.exports = {
  PF_WAGE_CEILING, ESI_WAGE_CEILING, PT_SLABS,
  professionalTax, computePayslip, monthlyEmployerCost,
};
