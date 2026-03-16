import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { bookingId, paymentMethod, notes } = body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      guest: true,
      invoices: true,
    },
  });

  if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  if (booking.status !== 'checked_in') {
    return NextResponse.json({ error: 'การจองนี้ยังไม่ได้เช็คอิน' }, { status: 400 });
  }

  const totalInvoiced = booking.invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
  const totalPaid = booking.invoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
  const balance = totalInvoiced - totalPaid;

  const now = new Date();

  const operations: any[] = [
    prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'checked_out',
        actualCheckOut: now,
        ...(notes && { notes }),
      },
    }),
    prisma.room.update({
      where: { id: booking.roomId },
      data: { status: 'checkout', currentBookingId: null },
    }),
  ];

  // If there's outstanding balance and no unpaid invoice, create one
  const hasUnpaidInvoice = booking.invoices.some((inv) => inv.status === 'unpaid' || inv.status === 'overdue');
  if (balance > 0 && !hasUnpaidInvoice) {
    const invoiceNumber = `INV-${Date.now()}`;
    operations.push(
      prisma.invoice.create({
        data: {
          invoiceNumber,
          bookingId,
          guestId: booking.guestId,
          issueDate: now,
          dueDate: now,
          subtotal: balance,
          taxTotal: 0,
          grandTotal: balance,
          status: paymentMethod ? 'paid' : 'unpaid',
          paymentMethod: paymentMethod || null,
          paidAt: paymentMethod ? now : null,
          notes: 'ค่าใช้จ่ายค้างชำระ ณ วันเช็คเอาท์',
          items: {
            create: [
              {
                description: `ค่าห้องพักคงค้าง - ห้อง ${booking.room.number}`,
                amount: balance,
                taxType: 'included',
              },
            ],
          },
        },
      })
    );
  } else if (balance <= 0 && paymentMethod) {
    // Mark existing unpaid invoices as paid
    for (const inv of booking.invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue')) {
      operations.push(
        prisma.invoice.update({
          where: { id: inv.id },
          data: { status: 'paid', paymentMethod: paymentMethod, paidAt: now },
        })
      );
    }
  }

  await prisma.$transaction(operations);

  return NextResponse.json({ success: true, balance, settled: !!paymentMethod });
}
