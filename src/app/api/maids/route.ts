import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const maids = await prisma.maid.findMany({
      include: {
        teams: {
          include: {
            team: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(maids);
  } catch (error) {
    console.error('Error fetching maids:', error);
    return NextResponse.json({ error: 'Failed to fetch maids' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { name, phone, active } = data;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const newMaid = await prisma.maid.create({
      data: {
        name,
        phone,
        active: active ?? true
      }
    });

    return NextResponse.json(newMaid, { status: 201 });
  } catch (error) {
    console.error('Error creating maid:', error);
    return NextResponse.json({ error: 'Failed to create maid' }, { status: 500 });
  }
}
