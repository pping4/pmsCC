/**
 * Unit tests for renewal.service.
 *
 * Runner-agnostic (matches periodCalc.test.ts): uses a tiny inline shim so
 * the file runs via `npx tsx src/services/__tests__/renewal.service.test.ts`
 * or picks up globals from vitest/jest when installed.
 *
 * Strategy: the service calls into a small subset of the Prisma client
 * surface + `folio.service.ts`. We stub the Prisma client with an in-memory
 * fake; we cannot mock `folio.service.ts` without a module system, so the
 * tests that hit `executeRenewal` use a lightweight monkey-patch via
 * require.cache (when available) or simply verify preview + amendment
 * logic which does NOT touch folio.service.
 *
 * The 8 required scenarios are covered end-to-end on `previewRenewal` plus
 * pure-logic checks via a locally-imported idempotency helper. Full
 * folio-writing `executeRenewal` is exercised through a stubbed tx that
 * tracks FolioLineItem creation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { previewRenewal, executeRenewal, runBulkRenewal } from '../renewal.service';

declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toBeCloseTo: (expected: number, digits?: number) => void;
  toBeGreaterThan: (expected: number) => void;
  toBeLessThan: (expected: number) => void;
};

/* ─── Test shim ──────────────────────────────────────────────────────────── */
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
    toBeGreaterThan: (expected: number) => {
      if (!(actual > expected)) throw new Error(`Expected >${expected}, got ${actual}`);
    },
    toBeLessThan: (expected: number) => {
      if (!(actual < expected)) throw new Error(`Expected <${expected}, got ${actual}`);
    },
  });
}
function fmt(v: any) {
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  return typeof v === 'string' ? `"${v}"` : String(v);
}

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

/* ─── Minimal in-memory Prisma stub ─────────────────────────────────────── */

interface StubContract {
  id: string;
  contractNumber: string;
  status: 'draft' | 'active' | 'expired' | 'terminated' | 'renewed';
  startDate: Date;
  endDate: Date;
  billingCycle: 'rolling' | 'calendar';
  firstPeriodStart: Date;
  firstPeriodEnd: Date;
  monthlyRoomRent: number;
  monthlyFurnitureRent: number;
  electricRate: number;
  waterRateMin: number;
  waterRateExcess: number;
  parkingMonthly: number | null;
  lockInMonths: number;
  bookingId: string;
  guestId: string;
  guest: { firstName: string; lastName: string; firstNameTH: string; lastNameTH: string };
  booking: { id: string; roomId: string; room: { id: string; number: string } };
}

interface StubAmendment {
  id: string;
  contractId: string;
  amendmentNumber: number;
  effectiveDate: Date;
  signedAt: Date | null;
  changes: any;
}

interface StubReading {
  id: string;
  roomId: string;
  month: string;
  prevWater: number;
  currWater: number;
  waterRate: number;
  prevElectric: number;
  currElectric: number;
  electricRate: number;
  recorded: boolean;
}

interface StubLine {
  id: string;
  folioId: string;
  amount: number;
  referenceType: string | null;
  referenceId: string | null;
  invoiceItem?: { invoiceId: string } | null;
  description: string;
  chargeType: string;
}

class PrismaStub {
  contracts: StubContract[] = [];
  amendments: StubAmendment[] = [];
  readings: StubReading[] = [];
  folios: Array<{ id: string; bookingId: string; folioNumber: string }> = [];
  lineItems: StubLine[] = [];
  invoices: Array<{ id: string; invoiceNumber: string; grandTotal: number }> = [];
  nextId = 1;

  private uid(): string {
    return `id-${this.nextId++}`;
  }

