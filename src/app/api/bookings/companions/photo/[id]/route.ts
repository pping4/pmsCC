import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import path from 'path';
import fs from 'fs/promises';

// ─── DELETE /api/bookings/companions/photo/[id] ───────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const photo = await (prisma.bookingCompanionPhoto as any).findUnique({
    where: { id: params.id },
  });

  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  // Delete physical file
  try {
    const filePath = path.join(process.cwd(), 'public', photo.filename);
    await fs.unlink(filePath);
  } catch {}

  // Delete DB record
  await (prisma.bookingCompanionPhoto as any).delete({
    where: { id: params.id },
  });

  return NextResponse.json({ success: true });
}
