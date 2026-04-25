/**
 * POST /api/contracts/[id]/renewal/preview  (T16 — Sprint 3B)
 *
 * Read-only renewal preview for a single contract. POST is used (not GET)
 * because callers may pass an optional utility override body (e.g. when no
 * UtilityReading has been recorded for the month yet and the front-desk
 * staff are typing meter numbers directly).
 *
 * RBAC: admin / manager / staff  (read-oriented → staff allowed).
 * No writes — does NOT need a Prisma `$transaction`.
 *
 * Response: `RenewalPreview` shape from `renewal.service.ts`.
 *
 * Error map:
 *   401 — no session
 *   403 — wrong role
 *   400 — Zod validation failure
 *   404 — CONTRACT_NOT_FOUND
 *   409 — CONTRACT_NOT_RENEWABLE (status not in active|expired)
 *   500 — unexpected
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import {
  previewRenewal,
  RenewalError,
  type PreviewOptions,
} from '@/services/renewal.service';

const RENEWABLE_STATUSES = ['active', 'expired'] as const;

const UtilitySideSchema = z.object({
  prev: z.number().min(0).max(10_000_000),
  curr: z.number().min(0).max(10_000_000),
  rate: z.number().min(0).max(100_000).optional(),
});

const PreviewBody = z.object({
  periodStart: z.string().trim().min(1).optional(),
  includeUtilities: z.boolean().optional(),
  utilityOverride: z
    .object({
      water: UtilitySideSchema.optional(),
      electric: UtilitySideSchema.optional(),
    })
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  try {
    // Body is optional for this endpoint — accept empty body gracefully.
    let raw: unknown = {};
    try {
      const text = await request.text();
      raw = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง (JSON ผิดรูป)' },
        { status: 400 },
      );
    }
    const body = PreviewBody.parse(raw);

    // Status gate — read only the minimal column we need for 404/409 mapping.
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
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

    const opts: PreviewOptions = {
      periodStart: body.periodStart ? new Date(body.periodStart) : undefined,
      includeUtilities: body.includeUtilities,
      utilityOverride: body.utilityOverride,
    };

    const preview = await previewRenewal(prisma, params.id, opts);
    return NextResponse.json(preview);
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
    console.error('[/api/contracts/:id/renewal/preview POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถสร้างตัวอย่างการต่อสัญญาได้' },
      { status: 500 },
    );
  }
}
