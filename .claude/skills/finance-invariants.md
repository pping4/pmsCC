---
name: finance-invariants
description: Use when touching invoices, folios, payments, charges, refunds, or any money-moving code path. Enforces double-entry correctness, posted-record immutability, idempotency, and rounding policy.
type: convention
---

# Finance Invariants (ห้ามแตะ)

## When to use
Load this skill before writing/editing any of:
- `src/services/folio.service.ts`, `billing.service.ts`, `payment.service.ts`, `ledger.service.ts`, `cityLedger.service.ts`
- API routes under `src/app/api/billing/**`, `api/payments/**`, `api/folios/**`, `api/city-ledger/**`
- Any code creating/updating `Invoice`, `Folio`, `Payment`, `FolioCharge`, `LedgerEntry`

## Rules (checklist)

- [ ] **Double-entry**: every posting creates balanced Dr/Cr. `Σ debits === Σ credits` within the same transaction.
- [ ] **Folio balance**: `balance = Σ charges − Σ payments − Σ credits`. Never store a denormalized balance without a recompute path.
- [ ] **Posted record immutability**: once `Invoice.status = 'posted'` / `Folio.status = 'closed'` / `Payment.status = 'settled'`, NEVER mutate amount/taxRate/lineItems. Create a reversing entry (credit note / refund) instead.
- [ ] **Idempotency**: every money-creating endpoint accepts a client `idempotencyKey` (or derives one from booking+date+amount). Duplicate key → return the existing record, not a new one.
- [ ] **Rounding**: store `Decimal` (or integer satang), never `Float`. Round to 2 dp at the **final** display step only, using banker's rounding if available; otherwise `Math.round(x * 100) / 100`.
- [ ] **No negative amounts on line items** unless it's an explicit discount/credit line with a type flag.
- [ ] **Audit log**: every posted/voided/refunded event writes an `activityLog` entry with `actorId`, `before`, `after`, `reason`.
- [ ] **Currency**: single-currency (THB) assumption — if a field has a type suggesting otherwise, flag it.

## Anti-patterns

❌ `UPDATE invoice SET grand_total = ... WHERE status = 'posted'` — voids the audit trail.
❌ `const total = items.reduce((s, i) => s + i.price * i.qty, 0)` with floats — satang will drift.
❌ Letting the client POST a `total` field — always recompute server-side from line items.
❌ `try { createPayment() } catch { /* swallow */ }` — money errors must bubble or retry with the same idempotency key.
❌ Deleting a `Payment` row to "fix" a mistake — always void/refund.

## Reference files
- `src/services/folio.service.ts` — folio posting
- `src/services/payment.service.ts` — payment lifecycle
- `src/services/ledger.service.ts` — ledger entries
- `src/lib/invoice-utils.ts` — recompute helpers
- `CityLedger_Implementation_Plan_FINAL.md` — AR design intent