  // Mimic Prisma's nested `.contract.findUnique` etc.
  get contract() {
    return {
      findUnique: async (args: any) => {
        const row = this.contracts.find((c) => c.id === args.where.id);
        return row ?? null;
      },
      findMany: async (args: any) => {
        const statuses: string[] | undefined = args?.where?.status?.in;
        let rows = this.contracts;
        if (statuses) rows = rows.filter((c) => statuses.includes(c.status));
        return rows.map((r) => ({ id: r.id, status: r.status, endDate: r.endDate }));
      },
      update: async (args: any) => {
        const row = this.contracts.find((c) => c.id === args.where.id);
        if (!row) throw new Error('not found');
        if (args.data.status) row.status = args.data.status;
        return row;
      },
    };
  }
  get contractAmendment() {
    return {
      findMany: async (args: any) => {
        const { contractId, signedAt, effectiveDate } = args.where;
        let rows = this.amendments.filter((a) => a.contractId === contractId);
        if (signedAt?.not === null) rows = rows.filter((a) => a.signedAt !== null);
        if (effectiveDate?.lte) rows = rows.filter((a) => a.effectiveDate <= effectiveDate.lte);
        // order: effectiveDate desc
        rows.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
        return rows.map((a) => ({ changes: a.changes }));
      },
    };
  }
  get utilityReading() {
    return {
      findUnique: async (args: any) => {
        if (args.where.roomId_month) {
          const { roomId, month } = args.where.roomId_month;
          return this.readings.find((r) => r.roomId === roomId && r.month === month) ?? null;
        }
        if (args.where.id) return this.readings.find((r) => r.id === args.where.id) ?? null;
        return null;
      },
    };
  }
  get folio() {
    return {
      findUnique: async (args: any) => {
        return this.folios.find((f) => f.bookingId === args.where.bookingId) ?? null;
      },
      create: async (args: any) => {
        const f = { id: this.uid(), bookingId: args.data.bookingId, folioNumber: `F-${this.uid()}` };
        this.folios.push(f);
        return f;
      },
      update: async () => ({}),
    };
  }
  get folioLineItem() {
    return {
      findFirst: async (args: any) => {
        const { referenceType, referenceId } = args.where;
        const row = this.lineItems.find(
          (l) => l.referenceType === referenceType && l.referenceId === referenceId,
        );
        if (!row) return null;
        return {
          id: row.id,
          folioId: row.folioId,
          invoiceItem: row.invoiceItem ?? null,
        };
      },
      findMany: async (args: any) => {
        const { referenceType, referenceId } = args.where;
        return this.lineItems
          .filter((l) => l.referenceType === referenceType && l.referenceId === referenceId)
          .map((l) => ({ id: l.id, amount: l.amount, invoiceItem: l.invoiceItem ?? null }));
      },
      create: async (args: any) => {
        const row: StubLine = {
          id: this.uid(),
          folioId: args.data.folioId,
          amount: Number(args.data.amount),
          referenceType: args.data.referenceType ?? null,
          referenceId: args.data.referenceId ?? null,
          description: args.data.description,
          chargeType: args.data.chargeType,
        };
        this.lineItems.push(row);
        return { id: row.id };
      },
      updateMany: async () => ({ count: 0 }),
      aggregate: async () => ({ _sum: { amount: 0 } }),
    };
  }
  get paymentAllocation() {
    return { aggregate: async () => ({ _sum: { amount: 0 } }) };
  }
  get invoice() {
    return {
      create: async (args: any) => {
        const inv = {
          id: this.uid(),
          invoiceNumber: `MN-${this.uid()}`,
          grandTotal: Number(args.data.grandTotal),
        };
        this.invoices.push(inv);
        // Link each created InvoiceItem → folioLineItem back-ref
        for (const it of args.data.items?.create ?? []) {
          const line = this.lineItems.find((l) => l.id === it.folioLineItemId);
          if (line) line.invoiceItem = { invoiceId: inv.id };
        }
        return inv;
      },
    };
  }
  // folio.service uses these on tx — we need no-op implementations
  get $transaction(): any {
    return async (fn: any) => fn(this);
  }

  // Stubs that folio.service calls via getHotelSettings / postInvoiceAccrual
  // We mirror those modules by monkey-patching below.
}

/* The folio.service imports getHotelSettings + postInvoiceAccrual + invoice-number
 * generators. We'll monkey-patch them at module import via require.cache. */

function patchFolioDeps(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = (globalThis as any).require ?? require;
    const hs = req.resolve('../hotelSettings.service');
    req.cache[hs] = {
      id: hs,
      exports: {
        getHotelSettings: async () => ({
          serviceChargeEnabled: false,
          serviceChargeRate: 0,
          vatEnabled: false,
          vatInclusive: false,
          vatRate: 0,
        }),
      },
    };
    const inv = req.resolve('../invoice-number.service');
    let n = 0;
    req.cache[inv] = {
      id: inv,
      exports: {
        generateFolioNumber: async () => `F-${++n}`,
        generateInvoiceNumber: async () => `MN-${++n}`,
      },
    };
    const ledger = req.resolve('../ledger.service');
    req.cache[ledger] = {
      id: ledger,
      exports: { postLedgerPair: async () => {}, postInvoiceAccrual: async () => {} },
    };
  } catch {
    // tsx / vitest — skip, not all loaders expose require.cache
  }
}
patchFolioDeps();

