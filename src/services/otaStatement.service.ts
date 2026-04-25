/**
 * otaStatement.service.ts — Phase H2
 *
 * Parses uploaded OTA statement CSV, creates an OtaStatement + OtaStatementLines,
 * and auto-matches lines against internal bookings by (otaBookingRef OR
 * guestName+checkIn fuzzy match). Unmatched lines flagged for manual review.
 *
 * Posting to ledger happens in a separate call (postOtaStatement) once the
 * user confirms reconciliation is correct.
 *
 * CSV format (flexible — headers detected by name, case-insensitive):
 *   required: booking_ref, guest_name, check_in, check_out, gross, commission
 *   optional: net, room_nights
 */

import { Prisma } from '@prisma/client';
import { postLedgerPair } from './ledger.service';
import { LedgerAccount } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface ParsedCsvLine {
  otaBookingRef:    string;
  guestName:        string;
  checkIn:          Date;
  checkOut:         Date;
  roomNights:       number;
  grossAmount:      number;
  commissionAmount: number;
  netAmount:        number;
}

export interface CsvParseResult {
  lines:  ParsedCsvLine[];
  errors: Array<{ rowIndex: number; message: string }>;
}

/** Normalize header cell → canonical key. */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const HEADER_ALIASES: Record<string, string[]> = {
  otaBookingRef:    ['booking_ref', 'reference', 'reservation_id', 'booking_id', 'ref'],
  guestName:        ['guest_name', 'guest', 'customer', 'name'],
  checkIn:          ['check_in', 'checkin', 'arrival', 'from'],
  checkOut:         ['check_out', 'checkout', 'departure', 'to'],
  roomNights:       ['room_nights', 'nights', 'los'],
  grossAmount:      ['gross', 'gross_amount', 'amount', 'total'],
  commissionAmount: ['commission', 'commission_amount', 'fee'],
  netAmount:        ['net', 'net_amount', 'payable', 'payout'],
};

/** Minimal CSV parser — handles quoted fields + CRLF + BOM. */
export function parseCsv(csv: string): string[][] {
  const stripped = csv.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inQuotes) {
      if (c === '"' && stripped[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cell += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else { cell += c; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function parseStatementCsv(csv: string): CsvParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { lines: [], errors: [{ rowIndex: 0, message: 'CSV ว่างเปล่าหรือไม่มีข้อมูล' }] };

  const headers = rows[0].map(normalizeHeader);
  const colIdx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex(h => aliases.includes(h));
    if (idx >= 0) colIdx[key] = idx;
  }
  const missing = ['otaBookingRef', 'guestName', 'checkIn', 'checkOut', 'grossAmount', 'commissionAmount']
    .filter(k => !(k in colIdx));
  if (missing.length > 0) {
    return { lines: [], errors: [{ rowIndex: 0, message: `คอลัมน์ที่ต้องมี: ${missing.join(', ')}` }] };
  }

  const lines: ParsedCsvLine[] = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (k: string) => (row[colIdx[k]] ?? '').trim();
    try {
      const gross = parseNumber(get('grossAmount'));
      const commission = parseNumber(get('commissionAmount'));
      const netRaw = colIdx.netAmount != null ? parseNumber(get('netAmount')) : NaN;
      const net = Number.isFinite(netRaw) ? netRaw : gross - commission;
      const checkIn = parseDate(get('checkIn'));
      const checkOut = parseDate(get('checkOut'));
      if (!checkIn || !checkOut) { errors.push({ rowIndex: r, message: 'วันที่ไม่ถูกต้อง' }); continue; }
      const nightsRaw = colIdx.roomNights != null ? parseInt(get('roomNights'), 10) : NaN;
      const roomNights = Number.isFinite(nightsRaw)
        ? nightsRaw
        : Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000));

      lines.push({
        otaBookingRef: get('otaBookingRef'),
        guestName:     get('guestName'),
        checkIn,
        checkOut,
        roomNights,
        grossAmount:      round2(gross),
        commissionAmount: round2(commission),
        netAmount:        round2(net),
      });
    } catch (e) {
      errors.push({ rowIndex: r, message: e instanceof Error ? e.message : 'parse error' });
    }
  }
  return { lines, errors };
}

function parseNumber(s: string): number {
  const n = Number(s.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) throw new Error(`ตัวเลขไม่ถูกต้อง: "${s}"`);
  return n;
}
function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Ingest: create statement + lines, attempt auto-match ──────────────────

