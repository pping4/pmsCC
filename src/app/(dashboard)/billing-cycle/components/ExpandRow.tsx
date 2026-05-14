/**
 * ExpandRow.tsx — Billing Cycle / Task 3.2
 *
 * Renders lazy-loaded billing history for a single booking when the manager
 * clicks the "▼ ประวัติ" toggle in the review table.
 *
 * Layout (top-to-bottom):
 *  1. 5-card summary strip (check-in, deposit, invoices, outstanding, avg delay)
 *  2. Past invoices table (cycle, invoice#, rent/water/electric/total, paid, paid-date, days-late, status)
 *  3. Meter reading history table
 *  4. Quick-links row
 *
 * Auth: data is gated server-side to admin|manager|staff. No client role check
 * is needed here — the API will return 403 if the session is insufficient.
 *
 * All dates via fmtDate/fmtDateTime. All money via fmtBaht. No th-TH locale.
 */

'use client';

import { useState, useEffect } from 'react';
import { fmtDate, fmtBaht } from '@/lib/date-format';

// ─── API types ────────────────────────────────────────────────────────────────

interface BillingSummary {
  checkIn:            string;
  depositStatus:      'paid' | 'unpaid';
  invoicesCount:      number;
  outstandingBalance: number;
  avgDaysLate:        number;
}

interface InvoiceHistoryRow {
  cycleIndex:     number;
  invoiceNumber:  string;
  periodStart:    string;
  periodEnd:      string;
  rentAmount:     number;
  waterAmount:    number;
  electricAmount: number;
  grandTotal:     number;
  paidAmount:     number;
  paidDate:       string;
  daysLate:       number | null;
  status:         string;
}

interface ReadingRow {
  id:           string;
  readingDate:  string;
  prevWater:    number;
  currWater:    number;
  prevElectric: number;
  currElectric: number;
  waterRate:    number;
  electricRate: number;
  notes:        string | null;
  recordedBy:   string | null;
}

