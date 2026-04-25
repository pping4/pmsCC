---
name: schema-migration-safety
description: Use when writing a Prisma migration that touches Invoice, Folio, Payment, FolioCharge, LedgerEntry, CashSession, Booking, or City Ledger tables. Enforces posted-record preservation, safe NOT NULL additions, and AR aging index requirements.
type: convention
---

# Schema Migration Safety

## When to use
Any `prisma migrate dev` / `migrate deploy` that changes a column, constraint, or index on a financial table.

## Red-zone tables (require extra review)
`Invoice`, `Folio`, `FolioCharge`, `Payment`, `LedgerEntry`, `CashSession`, `Booking`, `CityLedgerAccount`, `SecurityDeposit`, `BadDebt`, `NightAuditLog`.

## Rules (checklist)

- [ ] **Never drop a column** on a red-zone table if any `posted`/`closed`/`settled` row references it. Migrate data first, then deprecate with a `@deprecated` comment for ≥1 release before drop.
- [ ] **Never change the type** of a money column (`Decimal → Float`, `Decimal(10,2) → Decimal(12,2)` is OK; reducing precision is NOT).
- [ ] **Adding NOT NULL** requires a backfill in the same migration:
  1. Add column nullable with default
  2. Backfill: `UPDATE ... SET col = ... WHERE col IS NULL`
  3. `ALTER COLUMN col SET NOT NULL`
- [ ] **New indexes** for AR/aging queries: composite `(accountId, dueDate)`, `(status, businessDate)`, `(folioId, postedAt)`. Think about the WHERE + ORDER BY pattern.
- [ ] **Foreign keys on money-path tables** use `ON DELETE RESTRICT` (never `CASCADE`) — you never want a deleted customer to orphan-nuke their invoices.
- [ ] **Unique constraint for idempotency**: `Payment.idempotencyKey`, `Invoice.invoiceNumber`, `Folio.folioNumber` — always `@unique`.
- [ ] **Shadow DB check**: run `prisma migrate diff` before deploy; if the diff changes a red-zone table, require manual DBA review note in the PR description.
- [ ] **Rollback plan**: every red-zone migration has an inverse SQL in the PR description (even if Prisma doesn't auto-generate one).
- [ ] **Posted-record preservation**: migration must not alter rows where `status IN ('posted', 'closed', 'settled', 'void')`. Guard with `WHERE status NOT IN (...)` in any `UPDATE`.

## Anti-patterns

❌ `DROP COLUMN amount` on `Invoice` — even if "unused", archived rows need it.
❌ `ALTER COLUMN total TYPE FLOAT` — floating-point money is forbidden.
❌ `CASCADE DELETE` from `Guest` → `Booking` → `Folio` → `Invoice` — one bad delete voids an audit trail.
❌ Adding `NOT NULL` without a backfill — production crash on the next insert path.
❌ Renaming `Payment.amount` → `Payment.amountReceived` in a single migration — breaks reporting queries during deploy. Do rename via `@map`.

## Checklist for PR description
When a migration touches a red-zone table, the PR must contain:
```
## Migration impact
- Table(s): <list>
- Red-zone: YES
- Backfill needed: <yes/no + SQL>
- Rollback SQL:
    <paste>
- Affected queries:
    <list>
- DBA review: @<handle>
```

## Reference files
- `prisma/schema.prisma`
- `prisma/migrations/`
