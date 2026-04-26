/**
 * POST /api/bookings/[id]/extend
 *
 * Extend (ต่ออายุ) a checked-in booking — works for both daily and monthly.
 *
 * Steps:
 *  1. Validate newCheckOut > current checkOut
 *  2. Compute extraDays and extraCharge = extraDays × (newRate ?? booking.rate)
 *  3. In $transaction:
 *     a. Update booking.checkOut (and rate if newRate provided for monthly)
 *     b. Add FolioLineItem for the extra charge
 *     c. If collectNow → create Invoice for just this line item, then Payment + Allocation
 *     d. recalculateFolioBalance
 *     e. Activity log
 *
 * Security checklist:
 * ✅ Auth: session required
 * ✅ Input: Zod validated
 * ✅ Transaction: $transaction wraps all writes
 * ✅ select used — no data leaks
 */

import { NextResponse }      from 'next/server';
import { getServerSession }  from 'next-auth';
import { authOptions }       from '@/lib/auth';
import { prisma }            from '@/lib/prisma';
import { Prisma }            from '@prisma/client';
import { z }                 from 'zod';
import {
  getFolioByBookingId,
  addCharge,
  addNightlyRoomCharges,
  createInvoiceFromFolio,
} from '@/services/folio.service';
import { recalculateFolioBalance } from '@/services/folio.service';
import { createPayment } from '@/services/payment.service';
import { logActivity }       from '@/services/activityLog.service';

