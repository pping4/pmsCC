import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { floor, evenOdd, maidTeamId, date, payoutAmount } = data;

    if (!maidTeamId) {
      return NextResponse.json({ error: 'Team ID is required' }, { status: 400 });
    }

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    // Convert date string to Date object
    const targetDate = new Date(date);
    
    // Fetch all rooms matching the floor criteria
    const roomFilters: any = {};
    if (floor !== 'all') {
      roomFilters.floor = parseInt(floor);
    }

    const rooms = await prisma.room.findMany({
      where: roomFilters
    });

    // Filter by even/odd numbers as strings (e.g., "101" -> 101, odd)
    const filteredRooms = rooms.filter(room => {
      // Basic extraction of numbers, e.g., "101A" -> 101
      const numMatch = room.number.match(/\d+/);
      if (!numMatch) return false;
      
      const num = parseInt(numMatch[0]);
      if (evenOdd === 'even') return num % 2 === 0;
      if (evenOdd === 'odd') return num % 2 !== 0;
      return true; // 'all'
    });

    if (filteredRooms.length === 0) {
      return NextResponse.json({ message: 'No rooms found for criteria', assignedCount: 0 });
    }

    // Look for existing tasks on this date and create if they don't exist
    // For simplicity, we create a task for each room
    let assignedCount = 0;
    for (const room of filteredRooms) {
      // Find if task already exists for this room on this date
      const existingTask = await prisma.housekeepingTask.findFirst({
        where: {
          roomId: room.id,
          scheduledAt: targetDate
        }
      });

      if (existingTask) {
        // Update existing task team
        await prisma.housekeepingTask.update({
          where: { id: existingTask.id },
          data: {
            maidTeamId,
            payoutAmount: payoutAmount ? parseFloat(payoutAmount) : existingTask.payoutAmount
          }
        });
      } else {
        // Create new task
        await prisma.housekeepingTask.create({
          data: {
            taskNumber: `HK-${Date.now()}-${room.number}`,
            roomId: room.id,
            taskType: 'daily_cleaning',
            maidTeamId,
            status: 'pending',
            scheduledAt: targetDate,
            payoutAmount: payoutAmount ? parseFloat(payoutAmount) : 0
          }
        });
      }
      assignedCount++;
    }

    return NextResponse.json({ 
      message: `Successfully assigned ${assignedCount} tasks`,
      assignedCount
    });

  } catch (error) {
    console.error('Error during bulk assign:', error);
    return NextResponse.json({ error: 'Failed to bulk assign tasks' }, { status: 500 });
  }
}
