/**
 * GET /api/contracts/[id]/prepare-sign
 *
 * Server-side helper used by the contract sign wizard. Builds the
 * render context from Prisma + HotelSettings, renders the full HTML
 * document via `renderContractDocument` (React → static markup), and
 * returns `{ renderedHtml, renderedVariables }`.
 *
 * The wizard then POSTs those values to `/api/contracts/[id]/sign`,
 * where the transition service snapshots them atomically. This split
 * lets us keep the legacy sign POST contract stable (body still
 * accepts arbitrary HTML) while moving the actual templating off the
 * client and out of its trust boundary.
 *
 * Security:
 *   - Admin / manager only (same gate as the sign POST).
 *   - Read-only — no Prisma writes.
 *   - Response includes guest PII embedded in the rendered HTML, so
 *     the route is gated to the same roles allowed to sign.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { assembleRenderContextById } from '@/lib/contract/assembleContext';
import {
  renderContractDocument,
  type ContractLanguageCode,
} from '@/lib/contract/renderContract';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const assembled = await assembleRenderContextById(prisma, params.id);
    if (!assembled) {
      return NextResponse.json({ error: 'ไม่พบสัญญา' }, { status: 404 });
    }

    const { contract, ctx } = assembled;

    // Only drafts should ever be prepared for signing — but we don't
    // enforce status here, so the sign POST route remains the single
    // source of truth for the draft→active transition (it holds the
    // row-level lock).
    const language: ContractLanguageCode =
      (contract.language as ContractLanguageCode) === 'en' ? 'en' : 'th';

    const renderedHtml = renderContractDocument(ctx, language);

    return NextResponse.json({
      renderedHtml,
      // `ctx` is JSON-safe (Dates serialise to ISO strings, Decimals
      // already coerced to numbers by assembleRenderContextById).
      renderedVariables: ctx,
    });
  } catch (err) {
    console.error('[/api/contracts/:id/prepare-sign GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถเตรียมเอกสารสัญญาได้' },
      { status: 500 },
    );
  }
}
