/**
 * /api/admin/users
 *   GET  — list users (filter + search + pagination)
 *   POST — create user (requires `admin.manage_users`)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac/requirePermission';
import {
  createUser,
  listUsers,
  UnknownPermissionError,
  UserEmailInUseError,
  WeakPasswordError,
} from '@/services/user.service';

const PermissionOverridesSchema = z
  .object({
    add: z.array(z.string()).optional().default([]),
    remove: z.array(z.string()).optional().default([]),
  })
  .optional();

const CreateBody = z.object({
  email: z.string().email().max(191),
  name: z.string().min(1).max(191),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(UserRole),
  permissionOverrides: PermissionOverridesSchema,
  active: z.boolean().optional(),
});

// ─── GET ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  const sp = req.nextUrl.searchParams;
  const role = sp.get('role') as UserRole | null;
  const activeParam = sp.get('active');
  const active =
    activeParam === 'true' ? true : activeParam === 'false' ? false : undefined;
  const search = sp.get('search') ?? undefined;
  const skip = Number(sp.get('skip') ?? 0);
  const take = Number(sp.get('take') ?? 100);

  try {
    const result = await listUsers({
      role: role ?? undefined,
      active,
      search,
      skip: Number.isFinite(skip) ? skip : 0,
      take: Number.isFinite(take) ? take : 100,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/admin/users GET]', err);
    return NextResponse.json({ error: 'ไม่สามารถโหลดรายชื่อผู้ใช้' }, { status: 500 });
  }
}

// ─── POST ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const forbidden = await requirePermission(session, 'admin.manage_users');
  if (forbidden) return forbidden;

  try {
    const body = CreateBody.parse(await req.json());
    const actor = session!.user as { id: string; name?: string };

    const created = await createUser(
      {
        email: body.email,
        name: body.name,
        password: body.password,
        role: body.role,
        permissionOverrides: body.permissionOverrides,
        active: body.active,
      },
      { id: actor.id, name: actor.name },
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof UserEmailInUseError) {
      return NextResponse.json(
        { error: 'อีเมลนี้ถูกใช้แล้ว', code: err.code },
        { status: 409 },
      );
    }
    if (err instanceof UnknownPermissionError) {
      return NextResponse.json(
        { error: 'Permission ไม่ถูกต้อง', code: err.code, unknown: err.unknown },
        { status: 400 },
      );
    }
    if (err instanceof WeakPasswordError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    console.error('[/api/admin/users POST]', err);
    return NextResponse.json({ error: 'ไม่สามารถสร้างผู้ใช้ได้' }, { status: 500 });
  }
}
