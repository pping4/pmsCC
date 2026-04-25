/**
 * /api/cash-boxes/[id] — Sprint 4B.
 *
 * PATCH  — update a drawer (admin.manage_settings).
 * DELETE — soft-delete (deactivate). Hard delete forbidden because
 *          historical sessions reference the row. Blocked when an
 *          OPEN session is still using the drawer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import { requirePermission } from '@/lib/rbac/requirePermission';

async function requireAdminSettings() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const forbidden = await requirePermission(session, 'admin.manage_settings');
  if (forbidden) return { error: forbidden };
  return { session };
}

const UpdateSchema = z.object({
  name:               z.string().trim().min(1).max(120).optional(),
  location:           z.string().trim().max(120).optional().nullable(),
  displayOrder:       z.number().int().min(0).max(9999).optional(),
  notes:              z.string().trim().max(500).optional().nullable(),
  isActive:           z.boolean().optional(),
  financialAccountId: z.string().uuid().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminSettings();
  if ('error' in auth) return auth.error;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof UpdateSchema>;
  try { input = UpdateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  const existing = await prisma.cashBox.findUnique({
    where: { id: params.id },
    select: { id: true, currentSessionId: true },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Can't deactivate a drawer that still has an OPEN session pointed at it.
  if (input.isActive === false && existing.currentSessionId) {
    return NextResponse.json(
      { error: 'HAS_OPEN_SESSION', message: 'ปิดกะก่อนจึงจะปิดใช้งานลิ้นชักได้' },
      { status: 409 },
    );
  }

  // Re-linking the GL account: must be an active CASH account.
  if (input.financialAccountId) {
    const acc = await prisma.financialAccount.findUnique({
      where: { id: input.financialAccountId },
      select: { isActive: true, subKind: true },
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
  }

  const updated = await prisma.cashBox.update({
    where: { id: params.id },
    data: {
      ...(input.name !== undefined               ? { name:               input.name }               : {}),
      ...(input.location !== undefined           ? { location:           input.location }           : {}),
      ...(input.displayOrder !== undefined       ? { displayOrder:       input.displayOrder }       : {}),
      ...(input.notes !== undefined              ? { notes:              input.notes }              : {}),
      ...(input.isActive !== undefined           ? { isActive:           input.isActive }           : {}),
      ...(input.financialAccountId !== undefined ? { financialAccountId: input.financialAccountId } : {}),
    },
    select: {
      id: true, code: true, name: true, location: true, displayOrder: true, isActive: true,
    },
  });

  return NextResponse.json({ box: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminSettings();
  if ('error' in auth) return auth.error;

  const existing = await prisma.cashBox.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      currentSessionId: true,
      currentSession: {
        select: { openedByName: true, openedBy: true },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  if (existing.currentSessionId && existing.currentSession) {
    const who = existing.currentSession.openedByName ?? existing.currentSession.openedBy;
    return NextResponse.json(
      {
        error:   'HAS_OPEN_SESSION',
        message: `ลิ้นชักนี้มีกะเปิดอยู่ (${who}) — ปิดกะก่อนจึงจะปิดลิ้นชักได้`,
      },
      { status: 409 },
    );
  }

  await prisma.cashBox.update({
    where: { id: params.id },
    data:  { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
