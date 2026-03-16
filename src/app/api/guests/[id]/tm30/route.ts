import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guest = await prisma.guest.update({
    where: { id: params.id },
    data: {
      tm30Reported: true,
      tm30ReportDate: new Date(),
    },
  });

  return NextResponse.json(guest);
}
