/**
 * Unit tests — RBAC permission resolver (Sprint 4A / A-T1).
 *
 * Runner-agnostic shim (same pattern as depositForfeit.service.test.ts).
 * Run via: npx tsx src/lib/rbac/__tests__/permissions.test.ts
 */

import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_DEFAULTS,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isKnownPermission,
  parseOverrides,
  resolveEffectivePermissions,
  validatePermissionList,
  type RbacUser,
} from '../permissions';

// ─── Shim ──────────────────────────────────────────────────────────────────
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

type TestFn = () => void | Promise<void>;
interface Suite { name: string; tests: { name: string; fn: TestFn }[] }
const suites: Suite[] = [];
let currentSuite: Suite | null = null;
const g = globalThis as unknown as {
  describe?: (n: string, b: () => void) => void;
  it?: (n: string, f: TestFn) => void;
  expect?: (a: unknown) => unknown;
};
if (typeof g.describe !== 'function') {
  g.describe = (name: string, body: () => void) => {
    const s: Suite = { name, tests: [] };
    currentSuite = s;
    body();
    suites.push(s);
    currentSuite = null;
  };
  g.it = (name: string, fn: TestFn) => {
    if (!currentSuite) throw new Error('it() outside describe()');
    currentSuite.tests.push({ name, fn });
  };
  g.expect = (actual: unknown) => ({
    toBe: (expected: unknown) => {
      if (!Object.is(actual, expected)) {
        throw new Error(`Expected ${fmt(expected)}, got ${fmt(actual)}`);
      }
    },
    toEqual: (expected: unknown) => {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
  });
}
function fmt(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : String(v);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mk(role: string, overrides: unknown = {}, active = true): RbacUser {
  return { role, active, permissionOverrides: overrides };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('catalog integrity', () => {
  it('ALL_PERMISSIONS contains every category entry exactly once', () => {
    const flat = Object.values(PERMISSION_CATALOG).flat();
    expect(flat.length).toBe(ALL_PERMISSIONS.length);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('every permission uses "category.action" dotted form', () => {
    for (const p of ALL_PERMISSIONS) {
      const ok = /^[a-z_]+\.[a-z_]+$/.test(p);
      if (!ok) throw new Error(`bad permission string: "${p}"`);
    }
    expect(true).toBe(true);
  });

  it('no customer-portal permissions yet (Phase II)', () => {
    expect(PERMISSION_CATALOG.customer.length).toBe(0);
  });
});

describe('parseOverrides — tolerant parser', () => {
  it('null → empty', () => {
    expect(parseOverrides(null)).toEqual({ add: [], remove: [] });
  });
  it('malformed object → empty arrays', () => {
    expect(parseOverrides({ add: 'nope', remove: 42 })).toEqual({ add: [], remove: [] });
  });
  it('strips non-string entries silently', () => {
    expect(parseOverrides({ add: ['a', 1, null, 'b'], remove: ['x'] })).toEqual({
      add: ['a', 'b'],
      remove: ['x'],
    });
  });
  it('valid shape round-trips', () => {
    expect(parseOverrides({ add: ['cashier.refund'], remove: [] })).toEqual({
      add: ['cashier.refund'],
      remove: [],
    });
  });
});

describe('resolveEffectivePermissions', () => {
  it('inactive user → empty set (never bypass)', () => {
    const u = mk('admin', {}, false);
    expect(resolveEffectivePermissions(u).size).toBe(0);
  });

  it('admin → wildcard marker', () => {
    const u = mk('admin');
    const eff = resolveEffectivePermissions(u);
    expect(eff.has('*')).toBe(true);
  });

  it('cashier role → default cashier permissions, no reservation.create', () => {
    const u = mk('cashier');
    const eff = resolveEffectivePermissions(u);
    expect(eff.has('cashier.record_payment')).toBe(true);
    expect(eff.has('cashier.refund')).toBe(true);
    expect(eff.has('reservation.create')).toBe(false);
  });

  it('cashier with remove=["cashier.refund"] → trainee has no refund (Option A)', () => {
    const u = mk('cashier', { add: [], remove: ['cashier.refund'] });
    const eff = resolveEffectivePermissions(u);
    expect(eff.has('cashier.record_payment')).toBe(true);
    expect(eff.has('cashier.refund')).toBe(false);
  });

  it('front with add=["finance.view_reports"] → extended beyond defaults', () => {
    const u = mk('front', { add: ['finance.view_reports'] });
    const eff = resolveEffectivePermissions(u);
    expect(eff.has('reservation.checkin')).toBe(true);
    expect(eff.has('finance.view_reports')).toBe(true);
  });

  it('customer role → empty (no admin-portal access)', () => {
    const u = mk('customer');
    expect(resolveEffectivePermissions(u).size).toBe(0);
  });

  it('staff (legacy alias) maps to front defaults', () => {
    const u = mk('staff');
    const eff = resolveEffectivePermissions(u);
    expect(eff.has('reservation.checkin')).toBe(true);
    expect(eff.has('reservation.create')).toBe(true);
  });

  it('unknown role + no overrides → empty', () => {
    const u = mk('wizard');
    expect(resolveEffectivePermissions(u).size).toBe(0);
  });
});

describe('hasPermission / Any / All', () => {
  it('admin wildcard passes any permission', () => {
    const u = mk('admin');
    expect(hasPermission(u, 'reservation.cancel')).toBe(true);
    expect(hasPermission(u, 'anything.made_up')).toBe(true); // wildcard covers future perms
  });

  it('cashier: record_payment yes, manage_users no', () => {
    const u = mk('cashier');
    expect(hasPermission(u, 'cashier.record_payment')).toBe(true);
    expect(hasPermission(u, 'admin.manage_users')).toBe(false);
  });

  it('hasAnyPermission short-circuits', () => {
    const u = mk('housekeeping');
    expect(hasAnyPermission(u, ['admin.manage_users', 'housekeeping.inspect'])).toBe(true);
    expect(hasAnyPermission(u, ['admin.manage_users', 'finance.export'])).toBe(false);
  });

  it('hasAllPermissions requires every entry', () => {
    const u = mk('manager');
    expect(hasAllPermissions(u, ['reservation.checkin', 'cashier.refund'])).toBe(true);
    expect(hasAllPermissions(u, ['reservation.checkin', 'admin.manage_users'])).toBe(false);
  });

  it('remove overrides block the admin default (Option A with manager)', () => {
    const u = mk('manager', { remove: ['cashier.refund'] });
    expect(hasPermission(u, 'cashier.refund')).toBe(false);
    expect(hasPermission(u, 'reservation.checkin')).toBe(true);
  });

  it('inactive user: every check returns false even for admin', () => {
    const u = mk('admin', {}, false);
    expect(hasPermission(u, 'cashier.record_payment')).toBe(false);
    expect(hasAnyPermission(u, ['cashier.record_payment'])).toBe(false);
    expect(hasAllPermissions(u, ['cashier.record_payment'])).toBe(false);
    // Defensive: empty list is treated as false to avoid vacuous-truth footgun.
    expect(hasAllPermissions(u, [])).toBe(false);
  });
});

describe('catalog validation helpers', () => {
  it('isKnownPermission accepts cataloged strings', () => {
    expect(isKnownPermission('cashier.refund')).toBe(true);
    expect(isKnownPermission('typo.action')).toBe(false);
  });

  it('validatePermissionList splits known vs unknown', () => {
    const r = validatePermissionList(['cashier.refund', 'bogus.thing', 'admin.manage_users']);
    expect(r.valid).toEqual(['cashier.refund', 'admin.manage_users']);
    expect(r.unknown).toEqual(['bogus.thing']);
  });
});

describe('ROLE_DEFAULTS sanity', () => {
  it('cashier defaults do NOT include admin.manage_users', () => {
    expect(ROLE_DEFAULTS.cashier.includes('admin.manage_users')).toBe(false);
  });
  it('housekeeping can file a maintenance ticket (cross-dept grant)', () => {
    expect(ROLE_DEFAULTS.housekeeping.includes('maintenance.create_ticket')).toBe(true);
  });
  it('manager gets force_close_shift (for stuck-shift recovery)', () => {
    expect(ROLE_DEFAULTS.manager.includes('admin.force_close_shift')).toBe(true);
  });
});

describe('ROLE_DEFAULTS — exact matrix (plan §3)', () => {
  it('cashier has exactly the 10 permissions listed in the plan', () => {
    const expected = [
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
    ];
    expect(ROLE_DEFAULTS.cashier.length).toBe(expected.length);
    for (const p of expected) {
      if (!ROLE_DEFAULTS.cashier.includes(p)) throw new Error(`missing ${p}`);
    }
    expect(true).toBe(true);
  });

  it('housekeeping gets 4 housekeeping + 1 maintenance.create_ticket = 5', () => {
    expect(ROLE_DEFAULTS.housekeeping.length).toBe(5);
  });

  it('maintenance gets exactly 4 permissions (its own category)', () => {
    expect(ROLE_DEFAULTS.maintenance.length).toBe(4);
  });

  it('customer role is empty (no admin-portal access)', () => {
    expect(ROLE_DEFAULTS.customer.length).toBe(0);
  });

  it('staff (legacy) and front grant the same permissions', () => {
    const a = new Set(ROLE_DEFAULTS.staff);
    const b = new Set(ROLE_DEFAULTS.front);
    expect(a.size).toBe(b.size);
    for (const p of a) {
      if (!b.has(p)) throw new Error(`staff has ${p}, front does not`);
    }
    expect(true).toBe(true);
  });
});

describe('cross-scenario: realistic trainee cashier', () => {
  it('trainee (cashier role, remove cashier.refund + cashier.handover)', () => {
    const u: RbacUser = {
      role: 'cashier',
      active: true,
      permissionOverrides: { add: [], remove: ['cashier.refund', 'cashier.handover'] },
    };
    expect(hasPermission(u, 'cashier.record_payment')).toBe(true);
    expect(hasPermission(u, 'cashier.open_shift')).toBe(true);
    expect(hasPermission(u, 'cashier.refund')).toBe(false);
    expect(hasPermission(u, 'cashier.handover')).toBe(false);
    // Sanity: still can't touch manager-level stuff
    expect(hasPermission(u, 'admin.manage_users')).toBe(false);
    expect(hasPermission(u, 'finance.approve_refund')).toBe(false);
  });

  it('hybrid "front+cashier duty" (front role, +cashier.record_payment +cashier.refund)', () => {
    const u: RbacUser = {
      role: 'front',
      active: true,
      permissionOverrides: {
        add: ['cashier.record_payment', 'cashier.refund'],
        remove: [],
      },
    };
    expect(hasPermission(u, 'reservation.checkin')).toBe(true);
    expect(hasPermission(u, 'cashier.record_payment')).toBe(true);
    expect(hasPermission(u, 'cashier.refund')).toBe(true);
    // But no open_shift — they piggy-back on someone else's shift
    expect(hasPermission(u, 'cashier.open_shift')).toBe(false);
  });
});

// ─── Runner ────────────────────────────────────────────────────────────────
async function run() {
  const gg = globalThis as unknown as {
    __vitest_worker__?: unknown;
    expect?: { extend?: unknown };
  };
  if (gg.__vitest_worker__ || gg.expect?.extend) return;
  let passed = 0;
  let failed = 0;
  for (const s of suites) {
    console.log(`\n  ${s.name}`);
    for (const t of s.tests) {
      try {
        await t.fn();
        console.log(`    ✓ ${t.name}`);
        passed++;
      } catch (err) {
        console.log(`    ✗ ${t.name}`);
        console.log(`      ${(err as Error).message}`);
        failed++;
      }
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
if (typeof require !== 'undefined' && require.main === module) {
  void run();
}
