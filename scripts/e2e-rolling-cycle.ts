/**
 * e2e-rolling-cycle.ts
 *
 * Task 4.1 — Full 2.5-month rolling stay (monthly_short).
 *
 * Scenario: checkIn=2026-01-10, checkOut=2026-03-25, rate=฿15,000.
 *
 * Cycle 1: 10 ม.ค. – 09 ก.พ.  (full, 31 days)   rent=15000, no utility
 * Cycle 2: 10 ก.พ. – 09 มี.ค.  (full, 28 days)   rent=15000, utility from reading @09 ก.พ.
 * Cycle 3: 10 มี.ค. – 24 มี.ค. (partial, 15 days) rent=pro-rated, utility from baseline
 *
 * Uses past dates to avoid the "future date" guard in recordReading.
 *
 * npx tsx scripts/e2e-rolling-cycle.ts
 */

import {
  prisma,
  ok,
  seedMonthlyBooking,
  cleanupBookingFixture,
  finalize,
} from './_billing-e2e-helpers';
import { Prisma } from '@prisma/client';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';
import { recordReading } from '../src/services/utility.service';

// All dates in the past (relative to today 2026-05-14)
const CHECK_IN  = new Date('2026-01-10T00:00:00.000Z');
const CHECK_OUT = new Date('2026-03-25T00:00:00.000Z');
const RATE      = 15000;

// Cycle 1: 10 ม.ค. – 09 ก.พ. (31 days; January has 31 days — full rolling)
// isPartial=false

// Cycle 2: 10 ก.พ. – 09 มี.ค. (28 days; February has 28 days in 2026 — full rolling)
// isPartial=false

// Cycle 3: 10 มี.ค. – 24 มี.ค. (partial, checkOut-1 = 24 มี.ค.; March has 31 days)
// daysInCycle = 24 - 10 + 1 = 15; fullCycleDays = 31
// rent = 15000 × (15 / 31) = 7258.06
const CYCLE3_DAYS       = 15;
const CYCLE3_MONTH_DAYS = 31; // March
const CYCLE3_RENT = Math.round(RATE * (CYCLE3_DAYS / CYCLE3_MONTH_DAYS) * 100) / 100;

