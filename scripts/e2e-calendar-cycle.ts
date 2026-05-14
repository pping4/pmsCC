/**
 * e2e-calendar-cycle.ts
 *
 * Task 4.2 — Full 2.5-month calendar stay (monthly_long).
 *
 * Scenario: checkIn=2026-01-12, checkOut=2026-03-25, rate=฿15,000.
 *
 * Cycle 1 (partial-start): 12 ม.ค. – 31 ม.ค.  (20 days / 31 days)  isPartial=true
 * Cycle 2 (full):          01 ก.พ. – 28 ก.พ.  (28 days)            isPartial=false
 * Cycle 3 (partial-end):   01 มี.ค. – 24 มี.ค. (24 days / 31 days)  isPartial=true
 *
 * All dates in the past relative to today 2026-05-14.
 *
 * npx tsx scripts/e2e-calendar-cycle.ts
 */

import {
  prisma,
  ok,
  seedMonthlyBooking,
  cleanupBookingFixture,
  finalize,
} from './_billing-e2e-helpers';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';
import { recordReading } from '../src/services/utility.service';

const CHECK_IN  = new Date('2026-01-12T00:00:00.000Z');
const CHECK_OUT = new Date('2026-03-25T00:00:00.000Z');
const RATE      = 15000;

// Cycle 1: 12–31 ม.ค. = 20 days; January has 31 days
const C1_DAYS = 20;
const C1_MONTH_DAYS = 31;
const C1_RENT = Math.round(RATE * (C1_DAYS / C1_MONTH_DAYS) * 100) / 100; // 9677.42

// Cycle 2: 1–28 ก.พ. = 28 days (full month, 2026 is not a leap year)
const C2_RENT = RATE; // 15000 (isPartial=false; Feb 1 is 1st, Feb 28 is end of month)

// Cycle 3: 1–24 มี.ค. = 24 days; March has 31 days
const C3_DAYS = 24;
const C3_MONTH_DAYS = 31;
const C3_RENT = Math.round(RATE * (C3_DAYS / C3_MONTH_DAYS) * 100) / 100; // 11612.90

