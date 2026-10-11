---
name: replica
description: Build a working Indian-market replica of an existing software product (e.g. "build something like Rosnet / Toast / Gusto / QuickBooks for India"). Use when the user names a product and asks for a similar, localized, or "Indian version" of it. Produces a runnable zero-dependency web app with India-specific tax, payroll, payments and compliance rules, seeded demo data, tests and screenshots.
---

# Replica: build an Indian version of a product

The goal is a **runnable, credible product**, not a mock-up: real domain logic, realistic data, every screen working. `rasoinet/` in this repo (an Indian Rosnet) is the reference implementation. Reuse its structure and its `src/india/` modules.

## 1. Understand the original

- Identify what the product actually is and who uses it. Rosnet, for example, is a restaurant back-office for multi-unit franchise operators, not a POS.
- List its core modules (typically 6–12) and the KPIs its users watch.
- If the product is unfamiliar or ambiguous, search the web first. If it could mean two different things, ask the user one short question.

## 2. Map every module to India

Go through `references/india-localization.md` and decide which rules apply. At minimum, check each module for:

- **Tax:** the GST rate and whether ITC is available, CGST+SGST vs IGST, SAC/HSN codes, Section 9(5) e-commerce operators, TDS/TCS (194-O, 194C, 194J…), GSTR-1/3B reporting.
- **Money:** ₹ with lakh/crore grouping (`en-IN`), UPI as a first-class payment mode, round-off to the rupee.
- **People:** EPF, ESI, state professional tax, Code on Wages (basic ≥ 50%), Shops & Establishments hours, state minimum wages.
- **Channels and partners:** the Indian equivalents of US integrations (Swiggy/Zomato/ONDC, Razorpay/PhonePe, Tally, Shiprocket, Practo…).
- **Compliance:** the sector's licences (FSSAI, drug licence, trade licence…) with expiry tracking, and a statutory filing calendar.
- **Identity numbers:** GSTIN (with check digit), PAN, UAN, ESIC IP, FSSAI, CIN, IFSC.

Name it with an Indian word for the domain (RasoiNet = *rasoi*, kitchen). Use a fictional brand on outputs; never imitate the original's branding.

## 3. Build

Copy the shape of `rasoinet/`:

```
<app>/server.js          node:http server, JSON API + static files, seeds on first run
<app>/src/db.js          node:sqlite schema (no npm dependencies)
<app>/src/api.js         route table → pure handler functions, HttpError for 4xx
<app>/src/seed.js        deterministic simulation (seeded PRNG), today-relative dates
<app>/src/india/         pure rule modules: copy rasoinet/src/india/*.js and extend
<app>/public/            vanilla-JS hash-routed SPA, CSS tokens with light/dark
<app>/test/              node:test for rules and for the API
```

Rules that matter:
- **Keep domain logic pure** and in `src/india/`, so it can be unit-tested and the rates are easy to find and update.
- **Simulate the data; don't randomize it.** Generate it day by day so the numbers reconcile (e.g. purchases replenish stock that sales consume, counts reflect wastage). Then check that KPIs land in realistic Indian ranges (food cost ~28–35%, labour ~12–20%, EBITDA ~10–18% for restaurants). Tune until they do.
- **Use Indian names, cities, states and addresses**, and give each entity a valid GSTIN via `makeGstin`.
- **Use the IST business date** (`UTC+5:30`), and financial years running April–March (`2627`).
- **Use the `dataviz` skill** before drawing charts.
- **Don't add the app to the profile `README.md`** or to `main`. Work on a feature branch in its own folder.

## 4. Verify before you report

1. `npm test` passes. Cover each tax/payroll rule with exact expected values, plus API flows (create → read → reconcile).
2. Start the server and screenshot every page at 1440px and 390px with Playwright (Chromium at `/opt/pw-browsers`). Fail on console errors and horizontal overflow, then **look at the screenshots**: fix clipped tables, hidden filters and unreadable charts.
3. Sanity-check a few numbers by hand: an invoice total, a payslip, the totals on one report.

## 5. Hand over

- Write `<app>/README.md`: how to run it, a module table with an "India-specific" column, how the key numbers are computed, and caveats.
- **Always say that statutory rates need checking with a CA**, and list what isn't built yet (auth, integrations, e-invoicing…).
- Commit, push the branch, send 2–3 screenshots, and offer the next steps. Don't open a PR unless asked.
