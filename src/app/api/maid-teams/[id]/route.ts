import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const team = await prisma.maidTeam.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            maid: true
          }
        }
      }
    });

    if (!team) {
      return NextResponse.json({ error: 'Maid team not found' }, { status: 404 });
    }

    return NextResponse.json(team);
  } catch (error) {
    console.error('Error fetching maid team:', error);
    return NextResponse.json({ error: 'Failed to fetch maid team' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const data = await request.json();
    const { name, memberIds } = data;

    // First update the name
    await prisma.maidTeam.update({
      where: { id },
      data: { name }
    });

    // Handle members update if provided
    if (memberIds !== undefined) {
      // Delete existing members
      await prisma.maidTeamMember.deleteMany({
        where: { maidTeamId: id }
      });

      // Add new members
      if (memberIds.length > 0) {
        await prisma.maidTeamMember.createMany({
          data: memberIds.map((maidId: string) => ({
            maidTeamId: id,
            maidId
          }))
        });
      }
    }

    // Fetch the updated team
    const updatedTeam = await prisma.maidTeam.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            maid: true
          }
        }
      }
    });

    return NextResponse.json(updatedTeam);
  } catch (error) {
    console.error('Error updating maid team:', error);
    return NextResponse.json({ error: 'Failed to update maid team' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    await prisma.maidTeam.delete({
      where: { id }
    });
    return NextResponse.json({ message: 'Maid team deleted successfully' });
  } catch (error) {
    console.error('Error deleting maid team:', error);
    return NextResponse.json({ error: 'Failed to delete maid team' }, { status: 500 });
  }
}