const ExtendSchema = z.object({
  /** New check-out date (must be strictly after current checkOut) */
  newCheckOut:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
  /** Optional new rate — only meaningful for monthly bookings */
  newRate:       z.number().positive().optional(),
  /** Whether to collect payment right now */
  collectNow:    z.boolean().default(false),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card']).optional(),
  notes:         z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ExtendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { newCheckOut: newCheckOutStr, newRate, collectNow, paymentMethod, notes } = parsed.data;

  // Validate payment info when collecting now
  if (collectNow && !paymentMethod) {
    return NextResponse.json({ error: 'ต้องระบุวิธีการชำระเงิน' }, { status: 422 });
  }
  // Sprint 4B: cashSessionId is resolved server-side from the caller's open
  // shift — never accepted from the client.

  const userId   = session.user.id   ?? session.user.email ?? 'system';
  const userName = session.user.name ?? undefined;

  // ── Fetch booking ───────────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where:  { id: params.id },
    select: {
      id:          true,
      bookingNumber: true,
      status:      true,
      bookingType: true,
      checkOut:    true,
      rate:        true,
      guestId:     true,
      guest:       { select: { firstName: true, lastName: true } },
      room:        { select: { number: true } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  }
  if (booking.status !== 'checked_in') {
    return NextResponse.json({ error: 'ต่ออายุได้เฉพาะผู้เข้าพักที่เช็คอินอยู่เท่านั้น' }, { status: 400 });
  }

  // Parse dates at midnight UTC to avoid timezone drift
  const oldCheckOut = new Date(booking.checkOut);
  const newCheckOut = new Date(`${newCheckOutStr}T00:00:00.000Z`);

  if (newCheckOut <= oldCheckOut) {
    return NextResponse.json({ error: 'วันเช็คเอาท์ใหม่ต้องมากกว่าวันเดิม' }, { status: 400 });
  }

  const extraDays   = Math.round((newCheckOut.getTime() - oldCheckOut.getTime()) / 86_400_000);
  const effectiveRate = newRate ?? Number(booking.rate);
  const extraCharge   = +(extraDays * effectiveRate).toFixed(2);

  const bookingTypeLabel =
    booking.bookingType === 'daily'         ? 'รายวัน' :
    booking.bookingType === 'monthly_short' ? 'รายเดือน (สั้น)' : 'รายเดือน (ยาว)';

  const guestName = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();

  try {
    const result = await prisma.$transaction(async (tx) => {

      // ── a. Update booking ─────────────────────────────────────────────────
      await tx.booking.update({
        where: { id: params.id },
        data: {
          checkOut: newCheckOut,
          ...(newRate ? { rate: new Prisma.Decimal(newRate) } : {}),
          ...(notes  ? { notes }                             : {}),
        },
      });

      // ── a.1 Extend the LAST segment's toDate so it stays in sync with
      //       booking.checkOut. Without this, split bookings end up with a
      //       gap between segments.toDate and booking.checkOut — the tape
      //       chart then renders the stay as shorter than it is, and the
      //       segment-based availability check lets other bookings grab
      //       that room during the extension window.
      //
      //       We also validate the extended window on the final segment's
      //       room: no other booking may occupy it in [oldCheckOut, newCheckOut).
      //       (Same-booking segments are excluded by bookingId filter.)
      const segments = await tx.bookingRoomSegment.findMany({
        where:   { bookingId: params.id },
        orderBy: { fromDate: 'desc' },
        take:    1,
        select:  { id: true, roomId: true, toDate: true },
      });
      const lastSeg = segments[0];
      if (lastSeg) {
        const conflict = await tx.bookingRoomSegment.findFirst({
          where: {
            roomId:    lastSeg.roomId,
            bookingId: { not: params.id },
            fromDate:  { lt: newCheckOut },
            toDate:    { gt: lastSeg.toDate },
            booking:   { status: { not: 'cancelled' } },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new Error('ห้องปลายทางไม่ว่างในช่วงที่ต่ออายุ (ชนกับการจองอื่น)');
        }
        await tx.bookingRoomSegment.update({
          where: { id: lastSeg.id },
          data:  { toDate: newCheckOut },
        });
      } else {
        // Legacy booking with zero segments — lazy backfill a single segment
        // covering [checkIn, newCheckOut) in booking.roomId.
        const b = await tx.booking.findUnique({
          where: { id: params.id },
          select: { checkIn: true, roomId: true, rate: true, bookingType: true },
        });
        if (b) {
          await tx.bookingRoomSegment.create({
            data: {
              bookingId:   params.id,
              roomId:      b.roomId,
              fromDate:    b.checkIn,
              toDate:      newCheckOut,
              rate:        b.rate,
              bookingType: b.bookingType,
              createdBy:   'system-lazy-backfill',
            },
          });
        }
      }

      // ── b. Add FolioLineItem for extra charge ──────────────────────────────
      const folio = await getFolioByBookingId(tx, params.id);
      if (!folio) throw new Error('ไม่พบ Folio ของการจองนี้');

      // Receipt-Standardization: daily extend → 1 row per added night.
      // Monthly extend → single row covering the extension period.
      let newLineItemIds: string[];
      if (booking.bookingType === 'daily') {
        const result = await addNightlyRoomCharges(tx, {
          folioId:      folio.folioId,
          roomNumber:   booking.room.number,
          startDate:    oldCheckOut,
          nights:       extraDays,
          ratePerNight: effectiveRate,
          taxType:      'no_tax',
          referenceType: 'booking',
          referenceId:   params.id,
          notes:         notes ?? 'ต่ออายุการจอง',
          createdBy:    userId,
        });
        newLineItemIds = result.lineItemIds;
      } else {
        const description =
          `ค่าเช่าเพิ่มเติม — ห้อง ${booking.room.number} (ต่ออายุสัญญา ${bookingTypeLabel})`;
        const { lineItemId } = await addCharge(tx, {
          folioId:     folio.folioId,
          chargeType:  'ROOM',
          description,
          amount:      extraCharge,
          quantity:    1,
          unitPrice:   extraCharge,
          serviceDate: oldCheckOut,
          periodEnd:   newCheckOut,
          notes:       notes,
          createdBy:   userId,
        });
        newLineItemIds = [lineItemId];
      }

      let invoiceId: string | undefined;
      let paymentId: string | undefined;

      // ── c. Collect payment now (optional) ──────────────────────────────────
      if (collectNow && extraCharge > 0 && paymentMethod) {

        // Create invoice for ONLY the new extension line item
        const invResult = await createInvoiceFromFolio(tx, {
          folioId:     folio.folioId,
          guestId:     booking.guestId,
          bookingId:   params.id,
          invoiceType: 'GN',               // General / extension invoice
          dueDate:     new Date(),
          notes:       notes ?? `ต่ออายุการจอง BK-${booking.bookingNumber}`,
          createdBy:   userId,
          lineItemIds: newLineItemIds,        // bill all new extension nights/rows
        });

        if (invResult) {
          invoiceId = invResult.invoiceId;

          // Single chokepoint: payment.service handles cash-session
          // resolution, invoice paid-status update, line-item paid flag,
          // ledger pair (DR Cash / CR AR), and audit log.
          const result = await createPayment(tx, {
            idempotencyKey: `extend-${params.id}-${newCheckOutStr}`,
            guestId:        booking.guestId,
            bookingId:      params.id,
            amount:         invResult.grandTotal,
            paymentMethod,
            paymentDate:    new Date(),
            receivedBy:     userId,
            notes:          notes ?? `ต่ออายุการจอง +${extraDays} วัน`,
            allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
            createdBy:      userId,
            createdByName:  userName ?? undefined,
          });
          paymentId = result.id;
        }
      }

      // ── d. Recalculate folio balance ────────────────────────────────────────
      await recalculateFolioBalance(tx, folio.folioId);

      // ── e. Activity log ─────────────────────────────────────────────────────
      const oldDateStr = oldCheckOut.toISOString().slice(0, 10);
      const newDateStr = newCheckOutStr;

      await logActivity(tx, {
        userId,
        userName,
        action:      'booking.extended',
        category:    'booking',
        description: collectNow
          ? `ต่ออายุการจอง BK-${booking.bookingNumber}: ${oldDateStr} → ${newDateStr} (+${extraDays} วัน) — รับชำระ ฿${extraCharge.toLocaleString()} (${guestName})`
          : `ต่ออายุการจอง BK-${booking.bookingNumber}: ${oldDateStr} → ${newDateStr} (+${extraDays} วัน) — ยังไม่รับชำระ (${guestName})`,
        bookingId:   params.id,
        guestId:     booking.guestId,
        icon:        '📅',
        severity:    'info',
        metadata:    {
          oldCheckOut: oldDateStr,
          newCheckOut: newDateStr,
          extraDays,
          extraCharge,
          effectiveRate,
          collectNow,
          paymentMethod: collectNow ? paymentMethod : null,
        },
      });

      return { extraDays, extraCharge, invoiceId, paymentId };
    });

    return NextResponse.json({
      success:     true,
      extraDays:   result.extraDays,
      extraCharge: result.extraCharge,
      invoiceId:   result.invoiceId,
      paymentId:   result.paymentId,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
