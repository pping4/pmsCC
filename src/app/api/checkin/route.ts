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
import { resolveNextPeriod } from '@/services/billing.service';
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
  // Bank account that received the transfer/QR (shared by deposit + upfront
  // legs).  Required by the server when ANY transfer is involved; otherwise
  // optional.  Validation per-leg happens inside payment.service.
  receivingAccountId:    z.string().min(1).optional(),
  // Phase 4 — credit-card EDC fields (shared by deposit + upfront legs).
  // Required when either leg is method='credit_card'.
  terminalId:            z.string().uuid().optional(),
  cardBrand:             z.enum(['VISA', 'MASTER', 'JCB', 'UNIONPAY', 'AMEX', 'OTHER']).optional(),
  cardType:              z.enum(['NORMAL', 'PREMIUM', 'CORPORATE', 'UNKNOWN']).optional(),
  cardLast4:             z.string().regex(/^\d{4}$/).optional(),
  authCode:              z.string().trim().max(12).optional(),
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
    receivingAccountId,
    terminalId, cardBrand, cardType, cardLast4, authCode,
  } = parsed.data;

  // Server-side guard: every transfer leg needs a receivingAccountId so the
  // ledger DEBIT lands on the right bank account.  The client picker
  // auto-defaults this so most cashiers never trigger this branch.
  const needsReceiving =
    depositPaymentMethod === 'transfer' || depositPaymentMethod === 'promptpay' ||
    upfrontPaymentMethod === 'transfer' || upfrontPaymentMethod === 'promptpay';
  if (needsReceiving && !receivingAccountId) {
    return NextResponse.json({ error: 'กรุณาเลือกบัญชีที่รับเงิน' }, { status: 422 });
  }
  // Phase 4 — credit_card needs EDC + brand
  const needsCard =
    depositPaymentMethod === 'credit_card' || upfrontPaymentMethod === 'credit_card';
  if (needsCard && (!terminalId || !cardBrand)) {
    return NextResponse.json({ error: 'กรุณาเลือกเครื่อง EDC + แบรนด์บัตร' }, { status: 422 });
  }

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

  // Wrap the whole transaction so any thrown error is surfaced as JSON.
  // Without this, an exception inside $transaction bubbles up to Next.js,
  // which serves an HTML error page; clients calling res.json() then fail
  // with "Unexpected end of JSON input" and no useful diagnostic.
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
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

    // Resolve cycle-1 period once (used in charge, invoice, and BillingPeriod).
    // For daily bookings this is unused; for monthly it's the authoritative anchor
    // that prevents the cron from double-billing the first month.
    const ciCycle1Period = isMonthly
      ? resolveNextPeriod({
          bookingType: booking.bookingType as 'monthly_short' | 'monthly_long',
          checkIn:     new Date(booking.checkIn),
          checkOut:    new Date(booking.checkOut),
          cycleIndex:  1,
        })
      : null;

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
          // Monthly: period = cycle 1 (not the full stay window).
          // ciCycle1Period is resolved above from resolveNextPeriod(cycleIndex=1).
          // Using cycle-1 dates here ensures the FolioLineItem's serviceDate/periodEnd
          // match the INV-CI billingPeriod and the BillingPeriod anchor that the
          // monthly-billing cron uses to detect 'already invoiced → skip'.
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
            serviceDate: ciCycle1Period!.start,
            periodEnd:   ciCycle1Period!.end,
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

    // ── 3b. Always cut INV-CI from UNBILLED charges (Phase 6.9) ──────────────
    // Before this fix INV-CI was created ONLY when collectUpfront=true. A
    // walk-in / no-prepay check-in left the room nights as UNBILLED FolioLine-
    // Item rows with no invoice. Then if the guest later extended via "pay
    // later" (Phase 6.7), INV-GN was cut for the extension ONLY — the original
    // stay nights stayed UNBILLED and the bill tab lost visibility of them
    // (proforma row disappears once any real invoice exists). Hoisting the
    // invoice creation out of the collectUpfront guard means every checked-in
    // booking always carries an INV-CI (status=unpaid when not paid upfront)
    // that surfaces in the bill tab with a "💳 รับชำระเงิน" button — same
    // pattern as the Phase 6.7 fix for extend.
    let stayInvoiceResult: { invoiceId: string; grandTotal: number; invoiceNumber: string } | null = null;
    if (folio && !existingStayInvoice) {
      const dueDate = isMonthly
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
        : new Date(booking.checkOut);

      stayInvoiceResult = await createInvoiceFromFolio(tx, {
        folioId:     folio.folioId,
        guestId:     booking.guestId,
        bookingId,
        invoiceType: 'CI',
        dueDate,
        notes:       collectUpfront && upfrontPaymentMethod
          ? `ชำระค่าห้องพัก ณ เช็คอิน — ห้อง ${booking.room.number}`
          : `ค่าห้องพัก — ห้อง ${booking.room.number} (รอเก็บเงิน)`,
        createdBy:   userId,
        // For monthly: constrain invoice billing period to cycle 1 so the
        // period column shows 1-month window (not the full stay).
        ...(ciCycle1Period && {
          billingPeriodStart: ciCycle1Period.start,
          billingPeriodEnd:   ciCycle1Period.end,
        }),
      });

      if (stayInvoiceResult) {
        stayInvoiceId     = stayInvoiceResult.invoiceId;
        ciCollectedAmount = stayInvoiceResult.grandTotal;   // net after deposit credit
      }
    }

    // ── 3b'. Mark paid + flip line items (only when actually collecting) ─────
    // createPayment later (step 5) ALSO recalculates the invoice's paid
    // status via its allocations, but we mirror the legacy preflight to
    // keep diff churn minimal in the receipt branch.
    if (collectUpfront && upfrontPaymentMethod && stayInvoiceResult) {
      await tx.invoice.update({
        where: { id: stayInvoiceResult.invoiceId },
        data:  { paidAmount: stayInvoiceResult.grandTotal, status: 'paid' },
      });
      await markLineItemsPaid(tx, stayInvoiceResult.invoiceId);
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
        // Route ledger DEBIT to the cashier's chosen bank account when this
        // is a transfer. Null for cash → resolveMoneyAccount picks default.
        receivingAccountId: depositPaymentMethod === 'transfer' || depositPaymentMethod === 'promptpay'
          ? receivingAccountId : undefined,
        // Phase 4: forward credit-card fields when method=credit_card. Will
        // be ignored for other methods inside the service.
        terminalId: depositPaymentMethod === 'credit_card' ? terminalId : undefined,
        cardBrand:  depositPaymentMethod === 'credit_card' ? cardBrand  as never : undefined,
        cardType:   depositPaymentMethod === 'credit_card' ? cardType   as never : undefined,
        cardLast4:  depositPaymentMethod === 'credit_card' ? cardLast4  : undefined,
        authCode:   depositPaymentMethod === 'credit_card' ? authCode   : undefined,
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
        receivingAccountId: upfrontPaymentMethod === 'transfer' || upfrontPaymentMethod === 'promptpay'
          ? receivingAccountId : undefined,
        terminalId: upfrontPaymentMethod === 'credit_card' ? terminalId : undefined,
        cardBrand:  upfrontPaymentMethod === 'credit_card' ? cardBrand  as never : undefined,
        cardType:   upfrontPaymentMethod === 'credit_card' ? cardType   as never : undefined,
        cardLast4:  upfrontPaymentMethod === 'credit_card' ? cardLast4  : undefined,
        authCode:   upfrontPaymentMethod === 'credit_card' ? authCode   : undefined,
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

      // ── Register BillingPeriod(cycleIndex=1) for monthly upfront check-in ──
      // Uses upsert to be safe if the booking route already registered cycle 1
      // (full-pay at booking creation). Idempotent — second write just refreshes
      // the invoiceId link without creating a duplicate row.
      if (isMonthly && ciCycle1Period && stayInvoiceId) {
        await tx.billingPeriod.upsert({
          where: { bookingId_cycleIndex: { bookingId, cycleIndex: 1 } },
          create: {
            bookingId,
            cycleIndex:  1,
            periodStart: ciCycle1Period.start,
            periodEnd:   ciCycle1Period.end,
            isPartial:   ciCycle1Period.isPartial,
            isFinal:     ciCycle1Period.isFinal,
            invoiceId:   stayInvoiceId,
          },
          update: {
            periodStart: ciCycle1Period.start,
            periodEnd:   ciCycle1Period.end,
            isPartial:   ciCycle1Period.isPartial,
            isFinal:     ciCycle1Period.isFinal,
            invoiceId:   stayInvoiceId,
          },
        });
      }

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
  } catch (err) {
    // Server-side log so the operator can see the actual exception
    console.error('POST /api/checkin transaction error:', err);
    const message =
      err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างเช็คอิน';
    // Map known Prisma errors to friendlier statuses; default 500.
    let status = 500;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') status = 409;
      else if (err.code === 'P2025') status = 404;
    }
    return NextResponse.json({ success: false, error: message }, { status });
  }

  return NextResponse.json({
    success: true,
    booking:           result.updatedBooking,
    stayInvoiceId:     result.stayInvoiceId,
    securityDepositId: result.securityDepositId,
    receipt:           checkinReceipt,   // null if no payment at checkin
  });
}
