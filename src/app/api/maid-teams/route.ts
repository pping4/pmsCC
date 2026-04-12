import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const teams = await prisma.maidTeam.findMany({
      include: {
        members: {
          include: {
            maid: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(teams);
  } catch (error) {
    console.error('Error fetching maid teams:', error);
    return NextResponse.json({ error: 'Failed to fetch maid teams' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { name, memberIds } = data;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Create team and assign members
    const newTeam = await prisma.maidTeam.create({
      data: {
        name,
        members: {
          create: (memberIds || []).map((maidId: string) => ({
            maid: {
              connect: { id: maidId }
            }
          }))
        }
      },
      include: {
        members: {
          include: {
            maid: true
          }
        }
      }
    });

    return NextResponse.json(newTeam, { status: 201 });
  } catch (error) {
    console.error('Error creating maid team:', error);
    return NextResponse.json({ error: 'Failed to create maid team' }, { status: 500 });
  }
}