async function main() {
  console.log('\n🧪  e2e-calendar-cycle — 2.5-month monthly_long stay\n');
  console.log(`    C1 rent=${C1_RENT} (20/31), C2 rent=${C2_RENT} (full), C3 rent=${C3_RENT} (24/31)`);

  const tag = `calendar-${Date.now().toString(36).slice(-6)}`;
  const fix = await seedMonthlyBooking({
    tag,
    bookingType: 'monthly_long',
    checkIn:  CHECK_IN,
    checkOut: CHECK_OUT,
    rate:     RATE,
  });

  try {
    // ── Cycle 1: partial-start ────────────────────────────────────────────────
    console.log('\nCycle 1 — generate draft (partial-start, 12–31 ม.ค.)');
    const draft1 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 1, createdBy: 'e2e-calendar' }),
    );
    ok(draft1.status === 'draft',       'cycle 1: status=draft');
    ok(draft1.isPartial === true,       'cycle 1: isPartial=true (started 12th, not 1st)');
    ok(draft1.needsReading === false,   'cycle 1: needsReading=false');
    ok(draft1.periodStart.toISOString().slice(0, 10) === '2026-01-12', 'cycle 1: periodStart=2026-01-12');
    ok(draft1.periodEnd.toISOString().slice(0, 10)   === '2026-01-31', 'cycle 1: periodEnd=2026-01-31');
    ok(
      Math.abs(Number(draft1.grandTotal) - C1_RENT) < 1,
      `cycle 1: grandTotal=${draft1.grandTotal} ≈ ${C1_RENT} (20/31 × 15000)`,
    );

    // No ledger before approval
    const led1 = await prisma.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft1.invoiceId },
    });
    ok(led1 === 0, 'cycle 1 draft: 0 ledger entries');
    const folioBeforeApprove = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(Number(folioBeforeApprove.totalCharges) === 0, 'cycle 1 draft: folio.totalCharges=0');

    // Approve cycle 1
    console.log('Cycle 1 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'e2e-calendar' }),
    );
    const folio1 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(
      Math.abs(Number(folio1.totalCharges) - C1_RENT) < 1,
      `cycle 1 approved: folio.totalCharges≈${C1_RENT} (got ${folio1.totalCharges})`,
    );

    // ── Record reading @ end of January (past) ────────────────────────────────
    console.log('Record reading @ 2026-01-31 (end of cycle 1)');
    const reading1Date = new Date('2026-01-31T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: reading1Date } });
    await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: reading1Date,
        currWater:   80,
        currElectric: 1600,
        recordedBy:  'e2e-calendar',
      }),
    );
    ok(true, 'reading 1 @ 2026-01-31 recorded');

    // ── Cycle 2: full month ───────────────────────────────────────────────────
    console.log('Cycle 2 — generate draft (full: 1–28 ก.พ.)');
    const draft2 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 2, createdBy: 'e2e-calendar' }),
    );
    ok(draft2.status === 'draft',       'cycle 2: status=draft');
    ok(draft2.isPartial === false,      'cycle 2: isPartial=false (full calendar month Feb)');
    ok(draft2.needsReading === false,   'cycle 2: needsReading=false');
    ok(draft2.periodStart.toISOString().slice(0, 10) === '2026-02-01', 'cycle 2: periodStart=2026-02-01');
    ok(draft2.periodEnd.toISOString().slice(0, 10)   === '2026-02-28', 'cycle 2: periodEnd=2026-02-28');
    // Utility: curr = reading @ 31 ม.ค.; baseline = reading before cycle 1 start (2026-01-12) → null
    // waterUsage = 80 - 0 = 80; electricUsage = 1600 - 0 = 1600
    const C2_WATER    = 80 * 18;    // 1440
    const C2_ELECTRIC = 1600 * 8;   // 12800
    const C2_TOTAL    = C2_RENT + C2_WATER + C2_ELECTRIC; // 29240
    ok(
      Math.abs(Number(draft2.grandTotal) - C2_TOTAL) < 1,
      `cycle 2: grandTotal=${draft2.grandTotal} ≈ ${C2_TOTAL}`,
    );

    // Approve cycle 2
    console.log('Cycle 2 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft2.invoiceId, approvedBy: 'e2e-calendar' }),
    );
    const folio2 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    ok(
      Math.abs(Number(folio2.totalCharges) - (C1_RENT + C2_TOTAL)) < 1,
      `cycle 2 approved: folio≈${C1_RENT + C2_TOTAL} (got ${folio2.totalCharges})`,
    );

    // ── Record reading @ end of February ─────────────────────────────────────
    console.log('Record reading @ 2026-02-28 (end of cycle 2)');
    const reading2Date = new Date('2026-02-28T00:00:00.000Z');
    await prisma.utilityReading.deleteMany({ where: { roomId: fix.roomId, readingDate: reading2Date } });
    await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      fix.roomId,
        bookingId:   fix.bookingId,
        readingDate: reading2Date,
        currWater:   130,   // usage = 130 - 80 = 50
        currElectric: 2100, // usage = 2100 - 1600 = 500
        recordedBy:  'e2e-calendar',
      }),
    );
    ok(true, 'reading 2 @ 2026-02-28 recorded');

    // ── Cycle 3: partial-end ──────────────────────────────────────────────────
    console.log('Cycle 3 — generate draft (partial-end, 1–24 มี.ค.)');
    const draft3 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix.bookingId, cycleIndex: 3, createdBy: 'e2e-calendar' }),
    );
    ok(draft3.status === 'draft',      'cycle 3: status=draft');
    ok(draft3.isPartial === true,      'cycle 3: isPartial=true (checkout before end of March)');
    ok(draft3.isFinal === true,        'cycle 3: isFinal=true');
    ok(draft3.needsReading === false,  'cycle 3: needsReading=false');
    ok(draft3.periodStart.toISOString().slice(0, 10) === '2026-03-01', 'cycle 3: periodStart=2026-03-01');
    ok(draft3.periodEnd.toISOString().slice(0, 10)   === '2026-03-24', 'cycle 3: periodEnd=2026-03-24');
    // Utility: curr = reading @ 28 ก.พ.; baseline = reading before cycle 2 start (2026-02-01)
    //   baseline = reading @ 31 ม.ค. (currWater=80, currElectric=1600)
    //   usage water = 130 - 80 = 50; usage electric = 2100 - 1600 = 500
    const C3_WATER    = 50 * 18;    // 900
    const C3_ELECTRIC = 500 * 8;    // 4000
    const C3_TOTAL    = C3_RENT + C3_WATER + C3_ELECTRIC; // 16512.90
    ok(
      Math.abs(Number(draft3.grandTotal) - C3_TOTAL) < 1,
      `cycle 3: grandTotal=${draft3.grandTotal} ≈ ${C3_TOTAL} (rent${C3_RENT}+w${C3_WATER}+e${C3_ELECTRIC})`,
    );

    // Approve cycle 3
    console.log('Cycle 3 — approve');
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft3.invoiceId, approvedBy: 'e2e-calendar' }),
    );
    const folio3 = await prisma.folio.findUniqueOrThrow({ where: { id: fix.folioId } });
    const expectedFinal = C1_RENT + C2_TOTAL + C3_TOTAL;
    ok(
      Math.abs(Number(folio3.totalCharges) - expectedFinal) < 1,
      `cycle 3 approved: folio≈${expectedFinal} (got ${folio3.totalCharges})`,
    );

    // ── Final assertions ──────────────────────────────────────────────────────
    console.log('\nFinal assertions');
    const periods = await prisma.billingPeriod.findMany({
      where:   { bookingId: fix.bookingId },
      orderBy: { cycleIndex: 'asc' },
      select:  { cycleIndex: true, isPartial: true, isFinal: true },
    });
    ok(periods.length === 3,           '3 BillingPeriod rows');
    ok(periods[0].isPartial === true,  'period 1: isPartial=true (partial-start)');
    ok(periods[1].isPartial === false, 'period 2: isPartial=false (full month)');
    ok(periods[2].isPartial === true,  'period 3: isPartial=true (partial-end)');
    ok(periods[2].isFinal === true,    'period 3: isFinal=true');

    const invoices = await prisma.invoice.findMany({
      where:  { bookingId: fix.bookingId },
      select: { status: true, grandTotal: true },
    });
    ok(invoices.length === 3,                        '3 Invoice rows');
    ok(invoices.every((i) => i.status === 'unpaid'), 'all invoices status=unpaid');

    const sumGrand = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);
    ok(Math.abs(sumGrand - expectedFinal) < 1, `sum of grandTotals=${sumGrand} ≈ ${expectedFinal}`);

  } finally {
    console.log('\n🧹  Cleanup …');
    await cleanupBookingFixture(fix);
    console.log('    done');
  }

  finalize('e2e-calendar-cycle');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
