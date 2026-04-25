/**
 * POST /api/contracts/[id]/renewal/execute  (T16 — Sprint 3B)
 *
 * Single-contract renewal execution. Wraps `executeRenewal` in a
 * `prisma.$transaction` so folio postings + invoice creation are atomic.
 *
 * Idempotency: handled *inside* the service via the
 * `FolioLineItem.referenceType='contract_renewal'` marker keyed by
 * `{contractId}:{periodStart YYYY-MM-DD}`. A retry of the same call
 * returns the pre-existing folio/invoice with `reused=true` — no header
 * plumbing required at the route layer.
 *
 * RBAC: admin / manager only (writes money → staff excluded).
 *
 * Error map:
 *   401 — no session
 *   403 — wrong role
 *   400 — Zod validation failure
 *   404 — CONTRACT_NOT_FOUND
 *   409 — CONTRACT_NOT_RENEWABLE | CONTRACT_NOT_ACTIVE | INVALID_PERIOD
 *   503 — Prisma P2034 serialization failure (client should retry)
 *   500 — unexpected
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import {
  executeRenewal,
  RenewalError,
} from '@/services/renewal.service';
import { logActivity } from '@/services/activityLog.service';

const RENEWABLE_STATUSES = ['active', 'expired'] as const;

const UtilityTripletSchema = z.object({
  prev: z.number().min(0).max(10_000_000),
  curr: z.number().min(0).max(10_000_000),
  rate: z.number().min(0).max(100_000),
});

const OtherChargeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(100_000_000),
});

const ExecuteBody = z.object({
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1),
  utilityReadingId: z.string().trim().min(1).nullable().optional(),
  utilityManual: z
    .object({
      water: UtilityTripletSchema.optional(),
      electric: UtilityTripletSchema.optional(),
    })
    .optional(),
  otherCharges: z.array(OtherChargeSchema).max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Money-moving endpoint → admin/manager only.
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const raw = await request.json();
    const body = ExecuteBody.parse(raw);

    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      return NextResponse.json(
        { error: 'รูปแบบวันที่ไม่ถูกต้อง', code: 'INVALID_DATE' },
        { status: 400 },
      );
    }
    if (!(periodEnd > periodStart)) {
      return NextResponse.json(
        { error: 'วันสิ้นสุดงวดต้องอยู่หลังวันเริ่มต้น', code: 'INVALID_PERIOD' },
        { status: 409 },
      );
    }

    // Pre-flight status gate: 404 vs 409 clarity before opening the tx.
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        contractNumber: true,
      },
    });
    if (!contract) {
      return NextResponse.json(
        { error: 'ไม่พบสัญญา', code: 'CONTRACT_NOT_FOUND' },
        { status: 404 },
      );
    }
    if (
      !RENEWABLE_STATUSES.includes(
        contract.status as (typeof RENEWABLE_STATUSES)[number],
      )
    ) {
      return NextResponse.json(
        {
          error: `ไม่สามารถต่อสัญญา: สถานะปัจจุบันคือ ${contract.status}`,
          code: 'CONTRACT_NOT_RENEWABLE',
        },
        { status: 409 },
      );
    }

    const userRef = getUserRef(session);

    const result = await prisma.$transaction(async (tx) => {
      const res = await executeRenewal(tx, {
        contractId: params.id,
        periodStart,
        periodEnd,
        utilityReadingId: body.utilityReadingId ?? null,
        utilityManual: body.utilityManual,
        otherCharges: body.otherCharges,
        userRef,
        notes: body.notes,
      });

      // Only log the first-time post; idempotent reuse is noise.
      if (!res.reused) {
        await logActivity(tx, {
          session,
          action: 'contract.renew',
          // `LogCategory` enum has no 'contract' value (as of activityLog.service.ts);
          // the renewal's primary durable artifact is an MN invoice, so log under 'invoice'.
          category: 'invoice',
          description: `ต่อสัญญา ${contract.contractNumber} (${body.periodStart} → ${body.periodEnd}) — ฿${res.total.toFixed(2)}`,
          icon: '📄',
          severity: 'info',
          metadata: {
            contractId: params.id,
            folioId: res.folioId,
            invoiceId: res.invoiceId,
            lineItemIds: res.lineItemIds,
            total: res.total,
            periodStart: body.periodStart,
            periodEnd: body.periodEnd,
          },
        });
      }
      return res;
    });

    return NextResponse.json({
      ok: true,
      folioId: result.folioId,
      invoiceId: result.invoiceId,
      lineItemIds: result.lineItemIds,
      total: result.total,
      reused: result.reused,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'ข้อมูลไม่ถูกต้อง',
          details: err.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    }
    if (err instanceof RenewalError) {
      const status = err.code === 'CONTRACT_NOT_FOUND' ? 404 : 409;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2034'
    ) {
      // Serialization/write conflict — caller should retry.
      return NextResponse.json(
        {
          error: 'ระบบไม่ว่าง กรุณาลองใหม่อีกครั้ง',
          code: 'RETRY',
        },
        { status: 503, headers: { 'Retry-After': '1' } },
      );
    }
    console.error('[/api/contracts/:id/renewal/execute POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถต่อสัญญาได้' },
      { status: 500 },
    );
  }
}