async function main() {
  console.log('\n🧪  e2e-rolling-cycle — 2.5-month monthly_short stay\n');
  console.log(`    cycle 3 pro-rated rent = ${CYCLE3_RENT} (15/31 × 15000)`);

  const tag = `rolling-${Date.now().toString(36).slice(-6)}`;
  const fix = await seedMonthlyBooking({
    tag,
    bookingType: 'monthly_short',
    checkIn:  CHECK_IN,
    checkOut: CHECK_OUT,
    rate:     RATE,
  });

  try {
    // ── Cycle 1: generate draft ───────────────────────────────────────────────
    console.log('\nCycle 1 — generate draft (no utility, full rent)');
    const draft1 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 1, createdBy: 'e2e-rolling' }),
    );
    ok(draft1.status === 'draft',           'cycle 1: status=draft');
    ok(draft1.needsReading === false,       'cycle 1: needsReading=false');
    ok(draft1.isPartial === false,          'cycle 1: isPartial=false');
    ok(Number(draft1.grandTotal) === RATE,  `cycle 1: grandTotal=15000 (got ${draft1.grandTotal})`);
    ok(draft1.periodStart.toISOString().slice(0, 10) === '2026-01-10', 'cycle 1: periodStart=2026-01-10');
    ok(draft1.periodEnd.toISOString().slice(0, 10)   === '2026-02-09', 'cycle 1: periodEnd=2026-02-09');

    // No ledger yet
    const led1 = await prisma.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft1.invoiceId },
    });
    ok(led1 === 0, 'cycle 1 draft: no ledger entries');

    const folioBeforeApprove = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(Number(folioBeforeApprove.totalCharges) === 0, 'cycle 1 draft: folio.totalCharges=0');

    // ── Cycle 1: approve ─────────────────────────────────────────────────────
    console.log('Cycle 1 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'e2e-rolling' }),
    );
    const inv1 = await prisma.invoice.findUniqueOrThrow({
      where:  { id: draft1.invoiceId },
      select: { status: true },
    });
    ok(inv1.status === 'unpaid', 'cycle 1 approved: status=unpaid');
    const led1After = await prisma.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft1.invoiceId },
    });
    ok(led1After >= 2, `cycle 1 approved: ledger posted (${led1After} entries)`);
    const folio1 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(Number(folio1.totalCharges) === RATE, 'cycle 1 approved: folio.totalCharges=15000');

    // ── Record reading @ end of cycle 1 (09 ก.พ., past date) ─────────────────
    console.log('Record reading @ 2026-02-09 (end of cycle 1)');
    const reading1Date = new Date('2026-02-09T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: reading1Date } });
    const reading1 = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: reading1Date,
        currWater:   100,
        currElectric: 2000,
        recordedBy:  'e2e-rolling',
      }),
    );
    ok(!!reading1.id,                          'reading 1 recorded');
    ok(Number(reading1.currWater) === 100,     'reading 1: currWater=100');
    ok(Number(reading1.currElectric) === 2000, 'reading 1: currElectric=2000');

    // ── Cycle 2: generate draft ───────────────────────────────────────────────
    // Cycle 2: 10 ก.พ. – 09 มี.ค.
    // Utility: curr = reading @ 09 ก.พ.; baseline = reading before cycle1 start (2026-01-10) → null
    // waterUsage = 100 - 0 = 100; electricUsage = 2000 - 0 = 2000
    // waterCharge = 100 × 18 = 1800; electricCharge = 2000 × 8 = 16000
    console.log('Cycle 2 — generate draft (rent + utility)');
    const draft2 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 2, createdBy: 'e2e-rolling' }),
    );
    ok(draft2.status === 'draft',    'cycle 2: status=draft');
    ok(draft2.needsReading === false,'cycle 2: needsReading=false');
    ok(draft2.isPartial === false,   'cycle 2: isPartial=false');
    ok(draft2.periodStart.toISOString().slice(0, 10) === '2026-02-10', 'cycle 2: periodStart=2026-02-10');
    ok(draft2.periodEnd.toISOString().slice(0, 10)   === '2026-03-09', 'cycle 2: periodEnd=2026-03-09');
    const WATER_CHARGE_2    = 100 * 18;  // 1800
    const ELECTRIC_CHARGE_2 = 2000 * 8; // 16000
    const EXPECTED_TOTAL_2  = RATE + WATER_CHARGE_2 + ELECTRIC_CHARGE_2; // 32800
    ok(
      Number(draft2.grandTotal) === EXPECTED_TOTAL_2,
      `cycle 2: grandTotal=${draft2.grandTotal} (expected ${EXPECTED_TOTAL_2})`,
    );

    // Task 5.3: assert periodEnd is non-null on water/electric lines (cycle >= 2)
    const c2UtilityLines = await prisma.folioLineItem.findMany({
      where:   { folioId: fix.folioId, billingStatus: 'DRAFT', chargeType: { in: ['UTILITY_WATER', 'UTILITY_ELECTRIC'] } },
      select:  { chargeType: true, periodEnd: true },
    });
    ok(c2UtilityLines.length >= 2,        `cycle 2: found ${c2UtilityLines.length} utility lines`);
    ok(c2UtilityLines.every((l) => l.periodEnd !== null), 'cycle 2: all utility lines have periodEnd set (Task 5.3)');
    const waterLine = c2UtilityLines.find((l) => l.chargeType === 'UTILITY_WATER');
    ok(
      waterLine?.periodEnd?.toISOString().slice(0, 10) === '2026-03-09',
      `cycle 2: water periodEnd=2026-03-09 (got ${waterLine?.periodEnd?.toISOString().slice(0, 10)})`,
    );

    // ── Cycle 2: approve ─────────────────────────────────────────────────────
    console.log('Cycle 2 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft2.invoiceId, approvedBy: 'e2e-rolling' }),
    );
    const folio2 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(
      Number(folio2.totalCharges) === RATE + EXPECTED_TOTAL_2,
      `cycle 2 approved: folio.totalCharges=${folio2.totalCharges} (expected ${RATE + EXPECTED_TOTAL_2})`,
    );

    // ── Record reading @ 09 มี.ค. (end of cycle 2, past date) ─────────────────
    console.log('Record reading @ 2026-03-09 (end of cycle 2)');
    const reading2Date = new Date('2026-03-09T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: reading2Date } });
    const reading2 = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: reading2Date,
        currWater:   150,    // usage = 150 - 100 = 50
        currElectric: 2500,  // usage = 2500 - 2000 = 500
        recordedBy:  'e2e-rolling',
      }),
    );
    ok(Number(reading2.prevWater) === 100,  'reading 2: prevWater=100');
    ok(Number(reading2.currWater) === 150,  'reading 2: currWater=150');

    // ── Cycle 3: generate draft (partial) ─────────────────────────────────────
    // Cycle 3: 10 มี.ค. – 24 มี.ค. (15 days, March has 31 days)
    // rent = 15000 × 15/31 = 7258.06
    // Utility: curr = reading @ 09 มี.ค., baseline = reading before cycle 2 start (2026-02-10)
    //   baseline = reading @ 09 ก.พ. (currWater=100, currElectric=2000)
    //   waterUsage = 150 - 100 = 50; electricUsage = 2500 - 2000 = 500
    //   waterCharge = 50 × 18 = 900; electricCharge = 500 × 8 = 4000
    console.log('Cycle 3 — generate draft (partial, 15/31 days)');
    const draft3 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 3, createdBy: 'e2e-rolling' }),
    );
    ok(draft3.status === 'draft',     'cycle 3: status=draft');
    ok(draft3.isPartial === true,     'cycle 3: isPartial=true');
    ok(draft3.isFinal === true,       'cycle 3: isFinal=true');
    ok(draft3.needsReading === false, 'cycle 3: needsReading=false');
    ok(draft3.periodStart.toISOString().slice(0, 10) === '2026-03-10', 'cycle 3: periodStart=2026-03-10');
    ok(draft3.periodEnd.toISOString().slice(0, 10)   === '2026-03-24', 'cycle 3: periodEnd=2026-03-24');
    const WATER_CHARGE_3    = 50 * 18;  // 900
    const ELECTRIC_CHARGE_3 = 500 * 8; // 4000
    const EXPECTED_TOTAL_3  = CYCLE3_RENT + WATER_CHARGE_3 + ELECTRIC_CHARGE_3; // ~12158.06
    ok(
      Math.abs(Number(draft3.grandTotal) - EXPECTED_TOTAL_3) < 1,
      `cycle 3: grandTotal=${draft3.grandTotal} ≈ ${EXPECTED_TOTAL_3} (rent${CYCLE3_RENT}+w${WATER_CHARGE_3}+e${ELECTRIC_CHARGE_3})`,
    );

    // ── Cycle 3: approve ─────────────────────────────────────────────────────
    console.log('Cycle 3 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft3.invoiceId, approvedBy: 'e2e-rolling' }),
    );
    const folio3 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    const expectedFinalTotal = RATE + EXPECTED_TOTAL_2 + EXPECTED_TOTAL_3;
    ok(
      Math.abs(Number(folio3.totalCharges) - expectedFinalTotal) < 1,
      `cycle 3 approved: folio.totalCharges=${folio3.totalCharges} ≈ ${expectedFinalTotal}`,
    );

    // ── Final assertions ──────────────────────────────────────────────────────
    console.log('\nFinal assertions');
    const periods = await prisma.billingPeriod.findMany({
      where:   { bookingId: fix.bookingId },
      orderBy: { cycleIndex: 'asc' },
      select:  { cycleIndex: true, isPartial: true, isFinal: true, invoiceId: true },
    });
    ok(periods.length === 3,          `3 BillingPeriod rows (got ${periods.length})`);
    ok(periods[0].isPartial === false, 'period 1: not partial');
    ok(periods[1].isPartial === false, 'period 2: not partial');
    ok(periods[2].isPartial === true,  'period 3: partial');
    ok(periods[2].isFinal === true,    'period 3: isFinal=true');

    const invoices = await prisma.invoice.findMany({
      where:   { bookingId: fix.bookingId },
      select:  { id: true, status: true, grandTotal: true },
    });
    ok(invoices.length === 3,                          `3 Invoice rows (got ${invoices.length})`);
    ok(invoices.every((i) => i.status === 'unpaid'), 'all 3 invoices status=unpaid');

    const totalLedger = await prisma.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: { in: invoices.map((i) => i.id) } },
    });
    ok(totalLedger >= 6, `ledger has ≥6 entries (3 DR/CR pairs) — got ${totalLedger}`);

    const grandTotalSum = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);
    ok(
      Math.abs(grandTotalSum - expectedFinalTotal) < 1,
      `sum of invoice grandTotals=${grandTotalSum} ≈ ${expectedFinalTotal}`,
    );

  } finally {
    console.log('\n🧹  Cleanup …');
    await cleanupBookingFixture(fix);
    console.log('    done');
  }

  finalize('e2e-rolling-cycle');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
