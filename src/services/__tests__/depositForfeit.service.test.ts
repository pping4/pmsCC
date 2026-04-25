/**
 * Unit tests for `depositForfeit.service` — pure `calculateForfeit()`.
 *
 * Runner-agnostic: same tiny shim as periodCalc.test.ts. Run via:
 *   npx tsx src/services/__tests__/depositForfeit.service.test.ts
 *
 * Covers the 8 scenarios called out in T12:
 *   1. forfeit_full + lock-in violated      → full forfeit
 *   2. forfeit_percent 50% + violated       → half forfeit
 *   3. prorated, 3 months × 10000, dep 40k  → 30k forfeit / 10k refund
 *   4. prorated capped at deposit           → full forfeit
 *   5. 'none'                                → full refund
 *   6. lock-in not violated                  → full refund regardless of rule
 *   7. outstanding balance > refundable     → additionalCharge emitted (calc side)
 *   8. banker's rounding edge 12500.125     → 12500.12 (half-to-even)
 */

import { calculateForfeit } from '../depositForfeit.service';
import { roundHalfToEven2 } from '@/lib/contract/periodCalc';

// Type declarations (same pattern as periodCalc.test.ts)
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeCloseTo: (expected: number, digits?: number) => void;
};

// ─── Shim ──────────────────────────────────────────────────────────────────
type TestFn = () => void | Promise<void>;
interface Suite {
  name: string;
  tests: { name: string; fn: TestFn }[];
}
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
    toBeCloseTo: (expected: number, digits = 2) => {
      const diff = Math.abs((actual as number) - expected);
      const tol = Math.pow(10, -digits) / 2;
      if (diff > tol) {
        throw new Error(`Expected ${expected} ±${tol}, got ${actual}`);
      }
    },
  });
}
function fmt(v: unknown): string {
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  return typeof v === 'string' ? `"${v}"` : String(v);
}
function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('calculateForfeit — rule application', () => {
  it('1. forfeit_full + lock-in violated → full forfeit, zero refund', () => {
    const r = calculateForfeit({
      securityDepositAmount: 16000,
      forfeitType: 'forfeit_full',
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 8000,
    });
    expect(r.forfeitedAmount).toBe(16000);
    expect(r.refundableAmount).toBe(0);
    expect(r.breakdown.lockInViolated).toBe(true);
  });

  it('2. forfeit_percent 50% + violated → half forfeit, half refund', () => {
    const r = calculateForfeit({
      securityDepositAmount: 20000,
      forfeitType: 'forfeit_percent',
      forfeitPercent: 50,
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 10000,
    });
    expect(r.forfeitedAmount).toBe(10000);
    expect(r.refundableAmount).toBe(10000);
  });

  it('3. prorated, 3 months remaining × 10000 rent, deposit 40000 → 30000 forfeit', () => {
    // lock-in 12m, start 2026-01-01 → lockInEnd 2027-01-01
    // terminate 2026-10-15 → ~78 days left → ceil(78/30) = 3 months
    const r = calculateForfeit({
      securityDepositAmount: 40000,
      forfeitType: 'prorated',
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 10, 15),
      lockInMonths: 12,
      monthlyRent: 10000,
    });
    expect(r.breakdown.monthsRemainingInLockIn).toBe(3);
    expect(r.forfeitedAmount).toBe(30000);
    expect(r.refundableAmount).toBe(10000);
  });

  it('4. prorated capped at deposit — 6 × 10000 > 40000 → forfeit = 40000', () => {
    // terminate 2026-07-15 → ~170 days left → ceil(170/30) = 6 months
    const r = calculateForfeit({
      securityDepositAmount: 40000,
      forfeitType: 'prorated',
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 7, 15),
      lockInMonths: 12,
      monthlyRent: 10000,
    });
    expect(r.breakdown.monthsRemainingInLockIn).toBe(6);
    expect(r.forfeitedAmount).toBe(40000);
    expect(r.refundableAmount).toBe(0);
    // penaltyBase exposes the uncapped raw penalty so UI can show "would've been 60000"
    expect(r.breakdown.penaltyBase).toBe(60000);
  });

  it('5. none → full refund regardless', () => {
    const r = calculateForfeit({
      securityDepositAmount: 16000,
      forfeitType: 'none',
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 8000,
    });
    expect(r.forfeitedAmount).toBe(0);
    expect(r.refundableAmount).toBe(16000);
  });

  it('6. lock-in NOT violated → full refund regardless of rule', () => {
    // lockIn=6m, start 2026-01-01, lockInEnd 2026-07-01; terminate 2026-08-01 → after lock-in
    const r = calculateForfeit({
      securityDepositAmount: 16000,
      forfeitType: 'forfeit_full', // even "worst" rule
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 8, 1),
      lockInMonths: 6,
      monthlyRent: 8000,
    });
    expect(r.breakdown.lockInViolated).toBe(false);
    expect(r.forfeitedAmount).toBe(0);
    expect(r.refundableAmount).toBe(16000);
  });

  it('6b. lockInMonths=0 → lock-in never violated, full refund', () => {
    const r = calculateForfeit({
      securityDepositAmount: 5000,
      forfeitType: 'forfeit_full',
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 2, 15),
      lockInMonths: 0,
      monthlyRent: 5000,
    });
    expect(r.forfeitedAmount).toBe(0);
    expect(r.refundableAmount).toBe(5000);
  });
});

