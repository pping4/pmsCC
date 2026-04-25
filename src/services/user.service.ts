/**
 * User management service (Sprint 4A / A-T4)
 * -------------------------------------------
 * CRUD for the `User` model — the admin-portal's "Users & Roles" page sits
 * on top of this. Every write operation:
 *   - hashes passwords with bcrypt (cost 10 — matches existing seed)
 *   - validates `permissionOverrides` against the central catalog
 *   - records an ActivityLog entry (category: 'system')
 *   - runs inside a Prisma `$transaction` when it touches more than one row
 *
 * The service NEVER returns the `password` field — all selectors explicitly
 * omit it. Callers that need to change a password must use the dedicated
 * `setPassword()` / `changeOwnPassword()` helpers, which keep the hash
 * work inside this module.
 *
 * Q7 decision (from Sprint 4 v2 plan): admin sets the initial password,
 * user can use it immediately — there is NO `mustChangePassword` flag.
 * Users who want to rotate their password do so via `changeOwnPassword()`.
 *
 * Q8 decision: email is globally unique (`@unique` on the model). Deactivated
 * users keep their email reserved forever — the admin must rename the email
 * on the deactivated account if they want to reuse it.
 */

import type { Prisma, User, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';
import {
  ROLE_DEFAULTS,
  validatePermissionList,
  type PermissionOverrides,
  type UserRoleName,
} from '@/lib/rbac/permissions';

const BCRYPT_COST = 10;

// ─── Safe projection ──────────────────────────────────────────────────────

/**
 * Fields safe to return to any authenticated caller. NEVER include `password`.
 */
export const USER_SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  permissionOverrides: true,
  createdBy: true,
  updatedBy: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof USER_SAFE_SELECT }>;

// ─── DTOs ─────────────────────────────────────────────────────────────────

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  permissionOverrides?: PermissionOverrides;
  active?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  permissionOverrides?: PermissionOverrides;
  active?: boolean;
}

export interface ListUsersFilter {
  role?: UserRole;
  active?: boolean;
  search?: string; // matches email or name (case-insensitive)
  skip?: number;
  take?: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────

/** Raised when attempting to create a user with an email already in use. */
export class UserEmailInUseError extends Error {
  code = 'USER_EMAIL_IN_USE' as const;
  constructor(email: string) {
    super(`Email already in use: ${email}`);
  }
}

/** Raised when permission override strings aren't in the catalog. */
export class UnknownPermissionError extends Error {
  code = 'UNKNOWN_PERMISSION' as const;
  constructor(public unknown: string[]) {
    super(`Unknown permissions: ${unknown.join(', ')}`);
  }
}

/** Raised when a provided password fails the minimum strength check. */
export class WeakPasswordError extends Error {
  code = 'WEAK_PASSWORD' as const;
  constructor(reason: string) {
    super(reason);
  }
}

/** Raised when we can't find the user the caller asked about. */
export class UserNotFoundError extends Error {
  code = 'USER_NOT_FOUND' as const;
  constructor(id: string) {
    super(`User not found: ${id}`);
  }
}

/** Raised when the current password for changeOwnPassword is wrong. */
export class InvalidCurrentPasswordError extends Error {
  code = 'INVALID_CURRENT_PASSWORD' as const;
  constructor() {
    super('Current password is incorrect');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function assertPasswordStrong(pw: string): void {
  if (typeof pw !== 'string' || pw.length < 8) {
    throw new WeakPasswordError('Password must be at least 8 characters');
  }
  // Soft checks only — admin sets initial passwords; full policy is future work.
}

function assertOverridesValid(o: PermissionOverrides | undefined): PermissionOverrides {
  if (!o) return { add: [], remove: [] };
  const add = Array.isArray(o.add) ? o.add : [];
  const remove = Array.isArray(o.remove) ? o.remove : [];
  const all = [...add, ...remove];
  if (all.length === 0) return { add, remove };
  const { unknown } = validatePermissionList(all);
  if (unknown.length > 0) throw new UnknownPermissionError(unknown);
  return { add, remove };
}

/**
 * Translate a Prisma P2002 unique-constraint error on `email` into a
 * typed service error. Anything else is re-thrown unchanged so the
 * caller's error envelope stays honest.
 */
function translateCreateError(err: unknown, email: string): never {
  const e = err as { code?: string; meta?: { target?: string[] } };
  if (e.code === 'P2002' && (e.meta?.target ?? []).includes('email')) {
    throw new UserEmailInUseError(email);
  }
  throw err;
}

// ─── Queries ──────────────────────────────────────────────────────────────

export async function listUsers(filter: ListUsersFilter = {}): Promise<{
  items: SafeUser[];
  total: number;
}> {
  const where: Prisma.UserWhereInput = {};
  if (filter.role) where.role = filter.role;
  if (typeof filter.active === 'boolean') where.active = filter.active;
  if (filter.search?.trim()) {
    const q = filter.search.trim();
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: USER_SAFE_SELECT,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      skip: filter.skip ?? 0,
      take: Math.min(filter.take ?? 100, 500),
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total };
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  return prisma.user.findUnique({ where: { id }, select: USER_SAFE_SELECT });
}

// ─── Mutations ────────────────────────────────────────────────────────────

/**
 * Create a new user. Admin-only (caller enforces the permission check).
 * - Hashes the password (bcrypt cost 10).
 * - Validates overrides against the catalog (all-or-nothing — one typo rejects).
 * - Records an ActivityLog entry.
 */
export async function createUser(
  input: CreateUserInput,
  actor: { id: string; name?: string },
): Promise<SafeUser> {
  assertPasswordStrong(input.password);
  const overrides = assertOverridesValid(input.permissionOverrides);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  return prisma.$transaction(async (tx) => {
    let created: SafeUser;
    try {
      created = await tx.user.create({
        data: {
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          password: passwordHash,
          role: input.role,
          active: input.active ?? true,
          permissionOverrides: overrides as unknown as Prisma.InputJsonValue,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: USER_SAFE_SELECT,
      });
    } catch (err) {
      translateCreateError(err, input.email);
    }

    await logActivity(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'user.created',
      category: 'system',
      description: `สร้างผู้ใช้ ${created!.name} (${created!.email}) role=${created!.role}`,
      metadata: { targetUserId: created!.id, role: created!.role },
      severity: 'info',
    });

    return created!;
  });
}

/**
 * Update a user's profile fields. Password is NOT touched here — use
 * `setPassword()` instead.
 */
export async function updateUser(
  id: string,
  patch: UpdateUserInput,
  actor: { id: string; name?: string },
): Promise<SafeUser> {
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, active: true, permissionOverrides: true },
  });
  if (!existing) throw new UserNotFoundError(id);