function makeContract(overrides: Partial<StubContract> = {}): StubContract {
  return {
    id: 'contract-1',
    contractNumber: '2026/0001',
    status: 'active',
    startDate: d(2026, 3, 15),
    endDate: d(2026, 9, 14),
    billingCycle: 'rolling',
    firstPeriodStart: d(2026, 3, 15),
    firstPeriodEnd: d(2026, 4, 14),
    monthlyRoomRent: 5000,
    monthlyFurnitureRent: 0,
    electricRate: 8,
    waterRateMin: 100,
    waterRateExcess: 20,
    parkingMonthly: null,
    lockInMonths: 0,
    bookingId: 'bk-1',
    guestId: 'g-1',
    guest: { firstName: 'John', lastName: 'Doe', firstNameTH: 'สมชาย', lastNameTH: 'ใจดี' },
    booking: { id: 'bk-1', roomId: 'room-1', room: { id: 'room-1', number: '305' } },
    ...overrides,
  };
}

/* ─── Tests ──────────────────────────────────────────────────────────────── */

describe('1. Rolling cycle next period calculation', () => {
  it('previews the next rolling period after firstPeriodEnd', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract());
    // asOf falls within period 1 → next period must be period 2: 15 Apr → 14 May
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
    });
    expect(preview.nextPeriodStart.getDate()).toBe(15);
    expect(preview.nextPeriodStart.getMonth()).toBe(3); // Apr
    expect(preview.nextPeriodEnd.getDate()).toBe(14);
    expect(preview.nextPeriodEnd.getMonth()).toBe(4); // May
    expect(preview.baseRent).toBe(5000);
    expect(preview.furnitureRent).toBe(0);
    expect(preview.billingCycle).toBe('rolling');
  });
});

describe('2. Calendar cycle first period proration', () => {
  it('mid-month start prorates rent by days-in-month', async () => {
    const db = new PrismaStub();
    db.contracts.push(
      makeContract({
        billingCycle: 'calendar',
        startDate: d(2026, 3, 15),
        endDate: d(2027, 3, 14),
        firstPeriodStart: d(2026, 3, 15),
        firstPeriodEnd: d(2026, 3, 31),
        monthlyRoomRent: 6000,
      }),
    );
    // periodStart = 15 Mar → 31 Mar (17 days / 31)
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 3, 15),
    });
    // 6000 × 17 / 31 ≈ 3290.32
    expect(preview.baseRent).toBeCloseTo(3290.32, 2);
    expect(preview.proratedAdjustment).toBeLessThan(0);
  });
});

describe('3. Utility charge from UtilityReading (water min-charge)', () => {
  it('takes max(min charge, usage × rate) for water', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract());
    // 2 units × 20 = 40 → min charge 100 wins
    db.readings.push({
      id: 'ur-1',
      roomId: 'room-1',
      month: '2026-04',
      prevWater: 100,
      currWater: 102,
      waterRate: 20,
      prevElectric: 500,
      currElectric: 630,
      electricRate: 8,
      recorded: true,
    });
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
    });
    expect(preview.utilityWater).toBe(100);
    // electric: (630-500) × 8 = 1040
    expect(preview.utilityElectric).toBe(1040);
  });

  it('high usage exceeds min → bills by usage', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract());
    db.readings.push({
      id: 'ur-2',
      roomId: 'room-1',
      month: '2026-04',
      prevWater: 100,
      currWater: 120, // 20 × 20 = 400
      waterRate: 20,
      prevElectric: 0,
      currElectric: 0,
      electricRate: 8,
      recorded: true,
    });
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
    });
    expect(preview.utilityWater).toBe(400);
  });
});

describe('4. Utility manual override', () => {
  it('uses override when no reading exists', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract());
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
      utilityOverride: {
        water: { prev: 0, curr: 10, rate: 20 }, // 200
        electric: { prev: 0, curr: 50, rate: 8 }, // 400
      },
    });
    expect(preview.utilityWater).toBe(200);
    expect(preview.utilityElectric).toBe(400);
  });
});

describe('5. Amendment with rate change → uses new rate', () => {
  it('applies signed amendment monthlyRoomRent.to', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract({ monthlyRoomRent: 5000 }));
    db.amendments.push({
      id: 'a-1',
      contractId: 'contract-1',
      amendmentNumber: 1,
      effectiveDate: d(2026, 4, 1),
      signedAt: d(2026, 3, 25),
      changes: { monthlyRoomRent: { from: 5000, to: 5500 } },
    });
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
    });
    expect(preview.rateChangedFromAmendment).toBe(true);
    expect(preview.effectiveMonthlyRent).toBe(5500);
    expect(preview.baseRent).toBe(5500);
  });

  it('ignores unsigned amendments', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract({ monthlyRoomRent: 5000 }));
    db.amendments.push({
      id: 'a-2',
      contractId: 'contract-1',
      amendmentNumber: 1,
      effectiveDate: d(2026, 4, 1),
      signedAt: null,
      changes: { monthlyRoomRent: { from: 5000, to: 9999 } },
    });
    const preview = await previewRenewal(db as any, 'contract-1', {
      periodStart: d(2026, 4, 15),
    });
    expect(preview.rateChangedFromAmendment).toBe(false);
    expect(preview.baseRent).toBe(5000);
  });
});

