/**
 * POST /api/checkin
 *
 * Enhanced check-in flow (Phase 2):
 *  1. Validate booking is in 'confirmed' status
 *  2. Update booking → checked_in, room → occupied
 *  3. Create stay invoice (unpaid or paid depending on collectUpfront)
 *  4. If deposit provided → create SecurityDeposit via service (posts liability ledger)
 *  5. If collectUpfront + cashSessionId → link payment to session
 *
 * Security checklist:
 * ✅ Auth: session required
 * ✅ Input: validated before use
 * ✅ Transaction: $transaction wraps all writes
 * ✅ Ledger: SecurityDeposit posts DEBIT Cash / CREDIT Liability
 * ✅ No data leaks: select only needed fields in response
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { createSecurityDeposit } from '@/services/securityDeposit.service';
import { z } from 'zod';
import { getFolioByBookingId, addCharge, addNightlyRoomCharges, createInvoiceFromFolio, markLineItemsPaid } from '@/services/folio.service';
import { createPayment } from '@/services/payment.service';
import { logActivity } from '@/services/activityLog.service';
import { transitionRoom } from '@/services/roomStatus.service';
import { fmtDate } from '@/lib/date-format';
import { expandNightlyReceiptItems } from '@/lib/invoice-utils';
import type { ReceiptData } from '@/components/receipt/types';

const CheckinSchema = z.object({
  bookingId:             z.string().min(1),
  notes:                 z.string().max(500).optional(),

  // Security deposit (optional — handled via SecurityDeposit model now)
  depositAmount:         z.number().positive().optional(),
  depositPaymentMethod:  z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']).optional(),
  depositReferenceNo:    z.string().max(100).optional(),

  // Upfront stay payment
  collectUpfront:        z.boolean().optional().default(false),
  upfrontPaymentMethod:  z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']).optional(),
  // Sprint 4B: cashSessionId / depositCashSessionId are NOT accepted from the
  // client. For cash payments, the server looks up the caller's open shift.
});

export async function POST(request: Request) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CheckinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const {
    bookingId,
    notes,
    depositAmount,
    depositPaymentMethod,
    depositReferenceNo,
    collectUpfront,
    upfrontPaymentMethod,
  } = parsed.data;

  // ── Fetch booking ─────────────────────────────────────────────────────────
  // NOTE: Fetch booking FIRST so double-payment guard can run before any other
  // validation. This ensures a 409 (semantic conflict) takes priority over
  // 422 (missing cashSessionId) — more informative for the caller.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      guest: true,
      invoices: {
        select: {
          id: true,
          invoiceType: true,
          notes: true,
          grandTotal: true,
          paidAmount: true,
          status: true,
        },
      },
    },
  });

  if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  if (booking.status !== 'confirmed') {
    return NextResponse.json({ error: 'การจองนี้ไม่อยู่ในสถานะรอเช็คอิน' }, { status: 400 });
  }

  const now = new Date();

  // ── Calculate stay amounts ────────────────────────────────────────────────
  const nights =
    booking.bookingType === 'daily'
      ? Math.max(
          1,
          Math.ceil(
            (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

  const stayAmount =
    booking.bookingType === 'daily' && nights !== null
      ? Number(booking.rate) * nights
      : Number(booking.rate);

  // ── SERVER-SIDE GUARD: Prevent double payment (runs BEFORE cashSession check)
  // Priority: 409 Conflict > 422 Unprocessable, so caller gets the most
  // meaningful error first.
  if (collectUpfront) {
    const totalAlreadyPaid = booking.invoices
      .filter((inv) => inv.status === 'paid')
      .reduce((sum, inv) => sum + Number(inv.paidAmount ?? 0), 0);

    if (totalAlreadyPaid >= stayAmount) {
      return NextResponse.json(
        {
          error: 'ไม่สามารถเก็บเงินซ้ำได้ — การจองนี้ชำระเงินครบแล้ว',
          alreadyPaid: totalAlreadyPaid,
          stayAmount,
        },
        { status: 409 }
      );
    }
  }

  // Sprint 4B: cashSessionId is server-resolved inside the services
  // (securityDeposit.service / payment.service) — no client-side validation
  // here. If the cashier has no open shift, those services throw a friendly
  // error which the $transaction below surfaces as a 400.

  // Use invoiceType for reliable detection (not notes string matching)
  const existingStayInvoiceRecord = booking.invoices.find(
    (inv) => inv.invoiceType === 'daily_stay' || inv.invoiceType === 'monthly_rent'
  );
  const existingStayInvoice = !!existingStayInvoiceRecord;

  const userId     = authSession.user.id    ?? authSession.user.email ?? 'system';
  const userName   = authSession.user.name  ?? undefined;

  // Receipt holder — populated per payment type inside the transaction
  let checkinReceipt: ReceiptData | null = null;

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. Update booking → checked_in ────────────────────────────────────
    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status:        'checked_in',
        actualCheckIn: now,
        ...(notes && { notes }),
      },
      select: {
        id: true,
        status: true,
        guest:  { select: { id: true, firstName: true, lastName: true } },
        room:   { select: { id: true, number: true, roomType: { select: { name: true } } } },
      },
    });

    // ── 2. Update room → occupied (via chokepoint) ────────────────────────
    await transitionRoom(tx, {
      roomId:           booking.roomId,
      to:               'occupied',
      reason:           'check-in',
      userId,
      userName,
      bookingId,
      currentBookingId: bookingId,
    });

    // ── LOG: Check-in event ────────────────────────────────────────────────
    const guestName = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();
    await logActivity(tx, {
      userId,
      userName,
      action:      'booking.checkin',
      category:    'checkin',
      description: `เช็คอิน: ห้อง ${booking.room.number} — ${guestName}`,
      bookingId,
      roomId:  booking.roomId,
      guestId: booking.guestId,
      icon:    '🛎️',
      severity: 'success',
      metadata: {
        before: { status: 'confirmed' },
        after:  { status: 'checked_in' },
        roomNumber: booking.room.number,
        bookingType: booking.bookingType,
      },
    });

    // ── 3. Folio charges + optional upfront payment ───────────────────────────
    //
    // BILLING FLOW (revised):
    //
    //  3a. ADD ROOM CHARGE — runs at check-in regardless of collectUpfront:
    //      • Daily bookings: ALWAYS add ROOM charge so folio.balance is accurate
    //        from check-in onwards. Checkout preview reads this balance and shows
    //        the correct outstanding amount even when the guest hasn't paid yet.
    //      • Monthly bookings: only add when collectUpfront=true (billed at renewal cycle).
    //      • Credit back any DEPOSIT_BOOKING already paid at booking confirmation.
    //
    //  3b. COLLECT UPFRONT — only when collectUpfront=true:
    //      • createInvoiceFromFolio → INV-CI (bills all UNBILLED line items).
    //      • Mark invoice PAID, create Payment + PaymentAllocation.
    //      • Sync folio balance via recalculateFolioBalance.
    //
    // Why 3a is separated: if a guest checks in without paying, the folio must
    // still contain the ROOM charge so that GET /api/bookings/[id]/folio returns
    // a non-zero balance and the checkout dialog shows the correct amount due.

    let stayInvoiceId: string | null = existingStayInvoiceRecord?.id ?? null;
    // Tracks amount actually collected (may differ from stayAmount after deposit credit)
    let ciCollectedAmount: number = stayAmount;
    const folio = await getFolioByBookingId(tx, bookingId);

    const isMonthly =
      booking.bookingType === 'monthly_short' || booking.bookingType === 'monthly_long';

    // ── 3a. Add ROOM charge to folio ─────────────────────────────────────────
    // Daily: always. Monthly: only when paying upfront.
    const shouldAddRoomCharge = folio && (!isMonthly || (collectUpfront && !!upfrontPaymentMethod));

    if (shouldAddRoomCharge) {
      const existingRoomCharge = await tx.folioLineItem.findFirst({
        where: {
          folioId:    folio.folioId,
          chargeType: 'ROOM' as never,
          billingStatus: { not: 'VOIDED' as never },
        },
        select: { id: true },
      });

      if (!existingRoomCharge) {
        // Receipt-Standardization: daily → 1 row per night; monthly → single row.
        if (!isMonthly && nights && nights > 0) {
          await addNightlyRoomCharges(tx, {
            folioId:      folio.folioId,
            roomNumber:   booking.room.number,
            startDate:    new Date(booking.checkIn),
            nights,
            ratePerNight: Number(booking.rate),
            taxType:      'no_tax',
            referenceType: 'booking',
            referenceId:   booking.id,
            notes:         'เช็คอิน',
            createdBy:    userId,
          });
        } else {
          const monthlyLabel = booking.bookingType === 'monthly_short'
            ? ' (รายเดือนระยะสั้น)'
            : ' (รายเดือนระยะยาว)';
          await addCharge(tx, {
            folioId:     folio.folioId,
            chargeType:  'ROOM',
            description: `ค่าห้องพักเดือนแรก${monthlyLabel} — ห้อง ${booking.room.number}`,
            amount:      stayAmount,
            quantity:    1,
            unitPrice:   stayAmount,
            serviceDate: new Date(booking.checkIn),
            periodEnd:   new Date(booking.checkOut),
            createdBy:   userId,
          });
        }

        // Credit back any DEPOSIT_BOOKING already paid at booking confirmation.
        // Prevents: INV-BK (deposit paid) + full room charge = overcharge.
        const paidDeposits = await tx.folioLineItem.findMany({
          where: {
            folioId:       folio.folioId,
            chargeType:    'DEPOSIT_BOOKING' as never,
            billingStatus: 'PAID' as never,
          },
          select: { amount: true },
        });
        for (const dep of paidDeposits) {
          const depAmt = Number(dep.amount);
          if (depAmt > 0) {
            await addCharge(tx, {
              folioId:     folio.folioId,
              chargeType:  'ADJUSTMENT',
              description: 'หักมัดจำที่รับไว้แล้ว (INV-BK)',
              amount:      -depAmt,
              createdBy:   userId,
            });
          }
        }
      }
    }

    // ── 3b. Create INV-CI and collect payment (upfront only) ─────────────────
    if (collectUpfront && upfrontPaymentMethod && folio && !existingStayInvoice) {
      const dueDate = isMonthly
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
        : new Date(booking.checkOut);

      const invResult = await createInvoiceFromFolio(tx, {
        folioId:     folio.folioId,
        guestId:     booking.guestId,
        bookingId,
        invoiceType: 'CI',
        dueDate,
        notes:       `ชำระค่าห้องพัก ณ เช็คอิน — ห้อง ${booking.room.number}`,
        createdBy:   userId,
      });

      if (invResult) {
        stayInvoiceId     = invResult.invoiceId;
        ciCollectedAmount = invResult.grandTotal;   // net after deposit credit
        await tx.invoice.update({
          where: { id: invResult.invoiceId },
          data:  { paidAmount: invResult.grandTotal, status: 'paid' },
        });
        await markLineItemsPaid(tx, invResult.invoiceId);
      }
    }

    // ── 4. Create Security Deposit via service (posts liability ledger) ────
    let securityDepositId: string | null = null;

    if (depositAmount && depositAmount > 0 && depositPaymentMethod) {
      const depResult = await createSecurityDeposit(tx, {
        bookingId,
        guestId:       booking.guestId,
        amount:        depositAmount,
        paymentMethod: depositPaymentMethod,
        referenceNo:   depositReferenceNo,
        // cashSessionId omitted — service resolves it from createdBy for cash
        receivedBy:    userId,
        receivedByName: userName,
        notes:         `เงินมัดจำ ห้อง ${booking.room.number}`,
        createdBy:     userId,
        createdByName: userName,
      });
      securityDepositId = depResult.depositId;

      // ── LOG: Security deposit received ──────────────────────────────────
      await logActivity(tx, {
        userId,
        userName,
        action:      'payment.security_deposit',
        category:    'payment',
        description: `รับมัดจำ ฿${depositAmount.toLocaleString()} — ห้อง ${booking.room.number} (${depositPaymentMethod})`,
        bookingId,
        roomId:  booking.roomId,
        guestId: booking.guestId,
        icon:    '🔒',
        severity: 'success',
        metadata: {
          amount: depositAmount,
          paymentMethod: depositPaymentMethod,
          securityDepositId,
          referenceNo: depositReferenceNo ?? null,
        },
      });

      // ── Build security deposit receipt ───────────────────────────────────
      const guestName = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();
      checkinReceipt = {
        receiptType:   'checkin_security',
        receiptNumber: depResult.receiptNumber,
        paymentNumber: depResult.paymentNumber,
        invoiceNumber: '',
        bookingNumber: booking.bookingNumber,
        guestName,
        roomNumber:    booking.room.number,
        bookingType:   booking.bookingType,
        checkIn:       fmtDate(booking.checkIn),
        checkOut:      fmtDate(booking.checkOut),
        items: [{
          description: `เงินประกันความเสียหาย — ห้อง ${booking.room.number}`,
          amount:      depositAmount,
        }],
        subtotal:      depositAmount,
        vatAmount:     0,
        grandTotal:    depositAmount,
        paymentMethod: depositPaymentMethod!,
        paidAmount:    depositAmount,
        issueDate:     now.toISOString(),
        cashierName:   userName,
        notes:         'เงินประกันจะคืนเมื่อเช็คเอาท์โดยไม่มีความเสียหาย',
      };
    }

    // ── 5. Create Payment record for upfront collection ────────────────────
    // Required so cash session calculates systemCalculatedCash correctly.
    if (collectUpfront && upfrontPaymentMethod && stayInvoiceId) {
      // Single chokepoint: payment.service handles cash-session resolution,
      // payment-number generation, allocation, invoice paid-status update,
      // line-item paid flag, ledger pair (DR Cash / CR AR), folio recalc,
      // and audit log.
      const upfrontResult = await createPayment(tx, {
        idempotencyKey: `ci-upfront-${bookingId}`,
        guestId:        booking.guestId,
        bookingId,
        amount:         ciCollectedAmount,
        paymentMethod:  upfrontPaymentMethod,
        paymentDate:    now,
        receivedBy:     userId,
        notes:          `ค่าห้องพัก${nights ? ` ${nights} คืน` : ''} ณ เช็คอิน — ห้อง ${booking.room.number}`,
        allocations:    [{ invoiceId: stayInvoiceId, amount: ciCollectedAmount }],
        createdBy:      userId,
        createdByName:  userName ?? undefined,
      });
      const paymentNumber = upfrontResult.paymentNumber;
      const receiptNumber = upfrontResult.receiptNumber;
      const upfrontPaymentId = upfrontResult.id;

      // ── LOG: Upfront payment collected ──────────────────────────────────
      await logActivity(tx, {
        userId,
        userName,
        action:      'payment.upfront_checkin',
        category:    'payment',
        description: `รับชำระ ฿${ciCollectedAmount.toLocaleString()} ณ เช็คอิน — ห้อง ${booking.room.number} (${upfrontPaymentMethod})`,
        bookingId,
        roomId:   booking.roomId,
        guestId:  booking.guestId,
        invoiceId: stayInvoiceId ?? undefined,
        icon:     '💳',
        severity: 'success',
        metadata: {
          amount: ciCollectedAmount,
          paymentMethod: upfrontPaymentMethod,
          nights,
          paymentId: upfrontPaymentId,
        },
      });

      // ── Build upfront receipt using the actual collected amount ───────────
      const guestNameUp = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();
      const ciDesc = nights
        ? `ค่าห้องพัก ${nights} คืน — ห้อง ${booking.room.number}`
        : `ค่าห้องพัก — ห้อง ${booking.room.number}`;
      checkinReceipt = {
        receiptType:   'checkin_upfront',
        receiptNumber: receiptNumber,
        paymentNumber: paymentNumber,
        invoiceNumber: '',
        bookingNumber: booking.bookingNumber,
        guestName:     guestNameUp,
        roomNumber:    booking.room.number,
        bookingType:   booking.bookingType,
        checkIn:       fmtDate(booking.checkIn),
        checkOut:      fmtDate(booking.checkOut),
        items: nights && nights > 1 && booking.bookingType === 'daily'
          ? expandNightlyReceiptItems({
              description: `ค่าห้องพัก — ห้อง ${booking.room.number}`,
              startDate:   new Date(booking.checkIn),
              nights,
              unitPrice:   Number(booking.rate),
            })
          : [{ description: ciDesc, amount: ciCollectedAmount }],
        subtotal:      ciCollectedAmount,
        vatAmount:     0,
        grandTotal:    ciCollectedAmount,
        paymentMethod: upfrontPaymentMethod!,
        paidAmount:    ciCollectedAmount,
        issueDate:     now.toISOString(),
        cashierName:   userName,
      };
    }

    return { updatedBooking, stayInvoiceId, securityDepositId };
  });

  return NextResponse.json({
    success: true,
    booking:           result.updatedBooking,
    stayInvoiceId:     result.stayInvoiceId,
    securityDepositId: result.securityDepositId,
    receipt:           checkinReceipt,   // null if no payment at checkin
  });
}
