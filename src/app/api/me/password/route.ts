/**
 * POST /api/me/password
 * ---------------------
 * Self-service password change. Any authenticated user may call this.
 * Verifies `currentPassword` before setting `newPassword`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import {
  changeOwnPassword,
  InvalidCurrentPasswordError,
  UserNotFoundError,
  WeakPasswordError,
} from '@/services/user.service';

const Body = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { currentPassword, newPassword } = Body.parse(await req.json());
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' },
        { status: 400 },
      );
    }
    await changeOwnPassword(userId, currentPassword, newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof InvalidCurrentPasswordError) {
      return NextResponse.json(
        { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง', code: err.code },
        { status: 400 },
      );
    }
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้', code: err.code }, { status: 404 });
    }
    if (err instanceof WeakPasswordError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('[/api/me/password POST]', err);
    return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนรหัสผ่านได้' }, { status: 500 });
  }
}
