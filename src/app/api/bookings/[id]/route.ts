import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: {
        guest: true,
        room: { include: { roomType: true } },
        invoices: { include: { items: true } },
      },
    });

    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(booking);
  } catch (error) {
    console.error('GET /api/bookings/[id] error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
  }
}

// ─── Shared handler for PUT and PATCH ────────────────────────────────────────
async function handleUpdate(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();
    const now = new Date();

    // ── Quick Check-in (from tape chart context menu) ──────────────────────
    // Creates an unpaid stay invoice automatically so it appears in
    // the Collection Center and the Finance ledger.
    if (data.action === 'checkin') {
      const booking = await prisma.booking.findUnique({
        where: { id: params.id },
        include: { room: true, invoices: true, guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } } },
      });
      if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      // Calculate stay amount
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

      // Check if a stay invoice already exists (exclude deposit invoices)
      const hasStayInvoice = booking.invoices.some(
        (inv) => !inv.notes?.includes('เงินมัดจำ')
      );

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: params.id },
          data: { status: 'checked_in', actualCheckIn: now },
        });

        await logActivity(tx, {
          session,
          action: 'booking.checkin',
          category: 'checkin',
          description: `เช็คอิน: ห้อง ${booking.room.number} — ${booking.guest?.firstName ?? ''} ${booking.guest?.lastName ?? ''}`.trim(),
          bookingId: params.id,
          roomId: booking.roomId,
          guestId: booking.guestId,
          icon: '🛎️',
          severity: 'success',
          metadata: { before: { status: 'confirmed' }, after: { status: 'checked_in' }, roomNumber: booking.room.number },
        });

        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'occupied', currentBookingId: params.id },
        });

        // ★ Create unpaid stay invoice so it shows in Collection Center
        if (!hasStayInvoice && stayAmount > 0) {
          const description =
            booking.bookingType === 'daily' && nights !== null
              ? `ค่าห้องพัก ${nights} คืน — ห้อง ${booking.room.number}`
              : `ค่าห้องพัก — ห้อง ${booking.room.number}`;

          await tx.invoice.create({
            data: {
              invoiceNumber: `INV-CI-${Date.now()}`,
              bookingId: params.id,
              guestId: booking.guestId,
              issueDate: now,
              dueDate: booking.checkOut,
              subtotal: stayAmount,
              vatAmount: 0,
              grandTotal: stayAmount,
              status: 'unpaid',
              notes: `ค่าห้องพัก — รอเก็บเงิน (Quick Check-in)`,
              items: {
                create: [
                  {
                    description,
                    amount: stayAmount,
                    taxType: 'no_tax' as const,
                  },
                ],
              },
            },
          });
        }
      });

      return NextResponse.json({ success: true });
    }

    // ── Quick Check-out (from tape chart context menu) ─────────────────────
    // Must: change status, free up room, AND create an unpaid invoice for the
    // balance so the amount is visible in the Collection Center.
    if (data.action === 'checkout') {
      const booking = await prisma.booking.findUnique({
        where: { id: params.id },
        include: { room: true, invoices: true, guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } } },
      });
      if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      const totalPaid = booking.invoices
        .filter((inv) => inv.status === 'paid')
        .reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
      const totalInvoiced = booking.invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);

      // Calculate stay amount based on booking type
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

      const effectiveTotal = booking.invoices.length === 0 ? stayAmount : totalInvoiced;
      const balance = Math.max(0, effectiveTotal - totalPaid);
      const hasUnpaidInvoice = booking.invoices.some(
        (inv) => inv.status === 'unpaid' || inv.status === 'overdue'
      );

      await prisma.$transaction(async (tx) => {
        // 1. Mark booking as checked_out
        await tx.booking.update({
          where: { id: params.id },
          data: { status: 'checked_out', actualCheckOut: now },
        });

        await logActivity(tx, {
          session,
          action: 'booking.checkout',
          category: 'checkout',
          description: `เช็คเอาท์: ห้อง ${booking.room.number} — ${booking.guest?.firstName ?? ''} ${booking.guest?.lastName ?? ''}`.trim(),
          bookingId: params.id,
          roomId: booking.roomId,
          guestId: booking.guestId,
          icon: '🧳',
          severity: 'success',
          metadata: { before: { status: 'checked_in' }, after: { status: 'checked_out' }, balance, roomNumber: booking.room.number },
        });

        // 2. Free up the room
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'cleaning', currentBookingId: null },
        });

        // 3. Create unpaid invoice for remaining balance (shows in Collection Center)
        if (balance > 0 && !hasUnpaidInvoice) {
          const description =
            booking.bookingType === 'daily' && nights !== null
              ? `ค่าห้องพัก ${nights} คืน — ห้อง ${booking.room.number}`
              : `ค่าห้องพัก — ห้อง ${booking.room.number}`;

          await tx.invoice.create({
            data: {
              invoiceNumber: `INV-CO-${Date.now()}`,
              bookingId: params.id,
              guestId: booking.guestId,
              issueDate: now,
              dueDate: now,
              subtotal: balance,
              vatAmount: 0,
              grandTotal: balance,
              status: 'unpaid',
              notes: 'ค่าใช้จ่าย ณ เช็คเอาท์ (Quick Checkout)',
              items: {
                create: [{ description, amount: balance, taxType: 'no_tax' as const }],
              },
            },
          });
        }
      });

      return NextResponse.json({ success: true, balance });
    }

    // ── Toggle Room Lock ──────────────────────────────────────────────────
    if (data.action === 'toggleLock') {
      const booking = await prisma.booking.findUnique({
        where: { id: params.id },
        select: { id: true, roomLocked: true },
      });
      if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      const updated = await prisma.booking.update({
        where: { id: params.id },
        data: { roomLocked: !booking.roomLocked },
      });

      await logActivity(prisma as any, {
        session,
        action: 'booking.lockToggled',
        category: 'booking',
        description: `${!booking.roomLocked ? 'ล็อค' : 'ปลดล็อค'}การจอง ${params.id}`,
        bookingId: params.id,
        icon: !booking.roomLocked ? '🔒' : '🔓',
        severity: 'info',
        metadata: { roomLocked: !booking.roomLocked },
      });

      return NextResponse.json({ success: true, roomLocked: updated.roomLocked });
    }

    // ── Cancel Booking ─────────────────────────────────────────────────────
    if (data.action === 'cancel') {
      const booking = await prisma.booking.findUnique({
        where: { id: params.id },
      });
      if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      const updated = await prisma.booking.update({
        where: { id: params.id },
        data: { status: 'cancelled' },
      });
      await prisma.room.update({
        where: { id: booking.roomId },
        data: { status: 'available', currentBookingId: null },
      });

      await logActivity(prisma as any, {
        session,
        action: 'booking.cancelled',
        category: 'booking',
        description: `ยกเลิกการจอง ${booking.bookingNumber}`,
        bookingId: params.id,
        roomId: booking.roomId,
        guestId: booking.guestId,
        icon: '❌',
        severity: 'warning',
        metadata: { before: { status: booking.status }, after: { status: 'cancelled' } },
      });

      return NextResponse.json({ success: true, booking: updated });
    }

    // ── General field update ───────────────────────────────────────────────
    const booking = await prisma.booking.update({
      where: { id: params.id },
      data: {
        checkIn:  data.checkIn  ? new Date(data.checkIn  + 'T00:00:00.000Z') : undefined,
        checkOut: data.checkOut ? new Date(data.checkOut + 'T00:00:00.000Z') : undefined,
        rate:     data.rate,
        deposit:  data.deposit,
        status:   data.status,
        notes:    data.notes,
      },
      include: { guest: true, room: { include: { roomType: true } } },
    });

    return NextResponse.json({ success: true, booking });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
    }
    console.error('PATCH/PUT /api/bookings/[id] error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' },
      { status: 500 }
    );
  }
}

// Both PUT and PATCH share the same handler so either method works
export const PUT   = handleUpdate;
export const PATCH = handleUpdate;
