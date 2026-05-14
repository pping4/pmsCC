/**
 * POST /api/billing/drafts/approve
 *
 * Bulk approve draft invoices. For each invoice:
 *  1. Re-derive needsReading server-side (don't trust client).
 *  2. If needsReading → skip with reason 'NEEDS_READING'.
 *  3. If not draft → skip with reason 'NOT_DRAFT'.
 *  4. Otherwise call approveDraft inside a per-invoice transaction.
 *
 * Role: admin | manager
 *
 * Body: { invoiceIds: string[] }   (at least 1, max 100)
 *
 * Returns:
 *   { approved: string[], skipped: Array<{ id: string, reason: string }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import { approveDraft, BillingStateError } from '@/services/billing.service';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const Body = z.object({
  invoiceIds: z.array(z.string().uuid()).nonempty().max(100),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Server-side re-derive whether an invoice needs a reading before approval.
 * An invoice needs a reading if cycleIndex >= 2 and it has no UTILITY_WATER
 * or UTILITY_ELECTRIC line items.
 */
async function checkNeedsReading(invoiceId: string): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      billingPeriod: { select: { cycleIndex: true } },
      items: {
        select: {
          folioLineItem: { select: { chargeType: true } },
        },
      },
    },
  });
  if (!inv) return false;

  const cycleIndex = inv.billingPeriod?.cycleIndex ?? 1;
  if (cycleIndex < 2) return false;

  const hasUtility = inv.items.some(
    (i) =>
      i.folioLineItem?.chargeType === 'UTILITY_WATER' ||
      i.folioLineItem?.chargeType === 'UTILITY_ELECTRIC',
  );
  return !hasUtility;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map((i) => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    throw err;
  }

  const approvedBy = getUserRef(session);
  const approved: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const invoiceId of body.invoiceIds) {
    try {
      // Server-side reading guard (re-derive, don't trust client)
      const needsReading = await checkNeedsReading(invoiceId);
      if (needsReading) {
        skipped.push({ id: invoiceId, reason: 'NEEDS_READING' });
        continue;
      }

      // Approve inside its own transaction so one failure doesn't roll back others
      await prisma.$transaction((tx) => approveDraft(tx, { invoiceId, approvedBy }));
      approved.push(invoiceId);
    } catch (err) {
      if (err instanceof BillingStateError) {
        skipped.push({ id: invoiceId, reason: err.code });
      } else {
        // Unexpected error — log but continue processing the rest
        console.error(`[POST /api/billing/drafts/approve] invoiceId=${invoiceId}`, err);
        skipped.push({ id: invoiceId, reason: 'UNEXPECTED_ERROR' });
      }
    }
  }

  return NextResponse.json({ approved, skipped });
}
