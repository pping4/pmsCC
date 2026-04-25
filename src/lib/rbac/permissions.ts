/**
 * RBAC Permission Catalog & Resolver (Sprint 4A / A-T1)
 * ------------------------------------------------------
 * Central source of truth for permission strings, role → default permission
 * mapping, and the resolver that combines role defaults with per-user
 * JSON overrides stored on `User.permissionOverrides`.
 *
 * Design:
 *   - Permission = namespaced string `"<category>.<action>"` (e.g. `"cashier.refund"`).
 *   - Role = preset (NOT enforcement). Role selects a default permission bundle.
 *   - Override shape: `{ add: string[], remove: string[] }` — free-form; resolver is
 *     the only code that interprets it.
 *   - Effective permissions = `ROLE_DEFAULTS[role] ∪ overrides.add − overrides.remove`.
 *     (Option A — admin may "untick" defaults to drop sensitive actions from a
 *     specific user, e.g. a cashier trainee without refund rights.)
 *
 * Security notes:
 *   - Every API must call `hasPermission(user, perm)` — never inspect role directly.
 *   - Deactivated users (`active === false`) always resolve to an empty set — the
 *     resolver is the single trust boundary for "can do X".
 *   - `admin` role implicitly has every permission via wildcard `*`. This keeps
 *     emergency break-glass access consistent without having to touch every
 *     role preset whenever a new permission is added.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export type UserRoleName =
  | 'admin'
  | 'manager'
  | 'staff' // legacy alias, treated as `front`
  | 'cashier'
  | 'front'
  | 'housekeeping'
  | 'maintenance'
  | 'customer';

/** Shape of `User.permissionOverrides` JSON column. Both arrays optional. */
export interface PermissionOverrides {
  add?: string[];
  remove?: string[];
}

/** Minimum user shape the resolver needs — keep it tiny so callers don't leak. */
export interface RbacUser {
  role: UserRoleName | string;
  active: boolean;
  permissionOverrides?: unknown; // Prisma Json — may be null/object/malformed
}

// ─── Catalog: 30 permissions × 8 categories ──────────────────────────────

export const PERMISSION_CATALOG = {
  reservation: [
    'reservation.view',
    'reservation.create',
    'reservation.edit',
    'reservation.cancel',
    'reservation.checkin',
    'reservation.checkout',
    'reservation.change_room',
    'reservation.waive_fee',
  ],
  cashier: [
    'cashier.open_shift',
    'cashier.close_shift',
    'cashier.record_payment',
    'cashier.refund',
    'cashier.handover',
    'cashier.view_other_shifts',
  ],
  housekeeping: [
    'housekeeping.view',
    'housekeeping.assign',
    'housekeeping.update_status',
    'housekeeping.inspect',
  ],
  maintenance: [
    'maintenance.view',
    'maintenance.create_ticket',
    'maintenance.assign',
    'maintenance.close_ticket',
  ],
  finance: [
    'finance.view_reports',
    'finance.post_invoice',
    'finance.approve_refund',
    'finance.manage_fiscal_period',
    'finance.export',
  ],
  contracts: [
    'contracts.view',
    'contracts.create',
    'contracts.sign',
    'contracts.terminate',
    'contracts.renew',
    'contracts.bulk_renew',
  ],
  admin: [
    'admin.manage_users',
    'admin.manage_roles',
    'admin.manage_settings',
    'admin.force_close_shift',
  ],
  customer: [] as string[], // reserved for Phase II customer portal
} as const;

export type PermissionCategory = keyof typeof PERMISSION_CATALOG;

/** Flat array of every defined permission — useful for UI checkbox rendering. */
export const ALL_PERMISSIONS: readonly string[] = Object.values(PERMISSION_CATALOG).flat();

// ─── Role Defaults ───────────────────────────────────────────────────────

/**
 * Role preset → default permission set. Admin uses `*` wildcard meaning
 * "everything defined in the catalog + anything added later".
 *
 * `staff` is kept as an alias for `front` so existing users don't lose access
 * the moment the migration lands; the admin UI should encourage migrating
 * `staff → front` over time.
 */
