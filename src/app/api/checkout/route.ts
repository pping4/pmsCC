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
import { postInvoiceToCityLedger } from '@/services/cityLedger.service';
import { z } from 'zod';
import {
  getFolioByBookingId, addCharge, createInvoiceFromFolio,
  closeFolio,
} from '@/services/folio.service';
import { generateInvoiceNumber } from '@/services/invoice-number.service';
import { createPayment } from '@/services/payment.service';
import { logActivity } from '@/services/activityLog.service';
import { transitionRoom, RoomTransitionError } from '@/services/roomStatus.service';
import { createCheckoutCleaningTask } from '@/services/housekeeping.service';
import { fmtDate } from '@/lib/date-format';
import { expandNightlyReceiptItems } from '@/lib/invoice-utils';
import type { ReceiptData } from '@/components/receipt/types';

const CheckoutSchema = z.object({
  bookingId:       z.string().min(1),
  notes:           z.string().max(500).optional(),
  badDebt:         z.boolean().optional().default(false),
  badDebtNote:     z.string().max(500).optional(),
  // ── Optional: collect outstanding at checkout ──────────────────────────
  paymentMethod:   z.enum(['cash', 'transfer', 'credit_card']).optional(),
  // Sprint 4B: cashSessionId removed from schema — server resolves it from
  // the authenticated user's open shift via getActiveSessionForUser.
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
  try {
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

  const { bookingId, notes, badDebt, badDebtNote, paymentMethod } = parsed.data;
  const userId   = authSession.user.id ?? authSession.user.email ?? 'system';

  // Sprint 4B: cashSessionId is resolved server-side inside the transaction.
  // The $transaction below will throw if cash is requested but no shift is open.

  // ── Fetch booking with invoices and security deposits ──────────────────────
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room:             { select: { id: true, number: true } },
      guest:            { select: { id: true, firstName: true, lastName: true } },
      cityLedgerAccount: { select: { id: true, companyName: true, accountCode: true } },
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

  try {
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

    // ── 2. Update room → checkout (via chokepoint) ────────────────────────
    await transitionRoom(tx, {
      roomId:           booking.roomId,
      to:               'checkout',
      reason:           'check-out',
      userId,
      userName:         authSession.user.name ?? undefined,
      bookingId,
      currentBookingId: null,
    });

    // ── 2b. Auto-create checkout cleaning task ────────────────────────────
    // Housekeeping needs an actionable task to pick up; previously the task
    // was only created if staff remembered to open the HK page. Dedup via
    // the service so rapid checkouts don't create duplicates.
    await createCheckoutCleaningTask(tx, {
      roomId:    booking.roomId,
      bookingId,
      createdBy: userId,
      notes:     `Auto-created on checkout (ห้อง ${booking.room.number})`,
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

    if (booking.cityLedgerAccount) {
      // ── 3a. CITY LEDGER checkout: create INV-CO, post to CL, skip cash ───
      const coResult = await createInvoiceFromFolio(tx, {
        folioId:     folio?.folioId ?? '',
        guestId:     booking.guestId,
        bookingId,
        invoiceType: 'CO',
        dueDate:     now,
        notes:       `ใบแจ้งหนี้ City Ledger — ${booking.cityLedgerAccount.companyName} — ห้อง ${booking.room.number}`,
        createdBy:   userId,
      });

      if (coResult) {
        checkoutSummary.newInvoiceNumber = coResult.invoiceNumber;

        await postInvoiceToCityLedger(tx, {
          invoiceId:  coResult.invoiceId,
          accountId:  booking.cityLedgerAccount.id,
          createdBy:  userId,
          userName:   authSession.user.name ?? undefined,
        });

        await logActivity(tx, {
          userId,
          action:      'city_ledger.checkout_posted',
          category:    'city_ledger',
          description: `เช็คเอาท์ City Ledger: ${booking.cityLedgerAccount.companyName} — ${coResult.invoiceNumber} ฿${coResult.grandTotal.toLocaleString()}`,
          bookingId,
          guestId:             booking.guestId,
          invoiceId:           coResult.invoiceId,
          cityLedgerAccountId: booking.cityLedgerAccount.id,
          severity: 'success',
        });
      }
    } else if (badDebt && outstanding > 0) {
      // ── 3b. BAD DEBT: create invoice + post ledger ───────────────────────
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
      // ── 3c. Normal checkout: build final invoice
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
            folioId:     folio.folioId,
            chargeType:  'ROOM',
            description: `ค่าห้องพัก ${actualNights} คืน — ห้อง ${booking.room.number}`,
            amount:      Number(booking.rate) * actualNights,
            quantity:    actualNights,
            unitPrice:   Number(booking.rate),
            serviceDate: new Date(booking.actualCheckIn ?? booking.checkIn),  // period start
            createdBy:   userId,
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
        let coPayNum: string | null = null;
        let coRcpNum: string | null = null;
        if (paymentMethod && coResult.grandTotal > 0) {
          // Single chokepoint: payment.service handles cash-session resolution,
          // payment-number generation, allocation, invoice paid-status update,
          // line-item paid flag, ledger pair (DR Cash / CR AR), folio recalc,
          // and audit log.
          const coPaymentResult = await createPayment(tx, {
            idempotencyKey: `co-${bookingId}`,
            guestId:        booking.guestId,
            bookingId,
            amount:         coResult.grandTotal,
            paymentMethod,
            paymentDate:    now,
            receivedBy:     userId,
            allocations:    [{ invoiceId: coResult.invoiceId, amount: coResult.grandTotal }],
            createdBy:      userId,
          });
          coPayNum = coPaymentResult.paymentNumber;
          coRcpNum = coPaymentResult.receiptNumber;

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
          // Re-fetch the INV-CO items with folio period dates
          const coItems = await tx.invoiceItem.findMany({
            where: { invoiceId: coResult.invoiceId },
            select: {
              description:   true,
              amount:        true,
              folioLineItem: {
                select: { quantity: true, unitPrice: true, chargeType: true, serviceDate: true },
              },
            },
          });
          checkoutReceipt = {
            receiptType:   'checkout',
            receiptNumber: coRcpNum ?? '',
            paymentNumber: coPayNum ?? '',
            invoiceNumber: coResult.invoiceNumber,
            bookingNumber: booking.bookingNumber,
            guestName,
            roomNumber:    booking.room.number,
            bookingType:   booking.bookingType,
            checkIn:       fmtDate(booking.checkIn),
            checkOut:      fmtDate(booking.checkOut),
            items: coItems.flatMap(i => {
              const fl        = i.folioLineItem;
              const unitPrice = fl?.unitPrice ? Number(fl.unitPrice) : undefined;
              const qty       = fl?.quantity ?? 1;

              // ROOM charge with serviceDate + multiple nights → expand per night
              if (
                fl?.chargeType === 'ROOM' &&
                fl.serviceDate &&
                qty > 1 &&
                unitPrice !== undefined
              ) {
                return expandNightlyReceiptItems({
                  description: i.description,
                  startDate:   new Date(fl.serviceDate),
                  nights:      qty,
                  unitPrice,
                });
              }

              // Single-night or non-ROOM: show as-is
              let periodStart: string | undefined;
              let periodEnd:   string | undefined;
              if (fl?.serviceDate) {
                periodStart = fmtDate(new Date(fl.serviceDate));
                if (fl.chargeType === 'ROOM' && qty > 0) {
                  const end = new Date(fl.serviceDate);
                  end.setUTCDate(end.getUTCDate() + qty);
                  periodEnd = fmtDate(end);
                }
              }
              return [{
                description: i.description,
                amount:      Number(i.amount),
                quantity:    unitPrice !== undefined ? qty : undefined,
                unitPrice,
                periodStart,
                periodEnd,
              }];
            }),
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
  } catch (e) {
    console.error('POST /api/checkout error:', e);
    if (e instanceof RoomTransitionError) {
      return NextResponse.json(
        { error: `ไม่สามารถเปลี่ยนสถานะห้องจาก ${e.from} → ${e.to}` },
        { status: 409 },
      );
    }
    const msg = e instanceof Error ? e.message : 'เช็คเอาท์ไม่สำเร็จ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

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
  } catch (e) {
    console.error('POST /api/checkout top-level error:', e);
    if (e instanceof RoomTransitionError) {
      return NextResponse.json(
        { error: `ไม่สามารถเปลี่ยนสถานะห้องจาก ${e.from} → ${e.to}` },
        { status: 409 },
      );
    }
    const msg = e instanceof Error ? e.message : 'เช็คเอาท์ไม่สำเร็จ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
