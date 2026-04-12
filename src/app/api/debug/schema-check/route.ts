import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const invoiceColumns = await (prisma as any).$queryRawUnsafe(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'invoices' ORDER BY ordinal_position`
    );
    const guestColumns = await (prisma as any).$queryRawUnsafe(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'guests' ORDER BY ordinal_position`
    );
    return NextResponse.json({ invoiceColumns, guestColumns });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message });
  }
}
