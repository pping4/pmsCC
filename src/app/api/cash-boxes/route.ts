/**
 * /api/cash-boxes — Sprint 4B counter-centric rewrite.
 *
 * GET  — list cash drawers (any authenticated user; used by /cashier picker
 *        and /settings/cash-boxes admin). Returns the denormalized
 *        `currentSession` pointer so the UI can show "in use by X" instantly.
 * POST — create a new drawer (admin.manage_settings).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { requirePermission } from '@/lib/rbac/requirePermission';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') === '1';

  const boxes = await prisma.cashBox.findMany({
    where: activeOnly ? { isActive: true } : {},
    select: {
      id:           true,
      code:         true,
      name:         true,
      location:     true,
      displayOrder: true,
      isActive:     true,
      notes:        true,
      financialAccount: { select: { id: true, code: true, name: true } },
      // Sprint 4B: follow the denormalized pointer — O(1) per box.
      currentSession: {
        select: {
          id:             true,
          openedBy:       true,
          openedByName:   true,
          openedAt:       true,
          openingBalance: true,
        },
      },
    },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
  });

  const result = boxes.map((b) => ({
    id:           b.id,
    code:         b.code,
    name:         b.name,
    location:     b.location,
    displayOrder: b.displayOrder,
    isActive:     b.isActive,
    notes:        b.notes,
    financialAccount: b.financialAccount,
    activeSession: b.currentSession
      ? {
          id:             b.currentSession.id,
          openedBy:       b.currentSession.openedBy,
          openedByName:   b.currentSession.openedByName,
          openedAt:       b.currentSession.openedAt,
          openingBalance: Number(b.currentSession.openingBalance),
        }
      : null,
  }));

  return NextResponse.json({ boxes: result });
}

const CreateSchema = z.object({
  code:               z.string().trim().min(1).max(32),
  name:               z.string().trim().min(1).max(120),
  location:           z.string().trim().max(120).optional().nullable(),
  displayOrder:       z.number().int().min(0).max(9999).optional(),
  financialAccountId: z.string().uuid(),
  notes:              z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const forbidden = await requirePermission(session, 'admin.manage_settings');
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof CreateSchema>;
  try { input = CreateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  // Enforce: the linked account must be a CASH account (double-entry correctness).
  const acc = await prisma.financialAccount.findUnique({
    where: { id: input.financialAccountId },
    select: { id: true, subKind: true, isActive: true },
  });
  if (!acc || !acc.isActive) {
    return NextResponse.json({ error: 'ACCOUNT_NOT_FOUND' }, { status: 404 });
  }
  if (acc.subKind !== 'CASH') {
    return NextResponse.json(
      { error: 'ACCOUNT_WRONG_KIND', message: 'ลิ้นชักต้องผูกกับบัญชีประเภทเงินสด (CASH)' },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.cashBox.create({
      data: {
        code:               input.code,
        name:               input.name,
        location:           input.location ?? null,
        displayOrder:       input.displayOrder ?? 0,
        financialAccountId: input.financialAccountId,
        notes:              input.notes ?? null,
      },
      select: { id: true, code: true, name: true },
    });
    return NextResponse.json({ box: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'DUPLICATE_CODE' }, { status: 409 });
    }
    throw err;
  }
}