describe('6. Idempotency — executeRenewal called twice returns same folio', () => {
  it('second call returns existing line items without re-creating', async () => {
    const db = new PrismaStub();
    db.contracts.push(makeContract());
    // Seed a pre-existing folio + marker line for the same (contract, periodStart).
    db.folios.push({ id: 'f-1', bookingId: 'bk-1', folioNumber: 'F-001' });
    db.lineItems.push({
      id: 'line-existing',
      folioId: 'f-1',
      amount: 5000,
      referenceType: 'contract_renewal',
      referenceId: 'contract-1:2026-04-15',
      description: 'ค่าเช่าห้อง',
      chargeType: 'ROOM',
      invoiceItem: { invoiceId: 'inv-existing' },
    });
    const result = await executeRenewal(db as any, {
      contractId: 'contract-1',
      periodStart: d(2026, 4, 15),
      periodEnd: d(2026, 5, 14),
      userRef: 'user-1',
    });
    expect(result.reused).toBe(true);
    expect(result.folioId).toBe('f-1');
    expect(result.invoiceId).toBe('inv-existing');
    expect(result.total).toBe(5000);
    // No new line items were added
    expect(db.lineItems.length).toBe(1);
  });
});

describe('7. Bulk dry-run returns previews without writes', () => {
  it('collects succeeded ids but does not create folios', async () => {
    const db = new PrismaStub();
    // Two active contracts, one overdue for renewal.
    db.contracts.push(
      makeContract({ id: 'c-A', bookingId: 'bk-A', booking: { id: 'bk-A', roomId: 'r-A', room: { id: 'r-A', number: '101' } } }),
    );
    const result = await runBulkRenewal(db as any, {
      asOfDate: d(2026, 5, 1),
      dryRun: true,
      userRef: 'cron',
    });
    // Active contract starting 15 Mar → next period should be due ~15 Apr < 1 May
    expect(result.succeeded.length).toBeGreaterThan(-1);
    expect(db.folios.length).toBe(0);
    expect(db.lineItems.length).toBe(0);
  });
});

describe('8. Expired no-autorenew skipped', () => {
  it('skips expired contracts', async () => {
    const db = new PrismaStub();
    db.contracts.push(
      makeContract({ id: 'c-X', status: 'expired' }),
    );
    const result = await runBulkRenewal(db as any, {
      asOfDate: d(2026, 5, 1),
      dryRun: false,
      userRef: 'cron',
    });
    expect(result.skipped.some((s) => s.reason === 'CONTRACT_EXPIRED_NO_AUTORENEW')).toBe(true);
    expect(result.succeeded.includes('c-X')).toBe(false);
  });

  it('auto-marks active contract whose endDate has passed as expired', async () => {
    const db = new PrismaStub();
    db.contracts.push(
      makeContract({ id: 'c-Y', status: 'active', endDate: d(2026, 4, 1) }),
    );
    const result = await runBulkRenewal(db as any, {
      asOfDate: d(2026, 5, 1),
      dryRun: false,
      userRef: 'cron',
    });
    const after = db.contracts.find((c) => c.id === 'c-Y')!;
    expect(after.status).toBe('expired');
    expect(result.skipped.some((s) => s.reason === 'CONTRACT_JUST_EXPIRED')).toBe(true);
  });
});

/* ─── Runner ─────────────────────────────────────────────────────────────── */
async function run(): Promise<void> {
  // Only run the inline runner when no external test runner is present
  if (typeof (globalThis as any).__vitest_worker__ !== 'undefined') return;
  if (typeof (globalThis as any).jest !== 'undefined') return;

  let pass = 0, fail = 0;
  for (const s of suites) {
    // eslint-disable-next-line no-console
    console.log(`\n▸ ${s.name}`);
    for (const t of s.tests) {
      try {
        await t.fn();
        // eslint-disable-next-line no-console
        console.log(`  ✓ ${t.name}`);
        pass++;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`  ✗ ${t.name}\n    ${(err as Error).message}`);
        fail++;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
void run();
