import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity, extractUser } from '@/services/activityLog.service';
import path from 'path';
import fs from 'fs/promises';

// ─── PUT /api/bookings/companions/[id] ────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    firstName, lastName, firstNameTH, lastNameTH,
    phone, idType, idNumber, nationality, notes,
  } = body;

  const companion = await (prisma.bookingCompanion as any).update({
    where: { id: params.id },
    data: {
      ...(firstName   !== undefined ? { firstName }   : {}),
      ...(lastName    !== undefined ? { lastName }    : {}),
      ...(firstNameTH !== undefined ? { firstNameTH } : {}),
      ...(lastNameTH  !== undefined ? { lastNameTH }  : {}),
      ...(phone       !== undefined ? { phone }       : {}),
      ...(idType      !== undefined ? { idType }      : {}),
      ...(idNumber    !== undefined ? { idNumber }    : {}),
      ...(nationality !== undefined ? { nationality } : {}),
      ...(notes       !== undefined ? { notes }       : {}),
    },
    include: { photos: true },
  });

  return NextResponse.json(companion);
}

// ─── DELETE /api/bookings/companions/[id] ─────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get companion with photos to delete physical files
  const companion = await (prisma.bookingCompanion as any).findUnique({
    where: { id: params.id },
    include: {
      photos: true,
      booking: {
        select: { id: true, bookingNumber: true, roomId: true, room: { select: { number: true } } },
      },
    },
  });

  if (!companion) {
    return NextResponse.json({ error: 'Companion not found' }, { status: 404 });
  }

  // Delete physical photo files
  for (const photo of companion.photos) {
    try {
      const filePath = path.join(process.cwd(), 'public', photo.filename);
      await fs.unlink(filePath);
    } catch {}
  }

  // Delete companion (cascade removes photos)
  await (prisma as any).$transaction(async (tx: any) => {
    await tx.bookingCompanion.delete({ where: { id: params.id } });

    try {
      await logActivity(tx, {
        action: 'companion_removed',
        category: 'booking',
        icon: '👥',
        severity: 'warning',
        description: `ลบผู้ติดตาม "${companion.firstName} ${companion.lastName}" ห้อง ${companion.booking.room.number}`,
        bookingId: companion.bookingId,
        roomId: companion.booking.roomId,
        userId:   extractUser(session).userId ?? undefined,
        userName: extractUser(session).userName ?? undefined,
      });
    } catch {}
  });

  return NextResponse.json({ success: true });
}
