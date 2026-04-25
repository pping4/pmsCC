/**
 * POST /api/admin/users/[id]/password
 * -----------------------------------
 * Admin-only password reset. Requires `admin.manage_users`. Does NOT
 * require the old password (that's the point — admin is overriding
 * a forgotten password).
 *
 * Body: { newPassword: string }  — min 8 chars
 *
 * Q7 note: Q7 answer was (b) "user ใช้ได้เลย" — after reset the user can
 * log in immediately; no forced change flag.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac/requirePermission';
import {
  setPassword,
  UserNotFoundError,
  WeakPasswordError,
} from '@/services/user.service';

const Body = z.object({ newPassword: z.string().min(8).max(128) });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  try {
    const { newPassword } = Body.parse(await req.json());
    const actor = session!.user as { id: string; name?: string };
    await setPassword(params.id, newPassword, { id: actor.id, name: actor.name });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้', code: err.code }, { status: 404 });
    }
    if (err instanceof WeakPasswordError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error('[/api/admin/users/:id/password POST]', err);
    return NextResponse.json({ error: 'ไม่สามารถรีเซ็ตรหัสผ่านได้' }, { status: 500 });
  }
}
