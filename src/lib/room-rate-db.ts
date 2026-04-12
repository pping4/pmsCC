/**
 * room-rate-db.ts
 * Helpers for room_rates table — supports both Prisma model and raw SQL fallback.
 *
 * CRITICAL BUGS FIXED:
 * 1. `id`/`roomId` leaked into Prisma update data → Prisma rejects unknown fields → save fails
 * 2. `ON CONFLICT` syntax error (42601) in raw SQL → replaced with SELECT + UPDATE/INSERT
 */
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

/* ───────── Types ───────── */

export interface RoomRateRow {
  id: string;
  roomId: string;
  dailyEnabled: boolean;
  dailyRate: number | null;
  monthlyShortEnabled: boolean;
  monthlyShortRate: number | null;
  monthlyShortFurniture: number;
  monthlyShortMinMonths: number;
  monthlyLongEnabled: boolean;
  monthlyLongRate: number | null;
  monthlyLongFurniture: number;
  monthlyLongMinMonths: number;
  waterRate: number | null;
  electricRate: number | null;
}

/** Pure data fields — NO id, NO roomId */
export interface RateData {
  dailyEnabled: boolean;
  dailyRate: number | null;
  monthlyShortEnabled: boolean;
  monthlyShortRate: number | null;
  monthlyShortFurniture: number;
  monthlyShortMinMonths: number;
  monthlyLongEnabled: boolean;
  monthlyLongRate: number | null;
  monthlyLongFurniture: number;
  monthlyLongMinMonths: number;
  waterRate: number | null;
  electricRate: number | null;
}

/* ───────── Internal helpers ───────── */

const SELECT_COLS = `
  id,
  room_id               AS "roomId",
  daily_enabled         AS "dailyEnabled",
  daily_rate            AS "dailyRate",
  monthly_short_enabled AS "monthlyShortEnabled",
  monthly_short_rate    AS "monthlyShortRate",
  monthly_short_furniture   AS "monthlyShortFurniture",
  monthly_short_min_months  AS "monthlyShortMinMonths",
  monthly_long_enabled  AS "monthlyLongEnabled",
  monthly_long_rate     AS "monthlyLongRate",
  monthly_long_furniture    AS "monthlyLongFurniture",
  monthly_long_min_months   AS "monthlyLongMinMonths",
  water_rate            AS "waterRate",
  electric_rate         AS "electricRate"
`;

function normalise(r: any): RoomRateRow {
  return {
    id: r.id,
    roomId: r.roomId,
    dailyEnabled: Boolean(r.dailyEnabled),
    dailyRate: r.dailyRate != null ? Number(r.dailyRate) : null,
    monthlyShortEnabled: Boolean(r.monthlyShortEnabled),
    monthlyShortRate: r.monthlyShortRate != null ? Number(r.monthlyShortRate) : null,
    monthlyShortFurniture: Number(r.monthlyShortFurniture ?? 0),
    monthlyShortMinMonths: Number(r.monthlyShortMinMonths ?? 1),
    monthlyLongEnabled: Boolean(r.monthlyLongEnabled),
    monthlyLongRate: r.monthlyLongRate != null ? Number(r.monthlyLongRate) : null,
    monthlyLongFurniture: Number(r.monthlyLongFurniture ?? 0),
    monthlyLongMinMonths: Number(r.monthlyLongMinMonths ?? 3),
    waterRate: r.waterRate != null ? Number(r.waterRate) : null,
    electricRate: r.electricRate != null ? Number(r.electricRate) : null,
  };
}

/** Strip id/roomId and any other non-RateData fields (defensive) */
function stripToRateData(obj: any): RateData {
  return {
    dailyEnabled: Boolean(obj.dailyEnabled),
    dailyRate: obj.dailyRate != null ? Number(obj.dailyRate) : null,
    monthlyShortEnabled: Boolean(obj.monthlyShortEnabled),
    monthlyShortRate: obj.monthlyShortRate != null ? Number(obj.monthlyShortRate) : null,
    monthlyShortFurniture: Number(obj.monthlyShortFurniture ?? 0),
    monthlyShortMinMonths: Number(obj.monthlyShortMinMonths ?? 1),
    monthlyLongEnabled: Boolean(obj.monthlyLongEnabled),
    monthlyLongRate: obj.monthlyLongRate != null ? Number(obj.monthlyLongRate) : null,
    monthlyLongFurniture: Number(obj.monthlyLongFurniture ?? 0),
    monthlyLongMinMonths: Number(obj.monthlyLongMinMonths ?? 3),
    waterRate: obj.waterRate != null ? Number(obj.waterRate) : null,
    electricRate: obj.electricRate != null ? Number(obj.electricRate) : null,
  };
}

function getPrismaRR(): any {
  const rr = (prisma as any).roomRate;
  return rr && typeof rr.findMany === 'function' ? rr : null;
}

/* ───────── READ operations ───────── */

