# RasoiNet

A multi-outlet restaurant back-office built for India, along the lines of Rosnet (RTI) in the US. It covers sales, food cost, labour, P&L and compliance, with Indian tax and labour rules built in.

It has no dependencies. It runs on Node.js 22.13 or later and uses the built-in `node:sqlite`.

```bash
cd rasoinet
npm start          # http://localhost:3000 — seeds demo data on first run
npm run reseed     # wipe and regenerate demo data
npm test
```

Environment variables: `PORT` (default 3000), `DB_FILE` (default `data/rasoinet.db`), `BRAND` (the name printed on invoices).

## Modules

| Area | What it does | India-specific |
|---|---|---|
| **Dashboard** | Net sales, orders, covers, food/labour/prime cost %, channel and payment mix, hourly sales, top items, outlet comparison | Lakh/crore formatting, Swiggy/Zomato/ONDC channels, UPI as a payment mode |
| **Sales** | Daily sales report by channel and payment mode, invoice register | CGST/SGST per day, for reconciling cash, UPI and card |
| **Billing (POS)** | Quick billing that prints a tax invoice | GST invoice with GSTIN, FSSAI no., SAC 996331, place of supply, per-FY invoice series (`KRM/2627/000123`), veg/non-veg marks |
| **Menu & recipes** | Recipe cards, plate cost, food cost %, margin, menu engineering (Star/Plowhorse/Puzzle/Dog) | Ingredient cost includes GST, since 5% restaurants cannot claim ITC |
| **Inventory** | Estimated stock on hand, par alerts, count sheets, actual vs theoretical usage by ingredient | HSN codes on items |
| **Purchases & vendors** | Goods received (GRN) with tax, vendor master | GSTIN check (format, state code, check digit); IGST for inter-state vendors, CGST + SGST otherwise |
| **Staff schedule** | Weekly roster, labour cost against a sales forecast | Flags weeks over 48 hours (Shops & Establishments overtime) |
| **Payroll** | Salary register, LOP and bonus, payslips | EPF (12%, ₹15k ceiling, EPS 8.33%, EDLI), ESI (0.75% + 3.25%, ≤ ₹21k), professional tax for KA/TS/MH/WB/DL, Code on Wages check that basic is at least 50% of pay |
| **Profit & loss** | P&L per outlet and consolidated, with % of sales | Aggregator commission plus 18% GST on it, 194-O TDS shown as an income-tax credit |
| **GST returns** | Monthly GSTR-1 / GSTR-3B working | B2C supplies at 5%; Section 9(5) e-commerce supplies (GST paid by the operator) reported separately; ineligible ITC |
| **Licences & filings** | Licence register with expiry alerts and renewals; 45-day filing calendar | FSSAI, Shop & Establishment, Trade, Fire NOC, Eating House, Signage, PPL/IPRS; GSTR-1 (11th), GSTR-3B (20th), PF/ESI (15th), TDS (7th), state PT |

## How the numbers work

- **Theoretical food cost** = items sold × recipe quantities × landed ingredient cost.
- **Actual usage** = opening count + purchases − closing count. Counts are taken after the day's deliveries and before service. The difference from theoretical is wastage, over-portioning or pilferage.
- **The P&L food cost** uses the actual food cost % from the stock counts closest to the period, applied to the period's sales. It falls back to theoretical when there are no counts.
- **Labour** is each employee's full employer cost (gross + employer PF, EDLI, admin and ESI), spread across the date range.
- **Aggregator payout** = gross − commission − 18% GST on commission − 0.1% TDS (194-O).

## Demo data

The seed simulates 75 days for three outlets of a fictional chain: Koramangala (Bengaluru), Gachibowli (Hyderabad) and Andheri West (Mumbai). Each day it generates orders across channels, ingredient consumption with wastage, purchases twice a week, Monday stock counts, 14 staff per outlet, rosters, rent, power and LPG expenses, and licences. Some licences are set to be expiring or expired so the alerts show.

## Caveats

Tax and statutory rates are defaults in `src/india/`, and these rules change often. Check them with your CA before relying on them for filing. Not yet included: login and roles, TDS on salaries, composition-scheme CMP-08, e-invoicing (IRN) and integrations (Swiggy/Zomato/Petpooja APIs, Tally export).

## Layout

```
server.js            HTTP server + static files
src/db.js            SQLite schema
src/api.js           REST API
src/seed.js          demo data simulator
src/india/           GST, payroll, compliance rules
public/              single-page app (vanilla JS)
test/                node:test suites
```