interface HistoryData {
  summary:  BillingSummary;
  invoices: InvoiceHistoryRow[];
  readings: ReadingRow[];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExpandRowProps {
  bookingId:   string;
  contractId?: string;
}

// ─── Status badge colours ─────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { fg: string; bg: string; label: string }> = {
  draft:    { fg: '#4b5563', bg: '#f3f4f6', label: 'ร่าง'       },
  unpaid:   { fg: '#c2410c', bg: '#ffedd5', label: 'ยังไม่จ่าย'  },
  partial:  { fg: '#92400e', bg: '#fef3c7', label: 'จ่ายบางส่วน' },
  paid:     { fg: '#16a34a', bg: '#dcfce7', label: 'จ่ายแล้ว'    },
  overdue:  { fg: '#b91c1c', bg: '#fee2e2', label: 'เกินกำหนด'   },
  void:     { fg: '#6b7280', bg: '#e5e7eb', label: 'ยกเลิก'      },
  rejected: { fg: '#6b7280', bg: '#e5e7eb', label: 'Rejected'    },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { fg: '#374151', bg: '#f3f4f6', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 10,
      fontSize: 10, fontWeight: 700,
      background: s.bg, color: s.fg,
    }}>
      {s.label}
    </span>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, fg, bg,
}: {
  label: string; value: React.ReactNode; sub?: string; fg?: string; bg?: string;
}) {
  return (
    <div className="pms-card" style={{
      flex: '1 1 140px',
      border: '1px solid var(--border-default)',
      borderRadius: 10, padding: '12px 14px',
      background: bg ?? 'var(--surface-card)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: fg ?? 'var(--text-primary)', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── Skeleton placeholder ─────────────────────────────────────────────────────

function ExpandSkeleton() {
  const bar = (w: string) => (
    <div style={{
      height: 12, background: 'var(--surface-muted)',
      borderRadius: 4, width: w,
      animation: 'expandSkeleton 1.4s ease-in-out infinite',
    }} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {['30%', '20%', '20%', '15%', '15%'].map((w, i) => (
          <div key={i} style={{ flex: '1 1 120px', border: '1px solid var(--border-light)', borderRadius: 10, padding: 12 }}>
            {bar('60%')}
            <div style={{ height: 8 }} />
            {bar(w)}
          </div>
        ))}
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12 }}>
          {bar('8%')}
          {bar('15%')}
          {bar('25%')}
          {bar('12%')}
          {bar('12%')}
          {bar('10%')}
        </div>
      ))}
      <style>{`
        @keyframes expandSkeleton {
          0%,100% { opacity: 0.5 }
          50%      { opacity: 1   }
        }
      `}</style>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpandRow({ bookingId, contractId }: ExpandRowProps) {
  const [data,    setData]    = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/bookings/${bookingId}/billing-history`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<HistoryData>;
      })
      .then(d => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  };

  useEffect(() => {
    if (!bookingId) return;
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (loading) return <ExpandSkeleton />;

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: '#b91c1c' }}>โหลดข้อมูลไม่สำเร็จ: {error}</span>
        <button
          type="button"
          onClick={load}
          style={{
            fontSize: 12, padding: '4px 12px',
            border: '1px solid var(--border-default)',
            borderRadius: 6, cursor: 'pointer',
            background: 'var(--surface-card)', color: 'var(--text-primary)',
          }}
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { summary, invoices, readings } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 1. Summary strip ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <SummaryCard
          label="เข้าพัก"
          value={fmtDate(summary.checkIn)}
        />
        <SummaryCard
          label="มัดจำ"
          value={summary.depositStatus === 'paid' ? '✓ จ่ายแล้ว' : '✗ ยังไม่จ่าย'}
          fg={summary.depositStatus === 'paid' ? '#16a34a' : '#b91c1c'}
          bg={summary.depositStatus === 'paid' ? '#f0fdf4' : '#fef2f2'}
        />
        <SummaryCard
          label="บิลออกแล้ว"
          value={summary.invoicesCount}
          sub="รอบ"
        />
        <SummaryCard
          label="ค้างชำระ"
          value={`฿${fmtBaht(summary.outstandingBalance)}`}
          fg={summary.outstandingBalance > 0 ? '#b91c1c' : '#16a34a'}
          bg={summary.outstandingBalance > 0 ? '#fef2f2' : '#f0fdf4'}
        />
        <SummaryCard
          label="จ่ายตรงเฉลี่ย"
          value={summary.avgDaysLate === 0 ? '✓ ตรงเวลา' : `+${summary.avgDaysLate} วัน`}
          fg={summary.avgDaysLate === 0 ? '#16a34a' : '#c2410c'}
          bg={summary.avgDaysLate === 0 ? '#f0fdf4' : '#fff7ed'}
        />
      </div>

      {/* ── 2. Invoice history table ──────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
          ประวัติบิล ({invoices.length} รายการ)
        </div>
        {invoices.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
            ยังไม่มีประวัติบิล
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 12, color: 'var(--text-secondary)',
            }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  {['รอบ', 'เลขที่บิล', 'ช่วงเวลา', 'ค่าห้อง', 'ค่าน้ำ', 'ค่าไฟ', 'รวม', 'จ่ายแล้ว', 'วันที่จ่าย', 'ช้า (วัน)', 'สถานะ'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: h === 'รอบ' ? 'center' : 'left',
                      fontWeight: 600, borderBottom: '1px solid var(--border-light)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr
                    key={inv.invoiceNumber}
                    style={{ background: idx % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}
                  >
                    <td style={{ padding: '5px 10px', textAlign: 'center', fontWeight: 700 }}>
                      {inv.cycleIndex}
                    </td>
                    <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11 }}>
                      {inv.invoiceNumber}
                    </td>
                    <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                      {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtBaht(inv.rentAmount)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {inv.waterAmount > 0 ? fmtBaht(inv.waterAmount) : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {inv.electricAmount > 0 ? fmtBaht(inv.electricAmount) : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      ฿{fmtBaht(inv.grandTotal)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {inv.paidAmount > 0 ? fmtBaht(inv.paidAmount) : '—'}
                    </td>
                    <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                      {inv.paidDate ? fmtDate(inv.paidDate) : '—'}
                    </td>
                    <td style={{
                      padding: '5px 10px', textAlign: 'center',
                      color: (inv.daysLate ?? 0) > 0 ? '#c2410c' : '#16a34a',
                      fontWeight: 600,
                    }}>
                      {inv.daysLate == null ? '—' : inv.daysLate === 0 ? '✓' : `+${inv.daysLate}`}
                    </td>
                    <td style={{ padding: '5px 10px' }}>
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 3. Meter reading history ──────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
          ประวัติมิเตอร์ ({readings.length} ครั้ง)
        </div>
        {readings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
            ยังไม่มีประวัติมิเตอร์
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 12, color: 'var(--text-secondary)',
            }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  {['วันที่', 'ผู้บันทึก', 'น้ำก่อน', 'น้ำหลัง', 'ใช้น้ำ', 'ไฟก่อน', 'ไฟหลัง', 'ใช้ไฟ', 'หมายเหตุ'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: 'left',
                      fontWeight: 600, borderBottom: '1px solid var(--border-light)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map((r, idx) => (
                  <tr
                    key={r.id}
                    style={{ background: idx % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}
                  >
                    <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.readingDate)}
                    </td>
                    <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.recordedBy ?? '—'}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {r.prevWater}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {r.currWater}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.currWater - r.prevWater}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {r.prevElectric}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {r.currElectric}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {r.currElectric - r.prevElectric}
                    </td>
                    <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 4. Quick links ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a
          href={`/reservation?bookingId=${bookingId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12, padding: '6px 14px',
            border: '1px solid var(--border-default)',
            borderRadius: 7, cursor: 'pointer',
            background: 'var(--surface-card)', color: 'var(--text-primary)',
            textDecoration: 'none', fontWeight: 600,
          }}
        >
          🔗 เปิด booking detail
        </a>
        {contractId && (
          <a
            href={`/contracts/${contractId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12, padding: '6px 14px',
              border: '1px solid var(--border-default)',
              borderRadius: 7, cursor: 'pointer',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              textDecoration: 'none', fontWeight: 600,
            }}
          >
            📄 ดูสัญญา
          </a>
        )}
      </div>
    </div>
  );
}
