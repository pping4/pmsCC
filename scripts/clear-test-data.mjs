#!/usr/bin/env node
/**
 * clear-test-data.mjs
 *
 * Receipt-Standardization branch helper.
 *
 * Truncates ALL transactional / financial tables so we can re-test the new
 * per-night ROOM charge model from a clean slate. System data is preserved:
 *   - users, roles, permissions
 *   - rooms, room_types, products
 *   - hotel_settings, financial_accounts, ledger_accounts
 *   - guests (kept — easier to reuse for testing)
 *   - cash_boxes, edc_terminals
 *   - city_ledger_accounts (the company master records — payments/allocations are wiped)
 *
 * Usage:
 *   node scripts/clear-test-data.mjs
 *
 * Safety:
 *   - Uses TRUNCATE ... RESTART IDENTITY CASCADE inside one transaction
 *   - Aborts if NODE_ENV=production
 *   - Prints row counts before/after for sanity
 */

import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('❌ Refusing to run against production. Set NODE_ENV !== production.');
  process.exit(1);
}

const prisma = new PrismaClient();

// Order matters only for the "before" count display — TRUNCATE CASCADE handles FKs.
// Grouped by domain for readability.
// Verified against actual schema 2026-04-27.
const TABLES_TO_CLEAR = [
  // ── Ledger / accounting ────────────────────────────────────────────────────
  'ledger_entries',
  'fiscal_periods',

  // ── Payments (Sprint 5) ────────────────────────────────────────────────────
  'payment_allocations',
  'payment_audit_logs',
  'refund_records',
  'transfer_records',
  'payments',
  'idempotency_records',

  // ── Tax / receipts ─────────────────────────────────────────────────────────
  'tax_invoices',

  // ── Invoices / folios (the tables we're refactoring) ───────────────────────
  'invoice_items',
  'invoices',
  'folio_line_items',
  'folios',

  // ── City ledger transactional (keep accounts master) ───────────────────────
  'city_ledger_allocations',
  'city_ledger_payments',
  'city_ledger_transactions',

  // ── Cash sessions / EDC batches ────────────────────────────────────────────
  'card_batch_reports',
  'cash_sessions',

  // ── OTA statements ─────────────────────────────────────────────────────────
  'ota_statement_lines',
  'ota_statements',

  // ── Contracts (test contracts) ─────────────────────────────────────────────
  'contract_amendments',
  'contracts',

  // ── Housekeeping / Maintenance / Inspections ──────────────────────────────
  'housekeeping_tasks',
  'maid_payouts',
  'maintenance_tasks',
  'cleaning_schedules',
  'room_inspection_photos',
  'room_inspections',

  // ── Bookings + related ─────────────────────────────────────────────────────
  'booking_companion_photos',
  'booking_companions',
  'security_deposits',
  'booking_room_segments',
  'room_move_history',
  'rate_audits',
  'utility_readings',
  'bookings',

  // ── Misc activity ─────────────────────────────────────────────────────────
  'activity_logs',
  'number_sequences',
];

async function main() {
  console.log('🧹  Receipt-Standardization: clearing test data…\n');

  // 1) Show row counts before
  console.log('📊  Row counts BEFORE:');
  for (const t of TABLES_TO_CLEAR) {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      const n = r?.[0]?.c ?? 0;
      if (n > 0) console.log(`    ${t.padEnd(34)} ${n}`);
    } catch {
      // Table may not exist in this branch — silent skip
    }
  }

  // 2) Snapshot cash_boxes config so we can restore after TRUNCATE
  // PostgreSQL's TRUNCATE ... CASCADE walks every FK that REFERENCES the
  // truncated table -- and since cash_boxes.current_session_id points at
  // cash_sessions, truncating cash_sessions wipes cash_boxes too,
  // regardless of whether the FK column is currently null.  An UPDATE
  // before the TRUNCATE doesn't help: the cascade is decided from the
  // schema, not from the data.  So we snapshot first and re-insert after.
  const cashBoxSnapshot = await prisma.cashBox.findMany({
    select: {
      id: true, code: true, name: true, location: true, displayOrder: true,
      financialAccountId: true, isActive: true, notes: true,
      createdAt: true, updatedAt: true,
    },
  });

  // 3) Truncate every transactional table.  CASCADE handles any FK we
  // didn't list explicitly (and as noted above, it WILL cascade through
  // cash_sessions to cash_boxes -- restored from the snapshot below).
  console.log('🗑   Truncating…');
  const tableList = TABLES_TO_CLEAR.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );

  // 3a) Restore cash_boxes from the snapshot taken before truncate.
  // current_session_id is intentionally null -- the link is rebuilt the
  // next time a cashier opens a shift.
  if (cashBoxSnapshot.length > 0) {
    console.log(`🔁  Restoring ${cashBoxSnapshot.length} cash box(es)…`);
    for (const b of cashBoxSnapshot) {
      await prisma.cashBox.create({
        data: {
          id:                 b.id,
          code:               b.code,
          name:               b.name,
          location:           b.location,
          displayOrder:       b.displayOrder,
          financialAccountId: b.financialAccountId,
          isActive:           b.isActive,
          notes:              b.notes,
          createdAt:          b.createdAt,
          updatedAt:          b.updatedAt,
          currentSessionId:   null,
        },
      });
    }
  }

  // 2.5) Reset rooms whose status was set by a now-deleted booking. Without
  // this, rooms stay stuck at "occupied" / "checkout" / "reserved" and any
  // new booking trying to use them throws RoomTransitionError because the
  // state machine forbids those direct transitions.
  console.log('\n🚪  Resetting stale room statuses…');
  const resetResult = await prisma.room.updateMany({
    where:  { status: { not: 'available' } },
    data:   { status: 'available', currentBookingId: null },
  });
  if (resetResult.count > 0) {
    console.log(`    ${resetResult.count} room(s) reset to 'available'`);
  } else {
    console.log('    all rooms already available');
  }

  // 3) Verify all are zero
  console.log('\n✅  Row counts AFTER:');
  let allZero = true;
  for (const t of TABLES_TO_CLEAR) {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      const n = r?.[0]?.c ?? 0;
      if (n > 0) {
        console.log(`    ❗ ${t.padEnd(34)} ${n}  (NOT EMPTY!)`);
        allZero = false;
      }
    } catch { /* ignore */ }
  }

  if (!allZero) {
    console.error('\n❌  Some tables are still non-empty.');
    process.exit(2);
  }

  // 4) Sanity check: confirm system data still present
  console.log('\n🔒  System data preserved:');
  const checks = [
    ['users',                'users'],
    ['rooms',                'rooms'],
    ['room_types',           'room_types'],
    ['products',             'products'],
    ['guests',               'guests'],
    ['hotel_settings',       'hotel_settings'],
    ['financial_accounts',   'financial_accounts'],
    ['cash_boxes',           'cash_boxes'],
    ['edc_terminals',        'edc_terminals'],
    ['city_ledger_accounts', 'city_ledger_accounts'],
    ['room_rates',           'room_rates'],
    ['card_fee_rates',       'card_fee_rates'],
    ['ota_agents',           'ota_agents'],
  ];
  for (const [label, t] of checks) {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      const n = r?.[0]?.c ?? 0;
      console.log(`    ${label.padEnd(34)} ${n}`);
    } catch (e) {
      console.log(`    ${label.padEnd(34)} (table missing — skipped)`);
    }
  }

  console.log('\n🎉  Done. Test data cleared, system data intact.');
}

main()
  .catch((e) => {
    console.error('\n❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
