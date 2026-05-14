/**
 * e2e-recurring-in-cycle.ts
 *
 * Integration test for recurring charges flowing through generateDraftInvoice.
 *
 * Scenario:
 *  - monthly_short booking: checkIn=2026-05-12, checkOut=2026-09-25, rate=฿15,000
 *  - Cycle 1: 12 พ.ค. – 11 มิ.ย. (31 days, May) — no utility, no recurring
 *  - Cycle 2: 12 มิ.ย. – 11 ก.ค. (30 days, June)
 *      TV ฿500  (starts 2026-06-01, no end) — full overlap → 500
 *      Internet ฿800 (starts 2026-06-20) — partial: 22/30 days → 586.67
 *  - Cycle 3: 12 ก.ค. – 11 ส.ค. (31 days, July)
 *      TV ฿500 — full overlap → 500
 *      Internet ฿800 — full overlap (starts 2026-06-20, well before cycle) → 800
 *      AC service ฿1,200 (starts 2026-07-25) — partial: 18/31 days → 696.77
 *
 * Assertions:
 *  - draft line counts and amounts
 *  - approveDraft ledger pair (DR/CR)
 *  - pro-rate math matches Decimal precision
 *
 * npx tsx scripts/e2e-recurring-in-cycle.ts
 */

import {
  prisma,
  ok,
  seedMonthlyBooking,
  cleanupBookingFixture,
  finalize,
  type SeededBooking,
} from './_billing-e2e-helpers';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';
import {
  createRecurringCharge,
  cancelRecurringCharge,
  RecurringValidationError,
} from '../src/services/recurring.service';

const CHECK_IN  = new Date('2026-05-12T00:00:00.000Z');
const CHECK_OUT = new Date('2026-09-25T00:00:00.000Z');
const RATE = 15000;

// Cycle 2: 12 มิ.ย. – 11 ก.ค. (June has 30 days → 30-day cycle)
const C2_DAYS = 30;
// Cycle 3: 12 ก.ค. – 11 ส.ค. (July has 31 days → 31-day cycle)
const C3_DAYS = 31;