  const data: Prisma.UserUpdateInput = { updatedBy: actor.id };
  if (typeof patch.name === 'string') data.name = patch.name.trim();
  if (patch.role) data.role = patch.role;
  if (typeof patch.active === 'boolean') data.active = patch.active;
  if (patch.permissionOverrides !== undefined) {
    data.permissionOverrides = assertOverridesValid(
      patch.permissionOverrides,
    ) as unknown as Prisma.InputJsonValue;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data,
      select: USER_SAFE_SELECT,
    });

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (patch.role && patch.role !== existing.role)
      diff.role = { from: existing.role, to: patch.role };
    if (typeof patch.active === 'boolean' && patch.active !== existing.active)
      diff.active = { from: existing.active, to: patch.active };
    if (patch.permissionOverrides !== undefined)
      diff.permissionOverrides = {
        from: existing.permissionOverrides,
        to: updated.permissionOverrides,
      };

    await logActivity(tx, {
      userId: actor.id,
      userName: actor.name,
      action: Object.keys(diff).includes('active') && !updated.active
        ? 'user.deactivated'
        : 'user.updated',
      category: 'system',
      description: `แก้ไขผู้ใช้ ${updated.name} (${updated.email})`,
      metadata: { targetUserId: id, diff },
      severity: 'info',
    });

    return updated;
  });
}

/** Convenience wrapper for the deactivate button in the admin UI. */
export async function deactivateUser(
  id: string,
  actor: { id: string; name?: string },
): Promise<SafeUser> {
  return updateUser(id, { active: false }, actor);
}

export async function reactivateUser(
  id: string,
  actor: { id: string; name?: string },
): Promise<SafeUser> {
  return updateUser(id, { active: true }, actor);
}

// ─── Password management ─────────────────────────────────────────────────

/**
 * Admin action: set (reset) another user's password. Does NOT verify the
 * old password — permission check is the caller's responsibility.
 */
export async function setPassword(
  targetUserId: string,
  newPassword: string,
  actor: { id: string; name?: string },
): Promise<void> {
  assertPasswordStrong(newPassword);
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);

  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true },
    });
    if (!target) throw new UserNotFoundError(targetUserId);

    await tx.user.update({
      where: { id: targetUserId },
      data: { password: hash, updatedBy: actor.id },
    });

    await logActivity(tx, {
      userId: actor.id,
      userName: actor.name,
      action: 'user.password_reset',
      category: 'system',
      description: `รีเซ็ตรหัสผ่านของ ${target.name} (${target.email})`,
      metadata: { targetUserId },
      severity: 'warning',
    });
  });
}

/**
 * User action: change own password. Verifies `currentPassword` first —
 * throws `InvalidCurrentPasswordError` on mismatch.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  assertPasswordStrong(newPassword);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true, name: true, email: true },
  });
  if (!user) throw new UserNotFoundError(userId);

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) throw new InvalidCurrentPasswordError();

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password: hash, updatedBy: userId },
    });
    await logActivity(tx, {
      userId,
      userName: user.name,
      action: 'user.password_changed',
      category: 'system',
      description: `เปลี่ยนรหัสผ่านตนเอง (${user.email})`,
      metadata: {},
      severity: 'info',
    });
  });
}

// ─── Read helpers for UI ──────────────────────────────────────────────────

/**
 * Return the list of permission strings that come from the role alone
 * (before overrides). Useful for rendering the permission-matrix UI so
 * the checkboxes can distinguish "default-on" from "granted by override".
 */
export function getRoleDefaultPermissions(role: UserRole): readonly string[] {
  return ROLE_DEFAULTS[role as UserRoleName] ?? [];
}

/** Raw user type (for auth flow). NEVER forward to the client. */
export type RawUser = User;
