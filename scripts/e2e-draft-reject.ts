import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateDraftInvoice, rejectDraft } from '../src/services/billing.service';

async function main() {
  await prisma.$transaction(async (tx) => {
    // ── Seed (same harness as e2e-draft-generation.ts) ────────────────────────
    const room  = await tx.room.findFirstOrThrow({ select: { id: true, number: true } });
    const guest = await tx.guest.create({
      data: { firstName: 'TestReject', lastName: 'Y', nationality: 'TH', idNumber: 'TEST-ID-REJECT' },
    });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: 'TEST-REJECT-' + Date.now().toString(36),
        guestId: guest.id,
        roomId:  room.id,
        bookingType: 'monthly_short',
        checkIn:  new Date('2026-05-01T00:00:00.000Z'),
        checkOut: new Date('2026-07-01T00:00:00.000Z'),
        rate:    new Prisma.Decimal(15000),
        status:  'checked_in',
        source:  'walkin',
      },
    });
    const folio = await tx.folio.create({
      data: { bookingId: booking.id, folioNumber: 'TEST-FOLIO-REJ-' + Date.now().toString(36), guestId: guest.id },
    });

    // ── Generate and then reject cycle 1 draft ────────────────────────────────
    const draft = await generateDraftInvoice(tx, {
      bookingId: booking.id,
      cycleIndex: 1,
      createdBy: 'test',
    });

    const rejected = await rejectDraft(tx, {
      invoiceId: draft.invoiceId,
      reason: 'wrong period',
      rejectedBy: 'test-mgr',
    });
    assert.strictEqual(rejected.status, 'voided');

    // BillingPeriod.invoiceId must be null after reject
    const period = await tx.billingPeriod.findUniqueOrThrow({
      where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: 1 } },
    });
    assert.strictEqual(period.invoiceId, null, 'reject clears BillingPeriod.invoiceId');

    // No ledger entries for rejected draft
    const led = await tx.ledgerEntry.count({
      where: { referenceType: 'Invoice', referenceId: draft.invoiceId },
    });
    assert.strictEqual(led, 0, 'reject must NOT post ledger');

    // Folio line items flipped to VOIDED
    const draftItems = await tx.folioLineItem.findMany({ where: { folioId: folio.id } });
    assert.ok(draftItems.length > 0, 'expect at least one line item from draft');
    for (const item of draftItems) {
      assert.strictEqual(item.billingStatus as string, 'VOIDED', `item ${item.id} should be VOIDED`);
    }

    // ── CRITICAL: re-draft for same cycle must succeed (no P2002) ─────────────
    const draft2 = await generateDraftInvoice(tx, {
      bookingId: booking.id,
      cycleIndex: 1,
      createdBy: 'test',
    });
    assert.notStrictEqual(draft2.invoiceId, draft.invoiceId, 'second draft has fresh invoice id');
    assert.strictEqual(draft2.status, 'draft');

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await tx.invoiceItem.deleteMany({ where: { invoiceId: draft.invoiceId } });
    await tx.invoice.delete({ where: { id: draft.invoiceId } });
    await tx.invoiceItem.deleteMany({ where: { invoiceId: draft2.invoiceId } });
    await tx.invoice.delete({ where: { id: draft2.invoiceId } });
    await tx.billingPeriod.deleteMany({ where: { bookingId: booking.id } });
    await tx.folioLineItem.deleteMany({ where: { folioId: folio.id } });
    await tx.folio.delete({ where: { id: folio.id } });
    await tx.booking.delete({ where: { id: booking.id } });
    await tx.guest.delete({ where: { id: guest.id } });
  });

  console.log('✓ rejectDraft voids invoice + clears BillingPeriod link + allows re-draft');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
