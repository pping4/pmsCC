/**
 * PATCH  /api/financial-accounts/[id] — update (admin only)
 * DELETE /api/financial-accounts/[id] — deactivate (soft delete — admin only)
 *
 * Hard delete is never allowed — accounts are referenced by immutable ledger
 * entries. Deactivation hides them from dropdowns but preserves history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import { AccountSubKind } from '@prisma/client';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const role = (session.user as { role?: string })?.role;
  if (role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

const UpdateSchema = z.object({
  name:            z.string().trim().min(1).max(120).optional(),
  nameEN:          z.string().trim().max(120).optional().nullable(),
  subKind:         z.nativeEnum(AccountSubKind).optional(),  // allowed only when no transactions
  bankName:        z.string().trim().max(80).optional().nullable(),
  bankAccountNo:   z.string().trim().max(40).optional().nullable(),
  bankAccountName: z.string().trim().max(120).optional().nullable(),
  isActive:        z.boolean().optional(),
  isDefault:       z.boolean().optional(),
  description:     z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof UpdateSchema>;
  try { input = UpdateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  const existing = await prisma.financialAccount.findUnique({
    where: { id: params.id },
    select: {
      id: true, subKind: true, isSystem: true,
      _count: {
        select: { ledgerEntries: true, payments: true, paymentFees: true, refunds: true, cashBoxes: true },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // System accounts: allow cosmetic edits (name, bank details) but not deactivation
  if (existing.isSystem && input.isActive === false) {
    return NextResponse.json(
      { error: 'CANNOT_DEACTIVATE_SYSTEM', message: 'ไม่สามารถปิดบัญชีมาตรฐานของระบบได้' },
      { status: 409 },
    );
  }

  // subKind change: only allowed when the account has never been used in any transaction.
  // Changing subKind on a live account would corrupt the meaning of existing ledger entries.
  if (input.subKind !== undefined && input.subKind !== existing.subKind) {
    const c = existing._count;
    const hasRefs = c.ledgerEntries + c.payments + c.paymentFees + c.refunds + c.cashBoxes > 0;
    if (hasRefs) {
      return NextResponse.json(
        { error: 'HAS_TRANSACTIONS', message: 'ไม่สามารถเปลี่ยนประเภทบัญชีได้ เพราะมีรายการที่อ้างอิงถึงบัญชีนี้แล้ว' },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const targetSubKind = input.subKind ?? existing.subKind;
    // Enforce one default per subKind
    if (input.isDefault === true) {
      await tx.financialAccount.updateMany({
        where: { subKind: targetSubKind, isDefault: true, NOT: { id: params.id } },
        data:  { isDefault: false },
      });
    }
    return tx.financialAccount.update({
      where: { id: params.id },
      data: {
        ...(input.subKind !== undefined          ? { subKind:         input.subKind }         : {}),
        ...(input.name !== undefined             ? { name:            input.name }            : {}),
        ...(input.nameEN !== undefined           ? { nameEN:          input.nameEN }          : {}),
        ...(input.bankName !== undefined         ? { bankName:        input.bankName }        : {}),
        ...(input.bankAccountNo !== undefined    ? { bankAccountNo:   input.bankAccountNo }   : {}),
        ...(input.bankAccountName !== undefined  ? { bankAccountName: input.bankAccountName } : {}),
        ...(input.isActive !== undefined         ? { isActive:        input.isActive }        : {}),
        ...(input.isDefault !== undefined        ? { isDefault:       input.isDefault }       : {}),
        ...(input.description !== undefined      ? { description:     input.description }     : {}),
      },
      select: { id: true, code: true, name: true, subKind: true, isActive: true, isDefault: true },
    });
  });

  return NextResponse.json({ account: updated });
}

/**
 * DELETE semantics:
 *  - isSystem → forbidden always (seed accounts)
 *  - No references anywhere → HARD DELETE (user can clean up accounts created by mistake)
 *  - Any references (ledger/payment/fee/refund/cashBox/children) → SOFT DELETE
 *    (ledger immutability means we can never destroy posted history)
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const existing = await prisma.financialAccount.findUnique({
    where: { id: params.id },
    select: {
      id: true, isSystem: true,
      _count: {
        select: {
          ledgerEntries: true,
          payments:      true,
          paymentFees:   true,
          refunds:       true,
          cashBoxes:     true,
          children:      true,
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (existing.isSystem) {
    return NextResponse.json(
      { error: 'CANNOT_DELETE_SYSTEM', message: 'ไม่สามารถลบบัญชีมาตรฐานของระบบได้' },
      { status: 409 },
    );
  }

  const c = existing._count;
  const hasRefs = c.ledgerEntries + c.payments + c.paymentFees + c.refunds + c.cashBoxes + c.children > 0;

  if (!hasRefs) {
    await prisma.financialAccount.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true, mode: 'hard' });
  }

  // Referenced → soft delete only
  await prisma.financialAccount.update({
    where: { id: params.id },
    data:  { isActive: false, isDefault: false },
  });
  return NextResponse.json({ ok: true, mode: 'soft' });
}
