/**
 * Unit tests for `periodCalc`.
 *
 * Runner-agnostic: uses a tiny in-file `describe/it/expect` shim when neither
 * Vitest nor Jest is present, so the file can be run via:
 *     npx tsx src/lib/contract/__tests__/periodCalc.test.ts
 * Once a real test runner (vitest/jest) is added, the globals are picked up
 * automatically and the shim is skipped.
 */

import { computeNextPeriod, prorateAmount, addContractMonths } from '../periodCalc';

/* Type declarations so tsc is happy whether or not a real test runner is installed. */
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeCloseTo: (expected: number, digits?: number) => void;
};

/* ─── Minimal test shim ──────────────────────────────────────────────────── */
type TestFn = () => void | Promise<void>;
interface Suite { name: string; tests: { name: string; fn: TestFn }[] }
const suites: Suite[] = [];
let currentSuite: Suite | null = null;

const g = globalThis as any;
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
  g.expect = (actual: any) => ({
    toBe: (expected: any) => {
      if (!Object.is(actual, expected)) {
        throw new Error(`Expected ${fmt(expected)}, got ${fmt(actual)}`);
      }
    },
    toEqual: (expected: any) => {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toBeCloseTo: (expected: number, digits = 2) => {
      const diff = Math.abs(actual - expected);
      const tol = Math.pow(10, -digits) / 2;
      if (diff > tol) throw new Error(`Expected ${expected} ±${tol}, got ${actual}`);
    },
  });
}
function fmt(v: any) {
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  return typeof v === 'string' ? `"${v}"` : String(v);
}
/** Helper — construct a local-time date with no DST surprises. */
function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}
function sameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/* ─── Tests ──────────────────────────────────────────────────────────────── */

describe('computeNextPeriod — rolling cycle', () => {
  it('first period starts at anchor — 15 Mar 2026, 6-month contract', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2026, 9, 14), billingCycle: 'rolling' },
      null,
    );
    expect(sameDate(r.start, d(2026, 3, 15))).toBe(true);
    expect(sameDate(r.end, d(2026, 4, 14))).toBe(true);
    expect(r.isProrated).toBe(false);
    expect(r.periodNumber).toBe(1);
  });

  it('second period — lastPeriodEnd=14 Apr → 15 Apr..14 May', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2026, 9, 14), billingCycle: 'rolling' },
      d(2026, 4, 14),
    );
    expect(sameDate(r.start, d(2026, 4, 15))).toBe(true);
    expect(sameDate(r.end, d(2026, 5, 14))).toBe(true);
    expect(r.periodNumber).toBe(2);
    expect(r.isProrated).toBe(false);
  });

  it('31 Jan rolling start — period 1 end clamps to last day of Feb (non-leap 2026)', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 1, 31), endDate: d(2026, 7, 30), billingCycle: 'rolling' },
      null,
    );
    expect(sameDate(r.start, d(2026, 1, 31))).toBe(true);
    // 2026 not leap → 28 Feb
    expect(sameDate(r.end, d(2026, 2, 27))).toBe(true);
    // Note: addMonths(31 Jan, 1) = 28 Feb; -1 day = 27 Feb.
    // This is date-fns's deterministic behavior documented in the plan.
  });

  it('31 Jan rolling start — leap year (2024) → period 1 end = 28 Feb', () => {
    const r = computeNextPeriod(
      { startDate: d(2024, 1, 31), endDate: d(2024, 7, 30), billingCycle: 'rolling' },
      null,
    );
    // addMonths(31 Jan 2024, 1) = 29 Feb 2024; -1 day = 28 Feb 2024
    expect(sameDate(r.end, d(2024, 2, 28))).toBe(true);
  });

  it('rolling last period clamps to contract end', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2026, 6, 10), billingCycle: 'rolling' },
      d(2026, 5, 14),
    );
    // natural end = 14 Jun but contract ends 10 Jun
    expect(sameDate(r.end, d(2026, 6, 10))).toBe(true);
    expect(r.isProrated).toBe(true);
  });
});

