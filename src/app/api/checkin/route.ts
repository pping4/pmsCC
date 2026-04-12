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
import { getFolioByBookingId, addCharge, createInvoiceFromFolio, markLineItemsPaid } from '@/services/folio.service';
import { generatePaymentNumber, generateReceiptNumber } from '@/services/invoice-number.service';
import { logActivity } from '@/services/activityLog.service';
import { fmtDate } from '@/lib/date-format';
import type { ReceiptData } from '@/components/receipt/types';

const CheckinSchema = z.object({
  bookingId:             z.string().min(1),
  notes:                 z.string().max(500).optional(),

  // Security deposit (optional — handled via SecurityDeposit model now)
  depositAmount:         z.number().positive().optional(),
  depositPaymentMethod:  z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']).optional(),
  depositCashSessionId:  z.string().uuid().optional(),   // required if depositMethod=cash
  depositReferenceNo:    z.string().max(100).optional(),

  // Upfront stay payment
  collectUpfront:        z.boolean().optional().default(false),
  upfrontPaymentMethod:  z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']).optional(),
  cashSessionId:         z.string().uuid().optional(),   // required if upfront method=cash
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
    depositCashSessionId,
    depositReferenceNo,
    collectUpfront,
    upfrontPaymentMethod,
    cashSessionId,
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

  // ── Validate cash session (after double-payment guard) ───────────────────
  if (depositPaymentMethod === 'cash' && depositAmount && !depositCashSessionId) {
    return NextResponse.json(
      { error: 'การรับเงินมัดจำด้วยเงินสดต้องระบุ cashSessionId' },
      { status: 422 }
    );
  }
  if (upfrontPaymentMethod === 'cash' && collectUpfront && !cashSessionId) {
    return NextResponse.json(
      { error: 'การรับชำระค่าห้องด้วยเงินสดต้องระบุ cashSessionId' },
      { status: 422 }
    );
  }

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

    // ── 2. Update room → occupied ─────────────────────────────────────────
    await tx.room.update({
      where: { id: booking.roomId },
      data:  { status: 'occupied', currentBookingId: bookingId },
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

    // ── 3. Folio-centric stay invoice — for ANY booking type when collectUpfront ──
    //
    // BILLING FLOW (revised):
    //  • collectUpfront = false → nothing here; daily rooms billed at checkout,
    //                             monthly rooms billed at next renewal cycle.
    //  • collectUpfront = true  → collect NOW regardless of booking type:
    //      1. If no ROOM charge in folio yet → add it.
    //      2. Credit back any DEPOSIT_BOOKING already paid (prevents double-billing).
    //      3. createInvoiceFromFolio → INV-CI for the NET amount due.
    //      4. Mark invoice + line items PAID so checkout/renewal won't re-bill.
    //
    // The double-payment guard earlier in this function (totalAlreadyPaid >= stayAmount)
    // ensures we never reach this block when the booking is already fully paid.

    let stayInvoiceId: string | null = existingStayInvoiceRecord?.id ?? null;
    // Track the actual collected amount (may differ from stayAmount when deposit credited)
    let ciCollectedAmount: number = stayAmount;
    const folio = await getFolioByBookingId(tx, bookingId);

    const isMonthly =
      booking.bookingType === 'monthly_short' || booking.bookingType === 'monthly_long';

    if (collectUpfront && upfrontPaymentMethod && folio) {
      // Check if the Folio already has a non-voided ROOM charge
      const existingRoomCharge = await tx.folioLineItem.findFirst({
        where: {
          folioId: folio.folioId,
          chargeType: 'ROOM' as never,
          billingStatus: { not: 'VOIDED' as never },
        },
        select: { id: true },
      });

      if (!existingRoomCharge) {
        // ── Build charge description by type ───────────────────────────────
        const chargeDesc = isMonthly
          ? `ค่าห้องพักเดือนแรก${
              booking.bookingType === 'monthly_short' ? ' (รายเดือนระยะสั้น)' : ' (รายเดือนระยะยาว)'
            } — ห้อง ${booking.room.number}`
          : `ค่าห้องพัก ${nights ?? 1} คืน — ห้อง ${booking.room.number}`;

        await addCharge(tx, {
          folioId:     folio.folioId,
          chargeType:  'ROOM',
          description: chargeDesc,
          amount:      stayAmount,
          quantity:    nights ?? 1,
          unitPrice:   Number(booking.rate),
          createdBy:   userId,
        });

        // ── Credit back any DEPOSIT_BOOKING already paid at booking ───────
        // This prevents: INV-BK (deposit) + INV-CI (full room) = overcharge.
        // The ADJUSTMENT here cancels out the deposit portion on INV-CI so
        // the net billed is only the remaining balance.
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

        // ── Create INV-CI from all UNBILLED items ──────────────────────────
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
          stayInvoiceId    = invResult.invoiceId;
          ciCollectedAmount = invResult.grandTotal;   // net after deposit credit
          await tx.invoice.update({
            where: { id: invResult.invoiceId },
            data:  { paidAmount: invResult.grandTotal, status: 'paid' },
          });
          await markLineItemsPaid(tx, invResult.invoiceId);
        }
      }
      // If ROOM charge already exists and stay invoice also exists → stayInvoiceId
      // was already set from existingStayInvoiceRecord at the top of the function.
      // The double-payment guard ensures we never charge twice.
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
        cashSessionId: depositCashSessionId,
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
      const [paymentNumber, receiptNumber] = await Promise.all([
        generatePaymentNumber(tx),
        generateReceiptNumber(tx),
      ]);
      const payment = await tx.payment.create({
        data: {
          paymentNumber,
          receiptNumber,
          bookingId,
          guestId:        booking.guestId,
          amount:         new Prisma.Decimal(ciCollectedAmount),
          paymentMethod:  upfrontPaymentMethod as never,
          paymentDate:    now,
          cashSessionId:  cashSessionId ?? null,
          status:         'ACTIVE' as never,
          idempotencyKey: `ci-upfront-${bookingId}`,
          receivedBy:     userId,
          notes:          `ค่าห้องพัก${nights ? ` ${nights} คืน` : ''} ณ เช็คอิน — ห้อง ${booking.room.number}`,
          createdBy:      userId,
        },
        select: { id: true },
      });

      // Link payment → invoice via PaymentAllocation
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: stayInvoiceId,
          amount:    new Prisma.Decimal(ciCollectedAmount),
        },
      });

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
          paymentId: payment.id,
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
        items: [{ description: ciDesc, amount: ciCollectedAmount }],
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
