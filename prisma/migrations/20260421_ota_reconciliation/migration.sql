-- Phase H2: OTA commission tracking + reconciliation statements.
-- Three new tables + 3 nullable columns on bookings. Additive, safe.

-- ── Bookings: add OTA metadata columns (nullable for existing rows) ─────────
ALTER TABLE "bookings"
  ADD COLUMN "ota_agent_id"       TEXT,
  ADD COLUMN "ota_booking_ref"    TEXT,
  ADD COLUMN "ota_commission_pct" DECIMAL(5,2);

-- ── OtaAgent: master list of partners (Agoda, Booking.com, …) ──────────────
CREATE TABLE "ota_agents" (
    "id"                     TEXT NOT NULL,
    "code"                   TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "default_commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "active"                 BOOLEAN NOT NULL DEFAULT true,
    "notes"                  TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ota_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ota_agents_code_key" ON "ota_agents"("code");

-- ── OtaStatement: monthly remittance statement per agent ──────────────────
CREATE TABLE "ota_statements" (
    "id"               TEXT NOT NULL,
    "agent_id"         TEXT NOT NULL,
    "period_start"     DATE NOT NULL,
    "period_end"       DATE NOT NULL,
    "total_gross"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status"           TEXT NOT NULL DEFAULT 'draft',
    "uploaded_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by"      TEXT,
    "posted_at"        TIMESTAMP(3),
    "posted_by"        TEXT,
    "notes"            TEXT,
    CONSTRAINT "ota_statements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ota_statements_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "ota_agents"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ota_statements_agent_period_idx"
  ON "ota_statements"("agent_id", "period_start");

-- ── OtaStatementLine: per-booking line from statement CSV ─────────────────
CREATE TABLE "ota_statement_lines" (
    "id"                  TEXT NOT NULL,
    "statement_id"        TEXT NOT NULL,
    "ota_booking_ref"     TEXT NOT NULL,
    "guest_name"          TEXT NOT NULL,
    "check_in"            DATE NOT NULL,
    "check_out"           DATE NOT NULL,
    "room_nights"         INT  NOT NULL DEFAULT 0,
    "gross_amount"        DECIMAL(12,2) NOT NULL,
    "commission_amount"   DECIMAL(12,2) NOT NULL,
    "net_amount"          DECIMAL(12,2) NOT NULL,
    "matched_booking_id"  TEXT,
    "match_status"        TEXT NOT NULL DEFAULT 'unmatched',
    "notes"               TEXT,
    CONSTRAINT "ota_statement_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ota_statement_lines_statement_id_fkey"
      FOREIGN KEY ("statement_id") REFERENCES "ota_statements"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ota_statement_lines_matched_booking_id_fkey"
      FOREIGN KEY ("matched_booking_id") REFERENCES "bookings"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ota_statement_lines_statement_idx"
  ON "ota_statement_lines"("statement_id");
CREATE INDEX "ota_statement_lines_matched_booking_idx"
  ON "ota_statement_lines"("matched_booking_id");
CREATE INDEX "ota_statement_lines_ota_ref_idx"
  ON "ota_statement_lines"("ota_booking_ref");

-- ── Seed common OTAs (idempotent via ON CONFLICT) ─────────────────────────
INSERT INTO "ota_agents" ("id", "code", "name", "default_commission_pct") VALUES
  (gen_random_uuid()::text, 'agoda',        'Agoda',         17.00),
  (gen_random_uuid()::text, 'booking',      'Booking.com',   15.00),
  (gen_random_uuid()::text, 'expedia',      'Expedia',       18.00),
  (gen_random_uuid()::text, 'airbnb',       'Airbnb',        12.00),
  (gen_random_uuid()::text, 'traveloka',    'Traveloka',     15.00)
ON CONFLICT ("code") DO NOTHING;
