---
name: prisma-money-transactions
description: Use when writing multi-step DB mutations involving money (booking+folio+payment, night audit, refunds, AR posting). Enforces $transaction usage, isolation, retry, and deadlock-safe lock ordering.
type: convention
---

# Prisma Money Transactions

## When to use
Any handler that does ≥2 writes where at least one is a `Payment`, `Invoice`, `Folio`, `FolioCharge`, `LedgerEntry`, `CashSession`, or `Booking` financial field.

## Rules (checklist)

- [ ] **Wrap in `prisma.$transaction(async (tx) => { ... })`** — every subsequent write uses `tx`, not `prisma`.
- [ ] **Isolation level**:
  - Default (`ReadCommitted`) is fine for simple postings.
  - `Serializable` for night audit / day close / cash-session close (anything that reads-then-writes aggregate totals).
  - `RepeatableRead` for AR aging snapshots.
- [ ] **Lock order** (prevents deadlocks): always lock in this order inside a tx:
  1. `Booking` (highest) →
  2. `Folio` →
  3. `Invoice` →
  4. `Payment` →
  5. `LedgerEntry` (lowest)
  — never acquire a higher-priority row after a lower one in the same tx.
- [ ] **Retry on P2034** (transaction conflict): retry up to 3× with exponential backoff (50ms, 150ms, 400ms). Same idempotency key each time.
- [ ] **Handle P2002** (unique violation) as a user-facing "already exists" message, not a 500.
- [ ] **Timeout**: set `{ maxWait: 5000, timeout: 15000 }` for night audit; `{ timeout: 5000 }` for normal postings.
- [ ] **No external I/O inside `$transaction`** — no `fetch`, no email send, no PDF generation. Queue those for after commit.
- [ ] **Return tailored `select`** — never return the full Prisma object of a Payment/Invoice to the client.

## Example shape

```ts
await prisma.$transaction(async (tx) => {
  const folio = await tx.folio.findUniqueOrThrow({ where: { id }, select: { id: true, status: true } });
  if (folio.status === 'closed') throw new Error('FOLIO_CLOSED');

  await tx.folioCharge.create({ data: { ... } });
  await tx.ledgerEntry.createMany({ data: [drEntry, crEntry] });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 8000 });
```

## Anti-patterns

❌ `await prisma.payment.create(...); await prisma.invoice.update(...)` outside a transaction — partial write on crash.
❌ `await prisma.$transaction([tx1, tx2])` (array form) when you need conditional logic — use the callback form.
❌ Sending an email/webhook inside the `$transaction` callback — slows locks, risks committing after a network fail.
❌ Catching P2034 and returning 500 — must retry.

## Reference files
- `src/services/folio.service.ts`
- `src/services/payment.service.ts`
- `src/services/cashSession.service.ts`
- `src/lib/prisma.ts`
