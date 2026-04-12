import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';
import { voidInvoice, markLineItemsPaid } from '@/services/folio.service';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      items: true,
      guest: true,
      booking: { include: { room: { include: { roomType: true } } } },
    },
  });

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  if (data.action === 'pay') {
    const invoice = await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: params.id },
        data: {
          status: 'paid',
        },
        include: { items: true, guest: true, booking: { select: { id: true, bookingNumber: true, roomId: true, guestId: true } } },
      });

      // ★ Mark folio line items as PAID
      await markLineItemsPaid(tx, params.id);

      await logActivity(tx, {
        session,
        action: 'invoice.paid',
        category: 'payment',
        description: `ชำระเงิน ${updated.invoiceNumber} — ฿${Number(updated.grandTotal).toLocaleString()} (${data.paymentMethod ?? '-'})`,
        bookingId: updated.bookingId ?? undefined,
        invoiceId: params.id,
        guestId: updated.guestId ?? undefined,
        roomId: updated.booking?.roomId ?? undefined,
        icon: '💳',
        severity: 'success',
        metadata: {
          invoiceNumber: updated.invoiceNumber,
          amount: Number(updated.grandTotal),
          paymentMethod: data.paymentMethod,
          paidAt: new Date().toISOString(),
        },
      });
      return updated;
    });
    return NextResponse.json(invoice);
  }

  if (data.action === 'cancel') {
    const invoice = await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: params.id },
        data: { status: 'cancelled' },
        include: { items: true, guest: true, booking: { select: { id: true, bookingNumber: true, roomId: true, guestId: true } } },
      });
      await logActivity(tx, {
        session,
        action: 'invoice.cancelled',
        category: 'invoice',
        description: `ยกเลิกใบแจ้งหนี้ ${updated.invoiceNumber} — ฿${Number(updated.grandTotal).toLocaleString()}`,
        bookingId: updated.bookingId ?? undefined,
        invoiceId: params.id,
        guestId: updated.guestId ?? undefined,
        roomId: updated.booking?.roomId ?? undefined,
        icon: '🚫',
        severity: 'warning',
        metadata: {
          invoiceNumber: updated.invoiceNumber,
          amount: Number(updated.grandTotal),
          previousStatus: 'unpaid',
        },
      });
      return updated;
    });
    return NextResponse.json(invoice);
  }

  // ★ Void invoice — unlocks FolioLineItems back to UNBILLED ★
  if (data.action === 'void') {
    const userId = session.user?.email ?? 'system';
    try {
      await prisma.$transaction(async (tx) => {
        await voidInvoice(tx, {
          invoiceId: params.id,
          voidedBy: userId,
          reason: data.reason ?? undefined,
        });

        // Fetch the voided invoice for activity log
        const inv = await tx.invoice.findUnique({
          where: { id: params.id },
          select: {
            invoiceNumber: true,
            grandTotal: true,
            bookingId: true,
            guestId: true,
            booking: { select: { roomId: true } },
          },
        });

        if (inv) {
          await logActivity(tx, {
            session,
            action: 'invoice.voided',
            category: 'invoice',
            description: `Void ใบแจ้งหนี้ ${inv.invoiceNumber} — ฿${Number(inv.grandTotal).toLocaleString()}`,
            bookingId: inv.bookingId ?? undefined,
            invoiceId: params.id,
            guestId: inv.guestId ?? undefined,
            roomId: inv.booking?.roomId ?? undefined,
            icon: '🔄',
            severity: 'warning',
            metadata: {
              invoiceNumber: inv.invoiceNumber,
              amount: Number(inv.grandTotal),
              reason: data.reason,
            },
          });
        }
      });
      return NextResponse.json({ success: true, message: 'Invoice voided — folio line items unlocked' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Void failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