export async function fetchAllRates(): Promise<RoomRateRow[]> {
  const rr = getPrismaRR();
  if (rr) {
    const rows = await rr.findMany();
    return rows.map(normalise);
  }
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT ${SELECT_COLS} FROM room_rates`
  );
  return (rows as any[]).map(normalise);
}

export async function fetchRateMap(): Promise<Record<string, RoomRateRow>> {
  const rows = await fetchAllRates();
  const map: Record<string, RoomRateRow> = {};
  for (const r of rows) map[r.roomId] = r;
  return map;
}

export async function fetchRateByRoomId(roomId: string): Promise<RoomRateRow | null> {
  const rr = getPrismaRR();
  if (rr) {
    const row = await rr.findUnique({ where: { roomId } });
    return row ? normalise(row) : null;
  }
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT ${SELECT_COLS} FROM room_rates WHERE room_id = $1`,
    roomId
  );
  const row = (rows as any[])[0];
  return row ? normalise(row) : null;
}

/* ───────── WRITE operations ───────── */

/** Upsert a single room rate. Always strips id/roomId from data before writing. */
export async function upsertRate(roomId: string, data: RateData): Promise<RoomRateRow> {
  // CRITICAL: always strip id/roomId to prevent Prisma "unknown field" errors
  const clean = stripToRateData(data);
  const rr = getPrismaRR();

  if (rr) {
    const existing = await rr.findUnique({ where: { roomId } });
    if (existing) {
      const saved = await rr.update({ where: { id: existing.id }, data: clean });
      return normalise(saved);
    } else {
      const saved = await rr.create({ data: { id: generateId(), roomId, ...clean } });
      return normalise(saved);
    }
  }

  // ── Raw SQL fallback (no ON CONFLICT — use SELECT then UPDATE or INSERT) ──
  const b = (v: boolean) => (v ? 'true' : 'false');

  const existingRows = await (prisma as any).$queryRawUnsafe(
    `SELECT id FROM room_rates WHERE room_id = $1`,
    roomId
  );

  if ((existingRows as any[]).length > 0) {
    // UPDATE existing row
    await (prisma as any).$executeRawUnsafe(
      `UPDATE room_rates SET
        daily_enabled         = ${b(clean.dailyEnabled)},
        daily_rate            = $1,
        monthly_short_enabled = ${b(clean.monthlyShortEnabled)},
        monthly_short_rate    = $2,
        monthly_short_furniture   = $3,
        monthly_short_min_months  = $4,
        monthly_long_enabled  = ${b(clean.monthlyLongEnabled)},
        monthly_long_rate     = $5,
        monthly_long_furniture    = $6,
        monthly_long_min_months   = $7,
        water_rate            = $8,
        electric_rate         = $9,
        updated_at            = NOW()
      WHERE room_id = $10`,
      clean.dailyRate,
      clean.monthlyShortRate,
      clean.monthlyShortFurniture,
      clean.monthlyShortMinMonths,
      clean.monthlyLongRate,
      clean.monthlyLongFurniture,
      clean.monthlyLongMinMonths,
      clean.waterRate,
      clean.electricRate,
      roomId
    );
  } else {
    // INSERT new row
    const id = generateId();
    await (prisma as any).$executeRawUnsafe(
      `INSERT INTO room_rates (
        id, room_id,
        daily_enabled, daily_rate,
        monthly_short_enabled, monthly_short_rate, monthly_short_furniture, monthly_short_min_months,
        monthly_long_enabled, monthly_long_rate, monthly_long_furniture, monthly_long_min_months,
        water_rate, electric_rate,
        updated_at
      ) VALUES (
        $1, $2,
        ${b(clean.dailyEnabled)}, $3,
        ${b(clean.monthlyShortEnabled)}, $4, $5, $6,
        ${b(clean.monthlyLongEnabled)}, $7, $8, $9,
        $10, $11,
        NOW()
      )`,
      id,
      roomId,
      clean.dailyRate,
      clean.monthlyShortRate,
      clean.monthlyShortFurniture,
      clean.monthlyShortMinMonths,
      clean.monthlyLongRate,
      clean.monthlyLongFurniture,
      clean.monthlyLongMinMonths,
      clean.waterRate,
      clean.electricRate
    );
  }

  const saved = await fetchRateByRoomId(roomId);
  if (!saved) throw new Error('Failed to read back saved rate');
  return saved;
}

/** Bulk upsert: merge patch into each room's existing data. */
export async function upsertRatesBulk(
  roomIds: string[],
  patch: Partial<RateData>
): Promise<RoomRateRow[]> {
  const DEFAULT_BASE: RateData = {
    dailyEnabled: false, dailyRate: null,
    monthlyShortEnabled: false, monthlyShortRate: null,
    monthlyShortFurniture: 0, monthlyShortMinMonths: 1,
    monthlyLongEnabled: false, monthlyLongRate: null,
    monthlyLongFurniture: 0, monthlyLongMinMonths: 3,
    waterRate: null, electricRate: null,
  };

  const results: RoomRateRow[] = [];
  for (const roomId of roomIds) {
    const existing = await fetchRateByRoomId(roomId);
    // CRITICAL: use stripToRateData to remove id/roomId from existing before merging
    const base: RateData = existing ? stripToRateData(existing) : DEFAULT_BASE;
    const merged: RateData = { ...base, ...patch };
    const saved = await upsertRate(roomId, merged);
    results.push(saved);
  }
  return results;
}
