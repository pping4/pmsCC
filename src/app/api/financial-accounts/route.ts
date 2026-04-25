/**
 * GET  /api/financial-accounts — list all accounts (active + inactive)
 * POST /api/financial-accounts — create a new account (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import { AccountKind, AccountSubKind, Prisma } from '@prisma/client';

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') === '1';
  const subKind    = url.searchParams.get('subKind') as AccountSubKind | null;

  const accounts = await prisma.financialAccount.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(subKind    ? { subKind }        : {}),
    },
    select: {
      id: true, code: true, name: true, nameEN: true,
      kind: true, subKind: true,
      bankName: true, bankAccountNo: true, bankAccountName: true,
      openingBalance: true, openingBalanceAt: true,
      isActive: true, isSystem: true, isDefault: true,
      description: true,
      createdAt: true, updatedAt: true,
      // Used by settings UI to decide whether subKind is editable (no refs = safe to change)
      _count: {
        select: {
          ledgerEntries: true,
          payments:      true,
          paymentFees:   true,
          refunds:       true,
          cashBoxes:     true,
        },
      },
    },
    orderBy: [{ kind: 'asc' }, { code: 'asc' }],
  });

  return NextResponse.json({ accounts });
}

// ── POST ────────────────────────────────────────────────────────────────────
const CreateSchema = z.object({
  code:            z.string().trim().min(1).max(32),
  name:            z.string().trim().min(1).max(120),
  nameEN:          z.string().trim().max(120).optional(),
  kind:            z.nativeEnum(AccountKind),
  subKind:         z.nativeEnum(AccountSubKind),
  parentId:        z.string().uuid().optional(),
  bankName:        z.string().trim().max(80).optional(),
  bankAccountNo:   z.string().trim().max(40).optional(),
  bankAccountName: z.string().trim().max(120).optional(),
  openingBalance:  z.coerce.number().finite().default(0),
  isDefault:       z.boolean().default(false),
  description:     z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'ต้องเป็นผู้ดูแลระบบ (admin) จึงจะสร้างบัญชีได้' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof CreateSchema>;
  try { input = CreateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // If isDefault=true, demote the previous default in the same subKind
      if (input.isDefault) {
        await tx.financialAccount.updateMany({
          where: { subKind: input.subKind, isDefault: true },
          data:  { isDefault: false },
        });
      }
      return tx.financialAccount.create({
        data: {
          code:             input.code,
          name:             input.name,
          nameEN:           input.nameEN ?? null,
          kind:             input.kind,
          subKind:          input.subKind,
          parentId:         input.parentId ?? null,
          bankName:         input.bankName ?? null,
          bankAccountNo:    input.bankAccountNo ?? null,
          bankAccountName:  input.bankAccountName ?? null,
          openingBalance:   input.openingBalance,
          openingBalanceAt: input.openingBalance !== 0 ? new Date() : null,
          isDefault:        input.isDefault,
          isSystem:         false,
          description:      input.description ?? null,
        },
        select: { id: true, code: true, name: true },
      });
    });

    return NextResponse.json({ account: created });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'DUPLICATE_CODE', message: `รหัสบัญชี "${input.code}" ถูกใช้ไปแล้ว` },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : 'Create failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