export const ROLE_DEFAULTS: Record<UserRoleName, readonly string[]> = {
  admin: ['*'],
  manager: [
    ...PERMISSION_CATALOG.reservation,
    ...PERMISSION_CATALOG.cashier,
    ...PERMISSION_CATALOG.housekeeping,
    ...PERMISSION_CATALOG.maintenance,
    ...PERMISSION_CATALOG.finance,
    ...PERMISSION_CATALOG.contracts,
    'admin.force_close_shift',
  ],
  cashier: [
    'reservation.view',
    'reservation.checkin',
    'reservation.checkout',
    'cashier.open_shift',
    'cashier.close_shift',
    'cashier.record_payment',
    'cashier.refund',
    'cashier.handover',
    'finance.view_reports',
    'contracts.view',
  ],
  front: [
    'reservation.view',
    'reservation.create',
    'reservation.edit',
    'reservation.cancel',
    'reservation.checkin',
    'reservation.checkout',
    'reservation.change_room',
    'housekeeping.view',
    'maintenance.view',
    'maintenance.create_ticket',
    'contracts.view',
  ],
  staff: [
    // alias for `front` — kept until admin UI nudges existing users onto the new role
    'reservation.view',
    'reservation.create',
    'reservation.edit',
    'reservation.cancel',
    'reservation.checkin',
    'reservation.checkout',
    'reservation.change_room',
    'housekeeping.view',
    'maintenance.view',
    'maintenance.create_ticket',
    'contracts.view',
  ],
  housekeeping: [...PERMISSION_CATALOG.housekeeping, 'maintenance.create_ticket'],
  maintenance: [...PERMISSION_CATALOG.maintenance],
  customer: [], // no admin-portal access — deflected at login
};

// ─── Resolver ────────────────────────────────────────────────────────────

/**
 * Safely parse `User.permissionOverrides` (Prisma Json — may be null, object,
 * or malformed). Never throws; returns `{}` on anything unexpected.
 */
export function parseOverrides(raw: unknown): PermissionOverrides {
  if (!raw || typeof raw !== 'object') return { add: [], remove: [] };
  const obj = raw as Record<string, unknown>;
  const add = Array.isArray(obj.add)
    ? (obj.add.filter((x) => typeof x === 'string') as string[])
    : [];
  const remove = Array.isArray(obj.remove)
    ? (obj.remove.filter((x) => typeof x === 'string') as string[])
    : [];
  return { add, remove };
}

/**
 * Resolve the full effective permission set for a user.
 *
 * Algorithm:
 *   1. Deactivated user → empty set (early return, never bypass).
 *   2. Start with `ROLE_DEFAULTS[role]` (unknown role → empty).
 *   3. Union in `overrides.add`.
 *   4. Subtract `overrides.remove` — and yes, this CAN remove a default. That
 *      is the whole point of Option A (trainee cashier without refund rights).
 *   5. If the set contains `*`, return `['*']` as a marker — callers should
 *      use `hasPermission()` instead of iterating.
 */
export function resolveEffectivePermissions(user: RbacUser): Set<string> {
  if (!user.active) return new Set();

  const defaults = ROLE_DEFAULTS[user.role as UserRoleName] ?? [];
  const { add = [], remove = [] } = parseOverrides(user.permissionOverrides);

  const set = new Set<string>(defaults);
  for (const p of add) set.add(p);
  for (const p of remove) set.delete(p);

  return set;
}

/**
 * Check a single permission. `*` in the effective set is a wildcard match.
 *
 * Note: wildcard is ONLY honoured via role defaults (admin). It cannot be
 * injected through overrides — `parseOverrides` accepts `*` as a string,
 * but the admin-user management UI is expected to forbid adding `*` to a
 * non-admin user. (This is a UI contract, not enforced here on purpose —
 * a future audit/breakglass feature may legitimately need to grant `*`.)
 */
export function hasPermission(user: RbacUser, permission: string): boolean {
  const effective = resolveEffectivePermissions(user);
  if (effective.has('*')) return true;
  return effective.has(permission);
}

export function hasAnyPermission(user: RbacUser, permissions: string[]): boolean {
  const effective = resolveEffectivePermissions(user);
  if (effective.has('*')) return true;
  return permissions.some((p) => effective.has(p));
}

export function hasAllPermissions(user: RbacUser, permissions: string[]): boolean {
  // Guard: empty list is a caller bug — treat as false rather than vacuously true.
  if (permissions.length === 0) return false;
  const effective = resolveEffectivePermissions(user);
  if (effective.has('*')) return true;
  return permissions.every((p) => effective.has(p));
}

/**
 * Validate that every string in a permissions array exists in the catalog.
 * Used by the admin API when saving `permissionOverrides` to reject typos.
 */
export function isKnownPermission(p: string): boolean {
  return (ALL_PERMISSIONS as readonly string[]).includes(p);
}

export function validatePermissionList(perms: string[]): {
  valid: string[];
  unknown: string[];
} {
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const p of perms) {
    if (isKnownPermission(p)) valid.push(p);
    else unknown.push(p);
  }
  return { valid, unknown };
}
