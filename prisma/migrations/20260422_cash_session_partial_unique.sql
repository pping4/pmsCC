-- Sprint 4B: enforce "at most one OPEN session per counter" and
-- "at most one OPEN session per user" at the database layer.
--
-- Postgres partial unique indexes allow many CLOSED rows to coexist
-- while guaranteeing that the OPEN slice is always ≤ 1 per key.
-- Attempting to open a second session for the same counter/user will
-- raise a P2002 unique-constraint violation at the Prisma layer —
-- services translate this into a friendly error.

-- At most one OPEN session per physical drawer (counter).
CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open_per_box
  ON cash_sessions (cash_box_id)
  WHERE status = 'OPEN';

-- At most one OPEN session per user (a cashier can't operate two drawers).
CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open_per_user
  ON cash_sessions (opened_by)
  WHERE status = 'OPEN';
