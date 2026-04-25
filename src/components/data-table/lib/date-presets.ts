/**
 * Date-range preset definitions for DataTable's Phase 4a date-range filter.
 *
 * Each preset maps to a `(today: Date) => { from: Date; to: Date }` computer.
 * `from` is inclusive-start-of-day, `to` is inclusive-end-of-day.
 *
 * The preset `id` is what we persist to the URL (readable & stable across
 * devices/timezones because it's re-computed against local `today` when
 * applied — no frozen timestamps in the URL).
 *
 * Timezone policy: all presets operate in local time — a user's "เดือนนี้"
 * is their calendar month, not UTC's.
 */

export type DatePresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear';

export interface DateRange {
  from: Date; // inclusive, start-of-day
  to:   Date; // inclusive, end-of-day
}

export interface DatePreset {
  id:    DatePresetId;
  label: string;
  compute: (now: Date) => DateRange;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    label: 'วันนี้',
    compute: now => ({ from: startOfDay(now), to: endOfDay(now) }),
  },
  {
    id: 'yesterday',
    label: 'เมื่อวาน',
    compute: now => {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y) };
    },
  },
  {
    id: 'last7',
    label: '7 วันล่าสุด',
    compute: now => ({ from: startOfDay(addDays(now, -6)), to: endOfDay(now) }),
  },
  {
    id: 'last30',
    label: '30 วันล่าสุด',
    compute: now => ({ from: startOfDay(addDays(now, -29)), to: endOfDay(now) }),
  },
  {
    id: 'thisMonth',
    label: 'เดือนนี้',
    compute: now => ({
      from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      to:   endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }),
  },
  {
    id: 'lastMonth',
    label: 'เดือนก่อน',
    compute: now => ({
      from: startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to:   endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
    }),
  },
  {
    id: 'thisQuarter',
    label: 'ไตรมาสนี้',
    compute: now => {
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      return {
        from: startOfDay(new Date(now.getFullYear(), qStart, 1)),
        to:   endOfDay(new Date(now.getFullYear(), qStart + 3, 0)),
      };
    },
  },
  {
    id: 'thisYear',
    label: 'ปีนี้',
    compute: now => ({
      from: startOfDay(new Date(now.getFullYear(), 0, 1)),
      to:   endOfDay(new Date(now.getFullYear(), 11, 31)),
    }),
  },
];

export function getPreset(id: DatePresetId): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

// ─── URL encoding ────────────────────────────────────────────────────────────

/**
 * Encode a date-range state to a URL-safe token.
 *
 *   Preset: "p:thisMonth"
 *   Custom: "c:2026-04-01..2026-04-20"   (ISO local-date; inclusive on both ends)
 *
 * We never write raw timestamps — preserve human-readability & timezone-sanity
 * across different devices / days.
 */
export interface DateRangeState {
  preset: DatePresetId | null; // null = custom
  from:   Date;
  to:     Date;
}

function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromLocalIsoDate(s: string, endOf: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const out = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(out.getTime())) return null;
  return endOf ? endOfDay(out) : startOfDay(out);
}

export function encodeDateRange(state: DateRangeState): string {
  if (state.preset) return `p:${state.preset}`;
  return `c:${toLocalIsoDate(state.from)}..${toLocalIsoDate(state.to)}`;
}

export function decodeDateRange(token: string): DateRangeState | null {
  if (!token) return null;
  if (token.startsWith('p:')) {
    const id = token.slice(2) as DatePresetId;
    const preset = getPreset(id);
    if (!preset) return null;
    const { from, to } = preset.compute(new Date());
    return { preset: id, from, to };
  }
  if (token.startsWith('c:')) {
    const [fromStr, toStr] = token.slice(2).split('..');
    const from = fromStr ? fromLocalIsoDate(fromStr, false) : null;
    const to   = toStr   ? fromLocalIsoDate(toStr, true)   : null;
    if (!from || !to) return null;
    return { preset: null, from, to };
  }
  return null;
}
