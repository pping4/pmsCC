/**
 * /api/saved-views
 *
 * GET  ?tableKey=<key>   → list current user's views + shared views for this table
 * POST { tableKey, name, query, shared? } → create a saved view
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - `tableKey` is user-supplied but it's a display-only label; we validate
 *     shape (≤64 chars, letters/digits/.,_,-) to prevent abuse of the index.
 *   - `query` is an opaque string we just round-trip; we cap its length.
 *   - Only the owner sees their unshared views; shared views are visible to
 *     any authenticated user.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const TableKeySchema = z.string().min(1).max(64).regex(/^[\w.\-]+$/, 'invalid tableKey');

const CreateSchema = z.object({
  tableKey: TableKeySchema,
  name:     z.string().min(1).max(80).trim(),
  query:    z.string().max(2000),
  shared:   z.boolean().optional().default(false),
});

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const rawTableKey = searchParams.get('tableKey');
  const parsed = TableKeySchema.safeParse(rawTableKey);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid tableKey' }, { status: 400 });

  const views = await prisma.savedView.findMany({
    where: {
      tableKey: parsed.data,
      OR: [
        { userId },
        { shared: true },
      ],
    },
    select: {
      id: true, tableKey: true, name: true, query: true, shared: true,
      userId: true, createdAt: true, updatedAt: true,
    },
    orderBy: [{ shared: 'asc' }, { name: 'asc' }],
  });

  // Annotate with whether the current user owns each view (for UI edit/delete).
  const annotated = views.map(v => ({
    ...v,
    isOwner: v.userId === userId,
  }));

  return NextResponse.json({ views: annotated });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  const view = await prisma.savedView.create({
    data: {
      userId,
      tableKey: parsed.data.tableKey,
      name:     parsed.data.name,
      query:    parsed.data.query,
      shared:   parsed.data.shared,
    },
    select: {
      id: true, tableKey: true, name: true, query: true, shared: true,
      userId: true, createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json({ view: { ...view, isOwner: true } }, { status: 201 });
}
