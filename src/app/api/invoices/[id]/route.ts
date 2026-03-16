import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        status: 'paid',
        paymentMethod: data.paymentMethod,
        paidAt: new Date(),
      },
      include: { items: true, guest: true },
    });
    return NextResponse.json(invoice);
  }

  if (data.action === 'cancel') {
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: { status: 'cancelled' },
      include: { items: true, guest: true },
    });
    return NextResponse.json(invoice);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
