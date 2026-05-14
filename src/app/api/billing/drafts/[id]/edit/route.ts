/**
 * POST /api/billing/drafts/[id]/edit
 *
 * Inline edit of a draft invoice's amounts before approval.
 * Only works while invoice.status = 'draft'. No ledger is touched.
 *
 * Role: admin | manager
 *
 * Body (all optional, at least one required):
 *   {
 *     rentAmount?:     number ≥ 0,
 *     waterUsage?:     number ≥ 0,
 *     electricUsage?:  number ≥ 0,
 *     notes?:          string ≤ 500,
 *   }
 *
 * Strategy:
 *   1. Load the invoice's folio line items grouped by chargeType.
 *   2. For each provided field, update the matching FolioLineItem.amount.
 *   3. Recompute Invoice.grandTotal as the sum of the (updated) DRAFT line items.
 *
 * Returns: { ok: true, newGrandTotal: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { Prisma } from '@prisma/client';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const Body = z
  .object({
    rentAmount:    z.number().nonnegative().optional(),
    waterUsage:    z.number().nonnegative().optional(),
    electricUsage: z.number().nonnegative().optional(),
    notes:         z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      d.rentAmount !== undefined ||
      d.waterUsage !== undefined ||
      d.electricUsage !== undefined ||
      d.notes !== undefined,
    { message: 'ต้องระบุอย่างน้อย 1 field (rentAmount, waterUsage, electricUsage, notes)' },
  );

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-lock the invoice
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;

      const inv = await tx.invoice.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          notes: true,
          items: {
            select: {
              id: true,
              folioLineItemId: true,
              folioLineItem: {
                select: {
                  id: true,
                  chargeType: true,
                  amount: true,
                  quantity: true,
                  unitPrice: true,
                },
              },
            },
          },
        },
      });

      if (!inv) {
        throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
      }
      if (inv.status !== 'draft') {
        throw Object.assign(
          new Error(`Invoice is not in draft status (was ${inv.status})`),
          { statusCode: 409 },
        );
      }

      // Map chargeType → FolioLineItem for this invoice
      const lineItemsByType = new Map<string, { id: string; amount: Prisma.Decimal }>();
      for (const item of inv.items) {
        if (item.folioLineItem) {
          lineItemsByType.set(item.folioLineItem.chargeType, {
            id:     item.folioLineItem.id,
            amount: item.folioLineItem.amount,
          });
        }
      }

      // Apply edits
      if (body.rentAmount !== undefined) {
        const li = lineItemsByType.get('ROOM');
        if (li) {
          await tx.folioLineItem.update({
            where: { id: li.id },
            data:  { amount: new Prisma.Decimal(body.rentAmount), unitPrice: new Prisma.Decimal(body.rentAmount) },
          });
          lineItemsByType.set('ROOM', { ...li, amount: new Prisma.Decimal(body.rentAmount) });
        }
      }

      if (body.waterUsage !== undefined) {
        const li = lineItemsByType.get('UTILITY_WATER');
        if (li) {
          await tx.folioLineItem.update({
            where: { id: li.id },
            data:  { amount: new Prisma.Decimal(body.waterUsage) },
          });
          lineItemsByType.set('UTILITY_WATER', { ...li, amount: new Prisma.Decimal(body.waterUsage) });
        }
      }

      if (body.electricUsage !== undefined) {
        const li = lineItemsByType.get('UTILITY_ELECTRIC');
        if (li) {
          await tx.folioLineItem.update({
            where: { id: li.id },
            data:  { amount: new Prisma.Decimal(body.electricUsage) },
          });
          lineItemsByType.set('UTILITY_ELECTRIC', { ...li, amount: new Prisma.Decimal(body.electricUsage) });
        }
      }

      // Recompute grandTotal from updated line items
      let newGrandTotal = new Prisma.Decimal(0);
      for (const [, li] of lineItemsByType) {
        newGrandTotal = newGrandTotal.add(li.amount);
      }

      // Update invoice totals + notes
      await tx.invoice.update({
        where: { id: params.id },
        data: {
          subtotal:   newGrandTotal,
          grandTotal: newGrandTotal,
          ...(body.notes !== undefined && { notes: body.notes }),
        },
      });

      return Number(newGrandTotal);
    });

    return NextResponse.json({ ok: true, newGrandTotal: result });
  } catch (err) {
    if (err instanceof Error && 'statusCode' in err) {
      const code = (err as Error & { statusCode: number }).statusCode;
      return NextResponse.json({ error: err.message }, { status: code });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    console.error('[POST /api/billing/drafts/[id]/edit]', err);
    return NextResponse.json({ error: 'ไม่สามารถแก้ไข draft ได้' }, { status: 500 });
  }
}