export interface IngestInput {
  agentId:     string;
  periodStart: Date;
  periodEnd:   Date;
  lines:       ParsedCsvLine[];
  uploadedBy:  string;
}

export async function ingestStatement(tx: Tx, input: IngestInput) {
  const totals = input.lines.reduce(
    (t, l) => ({
      gross:      t.gross      + l.grossAmount,
      commission: t.commission + l.commissionAmount,
      net:        t.net        + l.netAmount,
    }),
    { gross: 0, commission: 0, net: 0 },
  );

  const statement = await tx.otaStatement.create({
    data: {
      agentId:         input.agentId,
      periodStart:     input.periodStart,
      periodEnd:       input.periodEnd,
      totalGross:      round2(totals.gross),
      totalCommission: round2(totals.commission),
      netPayable:      round2(totals.net),
      status:          'draft',
      uploadedBy:      input.uploadedBy,
    },
    select: { id: true },
  });

  for (const ln of input.lines) {
    const match = await findMatchingBooking(tx, ln);
    await tx.otaStatementLine.create({
      data: {
        statementId:      statement.id,
        otaBookingRef:    ln.otaBookingRef,
        guestName:        ln.guestName,
        checkIn:          ln.checkIn,
        checkOut:         ln.checkOut,
        roomNights:       ln.roomNights,
        grossAmount:      ln.grossAmount,
        commissionAmount: ln.commissionAmount,
        netAmount:        ln.netAmount,
        matchedBookingId: match?.id ?? null,
        matchStatus:      match ? 'auto_matched' : 'unmatched',
      },
    });
  }

  return { statementId: statement.id, totals };
}

/**
 * Match priority:
 *   1. Exact otaBookingRef on Booking.otaBookingRef
 *   2. guestName (fuzzy, last-name contains) + checkIn date equal
 */
async function findMatchingBooking(tx: Tx, ln: ParsedCsvLine): Promise<{ id: string } | null> {
  if (ln.otaBookingRef) {
    const byRef = await tx.booking.findFirst({
      where: { otaBookingRef: ln.otaBookingRef },
      select: { id: true },
    });
    if (byRef) return byRef;
  }
  const parts = ln.guestName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const lastPart = parts[parts.length - 1];
  const byName = await tx.booking.findFirst({
    where: {
      checkIn: ln.checkIn,
      OR: [
        { guest: { lastName:   { contains: lastPart, mode: 'insensitive' } } },
        { guest: { firstName:  { contains: lastPart, mode: 'insensitive' } } },
        { guest: { lastNameTH: { contains: lastPart, mode: 'insensitive' } } },
      ],
    },
    select: { id: true },
  });
  return byName;
}

// ─── Post to ledger (once user confirms) ────────────────────────────────────

/**
 * Book the reconciled statement:
 *   DR BANK        (net)         | CR AR (gross-commission via ota_collect originally booked as AR)
 *   DR EXPENSE     (commission)  | CR AR (commission portion)
 * Net effect: AR cleared by total gross; BANK increased by net; commission
 * expense recognized.
 */
export async function postStatement(tx: Tx, statementId: string, postedBy: string) {
  const stmt = await tx.otaStatement.findUniqueOrThrow({
    where: { id: statementId },
    select: {
      id: true, status: true, totalGross: true, totalCommission: true,
      netPayable: true, agent: { select: { code: true, name: true } },
    },
  });
  if (stmt.status === 'posted') throw new Error('งบนี้ถูกโพสต์เข้าสมุดบัญชีแล้ว');
  if (stmt.status === 'void')   throw new Error('งบนี้ถูกยกเลิก');

  const net        = Number(stmt.netPayable);
  const commission = Number(stmt.totalCommission);

  if (net > 0) {
    await postLedgerPair(tx, {
      debitAccount:  LedgerAccount.BANK,
      creditAccount: LedgerAccount.AR,
      amount:        net,
      referenceType: 'OtaStatement',
      referenceId:   stmt.id,
      description:   `OTA settlement ${stmt.agent.name} (net)`,
      createdBy:     postedBy,
    });
  }
  if (commission > 0) {
    await postLedgerPair(tx, {
      debitAccount:  LedgerAccount.EXPENSE,
      creditAccount: LedgerAccount.AR,
      amount:        commission,
      referenceType: 'OtaStatement',
      referenceId:   stmt.id,
      description:   `OTA commission ${stmt.agent.name}`,
      createdBy:     postedBy,
    });
  }

  await tx.otaStatement.update({
    where: { id: statementId },
    data:  { status: 'posted', postedAt: new Date(), postedBy },
  });
}