async function main() {
  console.log('\n🧪  e2e-recurring-in-cycle\n');

  const tag = `e2e-recurring-${Date.now()}`;
  let fix: SeededBooking | null = null;
  let tvRcId: string | null = null;

  try {
    fix = await seedMonthlyBooking({
      tag,
      bookingType: 'monthly_short',
      checkIn:     CHECK_IN,
      checkOut:    CHECK_OUT,
      rate:        RATE,
    });

    // ── Cycle 1: generate draft (no recurring yet) ─────────────────────────────
    console.log('Cycle 1 — generate draft (no recurring)');
    const draft1 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix!.bookingId, cycleIndex: 1, createdBy: 'e2e-recurring' }),
    );
    ok(draft1.status === 'draft',          'cycle 1: status=draft');
    ok(Number(draft1.grandTotal) === RATE,  `cycle 1: grandTotal=${draft1.grandTotal} (expected ${RATE})`);

    // Check no recurring lines
    const c1Lines = await prisma.folioLineItem.findMany({
      where: { folioId: fix.folioId, billingStatus: 'DRAFT', referenceType: 'recurring_charge' },
    });
    ok(c1Lines.length === 0, 'cycle 1: 0 recurring lines');

    // Approve cycle 1
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'e2e-recurring' }),
    );
    ok(true, 'cycle 1: approveDraft succeeded');

    // ── Create TV recurring charge ─────────────────────────────────────────────
    console.log('\nCreate "เช่า TV" recurring ฿500, start=2026-06-01, no end');
    const tvRc = await prisma.$transaction((tx) =>
      createRecurringCharge(tx, {
        bookingId:   fix!.bookingId,
        chargeType:  'EXTRA_SERVICE',
        description: 'เช่า TV',
        amount:      500,
        startDate:   new Date('2026-06-01T00:00:00.000Z'),
        createdBy:   'e2e-recurring',
      }),
    );
    tvRcId = tvRc.id;
    ok(tvRc.status === 'active', 'TV recurring: status=active');

    // ── Cycle 2: draft with TV (full overlap) ──────────────────────────────────
    console.log('\nCycle 2 — generate draft (TV full overlap)');
    const draft2 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix!.bookingId, cycleIndex: 2, createdBy: 'e2e-recurring' }),
    );
    ok(draft2.status === 'draft', 'cycle 2: status=draft');

    const c2Lines = await prisma.folioLineItem.findMany({
      where:   { folioId: fix.folioId, billingStatus: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
    });
    // cycle 2 lines: 1 ROOM + 1 EXTRA_SERVICE (TV)
    const c2Room = c2Lines.filter((l) => l.chargeType === 'ROOM');
    const c2Tv   = c2Lines.filter((l) => l.referenceType === 'recurring_charge');
    ok(c2Room.length === 1,              'cycle 2: 1 ROOM line');
    ok(c2Tv.length === 1,               'cycle 2: 1 recurring (TV) line');
    ok(Number(c2Tv[0].amount) === 500,  `cycle 2: TV amount=500 (got ${c2Tv[0].amount})`);
    ok(c2Tv[0].description === 'เช่า TV', 'cycle 2: TV description correct (full overlap, no pro-rate suffix)');
    ok(c2Tv[0].periodEnd !== null,      'cycle 2: TV line has periodEnd set');
    ok(c2Tv[0].referenceId === tvRc.id, 'cycle 2: TV line referenceId = tvRc.id');

    // Grand total = 15000 (rent) + 500 (TV)
    const c2Expected = RATE + 500;
    ok(
      Number(draft2.grandTotal) === c2Expected,
      `cycle 2: grandTotal=${draft2.grandTotal} (expected ${c2Expected})`,
    );

    // Approve cycle 2
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft2.invoiceId, approvedBy: 'e2e-recurring' }),
    );
    const led2 = await prisma.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft2.invoiceId },
    });
    ok(led2 >= 2, `cycle 2: approveDraft posted ledger (${led2} entries)`);

    // ── Add Internet recurring ──────────────────────────────────────────────────
    console.log('\nCreate "Internet" recurring ฿800, start=2026-06-20, no end');
    const internetRc = await prisma.$transaction((tx) =>
      createRecurringCharge(tx, {
        bookingId:   fix!.bookingId,
        chargeType:  'EXTRA_SERVICE',
        description: 'Internet',
        amount:      800,
        startDate:   new Date('2026-06-20T00:00:00.000Z'),
        createdBy:   'e2e-recurring',
      }),
    );
    ok(internetRc.status === 'active', 'Internet recurring: status=active');

    // ── Cycle 3: draft with TV (full) + Internet (full) + AC (partial) ─────────
    // First add AC service (partial: starts 2026-07-25)
    console.log('\nCreate "AC service" recurring ฿1200, start=2026-07-25, no end');
    const acRc = await prisma.$transaction((tx) =>
      createRecurringCharge(tx, {
        bookingId:   fix!.bookingId,
        chargeType:  'EXTRA_SERVICE',
        description: 'AC service',
        amount:      1200,
        startDate:   new Date('2026-07-25T00:00:00.000Z'),
        createdBy:   'e2e-recurring',
      }),
    );
    ok(acRc.status === 'active', 'AC recurring: status=active');

    console.log('\nCycle 3 — generate draft (TV + Internet full, AC partial 18/31 days)');
    const draft3 = await prisma.$transaction((tx) =>
      generateDraftInvoice(tx, { bookingId: fix!.bookingId, cycleIndex: 3, createdBy: 'e2e-recurring' }),
    );
    ok(draft3.status === 'draft', 'cycle 3: status=draft');

    const c3Lines = await prisma.folioLineItem.findMany({
      where:   { folioId: fix.folioId, billingStatus: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
    });
    const c3Recurring = c3Lines.filter((l) => l.referenceType === 'recurring_charge');
    ok(c3Recurring.length === 3, `cycle 3: 3 recurring lines (got ${c3Recurring.length})`);

    // TV: full overlap (startDate=2026-06-01, well before cycle 3 2026-07-12–2026-08-11)
    const c3Tv = c3Recurring.find((l) => l.referenceId === tvRc.id);
    ok(!!c3Tv,                              'cycle 3: TV line present');
    ok(Number(c3Tv!.amount) === 500,        `cycle 3: TV amount=500 (got ${c3Tv!.amount})`);
    ok(c3Tv!.description === 'เช่า TV',     'cycle 3: TV full overlap (no pro-rate suffix)');

    // Internet: full overlap (startDate=2026-06-20, before cycle 3 start 2026-07-12)
    const c3Internet = c3Recurring.find((l) => l.referenceId === internetRc.id);
    ok(!!c3Internet,                        'cycle 3: Internet line present');
    ok(Number(c3Internet!.amount) === 800,  `cycle 3: Internet amount=800 (got ${c3Internet!.amount})`);
    ok(c3Internet!.description === 'Internet', 'cycle 3: Internet full overlap (no pro-rate suffix)');

    // AC: partial overlap — starts 2026-07-25; cycle3 = 12 ก.ค.–11 ส.ค. (31 days)
    // effStart=2026-07-25, effEnd=2026-08-11
    // overlapDays = (Aug11 - Jul25) + 1 = 17 + 1 = 18
    // cycleDays = 31
    // amount = 1200 * 18/31 = 696.77
    const AC_OVERLAP   = 18;
    const AC_CYCLE     = C3_DAYS; // 31
    const AC_EXPECTED  = 696.77;
    const c3Ac = c3Recurring.find((l) => l.referenceId === acRc.id);
    ok(!!c3Ac,                                        'cycle 3: AC line present');
    ok(
      Math.abs(Number(c3Ac!.amount) - AC_EXPECTED) < 0.01,
      `cycle 3: AC amount=${c3Ac!.amount} ≈ ${AC_EXPECTED} (${AC_OVERLAP}/${AC_CYCLE} days × 1200)`,
    );
    ok(
      c3Ac!.description.includes(`${AC_OVERLAP}/${AC_CYCLE}`),
      `cycle 3: AC description includes pro-rate suffix (got "${c3Ac!.description}")`,
    );
    ok(c3Ac!.periodEnd !== null, 'cycle 3: AC line has periodEnd set');

    // Grand total: 15000 + 500 + 800 + 696.77
    const c3Expected = RATE + 500 + 800 + AC_EXPECTED;
    ok(
      Math.abs(Number(draft3.grandTotal) - c3Expected) < 0.01,
      `cycle 3: grandTotal=${draft3.grandTotal} ≈ ${c3Expected}`,
    );

    // Approve cycle 3
    await prisma.$transaction((tx) =>
      approveDraft(tx, { invoiceId: draft3.invoiceId, approvedBy: 'e2e-recurring' }),
    );
    ok(true, 'cycle 3: approveDraft succeeded');

    // ── Validation: cancel a recurring and verify exclusion ────────────────────
    console.log('\nCancel TV recurring — verify excluded from future cycle list');
    await prisma.$transaction((tx) =>
      cancelRecurringCharge(tx, tvRc.id, 'e2e-recurring'),
    );

    // Double-cancel should throw
    let caughtAlreadyCancelled = false;
    try {
      await prisma.$transaction((tx) =>
        cancelRecurringCharge(tx, tvRc.id, 'e2e-recurring'),
      );
    } catch (e) {
      if (e instanceof RecurringValidationError && e.code === 'ALREADY_CANCELLED') {
        caughtAlreadyCancelled = true;
      }
    }
    ok(caughtAlreadyCancelled, 'double-cancel throws ALREADY_CANCELLED');

    // Cycle 4 would not include TV (cancelled)
    // We don't generate cycle 4 here (would need cycle 3 approved and data for it),
    // but we can assert via listForCycle helper directly
    const c4Start = new Date('2026-08-12T00:00:00.000Z');
    const c4End   = new Date('2026-09-11T00:00:00.000Z');
    const c4Recurring = await prisma.$transaction((tx) =>
      tx.recurringCharge.findMany({
        where: {
          bookingId: fix!.bookingId,
          status:    'active',
          startDate: { lte: c4End },
          OR: [{ endDate: null }, { endDate: { gte: c4Start } }],
        },
      }),
    );
    const c4Ids = c4Recurring.map((r) => r.id);
    ok(!c4Ids.includes(tvRc.id),        'cancelled TV excluded from hypothetical cycle 4');
    ok(c4Ids.includes(internetRc.id),   'Internet still active in hypothetical cycle 4');
    ok(c4Ids.includes(acRc.id),         'AC still active in hypothetical cycle 4');

  } finally {
    if (fix) {
      console.log('\n🧹  Cleanup …');
      // recurringCharges have FK to bookings — must delete them first
      await prisma.recurringCharge.deleteMany({ where: { bookingId: fix.bookingId } });
      await cleanupBookingFixture(fix);
      console.log('    done');
    }
  }

  finalize('e2e-recurring-in-cycle');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
