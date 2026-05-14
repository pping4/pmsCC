/**
 * POST /api/cron/billing-draft
 *
 * Machine-to-machine endpoint for the daily monthly-draft generation cron.
 * No NextAuth session — authenticated via bearer token instead.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *   - Compared with timing-safe equality to resist side-channel probing.
 *   - Returns 401 with no detail on mismatch.
 *
 * TODO: wire into render.yaml / railway.toml schedule (02:00 daily, UTC+7):
 *   # render.yaml example
 *   crons:
 *     - type: cron
 *       name: billing-draft-generation
 *       command: curl -X POST $RENDER_EXTERNAL_URL/api/cron/billing-draft \
 *                    -H "Authorization: Bearer $CRON_SECRET"
 *       schedule: "0 19 * * *"   # 02:00 ICT = 19:00 UTC
 *
 * Returns 200 on success (even with partial per-booking errors — the response
 * body describes per-booking outcomes). 5xx only for catastrophic failures.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { runBillingDraftsDaily } from '@/jobs/billing-drafts-daily';

// ─── Bearer-token guard ───────────────────────────────────────────────────────

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
  if (!expected) return false; // refuse to run without configured secret
  const header = req.headers.get('authorization') ?? '';
  const match  = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return constantTimeEqual(match[1].trim(), expected);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runBillingDraftsDaily(new Date());

    return NextResponse.json(
      {
        ok:             true,
        ranAt:          new Date().toISOString(),
        processed:      result.processed,
        generatedCount: result.generated.length,
        skippedCount:   result.skipped.length,
        errorCount:     result.errors.length,
        generated:      result.generated,
        skipped:        result.skipped,
        errors:         result.errors,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[cron.billing-draft]', err);
    return NextResponse.json(
      { error: 'Billing draft generation failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
