/**
 * Account movements drill-down — reachable by clicking a card on /finance/money-overview.
 * Shows every DR/CR touching this account in a date window, with running balance.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { fmtBaht, fmtDateTime, toDateStr } from '@/lib/date-format';

interface Movement {
  id:             string;
  date:           string;
  type:           'DEBIT' | 'CREDIT';
  amount:         number;
  signedDelta:    number;
  description:    string | null;
  referenceType:  string;
  referenceId:    string;
  batchId:        string | null;
  createdBy:      string;
  runningBalance: number;
}

interface Data {
  account:  { id: string; code: string; name: string; kind: string; subKind: string };
  window:   { from: string; to: string };
  baseline: number;
  closing:  number;
  movements: Movement[];
}

function defaultRange() {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 30);
  return { from: toDateStr(from), to: toDateStr(to) };
}

export default function AccountMovementsPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const { status } = useSession();

  const [range, setRange] = useState(defaultRange);
  const [data, setData]   = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`/api/account-balances/${id}/movements?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id, range.from, range.to]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  if (status === 'loading' || loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>กำลังโหลด…</div>;
  }
  if (error || !data) {
    return <div style={{ padding: 24, color: 'var(--danger)' }}>{error ?? 'ไม่พบข้อมูล'}</div>;
  }

  const netChange = data.closing - data.baseline;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={() => router.push('/finance/money-overview')} style={backBtnSx}>← กลับหน้าภาพรวมเงิน</button>

      <header style={{ margin: '12px 0 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{data.account.code}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{data.account.name}</h1>
      </header>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SummaryCard label="ยอดยกมา (ก่อนช่วง)"     value={data.baseline} />
        <SummaryCard label="เปลี่ยนแปลงสุทธิในช่วง" value={netChange} signed />
        <SummaryCard label="ยอดคงเหลือสิ้นช่วง"     value={data.closing} highlight />
        <SummaryCard label="จำนวนรายการ"            value={data.movements.length} raw />
      </div>

      {/* Date filter */}
      <div className="pms-card pms-transition" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่วงวันที่</span>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={inputSx} />
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <input type="date" value={range.to}   onChange={e => setRange(r => ({ ...r, to:   e.target.value }))} style={inputSx} />
        <button onClick={load} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>กรอง</button>
      </div>

      {/* Movements table */}
      <div className="pms-card pms-transition" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-muted)' }}>
                <th style={thSx}>วันที่</th>
                <th style={thSx}>รายการ</th>
                <th style={thSx}>อ้างอิง</th>
                <th style={{ ...thSx, textAlign: 'right' }}>เดบิต</th>
                <th style={{ ...thSx, textAlign: 'right' }}>เครดิต</th>
                <th style={{ ...thSx, textAlign: 'right' }}>เปลี่ยน</th>
                <th style={{ ...thSx, textAlign: 'right' }}>คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'var(--surface-subtle)' }}>
                <td style={{ ...tdSx, fontStyle: 'italic', color: 'var(--text-muted)' }} colSpan={6}>
                  ยอดยกมา ณ วันที่ {range.from}
                </td>
                <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtBaht(data.baseline)}
                </td>
              </tr>
              {data.movements.map((m, i) => (
                <tr key={m.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                  <td style={{ ...tdSx, whiteSpace: 'nowrap' }}>{fmtDateTime(new Date(m.date))}</td>
                  <td style={tdSx}>{m.description ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                  <td style={{ ...tdSx, fontSize: 11, color: 'var(--text-muted)' }}>
                    {m.referenceType}
                  </td>
                  <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {m.type === 'DEBIT' ? fmtBaht(m.amount) : ''}
                  </td>
                  <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {m.type === 'CREDIT' ? fmtBaht(m.amount) : ''}
                  </td>
                  <td style={{
                    ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: m.signedDelta >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {m.signedDelta >= 0 ? '+' : ''}{fmtBaht(m.signedDelta)}
                  </td>
                  <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmtBaht(m.runningBalance)}
                  </td>
                </tr>
              ))}
              {data.movements.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdSx, textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  ไม่มีรายการในช่วงที่เลือก
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, signed, highlight, raw }: {
  label: string; value: number; signed?: boolean; highlight?: boolean; raw?: boolean;
}) {
  const color =
    highlight ? 'var(--text-primary)'
    : signed ? (value >= 0 ? 'var(--success)' : 'var(--danger)')
    : 'var(--text-primary)';
  const prefix = signed && value >= 0 ? '+' : '';
  return (
    <div className="pms-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color }}>
        {raw ? value.toLocaleString() : `${prefix}฿${fmtBaht(value)}`}
      </div>
    </div>
  );
}

const thSx: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-default)',
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const tdSx: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top',
};
const inputSx: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
};
const backBtnSx: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--primary-light)',
  cursor: 'pointer', padding: 0, fontSize: 13,
};
