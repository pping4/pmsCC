/**
 * /api/admin/users/[id]
 *   GET   — fetch single user (safe projection)
 *   PATCH — update user (name, role, overrides, active)
 *   DELETE — deactivate (soft — sets active=false; never hard-delete)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac/requirePermission';
import {
  deactivateUser,
  getUserById,
  UnknownPermissionError,
  updateUser,
  UserNotFoundError,
} from '@/services/user.service';

const PermissionOverridesSchema = z
  .object({
    add: z.array(z.string()).optional().default([]),
    remove: z.array(z.string()).optional().default([]),
  })
  .optional();

const UpdateBody = z.object({
  name: z.string().min(1).max(191).optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
  permissionOverrides: PermissionOverridesSchema,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  const user = await getUserById(params.id);
  if (!user) return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 });
  return NextResponse.json(user);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  try {
    const body = UpdateBody.parse(await req.json());
    const actor = session!.user as { id: string; name?: string };

    const updated = await updateUser(
      params.id,
      {
        name: body.name,
        role: body.role,
        active: body.active,
        permissionOverrides: body.permissionOverrides,
      },
      { id: actor.id, name: actor.name },
    );
    return NextResponse.json(updated);
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
    if (err instanceof UnknownPermissionError) {
      return NextResponse.json(
        { error: 'Permission ไม่ถูกต้อง', code: err.code, unknown: err.unknown },
        { status: 400 },
      );
    }
    console.error('[/api/admin/users/:id PATCH]', err);
    return NextResponse.json({ error: 'ไม่สามารถแก้ไขผู้ใช้ได้' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  try {
    const actor = session!.user as { id: string; name?: string };
    // Refuse to deactivate yourself — avoids admin lock-out.
    if (actor.id === params.id) {
      return NextResponse.json(
        { error: 'ไม่สามารถปิดใช้งานตัวเองได้' },
        { status: 400 },
      );
    }
    const updated = await deactivateUser(params.id, { id: actor.id, name: actor.name });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้', code: err.code }, { status: 404 });
    }
    console.error('[/api/admin/users/:id DELETE]', err);
    return NextResponse.json({ error: 'ไม่สามารถปิดใช้งานผู้ใช้ได้' }, { status: 500 });
  }
}