describe('calculateForfeit — refund vs outstanding balance', () => {
  // Scenario 7 tests the mental model documented in previewTerminationSettlement:
  // refundableAmount − outstandingBalance  (floored at 0, excess → additionalCharge)
  it('7. outstanding > refundable → additionalCharge emerges', () => {
    const r = calculateForfeit({
      securityDepositAmount: 16000,
      forfeitType: 'forfeit_percent',
      forfeitPercent: 50,
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 8000,
    });
    // refundable = 8000
    expect(r.refundableAmount).toBe(8000);

    // Now simulate the preview math (same formula that previewTerminationSettlement uses).
    const outstanding = 12000; // guest owes 12k in unpaid utilities etc.
    const covered = Math.min(outstanding, r.refundableAmount); // 8000
    const netRefund = roundHalfToEven2(Math.max(0, r.refundableAmount - outstanding)); // 0
    const additionalCharge = roundHalfToEven2(Math.max(0, outstanding - covered)); // 4000

    expect(netRefund).toBe(0);
    expect(additionalCharge).toBe(4000);
  });
});

describe('calculateForfeit — rounding', () => {
  it("8. banker's rounding half-to-even: 12500.125 → 12500.12", () => {
    // 25000.25 * 50% = 12500.125 → half-to-even → 12500.12 (2 is even)
    const r = calculateForfeit({
      securityDepositAmount: 25000.25,
      forfeitType: 'forfeit_percent',
      forfeitPercent: 50,
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 10000,
    });
    expect(r.forfeitedAmount).toBeCloseTo(12500.12, 2);
    // refundable = 25000.25 - 12500.12 = 12500.13
    expect(r.refundableAmount).toBeCloseTo(12500.13, 2);
  });

  it('8b. half-to-even on the odd side: 12500.135 → 12500.14', () => {
    // Construct: deposit=25000.27, pct=50 → 12500.135 → .14 (4 even)
    // But raw float 25000.27*0.5 = 12500.135; half-to-even rounds to 12500.14
    const r = calculateForfeit({
      securityDepositAmount: 25000.27,
      forfeitType: 'forfeit_percent',
      forfeitPercent: 50,
      contractStartDate: d(2026, 1, 1),
      contractEndDate: d(2027, 1, 1),
      terminationDate: d(2026, 6, 1),
      lockInMonths: 12,
      monthlyRent: 10000,
    });
    expect(r.forfeitedAmount).toBeCloseTo(12500.14, 2);
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
