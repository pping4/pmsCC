import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// ─── GET /api/inspection?roomId=xxx&limit=50 ──────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');
  const limitStr = searchParams.get('limit');
  const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 30;

  if (!roomId) {
    return NextResponse.json({ error: 'กรุณาระบุ roomId' }, { status: 400 });
  }

  try {
    const inspections = await prisma.roomInspection.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        photos: {
          select: { id: true, filename: true, size: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return NextResponse.json({ inspections });
  } catch (error) {
    console.error('GET /api/inspection error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
  }
}

// ─── POST /api/inspection — Create inspection with photo upload ────────────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const roomId = formData.get('roomId') as string;
    const inspectorName = (formData.get('inspectorName') as string)?.trim();
    const remark = (formData.get('remark') as string)?.trim() || null;

    if (!roomId || !inspectorName) {
      return NextResponse.json({ error: 'กรุณาระบุ roomId และชื่อผู้ตรวจ' }, { status: 400 });
    }

    // Validate room exists
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, number: true },
    });
    if (!room) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลห้อง' }, { status: 404 });
    }

    // Collect photo files from formData
    const photoFiles: File[] = [];
    const entries = formData.getAll('photos');
    for (const entry of entries) {
      if (entry instanceof File && entry.size > 0) {
        // Validate: only images, max 5MB each
        if (!entry.type.startsWith('image/')) continue;
        if (entry.size > 5 * 1024 * 1024) continue;
        photoFiles.push(entry);
      }
    }

    // Create year-based upload directory
    const year = new Date().getFullYear().toString();
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'inspection', year);
    await mkdir(uploadDir, { recursive: true });

    // Save photos to disk & prepare DB records
    const photoRecords: { filename: string; size: number }[] = [];
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const uniqueName = `insp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const dbFilename = `${year}/${uniqueName}`;
      const filePath = path.join(uploadDir, uniqueName);

      await writeFile(filePath, buffer);
      photoRecords.push({ filename: dbFilename, size: buffer.length });
    }

    // Atomic create: inspection + photos
    const inspection = await prisma.$transaction(async (tx) => {
      const created = await tx.roomInspection.create({
        data: {
          roomId,
          inspectorName,
          remark,
          photos: {
            create: photoRecords.map((p) => ({
              filename: p.filename,
              size: p.size,
            })),
          },
        },
        include: {
          photos: { select: { id: true, filename: true, size: true, createdAt: true } },
        },
      });

      await logActivity(tx, {
        session,
        action: 'inspection.created',
        category: 'room',
        description: `ตรวจสภาพ ห้อง ${room.number} — ${inspectorName} (${photoRecords.length} รูป)`,
        roomId,
        icon: '🔍',
        severity: 'info',
        metadata: {
          inspectionId: created.id,
          roomNumber: room.number,
          inspectorName,
          photoCount: photoRecords.length,
          remark,
        },
      });

      return created;
    });

    return NextResponse.json({ success: true, inspection });
  } catch (error) {
    console.error('POST /api/inspection error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการบันทึก' }, { status: 500 });
  }
}
