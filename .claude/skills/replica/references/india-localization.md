# India localization checklist

These are defaults as of 2026. **Rates change often, so verify before relying on them.** Rules already coded and tested live in `rasoinet/src/india/` (`gst.js`, `payroll.js`, `compliance.js`).

## GST

| Topic | Default |
|---|---|
| Intra-state supply | CGST + SGST, each half the rate |
| Inter-state supply | IGST at the full rate (compare state codes, the first 2 digits of the GSTIN) |
| Slabs after the 2025 rationalisation | 0%, 5%, 18%, 40% (sin/luxury) |
| Restaurants (standalone) | 5%, no ITC, SAC 996331 |
| Restaurants in hotels with room tariff > ₹7,500 | 18% with ITC |
| Composition scheme | Bill of supply, no tax collected from customers, CMP-08 quarterly |
| E-commerce operators u/s 9(5) | The operator pays GST on restaurant supplies made through it; the restaurant reports them in GSTR-1 Table 15 |
| GSTIN | 15 chars: state(2) + PAN(10) + entity(1) + `Z` + check char (mod-36) |
| Invoice number | ≤ 16 chars, unique per FY series |
| Returns | GSTR-1 by the 11th, GSTR-3B by the 20th (monthly), GSTR-9 annual by 31 Dec |
| E-invoicing (IRN) | Required above the turnover threshold (B2B only) |

## Income tax / TDS

- 194-O: e-commerce operator deducts 0.1% of gross sales.
- 194C contractors 1%/2%; 194J professional 10% (2% technical); 194I rent 10%.
- TDS deposit by the 7th of the next month; quarterly returns (24Q/26Q).

## Payroll

| Item | Default |
|---|---|
| EPF | Employee 12% of basic+DA; employer 12%, split into EPS 8.33% (on wages up to ₹15,000) and the EPF balance; EDLI 0.5%; admin 0.5% |
| ESI | Applies when monthly wages ≤ ₹21,000: employee 0.75%, employer 3.25%, rounded up |
| Professional tax | State slabs (KA ₹200 at ≥ ₹25k, ₹300 in Feb; TS up to ₹200; MH ₹175/₹200, women exempt ≤ ₹25k; WB up to ₹200; DL none) |
| Code on Wages | Basic + DA ≥ 50% of total remuneration |
| Hours | 9 h/day, 48 h/week; overtime at 2× wages |
| Due dates | PF ECR and ESI by the 15th |

## Money and formatting

- `Intl.NumberFormat('en-IN')`: 12,34,567. Use L/Cr shorthand in KPIs.
- Show payment modes as UPI, Card, Cash, Wallet, Net banking. UPI is usually the largest share.
- Round invoices to the nearest rupee with a visible round-off line.
- Financial year runs 1 April–31 March.

## Sector licences (pick the relevant ones)

- Food: FSSAI (registration/state/central), Eating House Licence, Health Trade Licence, liquor licence.
- Retail/offices: Shop & Establishment, Trade Licence (BBMP/GHMC/MCGM…), Signage, Fire NOC.
- Pharma: Drug licence (Form 20/21), pharmacist registration.
- Music in premises: PPL/IPRS.
- Manufacturing: Factory licence, Pollution Control Board CTE/CTO.

## Common Indian equivalents

| US product category | Indian ecosystem |
|---|---|
| DoorDash / Uber Eats | Swiggy, Zomato, ONDC |
| Stripe / Square | Razorpay, PhonePe, Paytm, Pine Labs |
| QuickBooks | Tally, Zoho Books |
| ADP / Gusto | Keka, greytHR, Zoho Payroll |
| Shopify shipping | Shiprocket, Delhivery |
| SSN / EIN | PAN / GSTIN; Aadhaar must not be stored without need |
