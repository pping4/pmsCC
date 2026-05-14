import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logActivity } from '@/services/activityLog.service';
import { createFolio, addCharge, addNightlyRoomCharges, createInvoiceFromFolio } from '@/services/folio.service';
import { generateBookingNumber } from '@/services/invoice-number.service';
import { createPayment } from '@/services/payment.service';
import { transitionRoom, canTransition } from '@/services/roomStatus.service';
import { getActiveSessionForUser } from '@/services/cashSession.service';
import { resolveNextPeriod } from '@/services/billing.service';
import { fmtDate } from '@/lib/date-format';
import type { ReceiptData } from '@/components/receipt/types';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const search = searchParams.get('search') || '';

  const bookings = await prisma.booking.findMany({
    where: {
      ...(type && type !== 'all' ? { bookingType: type as never } : {}),
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(search ? {
        OR: [
          { bookingNumber: { contains: search, mode: 'insensitive' } },
          { guest: { firstName: { contains: search, mode: 'insensitive' } } },
          { guest: { lastName: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    select: {
      id: true,
      bookingNumber: true,
      bookingType: true,
      source: true,
      checkIn: true,
      checkOut: true,
      actualCheckIn: true,
      actualCheckOut: true,
      rate: true,
      deposit: true,
      status: true,
      roomLocked: true,
      notes: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      guestId: true,
      roomId: true,
      guest: {
        select: {
          id: true, title: true, firstName: true, lastName: true,
          firstNameTH: true, lastNameTH: true, gender: true,
          nationality: true, idType: true, idNumber: true,
          phone: true, email: true, lineId: true, vipLevel: true,
        },
      },
      room: {
        select: {
          id: true, number: true, floor: true, status: true,
          roomType: { select: { id: true, code: true, name: true, icon: true } },
        },
      },
      folio: {
        select: {
          id: true,
          folioNumber: true,
          balance: true,
          totalCharges: true,
          totalPayments: true,
          closedAt: true,
        },
      },
      cityLedgerAccount: {
        select: { id: true, companyName: true, accountCode: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(bookings);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();

    // Basic validation
    if (!data.guestId)    return NextResponse.json({ error: 'ต้องระบุลูกค้า' }, { status: 400 });
    if (!data.roomNumber) return NextResponse.json({ error: 'ต้องระบุห้องพัก' }, { status: 400 });
    if (!data.checkIn)    return NextResponse.json({ error: 'ต้องระบุวันเข้าพัก' }, { status: 400 });
    if (!data.checkOut)   return NextResponse.json({ error: 'ต้องระบุวันเช็คเอาท์' }, { status: 400 });
    if (!data.bookingType) return NextResponse.json({ error: 'ต้องระบุประเภทการจอง' }, { status: 400 });

    // Parse dates as UTC midnight (avoid timezone drift)
    const checkInDate  = new Date(data.checkIn  + 'T00:00:00.000Z');
    const checkOutDate = new Date(data.checkOut + 'T00:00:00.000Z');

    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      return NextResponse.json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' }, { status: 400 });
    }
    if (checkOutDate <= checkInDate) {
      return NextResponse.json({ error: 'วันเช็คเอาท์ต้องหลังวันเข้าพัก' }, { status: 400 });
    }

    // Find room by number
    const room = await prisma.room.findUnique({ where: { number: data.roomNumber } });
    if (!room) return NextResponse.json({ error: `ไม่พบห้อง ${data.roomNumber}` }, { status: 404 });

    // Check for overlapping bookings via BookingRoomSegment (authoritative).
    //
    // Why segments, not Booking: after a MOVE or SPLIT, `booking.roomId`
    // points only to the LATEST room in the stay while earlier segments
    // may be on other rooms. A Booking-based check would (a) over-detect
    // on the latest room (the booking looks like it spans its full
    // checkIn→checkOut there, even on days it was in another room) and
    // (b) under-detect on earlier rooms (the booking isn't indexed there
    // via booking.roomId) — so guests can't book an actually-free room,
    // and actually-occupied rooms look available.
    const overlapSegment = await prisma.bookingRoomSegment.findFirst({
      where: {
        roomId:   room.id,
        fromDate: { lt: checkOutDate },
        toDate:   { gt: checkInDate  },
        booking:  { status: { in: ['confirmed', 'checked_in'] } },
      },
      select: { booking: { select: { bookingNumber: true } } },
    });
    if (overlapSegment) {
      return NextResponse.json(
        { error: `วันที่ทับซ้อนกับการจอง ${overlapSegment.booking.bookingNumber}` },
        { status: 409 }
      );
    }

    // ── Payment at booking (optional) ──────────────────────────────────────
    // If paymentMethod is provided, create a paid invoice immediately.
    // Supports: full payment, deposit-only, or no payment (default).
    const paymentMethod   = data.paymentMethod   || null;   // 'cash' | 'transfer' | 'credit_card' | null
    const paymentType     = data.paymentType     || 'full'; // 'full' | 'deposit'
    const depositAmount   = Number(data.deposit) || 0;
    // For bank transfer / promptpay the cashier picks which bank account
    // received the funds; for cash this is null and resolveMoneyAccount
    // falls back to the cash-box's linked FinancialAccount.
    const receivingAccountId = (data.receivingAccountId as string | undefined) || null;
    if ((paymentMethod === 'transfer' || paymentMethod === 'promptpay') && !receivingAccountId) {
      return NextResponse.json(
        { error: 'กรุณาเลือกบัญชีที่รับเงิน' },
        { status: 422 }
      );
    }
    // Phase 4 — credit_card needs terminalId + cardBrand. The picker auto-
    // populates them on the client; we re-validate here so direct API calls
    // can't bypass.
    const cardFields = paymentMethod === 'credit_card' ? {
      terminalId: data.terminalId as string | undefined,
      cardBrand:  data.cardBrand  as string | undefined,
      cardType:   data.cardType   as string | undefined,
      cardLast4:  data.cardLast4  as string | undefined,
      authCode:   data.authCode   as string | undefined,
    } : null;
    if (paymentMethod === 'credit_card') {
      if (!cardFields?.terminalId || !cardFields?.cardBrand) {
        return NextResponse.json(
          { error: 'กรุณาเลือกเครื่อง EDC และแบรนด์บัตร' },
          { status: 422 }
        );
      }
    }
    const now = new Date();

    // Sprint 4B: resolve userId (id takes priority over email — cashSession.openedBy stores id)
    const userId   = (session?.user as { id?: string })?.id ?? session?.user?.email ?? 'system';
    const userName = session?.user?.name ?? undefined;

    // Calculate expected stay amount for invoicing
    let expectedStayAmount = Number(data.rate);
    if (data.bookingType === 'daily') {
      const nights = Math.max(
        1,
        Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      );
      expectedStayAmount = Number(data.rate) * nights;
    }

    // Fetch guest name for receipt (outside tx — read-only, no conflict)
    const guestInfo = await prisma.guest.findUnique({
      where: { id: data.guestId },
      select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true },
    });
    const guestName = `${guestInfo?.firstName ?? ''} ${guestInfo?.lastName ?? ''}`.trim();

    // Receipt data holder — populated inside tx if payment is made
    let bookingReceipt: ReceiptData | null = null;

    // Run creation inside a transaction for atomicity
    const booking = await prisma.$transaction(async (tx) => {
      // Generate booking number (inside tx to avoid race condition)
      const bookingNumber = await generateBookingNumber(tx);

      const created = await tx.booking.create({
        data: {
          bookingNumber,
          guestId:     data.guestId,
          roomId:      room.id,
          bookingType: data.bookingType,
          source:      data.source || 'direct',
          checkIn:     checkInDate,
          checkOut:    checkOutDate,
          rate:        data.rate,
          deposit:              depositAmount,
          status:               'confirmed',
          notes:                data.notes || null,
          // City Ledger — optional FK (validated: must be valid UUID if provided)
          ...(data.cityLedgerAccountId
            ? { cityLedgerAccountId: String(data.cityLedgerAccountId) }
            : {}),
        },
        select: {
          id:            true,
          bookingNumber: true,
          checkIn:       true,
          checkOut:      true,
          status:        true,
          roomId:        true,
          guestId:       true,
        },
      });

      // ★ Create the initial BookingRoomSegment covering [checkIn, checkOut) ★
      // BookingRoomSegment is the authoritative source of truth for room
      // availability / overlap checks in `src/services/roomChange.service.ts`
      // (SHUFFLE, MOVE, and their candidate listers). Without this row the
      // booking is invisible to those availability queries → double-booking
      // risk, and SHUFFLE would throw MULTI_SEGMENT_NOT_SUPPORTED.
      await tx.bookingRoomSegment.create({
        data: {
          bookingId:   created.id,
          roomId:      room.id,
          fromDate:    checkInDate,
          toDate:      checkOutDate,
          rate:        data.rate,
          bookingType: data.bookingType,
          createdBy:   session?.user?.email ?? 'system',
        },
      });

      // Update room status to reserved (via chokepoint).
      // Only transition if current status permits — future-dated bookings may
      // reference a room that is currently occupied by another guest; in that
      // case we leave the live status untouched.
      const liveRoom = await tx.room.findUniqueOrThrow({
        where: { id: room.id },
        select: { status: true },
      });
      if (canTransition(liveRoom.status, 'reserved')) {
        await transitionRoom(tx, {
          roomId:           room.id,
          to:               'reserved',
          reason:           'new booking',
          userId:           session?.user?.email ?? 'system',
          userName:         session?.user?.name ?? undefined,
          bookingId:        created.id,
          currentBookingId: created.id,
        });
      }

      // ★ Create Folio for this booking (1 Booking = 1 Folio) ★
      const { folioId } = await createFolio(tx, {
        bookingId: created.id,
        guestId:   data.guestId,
        notes:     `Folio for ${bookingNumber} — ห้อง ${data.roomNumber}`,
      });

      // ★ Sprint 4B: resolve cashSessionId server-side (never from client) ★
      // Must happen inside the transaction so we can atomically link payment → session.
      let bkCashSessionId: string | null = null;
      let bkCashBoxId:     string | null = null;
      if (paymentMethod === 'cash') {
        const active = await getActiveSessionForUser(tx, userId);
        if (!active) {
          throw new Error('การรับเงินสดต้องเปิดกะแคชเชียร์ก่อน');
        }
        bkCashSessionId = active.id;
        bkCashBoxId     = active.cashBoxId;
      }

      // ★ Create invoice if payment is provided at booking time ★
      if (paymentMethod) {
        if (paymentType === 'full') {
          // Full payment — add charge(s) to folio, then create invoice.
          // Receipt-Standardization: for daily, persist 1 row per night so every
          // downstream receipt/invoice renders the same per-night breakdown.
          const nights = data.bookingType === 'daily'
            ? Math.max(1, Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)))
            : null;

          // For monthly bookings, resolve cycle 1 period now so the upfront
          // invoice represents exactly 1 month (cycle 1), not the full stay.
          // This prevents the monthly-billing cron from double-billing cycle 1.
          const isMonthlyBK =
            data.bookingType === 'monthly_short' || data.bookingType === 'monthly_long';
          let invoicePeriodStart = checkInDate;
          let invoicePeriodEnd   = checkOutDate;
          let cycle1IsPartial    = false;
          let cycle1IsFinal      = false;

          if (isMonthlyBK) {
            const cycle1 = resolveNextPeriod({
              bookingType: data.bookingType as 'monthly_short' | 'monthly_long',
              checkIn:  checkInDate,
              checkOut: checkOutDate,
              cycleIndex: 1,
            });
            invoicePeriodStart = cycle1.start;
            invoicePeriodEnd   = cycle1.end;
            cycle1IsPartial    = cycle1.isPartial;
            cycle1IsFinal      = cycle1.isFinal;
          }

          if (data.bookingType === 'daily' && nights) {
            await addNightlyRoomCharges(tx, {
              folioId,
              roomNumber:   data.roomNumber,
              startDate:    checkInDate,
              nights,
              ratePerNight: Number(data.rate),
              taxType:      'no_tax',
              referenceType: 'booking',
              referenceId:   created.id,
              notes:         'ชำระล่วงหน้าตอนจอง',
              createdBy:    userId,
            });
          } else {
            // Monthly: single row, period = cycle 1 (not the full stay window).
            // The amount stays at booking.rate (= 1 month's rent).
            await addCharge(tx, {
              folioId,
              chargeType:  'ROOM',
              description: `ค่าห้องพัก — ห้อง ${data.roomNumber}`,
              amount:      expectedStayAmount,
              serviceDate: invoicePeriodStart,
              periodEnd:   invoicePeriodEnd,
              notes:       'ชำระล่วงหน้าตอนจอง',
              createdBy:   userId,
            });
          }

          const invResult = await createInvoiceFromFolio(tx, {
            folioId,
            guestId: data.guestId,
            bookingId: created.id,
            invoiceType: 'BK',
            dueDate: checkOutDate,
            notes: `ชำระเต็มจำนวน ณ วันจอง — ห้อง ${data.roomNumber}`,
            createdBy: userId,
            // For monthly: constrain period to cycle 1 so the invoice column
            // shows the correct 1-month window, not the entire stay.
            ...(isMonthlyBK && {
              billingPeriodStart: invoicePeriodStart,
              billingPeriodEnd:   invoicePeriodEnd,
            }),
          });

          // Mark as paid immediately since payment is collected at booking
          if (invResult) {
            // Single chokepoint: payment.service.createPayment handles
            // payment-number generation, allocation, invoice paid-status,
            // line-item paid flag, ledger pair (DR Cash / CR AR), folio
            // recalc, and audit log.
            const bkResult = await createPayment(tx, {
              idempotencyKey: `bk-full-${created.id}`,
              guestId:        data.guestId,
              bookingId:      created.id,
              amount:         invResult.grandTotal,
              paymentMethod:  paymentMethod!,
              paymentDate:    now,
              cashSessionId:  bkCashSessionId ?? undefined,
              receivedBy:     userId,
              notes:          `ชำระเต็มจำนวน ณ วันจอง — ห้อง ${data.roomNumber}`,
              allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
              createdBy:      session?.user?.email ?? 'system',
              createdByName:  session?.user?.name ?? undefined,
              // Route the ledger DEBIT to the bank account picked by the cashier
              // (transfer/promptpay). null for cash → resolveMoneyAccount default.
              receivingAccountId: receivingAccountId ?? undefined,
              terminalId: cardFields?.terminalId,
              cardBrand:  cardFields?.cardBrand as never,
              cardType:   cardFields?.cardType as never,
              cardLast4:  cardFields?.cardLast4,
              authCode:   cardFields?.authCode,
            });
            const payNum = bkResult.paymentNumber;
            const rcpNum = bkResult.receiptNumber;

            // ── LOG: Full payment at booking ─────────────────────────────
            await logActivity(tx, {
              session,
              action:      'payment.booking_full',
              category:    'payment',
              description: `รับชำระเต็มจำนวน ฿${invResult.grandTotal.toLocaleString()} (INV-BK) — ห้อง ${data.roomNumber} (${paymentMethod})`,
              bookingId:  created.id,
              roomId:     room.id,
              guestId:    data.guestId,
              invoiceId:  invResult.invoiceId,
              icon:       '💰',
              severity:   'success',
              metadata: {
                amount: invResult.grandTotal,
                invoiceNumber: invResult.invoiceNumber,
                paymentMethod,
                paymentType: 'full',
              },
            });

            // ── Register BillingPeriod(cycleIndex=1) for monthly bookings ──
            // This is the critical idempotency anchor: the monthly-billing cron
            // checks BillingPeriod.findUnique({bookingId, cycleIndex}) before
            // generating a draft. Without this row the cron would create a
            // second INV-MN for cycle 1, double-billing the guest.
            // We use upsert (not create) so the booking route + check-in route
            // can't both insert and cause a P2002 unique conflict.
            if (isMonthlyBK) {
              await tx.billingPeriod.upsert({
                where: { bookingId_cycleIndex: { bookingId: created.id, cycleIndex: 1 } },
                create: {
                  bookingId:   created.id,
                  cycleIndex:  1,
                  periodStart: invoicePeriodStart,
                  periodEnd:   invoicePeriodEnd,
                  isPartial:   cycle1IsPartial,
                  isFinal:     cycle1IsFinal,
                  invoiceId:   invResult.invoiceId,
                },
                update: {
                  // If a row already exists (e.g. check-in route ran first),
                  // link it to this invoice and update dates to be consistent.
                  periodStart: invoicePeriodStart,
                  periodEnd:   invoicePeriodEnd,
                  isPartial:   cycle1IsPartial,
                  isFinal:     cycle1IsFinal,
                  invoiceId:   invResult.invoiceId,
                },
              });
            }

            // ── Build receipt data ────────────────────────────────────────
            // Receipt-Standardization: for daily bookings, render one item per
            // night with periodStart/periodEnd. Monthly: single row spanning
            // the billing window (cycle 1 only, not the full stay).
            const receiptItems: ReceiptData['items'] =
              data.bookingType === 'daily' && nights
                ? Array.from({ length: nights }, (_, i) => {
                    const nightStart = new Date(checkInDate);
                    nightStart.setUTCHours(0, 0, 0, 0);
                    nightStart.setUTCDate(nightStart.getUTCDate() + i);
                    const nightEnd = new Date(nightStart);
                    nightEnd.setUTCDate(nightEnd.getUTCDate() + 1);
                    return {
                      description: `ค่าห้องพัก — ห้อง ${data.roomNumber}`,
                      quantity:    1,
                      unitPrice:   Number(data.rate),
                      amount:      Number(data.rate),
                      periodStart: fmtDate(nightStart),
                      periodEnd:   fmtDate(nightEnd),
                    };
                  })
                : [{
                    description: `ค่าห้องพัก — ห้อง ${data.roomNumber}`,
                    amount:      invResult.grandTotal,
                    periodStart: fmtDate(invoicePeriodStart),
                    periodEnd:   fmtDate(invoicePeriodEnd),
                  }];

            bookingReceipt = {
              receiptType:   'booking_full',
              receiptNumber: rcpNum,
              paymentNumber: payNum,
              invoiceNumber: invResult.invoiceNumber,
              bookingNumber,
              guestName,
              roomNumber:    data.roomNumber,
              bookingType:   data.bookingType,
              checkIn:       fmtDate(checkInDate),
              checkOut:      fmtDate(checkOutDate),
              items:         receiptItems,
              subtotal:      invResult.grandTotal,
              vatAmount:     0,
              grandTotal:    invResult.grandTotal,
              paymentMethod: paymentMethod!,
              paidAmount:    invResult.grandTotal,
              issueDate:     now.toISOString(),
              cashierName:   session?.user?.name ?? undefined,
            };
          }
        } else if (paymentType === 'deposit' && depositAmount > 0) {
          // Deposit-only — add DEPOSIT_BOOKING charge and create INV-BK
          await addCharge(tx, {
            folioId,
            chargeType: 'DEPOSIT_BOOKING',
            description: `เงินมัดจำ ห้อง ${data.roomNumber}`,
            amount: depositAmount,
            createdBy: userId,
          });

          const invResult = await createInvoiceFromFolio(tx, {
            folioId,
            guestId: data.guestId,
            bookingId: created.id,
            invoiceType: 'BK',
            dueDate: now,
            notes: `เงินมัดจำ — ห้อง ${data.roomNumber}`,
            createdBy: userId,
          });

          if (invResult) {
            // Single chokepoint: payment.service.createPayment
            const depResult = await createPayment(tx, {
              idempotencyKey: `bk-deposit-${created.id}`,
              guestId:        data.guestId,
              bookingId:      created.id,
              amount:         depositAmount,
              paymentMethod:  paymentMethod!,
              paymentDate:    now,
              cashSessionId:  bkCashSessionId ?? undefined,
              receivedBy:     userId,
              notes:          `เงินมัดจำ ห้อง ${data.roomNumber}`,
              allocations:    [{ invoiceId: invResult.invoiceId, amount: depositAmount }],
              createdBy:      session?.user?.email ?? 'system',
              createdByName:  session?.user?.name ?? undefined,
              receivingAccountId: receivingAccountId ?? undefined,
              terminalId: cardFields?.terminalId,
              cardBrand:  cardFields?.cardBrand as never,
              cardType:   cardFields?.cardType as never,
              cardLast4:  cardFields?.cardLast4,
              authCode:   cardFields?.authCode,
            });
            const payNum = depResult.paymentNumber;
            const rcpNum = depResult.receiptNumber;

            // ── LOG: Deposit payment at booking ──────────────────────────
            await logActivity(tx, {
              session,
              action:      'payment.booking_deposit',
              category:    'payment',
              description: `รับมัดจำ ฿${depositAmount.toLocaleString()} (INV-BK) — ห้อง ${data.roomNumber} (${paymentMethod})`,
              bookingId:  created.id,
              roomId:     room.id,
              guestId:    data.guestId,
              invoiceId:  invResult.invoiceId,
              icon:       '💵',
              severity:   'success',
              metadata: {
                amount: depositAmount,
                invoiceNumber: invResult.invoiceNumber,
                paymentMethod,
                paymentType: 'deposit',
              },
            });

            // ── Build receipt data ────────────────────────────────────────
            bookingReceipt = {
              receiptType:   'booking_deposit',
              receiptNumber: rcpNum,
              paymentNumber: payNum,
              invoiceNumber: invResult.invoiceNumber,
              bookingNumber,
              guestName,
              roomNumber:    data.roomNumber,
              bookingType:   data.bookingType,
              checkIn:       fmtDate(checkInDate),
              checkOut:      fmtDate(checkOutDate),
              items: [{
                description: `เงินมัดจำ — ห้อง ${data.roomNumber}`,
                amount:      depositAmount,
              }],
              subtotal:      depositAmount,
              vatAmount:     0,
              grandTotal:    depositAmount,
              paymentMethod: paymentMethod!,
              paidAmount:    depositAmount,
              issueDate:     now.toISOString(),
              cashierName:   session?.user?.name ?? undefined,
              notes:         `ยอดค้างชำระ ฿${(expectedStayAmount - depositAmount).toLocaleString()} จะเก็บ ณ เช็คเอาท์`,
            };
          }
        }
      }

      await logActivity(tx, {
        session,
        action: 'booking.created',
        category: 'booking',
        description: `สร้างการจองใหม่ ${bookingNumber} — ห้อง ${data.roomNumber}, ${data.bookingType}`,
        bookingId: created.id,
        roomId: room.id,
        guestId: data.guestId,
        icon: '📋',
        severity: 'success',
        metadata: {
          bookingNumber,
          roomNumber: data.roomNumber,
          bookingType: data.bookingType,
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          rate: Number(data.rate),
          deposit: depositAmount,
          source: data.source || 'direct',
          paymentMethod: paymentMethod,
          paymentType: paymentType,
        },
      });

      return created;
    });

    return NextResponse.json({
      success: true,
      booking: {
        ...booking,
        checkIn:  fmtDate(booking.checkIn),
        checkOut: fmtDate(booking.checkOut),
      },
      receipt: bookingReceipt,   // null when no payment at booking time
    }, { status: 201 });

  } catch (error: unknown) {
    // Prisma unique constraint violation (duplicate booking number — very rare race)
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'หมายเลขการจองซ้ำกัน กรุณาลองใหม่อีกครั้ง' },
        { status: 409 }
      );
    }
    console.error('POST /api/bookings error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 }
    );
  }
}