describe('computeNextPeriod — calendar cycle', () => {
  it('first period 15 Mar 2026 → 31 Mar, prorated', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2027, 3, 14), billingCycle: 'calendar' },
      null,
    );
    expect(sameDate(r.start, d(2026, 3, 15))).toBe(true);
    expect(sameDate(r.end, d(2026, 3, 31))).toBe(true);
    expect(r.isProrated).toBe(true);
    expect(r.periodNumber).toBe(1);
    expect(r.daysInPeriod).toBe(17); // 15..31 inclusive
    expect(r.daysInFullMonth).toBe(31);
  });

  it('second period — lastPeriodEnd=31 Mar → 1 Apr..30 Apr, full', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2027, 3, 14), billingCycle: 'calendar' },
      d(2026, 3, 31),
    );
    expect(sameDate(r.start, d(2026, 4, 1))).toBe(true);
    expect(sameDate(r.end, d(2026, 4, 30))).toBe(true);
    expect(r.isProrated).toBe(false);
    expect(r.periodNumber).toBe(2);
  });

  it('calendar last period clamps to contract endDate', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 3, 15), endDate: d(2027, 3, 14), billingCycle: 'calendar' },
      d(2027, 2, 28),
    );
    // start = 1 Mar 2027, monthEnd = 31 Mar 2027, contractEnd = 14 Mar 2027
    expect(sameDate(r.start, d(2027, 3, 1))).toBe(true);
    expect(sameDate(r.end, d(2027, 3, 14))).toBe(true);
    expect(r.isProrated).toBe(true);
    expect(r.daysInPeriod).toBe(14);
    expect(r.daysInFullMonth).toBe(31);
  });

  it('calendar contract starting on the 1st — period 1 is NOT prorated', () => {
    const r = computeNextPeriod(
      { startDate: d(2026, 4, 1), endDate: d(2026, 12, 31), billingCycle: 'calendar' },
      null,
    );
    expect(r.isProrated).toBe(false);
    expect(sameDate(r.end, d(2026, 4, 30))).toBe(true);
  });
});

describe('prorateAmount', () => {
  it('5200 * 17/31 → 2851.61 (banker rounded)', () => {
    // Raw: 5200*17/31 = 2851.6129...  → 2851.61
    expect(prorateAmount(5200, 17, 31)).toBeCloseTo(2851.61, 2);
  });

  it('full month returns full amount', () => {
    expect(prorateAmount(5200, 31, 31)).toBe(5200);
  });

  it('zero days → zero', () => {
    expect(prorateAmount(5200, 0, 31)).toBe(0);
  });

  it('half-to-even rounding case', () => {
    // 12.345 → 12.34 under banker's (round-half-to-even on 12.345 → 12.34 since 4 is even)
    // Construct a case that yields exactly .5 at the 2nd-decimal scale:
    //   monthly * d / dim = X.XX5 exactly
    // Use monthly=10, d=5, dim=8 → 6.25 (not a half case)
    // Use monthly=0.25, d=1, dim=2 → 0.125 → banker rounds to 0.12
    expect(prorateAmount(0.25, 1, 2)).toBeCloseTo(0.12, 2);
    // monthly=0.75, d=1, dim=2 → 0.375 → banker rounds to 0.38 (7 is odd → up to 8)
    expect(prorateAmount(0.75, 1, 2)).toBeCloseTo(0.38, 2);
  });
});

describe('addContractMonths', () => {
  it('31 Jan + 1 month = 28 Feb (non-leap)', () => {
    expect(sameDate(addContractMonths(d(2026, 1, 31), 1), d(2026, 2, 28))).toBe(true);
  });
  it('31 Jan + 1 month = 29 Feb (leap 2024)', () => {
    expect(sameDate(addContractMonths(d(2024, 1, 31), 1), d(2024, 2, 29))).toBe(true);
  });
  it('15 Mar + 6 months = 15 Sep', () => {
    expect(sameDate(addContractMonths(d(2026, 3, 15), 6), d(2026, 9, 15))).toBe(true);
  });
});

/* ─── Runner for shim mode ───────────────────────────────────────────────── */
async function run() {
  if ((globalThis as any).__vitest_worker__ || (globalThis as any).expect?.extend) {
    // Real runner — do nothing, let it collect via its own hooks.
    return;
  }
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

// Only auto-run when executed directly via tsx/node, not when imported by a runner.
if (typeof require !== 'undefined' && require.main === module) {
  void run();
}
