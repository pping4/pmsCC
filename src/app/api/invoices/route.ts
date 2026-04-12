import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calcTax } from '@/lib/tax';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status    = searchParams.get('status');
  const guestId   = searchParams.get('guestId');
  const bookingId = searchParams.get('bookingId');
  const invoiceType = searchParams.get('invoiceType');

  const invoices = await prisma.invoice.findMany({
    where: {
      ...(status      && status      !== 'all' ? { status:      status      as never } : {}),
      ...(guestId     ? { guestId }     : {}),
      ...(bookingId   ? { bookingId }   : {}),
      ...(invoiceType ? { invoiceType: invoiceType as never } : {}),
    },
    include: {
      guest: true,
      items: true,
      booking: { include: { room: { include: { roomType: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(invoices);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  // Generate invoice number
  const count = await prisma.invoice.count();
  const invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`;

  // Calculate totals
  let subtotal = 0;
  let vatAmount = 0;
  const processedItems = data.items.map((item: { description: string; amount: number; taxType: string; productId?: string }) => {
    const result = calcTax(Number(item.amount), item.taxType as 'included' | 'excluded' | 'no_tax');
    subtotal += result.net;
    vatAmount += result.tax;
    return {
      description: item.description,
      amount: item.amount,
      taxType: item.taxType,
      productId: item.productId || null,
    };
  });

  const grandTotal = subtotal + vatAmount;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      bookingId: data.bookingId || null,
      guestId: data.guestId,
      issueDate: new Date(data.issueDate || new Date()),
      dueDate: new Date(data.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      subtotal: Math.round(subtotal * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      status: 'unpaid',
      notes: data.notes || null,
      items: { create: processedItems },
    },
    include: { items: true, guest: true },
  });

  return NextResponse.json(invoice, { status: 201 });
}
