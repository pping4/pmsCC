import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get payouts (completed tasks that are not yet paid)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    // Default filters
    const dateFilter: any = {};
    if (startDateStr && endDateStr) {
      dateFilter.completedAt = {
        gte: new Date(startDateStr),
        lte: new Date(endDateStr)
      };
    }

    // Find completed tasks
    const completedTasks = await prisma.housekeepingTask.findMany({
      where: {
        status: 'completed',
        maidTeamId: { not: null },
        ...dateFilter
      },
      include: {
        maidTeam: {
          include: {
            members: {
              include: { maid: true }
            }
          }
        },
        room: true
      }
    });

    // Group by team
    const teamPayoutsMap = new Map();

    for (const task of completedTasks) {
      const teamId = task.maidTeam!.id;
      if (!teamPayoutsMap.has(teamId)) {
        teamPayoutsMap.set(teamId, {
          teamId,
          teamName: task.maidTeam!.name,
          members: task.maidTeam!.members.map(m => m.maid),
          totalEarned: 0,
          taskCount: 0,
          tasks: []
        });
      }
      
      const teamData = teamPayoutsMap.get(teamId);
      teamData.totalEarned += Number(task.payoutAmount || 0);
      teamData.taskCount += 1;
      teamData.tasks.push({
        id: task.id,
        roomNumber: task.room.number,
        completedAt: task.completedAt,
        amount: Number(task.payoutAmount || 0)
      });
    }

    return NextResponse.json(Array.from(teamPayoutsMap.values()));
  } catch (error) {
    console.error('Error calculating payouts:', error);
    return NextResponse.json({ error: 'Failed to calculate payouts' }, { status: 500 });
  }
}

// Record a payment
export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { maidId, amount, notes } = data;

    if (!maidId || !amount) {
      return NextResponse.json({ error: 'Maid ID and Amount are required' }, { status: 400 });
    }

    const payout = await prisma.maidPayout.create({
      data: {
        maidId,
        amount: parseFloat(amount),
        payDate: new Date(),
        status: 'paid',
        notes
      }
    });

    return NextResponse.json(payout, { status: 201 });
  } catch (error) {
    console.error('Error processing payout:', error);
    return NextResponse.json({ error: 'Failed to process payout' }, { status: 500 });
  }
}
