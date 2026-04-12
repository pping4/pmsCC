/**
 * GET  /api/city-ledger  — List all City Ledger accounts
 * POST /api/city-ledger  — Create a new City Ledger account
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCLAccount } from '@/services/cityLedger.service';
import { CreateCLAccountSchema } from '@/lib/validations/cityLedger';

// ─── GET — List accounts ─────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status  = searchParams.get('status');   // active | suspended | closed
  const search  = searchParams.get('search');

  const accounts = await prisma.cityLedgerAccount.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(search ? {
        OR: [
          { companyName:  { contains: search, mode: 'insensitive' } },
          { accountCode:  { contains: search, mode: 'insensitive' } },
          { contactEmail: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    },
    select: {
      id:             true,
      accountCode:    true,
      companyName:    true,
      companyTaxId:   true,
      contactName:    true,
      contactEmail:   true,
      contactPhone:   true,
      creditLimit:    true,
      creditTermsDays: true,
      currentBalance: true,
      status:         true,
      createdAt:      true,
      _count: {
        select: { bookings: true, invoices: true },
      },
    },
    orderBy: { companyName: 'asc' },
  });

  return NextResponse.json({ accounts });
}

// ─── POST — Create account ───────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateCLAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? 'system';
  const userName = session.user.name ?? undefined;

  try {
    const account = await prisma.$transaction(async (tx) =>
      createCLAccount(tx, { ...parsed.data, createdBy: userId, userName })
    );
    return NextResponse.json({ account }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unique constraint') || msg.includes('P2002')) {
      return NextResponse.json({ error: 'รหัสบัญชีนี้มีอยู่แล้ว' }, { status: 409 });
    }
    console.error('[city-ledger POST]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
