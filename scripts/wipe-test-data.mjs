/**
 * scripts/wipe-test-data.mjs
 *
 * Wipes all transactional / test data while preserving configuration:
 *   ✅ Kept  : User, Room, RoomType, RoomRate, FinancialAccount, CashBox,
 *              Product, Maid, MaidTeam, MaidTeamMember, OtaAgent,
 *              CityLedgerAccount, Contract, ContractAmendment,
 *              FiscalPeriod, HotelSettings
 *   🗑️  Wiped : every booking, guest, payment, ledger entry, cash session,
 *              folio, invoice, city-ledger transaction, OTA statement, …
 *
 * Usage:
 *   npm run db:wipe              # normal run (blocks in production)
 *   npm run db:wipe -- --force   # skip env guard (careful!)
 *
 * Deletion order respects FK constraints.
 * Circular FK: CashBox.currentSessionId is nulled before CashSession rows
 * are deleted.
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ── Load .env.local ──────────────────────────────────────────────────────────
// dotenv may not be installed as a direct dep; fall back to manual parse
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '../.env.local') });
} catch {
  // manual minimal parse
  const { readFileSync, existsSync } = await import('fs');
  const envPath = resolve(__dirname, '../.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

// ── Safety guard ─────────────────────────────────────────────────────────────
const force = process.argv.includes('--force');
const env   = (process.env.NODE_ENV ?? 'development').toLowerCase();

if (env === 'production' && !force) {
  console.error('❌  Blocked: NODE_ENV=production. Use --force to override (DANGER).');
  process.exit(1);
}

// ── Prisma ───────────────────────────────────────────────────────────────────
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ log: [] });

// ── Helpers ──────────────────────────────────────────────────────────────────
const line  = (s = '') => console.log(s);
const step  = (label, n) => console.log(`  🗑️  ${label.padEnd(32)} ${String(n).padStart(6)} rows`);
const note  = (msg) => console.log(`  ℹ️  ${msg}`);

async function count(model) {
  try { return await prisma[model].count(); } catch { return '—'; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  line();
  line('════════════════════════════════════════════════════════');
  line('  PMS — Test Data Wipe');
  line(`  env: ${env}${force ? '  ⚠️  --force' : ''}`);
  line('════════════════════════════════════════════════════════');
  line();

  // ── Snapshot before ────────────────────────────────────────────────────────
  line('Before:');
  const before = {
    booking:     await count('booking'),
    guest:       await count('guest'),
    payment:     await count('payment'),
    cashSession: await count('cashSession'),
    ledger:      await count('ledgerEntry'),
    invoice:     await count('invoice'),
    folio:       await count('folio'),
  };
  for (const [k, v] of Object.entries(before)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  line();

  // ── Wipe ───────────────────────────────────────────────────────────────────
  line('Wiping…');

  // 1. Break circular FK: CashBox.currentSessionId → null
  const cbBreak = await prisma.cashBox.updateMany({
    where: { currentSessionId: { not: null } },
    data:  { currentSessionId: null },
  });
  note(`CashBox.currentSessionId nulled (${cbBreak.count} rows)`);

  // 2. City Ledger (leaf → root)
  let n;
  n = await prisma.cityLedgerAllocation.deleteMany({});   step('CityLedgerAllocation', n.count);
  n = await prisma.cityLedgerPayment.deleteMany({});       step('CityLedgerPayment',    n.count);
  n = await prisma.cityLedgerTransaction.deleteMany({});   step('CityLedgerTransaction', n.count);

  // 3. OTA Statements
  n = await prisma.otaStatementLine.deleteMany({});        step('OtaStatementLine',     n.count);
  n = await prisma.otaStatement.deleteMany({});            step('OtaStatement',         n.count);

  // 4. Payments (audit log → allocation → refund → payment)
  n = await prisma.paymentAuditLog.deleteMany({});         step('PaymentAuditLog',      n.count);
  n = await prisma.paymentAllocation.deleteMany({});       step('PaymentAllocation',    n.count);
  n = await prisma.refundRecord.deleteMany({});            step('RefundRecord',         n.count);
  n = await prisma.payment.deleteMany({});                 step('Payment',              n.count);

  // 4b. Sprint 5 — EDC batch reports + tax invoices
  try { n = await prisma.cardBatchReport.deleteMany({});   step('CardBatchReport',      n.count); } catch { note('CardBatchReport — skipped (table may not exist yet)'); }
  try { n = await prisma.taxInvoice.deleteMany({});        step('TaxInvoice',           n.count); } catch { note('TaxInvoice — skipped (table may not exist yet)'); }

  // 5. Accounting
  n = await prisma.transferRecord.deleteMany({});          step('TransferRecord',       n.count);
  n = await prisma.ledgerEntry.deleteMany({});             step('LedgerEntry',          n.count);

  // 6. Security deposits
  n = await prisma.securityDeposit.deleteMany({});         step('SecurityDeposit',      n.count);

  // 7. Folios
  n = await prisma.folioLineItem.deleteMany({});           step('FolioLineItem',        n.count);
  n = await prisma.folio.deleteMany({});                   step('Folio',                n.count);

  // 8. Invoices
  n = await prisma.invoiceItem.deleteMany({});             step('InvoiceItem',          n.count);
  n = await prisma.invoice.deleteMany({});                 step('Invoice',              n.count);

  // 9. Housekeeping / maintenance / inspections
  n = await prisma.housekeepingTask.deleteMany({});        step('HousekeepingTask',     n.count);
  n = await prisma.cleaningSchedule.deleteMany({});        step('CleaningSchedule',     n.count);
  n = await prisma.maintenanceTask.deleteMany({});         step('MaintenanceTask',      n.count);
  n = await prisma.roomInspectionPhoto.deleteMany({});     step('RoomInspectionPhoto',  n.count);
  n = await prisma.roomInspection.deleteMany({});          step('RoomInspection',       n.count);

  // 10. Utility readings
  n = await prisma.utilityReading.deleteMany({});          step('UtilityReading',       n.count);

  // 11. Booking sub-tables
  n = await prisma.bookingCompanionPhoto.deleteMany({});   step('BookingCompanionPhoto',n.count);
  n = await prisma.bookingCompanion.deleteMany({});        step('BookingCompanion',     n.count);
  n = await prisma.roomMoveHistory.deleteMany({});         step('RoomMoveHistory',      n.count);
  n = await prisma.bookingRoomSegment.deleteMany({});      step('BookingRoomSegment',   n.count);

  // 12. Core records
  n = await prisma.booking.deleteMany({});                 step('Booking',              n.count);
  n = await prisma.guest.deleteMany({});                   step('Guest',                n.count);

  // 13. Cash sessions (circular FK already broken above)
  n = await prisma.cashSession.deleteMany({});             step('CashSession',          n.count);

  // 14. Maid payouts (linked to sessions/shifts — not maid config)
  n = await prisma.maidPayout.deleteMany({});              step('MaidPayout',           n.count);

  // 15. Logs / audit trails
  n = await prisma.activityLog.deleteMany({});             step('ActivityLog',          n.count);
  n = await prisma.idempotencyRecord.deleteMany({});       step('IdempotencyRecord',    n.count);
  n = await prisma.rateAudit.deleteMany({});               step('RateAudit',            n.count);
  n = await prisma.savedView.deleteMany({});               step('SavedView',            n.count);

  // 16. Reset room statuses
  const roomReset = await prisma.room.updateMany({
    where: { status: { not: 'available' } },
    data:  { status: 'available' },
  });
  note(`Room status reset to 'available' (${roomReset.count} rooms)`);

  // ── Snapshot after ─────────────────────────────────────────────────────────
  line();
  line('After:');
  for (const [k] of Object.entries(before)) {
    const v = await count(k === 'ledger' ? 'ledgerEntry' : k);
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }

  // ── Config counts (untouched) ──────────────────────────────────────────────
  line();
  line('Config (unchanged):');
  const cfg = {
    user:             await count('user'),
    room:             await count('room'),
    roomType:         await count('roomType'),
    financialAccount: await count('financialAccount'),
    cashBox:          await count('cashBox'),
    product:          await count('product'),
    maid:             await count('maid'),
    otaAgent:         await count('otaAgent'),
    cityLedgerAccount:await count('cityLedgerAccount'),
  };
  for (const [k, v] of Object.entries(cfg)) {
    console.log(`  ${k.padEnd(20)}: ${v}`);
  }

  line();
  line('✅  Wipe complete.');
  line();
}

run()
  .catch((e) => { console.error('❌  Wipe failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
