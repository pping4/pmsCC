/**
 * GET  /api/ota/statements        — list (auth)
 * POST /api/ota/statements        — upload CSV, create statement (admin/accountant)
 *   body: { agentId, periodStart, periodEnd, csv }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import { parseStatementCsv, ingestStatement } from '@/services/otaStatement.service';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await prisma.otaStatement.findMany({
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true, periodStart: true, periodEnd: true, totalGross: true,
      totalCommission: true, netPayable: true, status: true, uploadedAt: true,
      agent: { select: { id: true, code: true, name: true } },
      _count: { select: { lines: true } },
    },
    take: 100,
  });
  return NextResponse.json(rows);
}

const Body = z.object({
  agentId:     z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  csv:         z.string().min(1),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session as { user?: { role?: string; email?: string | null } }).user?.role ?? '';
  if (!['admin', 'accountant'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { lines, errors } = parseStatementCsv(input.csv);
  if (lines.length === 0) {
    return NextResponse.json({ error: 'CSV parse failed', errors }, { status: 422 });
  }

  const uploadedBy = (session as { user?: { email?: string | null } }).user?.email ?? 'system';
  const result = await prisma.$transaction(tx => ingestStatement(tx, {
    agentId:     input.agentId,
    periodStart: new Date(input.periodStart),
    periodEnd:   new Date(input.periodEnd),
    lines,
    uploadedBy,
  }));

  return NextResponse.json({ statementId: result.statementId, totals: result.totals, parseErrors: errors, lineCount: lines.length });
}
