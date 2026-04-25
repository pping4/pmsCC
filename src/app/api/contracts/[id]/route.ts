/**
 * /api/contracts/[id]
 *   GET    — full detail with relations
 *   PATCH  — update draft (draft-only; 409 otherwise)
 *   DELETE — delete draft (draft-only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import {
  ContractValidationError,
  deleteDraft,
  getContractById,
  updateDraft,
  type LateFeeTier,
} from '@/services/contract.service';
import {
  BillingCycle,
  ContractLanguage,
  TerminationRule,
} from '@prisma/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const contract = await getContractById(prisma, params.id);
    if (!contract) {
      return NextResponse.json({ error: 'ไม่พบสัญญา' }, { status: 404 });
    }
    return NextResponse.json(contract);
  } catch (err) {
    console.error('[/api/contracts/:id GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดสัญญาได้' },
      { status: 500 },
    );
  }
}

// ─── PATCH ──────────────────────────────────────────────────────────────────

const LateFeeTierSchema = z.object({
  afterDay: z.number().int().min(0).max(365),
  amountPerDay: z.number().min(0).max(100_000),
});

const UpdateBody = z
  .object({
    language: z.nativeEnum(ContractLanguage).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    durationMonths: z.number().int().min(1).max(120).optional(),
    billingCycle: z.nativeEnum(BillingCycle).optional(),
    paymentDueDayStart: z.number().int().min(1).max(31).optional(),
    paymentDueDayEnd: z.number().int().min(1).max(31).optional(),

    monthlyRoomRent: z.number().positive().max(10_000_000).optional(),
    monthlyFurnitureRent: z.number().min(0).max(10_000_000).optional(),
    electricRate: z.number().min(0).max(1_000).optional(),
    waterRateMin: z.number().min(0).max(100_000).optional(),
    waterRateExcess: z.number().min(0).max(1_000).optional(),
    phoneRate: z.number().min(0).max(10_000).nullable().optional(),

    securityDeposit: z.number().min(0).max(100_000_000).optional(),
    keyFrontDeposit: z.number().min(0).max(100_000).optional(),
    keyLockDeposit: z.number().min(0).max(100_000).optional(),
    keycardDeposit: z.number().min(0).max(100_000).optional(),
    keycardServiceFee: z.number().min(0).max(100_000).optional(),

    parkingStickerFee: z.number().min(0).max(1_000_000).nullable().optional(),
    parkingMonthly: z.number().min(0).max(1_000_000).nullable().optional(),

    lockInMonths: z.number().int().min(0).max(120).optional(),
    noticePeriodDays: z.number().int().min(0).max(365).optional(),
    earlyTerminationRule: z.nativeEnum(TerminationRule).optional(),
    earlyTerminationPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .nullable()
      .optional(),

    lateFeeSchedule: z.array(LateFeeTierSchema).max(10).optional(),
    checkoutCleaningFee: z.number().min(0).max(100_000).optional(),
  })
  .strict();

export async function PATCH(
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
    const raw = await request.json();
    const body = UpdateBody.parse(raw);

    await prisma.$transaction((tx) =>
      updateDraft(tx, params.id, {
        ...body,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        lateFeeSchedule: body.lateFeeSchedule as
          | LateFeeTier[]
          | undefined,
      }),
    );

    return NextResponse.json({ ok: true });
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
    if (err instanceof ContractValidationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    console.error('[/api/contracts/:id PATCH]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถแก้ไขสัญญาได้' },
      { status: 500 },
    );
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  try {
    await prisma.$transaction((tx) => deleteDraft(tx, params.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ContractValidationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    console.error('[/api/contracts/:id DELETE]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถลบสัญญาได้' },
      { status: 500 },
    );
  }
}
