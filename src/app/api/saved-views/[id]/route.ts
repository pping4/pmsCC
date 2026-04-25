/**
 * /api/saved-views/[id]
 *
 * DELETE — remove a saved view (owner only; 403 otherwise)
 * PATCH  — update name / shared / query (owner only)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const UpdateSchema = z.object({
  name:   z.string().min(1).max(80).trim().optional(),
  query:  z.string().max(2000).optional(),
  shared: z.boolean().optional(),
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const view = await prisma.savedView.findUnique({
    where:  { id: params.id },
    select: { userId: true },
  });
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (view.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.savedView.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.savedView.findUnique({
    where:  { id: params.id },
    select: { userId: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const updated = await prisma.savedView.update({
    where: { id: params.id },
    data:  parsed.data,
    select: {
      id: true, tableKey: true, name: true, query: true, shared: true,
      userId: true, createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json({ view: { ...updated, isOwner: true } });
}
