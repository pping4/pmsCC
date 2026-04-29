/**
 * E2E test: full guest-credit lifecycle (issue → use → expire).
 *
 * Drives the same service functions the API routes use, asserting both
 * sides of every double-entry pair, then cleans up. Run on a clean dev
 * DB (or a DB where these test fixtures don't collide with real data).
 *
 *   npx tsx scripts/e2e-guest-credit.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { issueGuestCredit, consumeGuestCredit, getAvailableCredit, expireGuestCredit, bulkExpireGuestCredits } from '../src/services/guestCredit.service';

const p = new PrismaClient();

const failures: string[] = [];
function expect(cond: boolean, msg: string) {
  if (cond) { console.log(`    ✓ ${msg}`); }
  else      { console.log(`    ✗ ${msg}`); failures.push(msg); }
}

async function ledgerSumByAccount(referenceType: string, referenceIds: string[]) {
  const entries = await p.ledgerEntry.findMany({
    where: { referenceType, referenceId: { in: referenceIds } },
    select: { type: true, account: true, amount: true, financialAccountId: true },
  });
  const byAccount: Record<string, { debit: number; credit: number }> = {};
  for (const e of entries) {
    byAccount[e.account] ??= { debit: 0, credit: 0 };
    if (e.type === 'DEBIT')  byAccount[e.account].debit  += Number(e.amount);
    if (e.type === 'CREDIT') byAccount[e.account].credit += Number(e.amount);
  }
  return { byAccount, count: entries.length, withFK: entries.filter(e => e.financialAccountId).length };
}

async function main() {
  console.log('🧪  Guest Credit lifecycle E2E\n');

  // Use a FRESH dedicated guest for the test so existing credits from prior
  // app activity don't poison FIFO consumption / liability sums.
  const room  = await p.room.findFirst({ where: { status: 'available' }, select: { id: true, number: true } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' }, select: { id: true } });
  if (!room || !admin) { console.error('missing fixtures'); process.exit(1); }

  const tag = `e2e-credit-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`Tag: ${tag}`);
  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-6)}`, lastName: 'TestGuest',
      phone: '0000000000', nationality: 'Thai', idType: 'thai_id',
      idNumber: `9999${Date.now().toString().slice(-9)}`,
    },
    select: { id: true, firstName: true },
  });
  console.log(`Guest: ${guest.firstName} (${guest.id.slice(0,8)})\n`);

  const created = {
    bookingIds:     [] as string[],
    folioIds:       [] as string[],
    invoiceIds:     [] as string[],
    paymentIds:     [] as string[],
    creditIds:      [] as string[],
  };

  try {
    // ─── Scenario 1: Issue a credit (manual) ────────────────────────────────
    console.log('1️⃣   Issue ฿500 GuestCredit');
    const before = await getAvailableCredit(p, guest.id);
    const issuedCredit = await p.$transaction((tx) =>
      issueGuestCredit(tx, {
        guestId:   guest.id,
        amount:    500,
        notes:     `${tag} initial issue`,
        createdBy: admin.id,
      }),
    );
    created.creditIds.push(issuedCredit.id);
    const after = await getAvailableCredit(p, guest.id);
    expect(after - before === 500, `available credit increased by exactly 500 (${before} → ${after})`);

    const issueLedger = await ledgerSumByAccount('GuestCredit', [issuedCredit.id]);
    expect(issueLedger.count === 2, `2 ledger entries for issue (got ${issueLedger.count})`);
    expect(issueLedger.byAccount.AR?.debit === 500, 'DR AR 500');
    expect(issueLedger.byAccount.GUEST_CREDIT_LIABILITY?.credit === 500, 'CR GUEST_CREDIT_LIABILITY 500');
    expect(issueLedger.withFK === issueLedger.count, 'all entries carry financialAccountId');
    console.log('');

    // ─── Scenario 2: Customer uses credit on a new invoice ──────────────────
    console.log('2️⃣   Customer uses ฿300 of credit on a new invoice');
    const setup = await p.$transaction(async (tx) => {
      const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
      const booking = await tx.booking.create({
        data: {
          bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
          bookingType: 'daily', status: 'checked_in', source: 'direct',
          checkIn: new Date('2026-12-01'), checkOut: new Date('2026-12-02'),
          rate: new Prisma.Decimal(1000),
        },
      });
      const folio = await tx.folio.create({
        data: {
          folioNumber: `FLO-2026-${num}`, bookingId: booking.id, guestId: guest.id,
          totalCharges: new Prisma.Decimal(1000), totalPayments: new Prisma.Decimal(0), balance: new Prisma.Decimal(1000),
        },
      });
      const item = await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: `ค่าห้องพัก — ห้อง ${room.number}`,
          amount: new Prisma.Decimal(1000), quantity: 1, unitPrice: new Prisma.Decimal(1000),
          taxType: 'no_tax', billingStatus: 'BILLED',
          serviceDate: new Date('2026-12-01'), periodEnd: new Date('2026-12-02'), createdBy: admin.id,
        },
      });
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-CI-2026-${num}`, bookingId: booking.id, guestId: guest.id, folioId: folio.id,
          issueDate: new Date(), dueDate: new Date('2026-12-02'), invoiceType: 'daily_stay',
          subtotal: new Prisma.Decimal(1000), grandTotal: new Prisma.Decimal(1000), paidAmount: new Prisma.Decimal(0),
          status: 'unpaid',
          items: { create: [{ description: item.description, amount: new Prisma.Decimal(1000), folioLineItemId: item.id, taxType: 'no_tax' }] },
        },
      });
      return { bookingId: booking.id, folioId: folio.id, invoiceId: inv.id };
    });
    created.bookingIds.push(setup.bookingId);
    created.folioIds.push(setup.folioId);
    created.invoiceIds.push(setup.invoiceId);

    const consumeResult = await p.$transaction((tx) =>
      consumeGuestCredit(tx, {
        guestId:   guest.id,
        invoiceId: setup.invoiceId,
        maxAmount: 300,
        createdBy: admin.id,
      }),
    );
    expect(consumeResult.applied === 300, `applied 300 (got ${consumeResult.applied})`);
    expect(consumeResult.creditsUsed.length === 1, '1 credit consumed (FIFO)');

    const creditAfterUse = await p.guestCredit.findUnique({
      where: { id: issuedCredit.id },
      select: { remainingAmount: true, status: true },
    });
    expect(Number(creditAfterUse!.remainingAmount) === 200, `credit remaining = 200 (got ${creditAfterUse!.remainingAmount})`);
    expect(creditAfterUse!.status === 'active', 'still active (not fully consumed)');

    // Verify ledger pair posted: DR GUEST_CREDIT_LIABILITY / CR AR
    const consumeLedger = await ledgerSumByAccount('GuestCredit', [issuedCredit.id]);
    // accumulator now has issue + consume entries
    expect(
      (consumeLedger.byAccount.GUEST_CREDIT_LIABILITY?.debit ?? 0) === 300 &&
      (consumeLedger.byAccount.AR?.credit ?? 0) === 300,
      'DR GUEST_CREDIT_LIABILITY 300 + CR AR 300 posted'
    );

    // Verify allocation row created with kind='credit'
    const allocations = await p.paymentAllocation.findMany({
      where: { invoiceId: setup.invoiceId, guestCreditId: issuedCredit.id },
    });
    expect(allocations.length === 1, '1 PaymentAllocation kind=credit');
    expect(allocations[0]?.kind === 'credit', `allocation.kind === 'credit' (got ${allocations[0]?.kind})`);
    if (allocations[0]) created.paymentIds.push(allocations[0].paymentId);
    console.log('');

    // ─── Scenario 3: Expire the remaining credit ───────────────────────────
    console.log('3️⃣   Manager expires remaining ฿200');
    const expireResult = await p.$transaction((tx) =>
      expireGuestCredit(tx, {
        creditId:    issuedCredit.id,
        reason:      `${tag} test expire`,
        expiredBy:   admin.id,
        finalStatus: 'expired',
      }),
    );
    expect(expireResult.amountForfeited === 200, `forfeited 200 (got ${expireResult.amountForfeited})`);

    const creditAfterExpire = await p.guestCredit.findUnique({
      where: { id: issuedCredit.id },
      select: { remainingAmount: true, status: true },
    });
    expect(creditAfterExpire!.status === 'expired', `status = expired (got ${creditAfterExpire!.status})`);
    expect(Number(creditAfterExpire!.remainingAmount) === 0, `remaining = 0`);

    // Verify forfeit ledger pair posted: DR GUEST_CREDIT_LIABILITY / CR REVENUE
    // The CR side's financialAccountId should be 4140-01 (Forfeited Revenue)
    const forfeitEntries = await p.ledgerEntry.findMany({
      where: { referenceType: 'GuestCredit', referenceId: issuedCredit.id, description: { contains: 'expired' } },
      select: {
        type: true, account: true, amount: true,
        financialAccount: { select: { code: true, subKind: true } },
      },
    });
    expect(forfeitEntries.length === 2, `2 forfeit entries (got ${forfeitEntries.length})`);
    const drLeg = forfeitEntries.find((e) => e.type === 'DEBIT');
    const crLeg = forfeitEntries.find((e) => e.type === 'CREDIT');
    expect(drLeg?.account === 'GUEST_CREDIT_LIABILITY', 'DR GUEST_CREDIT_LIABILITY');
    expect(Number(drLeg?.amount ?? 0) === 200, 'DR amount = 200');
    expect(crLeg?.account === 'REVENUE', 'CR REVENUE (legacy enum)');
    expect(crLeg?.financialAccount?.subKind === 'FORFEITED_REVENUE',
      `CR side routes to FORFEITED_REVENUE (got ${crLeg?.financialAccount?.subKind})`);
    expect(crLeg?.financialAccount?.code === '4140-01',
      `CR FinancialAccount code = 4140-01 (got ${crLeg?.financialAccount?.code})`);

    // Available credit should now be back to before-test baseline
    const finalAvailable = await getAvailableCredit(p, guest.id);
    expect(finalAvailable === before, `available credit back to baseline (${before} → ${finalAvailable})`);
    console.log('');

    // ─── Scenario 4: Bulk-expire (year-end forfeit) ──────────────────────────
    console.log('4️⃣   Bulk expire — issue 3 credits, then forfeit all');
    const c1 = await p.$transaction((tx) => issueGuestCredit(tx, { guestId: guest.id, amount: 100, notes: `${tag} bulk-1`, createdBy: admin.id }));
    const c2 = await p.$transaction((tx) => issueGuestCredit(tx, { guestId: guest.id, amount: 200, notes: `${tag} bulk-2`, createdBy: admin.id }));
    const c3 = await p.$transaction((tx) => issueGuestCredit(tx, { guestId: guest.id, amount: 50,  notes: `${tag} bulk-3`, createdBy: admin.id }));
    created.creditIds.push(c1.id, c2.id, c3.id);

    const liabilityBefore = await getAvailableCredit(p, guest.id);
    expect(liabilityBefore === 350, `total active liability = 350 before bulk-expire (got ${liabilityBefore})`);

    // Use a future cutoff so all 3 get hit
    const cutoff = new Date(Date.now() + 60_000);
    const bulkResult = await p.$transaction((tx) =>
      bulkExpireGuestCredits(tx, {
        cutoffDate: cutoff,
        reason:     `${tag} year-end forfeit`,
        expiredBy:  admin.id,
      }),
    );
    expect(bulkResult.count === 3, `3 credits forfeited (got ${bulkResult.count})`);
    expect(bulkResult.totalAmount === 350, `total ฿350 forfeited (got ${bulkResult.totalAmount})`);

    const liabilityAfter = await getAvailableCredit(p, guest.id);
    expect(liabilityAfter === 0, `liability cleared (got ${liabilityAfter})`);
    console.log('');

  } finally {
    // ─── Teardown — order matters for FK integrity ──────────────────────────
    // Delete in reverse-FK-dependency order. The full strategy:
    //   1. Delete every allocation referencing our invoices (covers sentinel
    //      payments that consume created without us tracking their ids)
    //   2. Delete sentinel payments that have no remaining allocations
    //   3. Delete invoice items + invoices
    //   4. Delete credits (and any allocations still pointing at them)
    //   5. Delete folios + bookings
    //   6. Delete the test guest
    console.log('🧹  Cleanup');
    if (created.invoiceIds.length) {
      // 1. blow away ANY allocation pointing at our test invoices
      const allocs = await p.paymentAllocation.findMany({
        where:  { invoiceId: { in: created.invoiceIds } },
        select: { id: true, paymentId: true },
      });
      const allocPaymentIds = Array.from(new Set(allocs.map(a => a.paymentId)));
      await p.paymentAllocation.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
      // 2. drop those payments too (they're sentinels with no other invoices)
      if (allocPaymentIds.length) {
        await p.payment.deleteMany({ where: { id: { in: allocPaymentIds } } });
      }
      await p.invoiceItem.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
      await p.invoice.deleteMany({ where: { id: { in: created.invoiceIds } } });
    }
    if (created.creditIds.length) {
      await p.paymentAllocation.deleteMany({ where: { guestCreditId: { in: created.creditIds } } });
      await p.guestCredit.deleteMany({ where: { id: { in: created.creditIds } } });
    }
    if (created.folioIds.length) {
      await p.folioLineItem.deleteMany({ where: { folioId: { in: created.folioIds } } });
      await p.folio.deleteMany({ where: { id: { in: created.folioIds } } });
    }
    if (created.bookingIds.length) {
      await p.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    }
    // Test guest goes last — its credits/bookings are gone
    await p.guest.delete({ where: { id: guest.id } }).catch(() => {});
    // Ledger entries are immutable — leave them as audit trail.
    console.log('   done.\n');
  }

  if (failures.length === 0) {
    console.log('🎉  ALL ASSERTIONS PASSED');
  } else {
    console.log(`❌  ${failures.length} ASSERTION${failures.length === 1 ? '' : 'S'} FAILED:`);
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }

  await p.$disconnect();
}

main().catch(async (e) => {
  console.error('\n💥  Fatal:', e);
  await p.$disconnect();
  process.exitCode = 2;
});
