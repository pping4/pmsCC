import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity, extractUser } from '@/services/activityLog.service';
import { ocrExtract } from '@/lib/ocr';
import path from 'path';
import fs from 'fs/promises';

// ─── POST /api/bookings/[id]/companions ───────────────────────────────────────
// Creates a companion with optional photos. If a photo with photoType=id_card
// or passport is uploaded, OCR will be performed to prefill data.

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bookingId = params.id;

  // Verify booking exists
  const booking = await (prisma.booking as any).findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingNumber: true,
      roomId: true,
      room: { select: { number: true } },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const formData = await request.formData();
  const firstName   = (formData.get('firstName')   as string) || '';
  const lastName    = (formData.get('lastName')    as string) || '';
  const firstNameTH = (formData.get('firstNameTH') as string) || null;
  const lastNameTH  = (formData.get('lastNameTH')  as string) || null;
  const phone       = (formData.get('phone')       as string) || null;
  const idType      = (formData.get('idType')      as string) || null;
  const idNumber    = (formData.get('idNumber')     as string) || null;
  const nationality = (formData.get('nationality')  as string) || null;
  const notes       = (formData.get('notes')       as string) || null;
  const runOcr      = formData.get('runOcr') === 'true';

  // Collect all photos
  const photoFiles: File[] = [];
  const photoTypes: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('photo_') && value instanceof File && value.size > 0) {
      photoFiles.push(value);
      // Extract photo type: photo_0_face → face, photo_1_id_card → id_card
      const parts = key.split('_');
      photoTypes.push(parts.length >= 3 ? parts.slice(2).join('_') : 'face');
    }
  }

  // OCR: if runOcr flag is set and there's an ID/passport photo, run OCR first
  let ocrResult: any = null;
  if (runOcr) {
    for (let i = 0; i < photoFiles.length; i++) {
      const pt = photoTypes[i];
      if (['id_card', 'passport', 'driving_license'].includes(pt)) {
        try {
          const buffer = Buffer.from(await photoFiles[i].arrayBuffer());
          ocrResult = await ocrExtract(buffer);
        } catch (err) {
          console.warn('[OCR] Failed:', err);
        }
        break; // only OCR first ID-type photo
      }
    }
  }

  // Merge OCR data into companion fields (manual input takes priority)
  const finalFirstName   = firstName   || ocrResult?.detected?.firstName   || 'Unknown';
  const finalLastName    = lastName    || ocrResult?.detected?.lastName    || 'Unknown';
  const finalFirstNameTH = firstNameTH || ocrResult?.detected?.firstNameTH || null;
  const finalLastNameTH  = lastNameTH  || ocrResult?.detected?.lastNameTH  || null;
  const finalIdNumber    = idNumber    || ocrResult?.detected?.idNumber    || null;
  const finalIdType      = idType      || (ocrResult?.detected?.docType !== 'unknown' ? ocrResult?.detected?.docType : null) || null;
  const finalNationality = nationality || ocrResult?.detected?.nationality || null;

  // Save photos to disk + create records
  const year = new Date().getFullYear().toString();
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'companions', year);
  await fs.mkdir(uploadDir, { recursive: true });

  // Use a transaction
  const result = await (prisma as any).$transaction(async (tx: any) => {
    // Create companion
    const companion = await tx.bookingCompanion.create({
      data: {
        bookingId,
        firstName:   finalFirstName,
        lastName:    finalLastName,
        firstNameTH: finalFirstNameTH,
        lastNameTH:  finalLastNameTH,
        phone,
        idType:      finalIdType,
        idNumber:    finalIdNumber,
        nationality: finalNationality,
        notes,
        ocrRawText:  ocrResult?.rawText || null,
      },
    });

    // Save photos
    const photoRecords = [];
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      const ext  = file.name.split('.').pop() || 'jpg';
      const filename = `${companion.id}_${i}_${Date.now()}.${ext}`;
      const filePath = path.join(uploadDir, filename);
      const buffer   = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      const photo = await tx.bookingCompanionPhoto.create({
        data: {
          companionId: companion.id,
          filename:    `/uploads/companions/${year}/${filename}`,
          photoType:   photoTypes[i] || 'face',
          size:        buffer.length,
        },
      });
      photoRecords.push(photo);
    }

    // Activity log
    try {
      await logActivity(tx, {
        action: 'companion_added',
        category: 'booking',
        icon: '👥',
        severity: 'info',
        description: `เพิ่มผู้ติดตาม "${finalFirstName} ${finalLastName}" ห้อง ${booking.room.number}`,
        bookingId,
        roomId: booking.roomId,
        userId:   extractUser(session).userId ?? undefined,
        userName: extractUser(session).userName ?? undefined,
        metadata: {
          companionId: companion.id,
          companionName: `${finalFirstName} ${finalLastName}`,
          photoCount: photoRecords.length,
          ocrUsed: !!ocrResult,
          ocrDocType: ocrResult?.detected?.docType || null,
        },
      });
    } catch {}

    return { ...companion, photos: photoRecords };
  });

  return NextResponse.json({
    companion: result,
    ocr: ocrResult
      ? {
          confidence: ocrResult.confidence,
          detected:   ocrResult.detected,
        }
      : null,
  });
}

// ─── GET /api/bookings/[id]/companions ────────────────────────────────────────
// List all companions for a booking

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companions = await (prisma.bookingCompanion as any).findMany({
    where: { bookingId: params.id },
    include: {
      photos: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(companions);
}
