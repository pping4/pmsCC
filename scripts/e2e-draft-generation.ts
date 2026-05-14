import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateDraftInvoice, approveDraft } from '../src/services/billing.service';

async function main() {
  await prisma.$transaction(async (tx) => {
    // ── Seed ──────────────────────────────────────────────────────────────────
    const room  = await tx.room.findFirstOrThrow({ select: { id: true, number: true } });
    const guest = await tx.guest.create({
      data: { firstName: 'TestDraft', lastName: 'X', nationality: 'TH', idNumber: 'TEST-ID-DRAFT' },
    });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: 'TEST-DRAFT-' + Date.now().toString(36),
        guestId: guest.id,
        roomId:  room.id,
        bookingType: 'monthly_short',
        checkIn:  new Date('2026-05-01T00:00:00.000Z'),
        checkOut: new Date('2026-07-01T00:00:00.000Z'),  // exactly 2 rolling cycles
        rate:    new Prisma.Decimal(15000),
        status:  'checked_in',
        source:  'walkin',
      },
    });
    const folio = await tx.folio.create({
      data: { bookingId: booking.id, folioNumber: 'TEST-FOLIO-' + Date.now().toString(36), guestId: guest.id },
    });

    // ── Draft generation ──────────────────────────────────────────────────────
    const draft1 = await generateDraftInvoice(tx, {
      bookingId: booking.id,
      cycleIndex: 1,
      createdBy: 'test-cron',
    });
    assert.strictEqual(draft1.status, 'draft');
    assert.strictEqual(Number(draft1.grandTotal), 15000);  // full rolling cycle, full rent
    assert.strictEqual(draft1.needsReading, false);         // cycle 1 has no utility

    const period1 = await tx.billingPeriod.findUniqueOrThrow({
      where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: 1 } },
    });
    assert.strictEqual(period1.invoiceId, draft1.invoiceId);
    assert.strictEqual(period1.isPartial, false);

    // CRITICAL: no ledger entry yet
    const led = await tx.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft1.invoiceId },
    });
    assert.strictEqual(led, 0, 'draft must NOT post ledger');

    // Folio totals must NOT change (DRAFT items excluded from totalCharges)
    const folioAfter = await tx.folio.findUniqueOrThrow({ where: { id: folio.id } });
    assert.strictEqual(Number(folioAfter.totalCharges), 0, 'folio totalCharges unchanged by draft');

    // ── Approval ──────────────────────────────────────────────────────────────
    const approved = await approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'test-mgr' });
    assert.strictEqual(approved.status, 'unpaid');

    const led2 = await tx.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft1.invoiceId },
    });
    // postInvoiceAccrual posts one DR/CR pair per non-zero leg.
    // Test data: subtotal=15000, serviceCharge=0, vatAmount=0 → 1 pair (revenue only) = 2 entries.
    assert.strictEqual(led2, 2, 'approval posts exactly one DR/CR pair (revenue only; SC+VAT=0)');

    const folioApproved = await tx.folio.findUniqueOrThrow({ where: { id: folio.id } });
    assert.strictEqual(Number(folioApproved.totalCharges), 15000, 'folio totalCharges updated on approve');

    // Re-approve must throw
    await assert.rejects(
      () => approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'test-mgr' }),
      /not in draft status/,
    );

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await tx.ledgerEntry.deleteMany({ where: { referenceType: 'Invoice', referenceId: draft1.invoiceId } });
    await tx.invoiceItem.deleteMany({ where: { invoiceId: draft1.invoiceId } });
    await tx.invoice.delete({ where: { id: draft1.invoiceId } });
    await tx.billingPeriod.delete({ where: { id: period1.id } });
    await tx.folioLineItem.deleteMany({ where: { folioId: folio.id } });
    await tx.folio.delete({ where: { id: folio.id } });
    await tx.booking.delete({ where: { id: booking.id } });
    await tx.guest.delete({ where: { id: guest.id } });
  });

  console.log('✓ draft generation creates Invoice(status=draft) + BillingPeriod + NO ledger');
  console.log('✓ approveDraft flips to unpaid + posts DR/CR pair + updates folio totalCharges');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
