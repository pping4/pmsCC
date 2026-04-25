---
name: night-audit-checklist
description: Use when editing the night audit / day close flow (src/app/(dashboard)/nightaudit, api/nightaudit). Enforces pre-checks, posting invariants, and day-close immutability.
type: convention
---

# Night Audit Checklist

## When to use
Any code under `nightaudit/*`, `api/nightaudit/*`, or logic that changes `businessDate`, posts room revenue, or flips booking status on day rollover.

## Pre-checks (fail-fast before any write)

- [ ] **No open cash session** — every `CashSession` for the closing date must be `closed` with variance explained.
- [ ] **No untendered payment** — every `Payment` is either `settled` or `voided`.
- [ ] **No in-house booking without folio** — every `checked_in` booking has an open `Folio`.
- [ ] **No negative-balance folio without a reason** — flag for manual review.
- [ ] **Previous business date is closed** — you cannot skip days.

## Postings performed (atomically in one `$transaction`, `Serializable`)

1. **Room revenue** posted to every in-house folio (rate × 1 night).
2. **Service charge & VAT** recomputed per folio (see `tax-thailand`).
3. **No-show handling** — `reserved` bookings past check-in date → `no_show` + charge first night per policy.
4. **Auto-checkout** — bookings past checkout → `checked_out` only if folio balance = 0; otherwise flag.
5. **Day close record** — insert `NightAuditLog { businessDate, closedBy, closedAt, totals }` — make this row **immutable** (no update/delete endpoint).
6. **Business date advance** — `SystemSetting.businessDate = nextDay`.

## Rules

- [ ] **One night audit runs at a time** — enforce with a DB advisory lock or a `NightAuditRun { status: 'running' }` singleton row.
- [ ] **Idempotent** — re-running the same `businessDate` after a mid-run crash continues from the last-posted booking; does not double-post.
- [ ] **Immutable past days** — any mutation to a record dated ≤ last closed businessDate is rejected at service layer.
- [ ] **Audit trail** — every posting writes an `activityLog` entry tagged `source: 'night_audit'`.
- [ ] **No external I/O inside the tx** — queue reports/emails for post-commit.

## Anti-patterns

❌ Advancing `businessDate` before all postings commit.
❌ Allowing a user to "reopen" a closed day via UI — only via a DB migration with DBA sign-off.
❌ Running night audit while a cashier session is still open.
❌ Using `prisma` (not `tx`) anywhere in the audit routine.

## Reference files
- `src/app/(dashboard)/nightaudit/page.tsx`
- (likely) `src/services/nightAudit.service.ts` — create if missing
- `PMS_SYSTEM_DOCUMENTATION.md`
