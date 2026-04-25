---
name: tax-thailand
description: Use when computing VAT, service charge, withholding tax, or pricing on invoices/folios/products. Enforces Thai tax order-of-operations, inclusive vs exclusive handling, and rounding.
type: convention
---

# Thai Tax Rules

## When to use
Editing price/tax math anywhere — `lib/tax.ts`, invoice line items, folio charges, product pricing, rate setup, receipt rendering.

## Fundamentals

- **VAT**: 7% (configurable, but default 7)
- **Service Charge**: 10% (hotels) — applied **before** VAT
- **Withholding Tax (WHT)**: 3% (services) / 5% (rent) / 1% (transport) — applied by payer, deducted from payment, not from invoice total

## Order of operations (MANDATORY)

```
netBeforeService = base price (pre-tax, pre-service)
serviceCharge    = round2(netBeforeService × 0.10)
netAfterService  = netBeforeService + serviceCharge
vat              = round2(netAfterService × 0.07)
grandTotal       = netAfterService + vat
```

For **VAT-inclusive** prices (price tag says `฿1,070` including VAT):
```
netAfterService = round2(gross / 1.07)
vat             = gross − netAfterService
```

## Rules (checklist)

- [ ] **Round at every tax step to 2 dp** (`Math.round(x * 100) / 100`). Do NOT round only at the end — Revenue Dept. rounds each tax line.
- [ ] **Service BEFORE VAT**, never the reverse.
- [ ] **Show net, service, VAT, grand total as separate lines** on every invoice/receipt.
- [ ] **VAT-inclusive vs exclusive** must be an explicit boolean on the price record; never inferred from magnitude.
- [ ] **WHT is a payment-side adjustment**, not an invoice line — invoice stays at grand total; payment records `amountReceived` and `whtAmount` separately.
- [ ] **Zero-rated / exempt items** (e.g. some food delivery, certain guest services): tag with `vatRate = 0` explicitly, don't skip the field.
- [ ] **City Ledger / corporate invoices** still show VAT normally; WHT happens when the company pays.

## Anti-patterns

❌ `total = price * 1.17` — conflates service+VAT and loses line visibility.
❌ VAT before service charge — wrong per Revenue Dept. rule.
❌ Rounding only the grand total — satang drift on multi-line invoices.
❌ Hardcoding 7 / 10 / 3 as magic numbers — pull from `lib/tax.ts` config.
❌ Storing WHT on the invoice record — belongs on Payment.

## Reference files
- `src/lib/tax.ts` — rate config + helpers
- `src/lib/invoice-utils.ts` — invoice recompute
- `src/services/folio.service.ts` — charge posting
