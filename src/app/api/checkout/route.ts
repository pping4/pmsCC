/**
 * POST /api/checkout
 *
 * Enhanced check-out flow (Phase 2):
 *  1. Validate booking is 'checked_in'
 *  2. Compute outstanding balance across all invoices
 *  3. Update booking → checked_out, room → checkout
 *  4. If outstanding > 0 and badDebt → post bad debt ledger entry
 *  5. If security deposit held → auto-refund or allow caller to trigger refund separately
 *     (deposit refund is done via /api/security-deposits/[id] PUT for full control)
 *  6. Return financial summary for receipt
 *
 * Security checklist:
 * ✅ Auth: session required
 * ✅ Input: Zod validated
 * ✅ Transaction: $transaction wraps all writes
 * ✅ Ledger: bad debt goes through ledger.service postBadDebt
 * ✅ No data leaks: select only needed fields
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { postBadDebt } from '@/services/ledger.service';
import { z } from 'zod';
import {
  getFolioByBookingId, addCharge, createInvoiceFromFolio,
  closeFolio, markLineItemsPaid, recalculateFolioBalance,
} from '@/services/folio.service';
import {
  generateInvoiceNumber, generatePaymentNumber, generateReceiptNumber,
} from '@/services/invoice-number.service';
import { logActivity } from '@/services/activityLog.service';
import { fmtDate } from '@/lib/date-format';
import type { ReceiptData } from '@/components/receipt/types';

const CheckoutSchema = z.object({
  bookingId:       z.string().min(1),
  notes:           z.string().max(500).optional(),
  badDebt:         z.boolean().optional().default(false),
  badDebtNote:     z.string().max(500).optional(),
  // ── Optional: collect outstanding at checkout ──────────────────────────
  paymentMethod:   z.enum(['cash', 'transfer', 'credit_card']).optional(),
  cashSessionId:   z.string().optional(),
}).refine(
  (d) => !d.badDebt || (d.badDebt && d.badDebtNote && d.badDebtNote.length > 0),
  { message: 'ต้องระบุเหตุผลของหนี้เสีย', path: ['badDebtNote'] }
);

function calcNights(checkIn: Date, checkOut: Date): number {
  return Math.max(
    1,
    Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24))
  );
}

export async function POST(request: Request) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { bookingId, notes, badDebt, badDebtNote, paymentMethod, cashSessionId } = parsed.data;
  const userId   = authSession.user.id ?? authSession.user.email ?? 'system';

  // ── Validate cash session when payment method = cash ──────────────────────
  if (paymentMethod === 'cash' && !cashSessionId) {
    return NextResponse.json(
      { error: 'ต้องระบุกะแคชเชียร์ที่เปิดอยู่สำหรับการชำระด้วยเงินสด' },
      { status: 422 }
    );
  }

  // ── Fetch booking with invoices and security deposits ──────────────────────
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room:    { select: { id: true, number: true } },
      guest:   { select: { id: true, firstName: true, lastName: true } },
      invoices: {
        select: {
          id:          true,
          invoiceNumber: true,
          grandTotal:  true,
          paidAmount:  true,
          status:      true,
          badDebt:     true,
          dueDate:     true,
        },
      },
      securityDeposits: {
        where: { status: { in: ['held', 'partially_deducted'] } },
        select: { id: true, amount: true, status: true },
      },
    },
  });

  if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  if (booking.status !== 'checked_in') {
    return NextResponse.json({ error: 'การจองนี้ยังไม่ได้เช็คอิน' }, { status: 400 });
  }

  // ── Compute financial summary ─────────────────────────────────────────────
  const totalInvoiced  = booking.invoices.reduce((s, inv) => s + Number(inv.grandTotal), 0);
  const totalPaid      = booking.invoices.reduce((s, inv) => s + Number(inv.paidAmount ?? 0), 0);
  const outstanding    = Math.max(0, totalInvoiced - totalPaid);

  const heldDeposit    = booking.securityDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const depositIds     = booking.securityDeposits.map((d) => d.id);

  const now = new Date();

  let checkoutSummary = { totalInvoiced: 0, totalPaid: 0, outstanding: 0, newInvoiceNumber: null as string | null };
  let checkoutReceipt: ReceiptData | null = null;

  await prisma.$transaction(async (tx) => {
    // ── 1. Update booking → checked_out ───────────────────────────────────
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status:          'checked_out',
        actualCheckOut:  now,
        ...(notes && { notes }),
      },
    });

    // ── 2. Update room → checkout ─────────────────────────────────────────
    await tx.room.update({
      where: { id: booking.roomId },
      data:  { status: 'checkout', currentBookingId: null },
    });

    // ── LOG: Checkout event ────────────────────────────────────────────────
    const guestName = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();
    await logActivity(tx, {
      userId,
      action:      'booking.checkout',
      category:    'checkout',
      description: `เช็คเอาท์: ห้อง ${booking.room.number} — ${guestName}`,
      bookingId,
      roomId:  booking.roomId,
      guestId: booking.guestId,
      icon:    '🧳',
      severity: 'success',
      metadata: {
        before: { status: 'checked_in' },
        after:  { status: 'checked_out' },
        roomNumber: booking.room.number,
        bookingType: booking.bookingType,
      },
    });

    // ── 3. Folio-centric: check for unbilled items and create final invoice ─
    const folio = await getFolioByBookingId(tx, bookingId);

    if (badDebt && outstanding > 0) {
      // ── 3a. BAD DEBT: create invoice + post ledger ───────────────────────
      const nights =
        booking.bookingType === 'daily'
          ? calcNights(booking.checkIn, booking.checkOut)
          : null;

      const description = nights
        ? `[หนี้เสีย] ค่าห้องพัก ${nights} คืน — ห้อง ${booking.room.number}`
        : `[หนี้เสีย] ค่าห้องพัก — ห้อง ${booking.room.number}`;

      // Only create bad-debt invoice if no existing unpaid invoice covers it
      const hasExistingUnpaid = booking.invoices.some(
        (inv) => inv.status === 'unpaid' || inv.status === 'overdue'
      );

      let badDebtInvoiceId: string;

      if (!hasExistingUnpaid) {
        const invoiceNumber = await generateInvoiceNumber(tx, 'BD');
        const bdInv = await tx.invoice.create({
          data: {
            invoiceNumber,
            bookingId,
            guestId:       booking.guestId,
            folioId:       folio?.folioId ?? null,
            issueDate:     now,
            dueDate:       now,
            subtotal:      outstanding,
            vatAmount:     0,
            grandTotal:    outstanding,
            paidAmount:    0,
            status:        'unpaid',
            badDebt:       true,
            badDebtNote,
            invoiceType:   'checkout_balance',
            createdBy:     userId,
            notes:         `[หนี้เสีย] — ${badDebtNote}`,
            items: {
              create: [{ description, amount: outstanding, taxType: 'no_tax' }],
            },
          },
          select: { id: true },
        });
        badDebtInvoiceId = bdInv.id;
      } else {
        // Mark existing unpaid as bad debt
        const first = booking.invoices.find(
          (inv) => inv.status === 'unpaid' || inv.status === 'overdue'
        )!;
        await tx.invoice.update({
          where: { id: first.id },
          data:  { badDebt: true, badDebtNote },
        });
        badDebtInvoiceId = first.id;
      }

      // Post ledger: DEBIT Bad Debt Expense / CREDIT AR
      await postBadDebt(tx, {
        amount:    outstanding,
        invoiceId: badDebtInvoiceId,
        createdBy: userId,
      });
    } else if (folio) {
      // ── 3b. Normal checkout: build final invoice
      //
      // BILLING FLOW (daily stay):
      //  A. Add ROOM charge if not already in Folio (i.e. not prepaid via INV-BK).
      //  B. Credit back any PAID DEPOSIT_BOOKING amounts so INV-CO = room − deposit.
      //  C. createInvoiceFromFolio bills UNBILLED items → INV-CO.
      //     Returns null when nothing to bill (e.g. full prepayment, no extras).
      //
      // Examples:
      //  Walk-in, no prepayment → room added here, INV-CO = room
      //  Deposit paid at booking → room added, credit added, INV-CO = room − deposit
      //  Full prepaid at booking → ROOM already PAID, no UNBILLED → INV-CO = null ✓

      if (booking.bookingType === 'daily') {
        // A: Add room charge only if no ROOM item exists (avoids double-billing prepaid)
        const existingRoomCharge = await tx.folioLineItem.findFirst({
          where: {
            folioId: folio.folioId,
            chargeType: 'ROOM' as never,
            billingStatus: { not: 'VOIDED' as never },
          },
          select: { id: true },
        });

        if (!existingRoomCharge) {
          const checkInTime = booking.actualCheckIn ?? booking.checkIn;
          const actualNights = calcNights(checkInTime, now);

          await addCharge(tx, {
            folioId: folio.folioId,
            chargeType: 'ROOM',
            description: `ค่าห้องพัก ${actualNights} คืน — ห้อง ${booking.room.number}`,
            amount: Number(booking.rate) * actualNights,
            quantity: actualNights,
            unitPrice: Number(booking.rate),
            createdBy: userId,
          });

          // B: For each PAID DEPOSIT_BOOKING, add a matching negative ADJUSTMENT
          //    so INV-CO reflects: room − deposit = net balance due.
          const paidDeposits = await tx.folioLineItem.findMany({
            where: {
              folioId: folio.folioId,
              chargeType: 'DEPOSIT_BOOKING' as never,
              billingStatus: 'PAID' as never,
            },
            select: { amount: true },
          });

          for (const dep of paidDeposits) {
            const depAmt = Number(dep.amount);
            if (depAmt > 0) {
              await addCharge(tx, {
                folioId: folio.folioId,
                chargeType: 'ADJUSTMENT',
                description: 'หักมัดจำที่รับไว้แล้ว (INV-BK)',
                amount: -depAmt,   // negative = credit on invoice
                createdBy: userId,
              });
            }
          }
        }
      }

      // C: Create final invoice from ALL UNBILLED items (null = nothing to bill)
      const coResult = await createInvoiceFromFolio(tx, {
        folioId: folio.folioId,
        guestId: booking.guestId,
        bookingId,
        invoiceType: 'CO',
        dueDate: now,
        notes: `ใบแจ้งหนี้ ณ เช็คเอาท์ — ห้อง ${booking.room.number}`,
        createdBy: userId,
      });
      if (coResult) {
        checkoutSummary.newInvoiceNumber = coResult.invoiceNumber;

        // ── LOG: INV-CO created ──────────────────────────────────────────
        await logActivity(tx, {
          userId,
          action:      'invoice.checkout_created',
          category:    'invoice',
          description: `ออกใบแจ้งหนี้ ${coResult.invoiceNumber} — ฿${coResult.grandTotal.toLocaleString()} — ห้อง ${booking.room.number}`,
          bookingId,
          guestId:  booking.guestId,
          invoiceId: coResult.invoiceId,
          icon:     '🧾',
          severity: 'info',
          metadata: {
            invoiceNumber: coResult.invoiceNumber,
            grandTotal: coResult.grandTotal,
            itemCount: coResult.itemCount,
          },
        });

        // D: If caller provided a payment method, collect the outstanding now.
        //    grandTotal may be 0 (fully cancelled via credits) — skip payment.
        if (paymentMethod && coResult.grandTotal > 0) {
          const [payNum, rcpNum] = await Promise.all([
            generatePaymentNumber(tx),
            generateReceiptNumber(tx),
          ]);

          const coPayment = await tx.payment.create({
            data: {
              paymentNumber:  payNum,
              receiptNumber:  rcpNum,
              bookingId,
              guestId:        booking.guestId,
              amount:         new Prisma.Decimal(coResult.grandTotal),
              paymentMethod:  paymentMethod as never,
              paymentDate:    now,
              status:         'ACTIVE',
              idempotencyKey: `co-${bookingId}`,
              ...(paymentMethod === 'cash' && cashSessionId
                ? { cashSessionId }
                : {}),
              createdBy: userId,
            },
            select: { id: true },
          });

          await tx.paymentAllocation.create({
            data: {
              paymentId:  coPayment.id,
              invoiceId:  coResult.invoiceId,
              amount:     new Prisma.Decimal(coResult.grandTotal),
            },
          });

          // Mark line items PAID + update invoice status
          await markLineItemsPaid(tx, coResult.invoiceId);

          await tx.invoice.update({
            where: { id: coResult.invoiceId },
            data:  {
              status:    'paid',
              paidAmount: new Prisma.Decimal(coResult.grandTotal),
            },
          });

          await recalculateFolioBalance(tx, folio.folioId);

          // ── LOG: Payment collected at checkout ────────────────────────
          await logActivity(tx, {
            userId,
            action:      'payment.checkout_collected',
            category:    'payment',
            description: `รับชำระ ฿${coResult.grandTotal.toLocaleString()} ณ เช็คเอาท์ — ห้อง ${booking.room.number} (${paymentMethod})`,
            bookingId,
            guestId:  booking.guestId,
            invoiceId: coResult.invoiceId,
            icon:     '💳',
            severity: 'success',
            metadata: {
              amount: coResult.grandTotal,
              paymentMethod,
              invoiceNumber: coResult.invoiceNumber,
            },
          });

          // ── Build checkout receipt ────────────────────────────────────
          const guestName = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();
          // Re-fetch the INV-CO items for detailed receipt line items
          const coItems = await tx.invoiceItem.findMany({
            where: { invoiceId: coResult.invoiceId },
            select: { description: true, amount: true },
          });
          checkoutReceipt = {
            receiptType:   'checkout',
            receiptNumber: rcpNum,
            paymentNumber: payNum,
            invoiceNumber: coResult.invoiceNumber,
            bookingNumber: booking.bookingNumber,
            guestName,
            roomNumber:    booking.room.number,
            bookingType:   booking.bookingType,
            checkIn:       fmtDate(booking.checkIn),
            checkOut:      fmtDate(booking.checkOut),
            items: coItems.map(i => ({
              description: i.description,
              amount:      Number(i.amount),
            })),
            subtotal:      coResult.grandTotal,
            vatAmount:     0,
            grandTotal:    coResult.grandTotal,
            paymentMethod: paymentMethod!,
            paidAmount:    coResult.grandTotal,
            issueDate:     now.toISOString(),
            cashierName:   userId,
          };
        }
      }
    }

    // ── 4. Close the Folio ────────────────────────────────────────────────
    if (folio) {
      await closeFolio(tx, folio.folioId);
    }
  });

  // Re-query post-transaction for accurate summary (pre-tx vars are stale)
  const postTxInvoices = await prisma.invoice.findMany({
    where: { bookingId, status: { not: 'voided' } },
    select: { grandTotal: true, paidAmount: true },
  });
  const postTotalInvoiced = postTxInvoices.reduce((s, i) => s + Number(i.grandTotal), 0);
  const postTotalPaid     = postTxInvoices.reduce((s, i) => s + Number(i.paidAmount ?? 0), 0);
  const postOutstanding   = Math.max(0, postTotalInvoiced - postTotalPaid);

  return NextResponse.json({
    success: true,
    summary: {
      totalInvoiced:    postTotalInvoiced,
      totalPaid:        postTotalPaid,
      outstanding:      postOutstanding,
      badDebt:          !!badDebt,
      heldDeposit,
      depositIds,
      newInvoiceNumber: checkoutSummary.newInvoiceNumber,
    },
    receipt: checkoutReceipt,   // null if no payment collected at checkout
  });
}
