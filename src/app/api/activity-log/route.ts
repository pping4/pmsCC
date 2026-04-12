import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('bookingId') ?? undefined;
  const roomId    = searchParams.get('roomId')    ?? undefined;
  const guestId   = searchParams.get('guestId')   ?? undefined;
  const category  = searchParams.get('category')  ?? undefined;
  const limitStr  = searchParams.get('limit');
  const limit     = limitStr ? Math.min(parseInt(limitStr, 10), 200) : 50;

  // At least one filter must be provided to prevent full-table scans
  if (!bookingId && !roomId && !guestId && !category) {
    return NextResponse.json(
      { error: 'กรุณาระบุ bookingId, roomId, guestId หรือ category' },
      { status: 400 }
    );
  }

  try {
    const logs = await prisma.activityLog.findMany({
      where: {
        ...(bookingId ? { bookingId } : {}),
        ...(roomId    ? { roomId    } : {}),
        ...(guestId   ? { guestId   } : {}),
        ...(category  ? { category  } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id:          true,
        userId:      true,
        userName:    true,
        createdAt:   true,
        action:      true,
        category:    true,
        bookingId:   true,
        roomId:      true,
        guestId:     true,
        invoiceId:   true,
        description: true,
        metadata:    true,
        icon:        true,
        severity:    true,
      },
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('GET /api/activity-log error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, { status: 500 });
  }
}
