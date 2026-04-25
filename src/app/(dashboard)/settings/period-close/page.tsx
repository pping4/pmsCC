/**
 * Period Close — admin-only.
 *
 * Shows 12 months of the selected year. Each month is either OPEN (can still
 * post) or CLOSED (ledger writes refused). Closing requires admin role; the
 * UI warns about open cash sessions before letting the admin force-close.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fmtDateTime } from '@/lib/date-format';

type Status = 'OPEN' | 'CLOSED';

interface PeriodRow {
  id: string | null;
  year: number;
  month: number;
  status: Status;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  notes: string | null;
}

const MONTH_NAMES_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export default function PeriodClosePage() {
  const { data: session, status: authStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin';

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/fiscal-periods?year=${year}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.months);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { if (authStatus === 'authenticated') load(); }, [authStatus, load]);

  async function handleClose(row: PeriodRow) {
    if (!confirm(`ต้องการปิดงวด ${MONTH_NAMES_TH[row.month - 1]} ${row.year} ใช่หรือไม่?\n\nหลังจากปิดแล้ว การบันทึก ledger ในเดือนนี้จะถูกปฏิเสธ — admin สามารถเปิดคืนได้ถ้าจำเป็น`)) return;

    setBusy(row.month); setError(null);
    try {
      let res = await fetch('/api/fiscal-periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: row.year, month: row.month }),
      });
      if (res.status === 409) {
        const j = await res.json();
        if (!confirm(`⚠️ ${j.message}\n\nต้องการปิดงวดทั้งที่มีกะเปิดค้างอยู่หรือไม่?`)) { setBusy(null); return; }
        res = await fetch('/api/fiscal-periods/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: row.year, month: row.month, force: true }),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ปิดงวดไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen(row: PeriodRow) {
    const reason = prompt(`เหตุผลในการเปิดงวด ${MONTH_NAMES_TH[row.month - 1]} ${row.year} คืน (บันทึกใน audit trail):`);
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) alert('ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }

    setBusy(row.month); setError(null);
    try {
      const res = await fetch('/api/fiscal-periods/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: row.year, month: row.month, reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดงวดคืนไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  if (authStatus === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>📅 ปิดงวดบัญชี (Period Close)</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          เมื่อปิดงวดแล้ว การบันทึก ledger ใด ๆ ในเดือนนั้นจะถูกปฏิเสธ — ป้องกันยอดย้อนหลังเพี้ยนหลังส่งงบ
        </p>
      </header>

      {!isAdmin && (
        <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fef3c7', color: '#92400e' }}>
          ⚠️ เฉพาะผู้ดูแลระบบเท่านั้นที่ปิด/เปิดงวดบัญชีได้ — คุณสามารถดูสถานะได้อย่างเดียว
        </div>
      )}

      <div className="pms-card pms-transition" style={{
        padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ปี ค.ศ.</span>
        <input
          type="number" min={2020} max={2100} value={year}
          onChange={e => setYear(Number(e.target.value))}
          style={inputSx}
        />
        <button onClick={load} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>
          โหลด
        </button>
      </div>

      {error && <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
      {loading && <div style={{ padding: 12, color: 'var(--text-secondary)' }}>กำลังโหลด…</div>}

      <div className="pms-card pms-transition" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)' }}>
              <th style={thSx}>เดือน</th>
              <th style={thSx}>สถานะ</th>
              <th style={thSx}>ปิดเมื่อ / โดย</th>
              <th style={thSx}>หมายเหตุ</th>
              <th style={{ ...thSx, textAlign: 'right' }}>การทำงาน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const closed = r.status === 'CLOSED';
              const rowBusy = busy === r.month;
              return (
                <tr key={r.month} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                  <td style={tdSx}>
                    <div style={{ fontWeight: 600 }}>{MONTH_NAMES_TH[r.month - 1]}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.year}-{String(r.month).padStart(2,'0')}</div>
                  </td>
                  <td style={tdSx}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: closed ? '#fee2e2' : '#f0fdf4',
                      color:      closed ? '#991b1b' : '#166534',
                    }}>
                      {closed ? '🔒 ปิดแล้ว' : '🔓 เปิดอยู่'}
                    </span>
                  </td>
                  <td style={{ ...tdSx, fontSize: 12, color: 'var(--text-muted)' }}>
                    {closed && r.closedAt && (
                      <>
                        <div>{fmtDateTime(new Date(r.closedAt))}</div>
                        <div>{r.closedBy ?? '—'}</div>
                      </>
                    )}
                    {r.reopenedAt && (
                      <div style={{ color: 'var(--warning)', marginTop: 2 }}>
                        เคยเปิดคืน: {fmtDateTime(new Date(r.reopenedAt))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdSx, fontSize: 12, color: 'var(--text-muted)' }}>
                    {r.notes ?? (r.reopenReason ? `เหตุผลเปิดคืน: ${r.reopenReason}` : '—')}
                  </td>
                  <td style={{ ...tdSx, textAlign: 'right' }}>
                    {isAdmin && (
                      closed ? (
                        <button
                          disabled={rowBusy}
                          onClick={() => handleReopen(r)}
                          style={{ ...btnSx, background: '#fef3c7', color: '#92400e' }}
                        >
                          {rowBusy ? '...' : 'เปิดคืน'}
                        </button>
                      ) : (
                        <button
                          disabled={rowBusy}
                          onClick={() => handleClose(r)}
                          style={{ ...btnSx, background: '#fee2e2', color: '#991b1b' }}
                        >
                          {rowBusy ? '...' : 'ปิดงวด'}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thSx: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-default)',
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const tdSx: React.CSSProperties = {
  padding: '10px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top',
};
const inputSx: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
  width: 100,
};
const btnSx: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
