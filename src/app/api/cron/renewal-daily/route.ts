/**
 * GET /api/cron/renewal-daily
 *
 * External-scheduler entry point for the daily renewal sweep (Sprint 3B / T20).
 *
 * Auth: bearer-token check against `process.env.CRON_SECRET`. A missing or
 * mismatching token returns 401 with no information leaked. The token is
 * compared with a timing-safe check to resist side-channel probing.
 *
 * Invocation shape (e.g. Vercel Cron, external scheduler, curl):
 *
 *   GET /api/cron/renewal-daily
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Returns the bulk-renewal result verbatim (same shape as
 * /api/contracts/renewal/bulk). Intended to run at 06:00 local time.
 *
 * Design notes:
 *   - No NextAuth session — this endpoint is machine-to-machine.
 *   - 200 on success even with partial failures (the result body describes
 *     per-contract outcomes). 5xx only for catastrophic errors (DB down etc.).
 *   - The underlying `runDailyRenewalJob` is idempotent per (contractId,
 *     periodStart); a double-fire from an over-eager scheduler is safe.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runDailyRenewalJob } from '@/jobs/renewal-daily';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function verifyCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // Refuse to run without a configured secret.

  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return constantTimeEqual(match[1].trim(), expected);
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDailyRenewalJob(new Date());
    return NextResponse.json(
      {
        ok: true,
        ranAt: new Date().toISOString(),
        processed: result.processed,
        succeededCount: result.succeeded.length,
        failedCount: result.failed.length,
        skippedCount: result.skipped.length,
        succeeded: result.succeeded,
        failed: result.failed,
        skipped: result.skipped,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[cron.renewal-daily]', err);
    return NextResponse.json(
      { error: 'Renewal job failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
