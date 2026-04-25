/**
 * /api/contracts/renewal/bulk
 *
 * Sprint 3B Phase I — T17. Exposes the bulk renewal engine shipped in T15
 * (`runBulkRenewal` in `src/services/renewal.service.ts`) to operators.
 *
 * Endpoints:
 *   GET  — dry-run preview (staff / manager / admin).
 *          Returns the set of contracts that WOULD renew today, without
 *          mutating anything. Used by the T20 BulkRenewalDialog to show
 *          "N contracts due for renewal".
 *   POST — execute bulk renewal (manager / admin only).
 *          Bulk operations are sensitive — staff are deliberately excluded.
 *
 * Architecture notes:
 *   - The service itself opens a SEPARATE `$transaction` per contract, so a
 *     single failure does not roll back the whole batch. We therefore DO NOT
 *     wrap the call in an outer transaction — partial success is the norm.
 *   - Activity logging uses `prisma` directly (not a tx) because the service
 *     call is not transactional at the batch level. Severity escalates to
 *     `warning` when any contract failed.
 *   - We return the service result verbatim, prefixed with `{ ok, dryRun }`
 *     so clients can distinguish preview vs. real runs from the envelope.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import { runBulkRenewal } from '@/services/renewal.service';
import { logActivity } from '@/services/activityLog.service';

// ─── Zod schema ────────────────────────────────────────────────────────────

const BulkRenewalBody = z.object({
  /** ISO date (YYYY-MM-DD or full ISO). Defaults to today server-side. */
  asOfDate: z
    .string()
    .trim()
    .min(1)
    .optional(),
  /** If true, no writes occur — preview only. */
  dryRun: z.boolean().optional(),
});

function parseAsOfDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ZodError([
      {
        code: 'custom',
        path: ['asOfDate'],
        message: 'รูปแบบวันที่ไม่ถูกต้อง',
      },
    ]);
  }
  return d;
}

// ─── GET — dry-run preview ─────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Staff may READ the preview — gating for execution happens in POST.
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  try {
    const userRef = getUserRef(session);
    const result = await runBulkRenewal(prisma, {
      asOfDate: new Date(),
      dryRun: true,
      userRef,
    });

    return NextResponse.json({
      ok: true,
      dryRun: true,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[/api/contracts/renewal/bulk GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถแสดงสัญญาที่ครบกำหนดต่ออายุได้' },
      { status: 500 },
    );
  }
}

// ─── POST — execute (or dry-run) bulk renewal ──────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Execution is manager/admin only — staff are explicitly excluded.
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const raw = await request.json().catch(() => ({}));
    const body = BulkRenewalBody.parse(raw);
    const asOfDate = parseAsOfDate(body.asOfDate);
    const dryRun = body.dryRun ?? false;

    const userRef = getUserRef(session);

    const result = await runBulkRenewal(prisma, {
      asOfDate,
      dryRun,
      userRef,
    });

    // Audit log (only for real runs — a dry-run preview isn't worth logging).
    if (!dryRun) {
      const failedCount = result.failed.length;
      const succeededCount = result.succeeded.length;
      const skippedCount = result.skipped.length;
      await logActivity(prisma, {
        session,
        action: 'contract.renewal.bulk',
        category: 'invoice',
        description:
          `ต่ออายุสัญญาแบบกลุ่ม — สำเร็จ ${succeededCount} / ล้มเหลว ${failedCount} / ข้าม ${skippedCount}`,
        severity: failedCount > 0 ? 'warning' : 'info',
        metadata: {
          processed: result.processed,
          succeededCount,
          failedCount,
          skippedCount,
          dryRun,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues },
        { status: 400 },
      );
    }
    console.error('[/api/contracts/renewal/bulk POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถต่ออายุสัญญาแบบกลุ่มได้' },
      { status: 500 },
    );
  }
}
