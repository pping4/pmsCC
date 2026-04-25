/**
 * Financial Statements — P&L and Balance Sheet.
 *
 * Both reports are ledger-derived via /api/reports/financial — no manual posting,
 * no reconciliation step. Grouping: accounts inside each kind are listed by code.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';

type Kind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

interface AccountRow {
  id: string; code: string; name: string; kind: Kind; subKind: string; balance: number;
}

interface PLData {
  type: 'pl';
  window: { from: string; to: string };
  revenue: AccountRow[]; expense: AccountRow[];
  totals: { revenue: number; expense: number; netIncome: number };
}

interface BSData {
  type: 'bs';
  asOf: string;
  assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[];
  retainedEarnings: number;
  totals: { assets: number; liabilities: number; equity: number; balanceCheck: number };
}

function defaultPLRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateStr(from), to: toDateStr(now) };
}

export default function StatementsPage() {
  const { status } = useSession();
  const [tab, setTab] = useState<'pl' | 'bs'>('pl');

  // P&L
  const [plRange, setPLRange] = useState(defaultPLRange);
  const [pl, setPL] = useState<PLData | null>(null);

  // BS
  const [bsAsOf, setBSAsOf] = useState(() => toDateStr(new Date()));
  const [bs, setBS] = useState<BSData | null>(null);

  const [loading, setLoading] = useState(false);

  const loadPL = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type: 'pl', from: plRange.from, to: plRange.to });
      const res = await fetch(`/api/reports/financial?${qs}`);
      if (res.ok) setPL(await res.json());
    } finally { setLoading(false); }
  }, [plRange.from, plRange.to]);

  const loadBS = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type: 'bs', asOf: bsAsOf });
      const res = await fetch(`/api/reports/financial?${qs}`);
      if (res.ok) setBS(await res.json());
    } finally { setLoading(false); }
  }, [bsAsOf]);

  useEffect(() => { if (status === 'authenticated' && tab === 'pl') loadPL(); }, [status, tab, loadPL]);
  useEffect(() => { if (status === 'authenticated' && tab === 'bs') loadBS(); }, [status, tab, loadBS]);

  if (status === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>📈 งบการเงิน</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          งบกำไรขาดทุน (P&amp;L) และงบดุล (Balance Sheet) — คำนวณจาก ledger อัตโนมัติ
        </p>
      </header>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-default)', marginBottom: 16 }}>
        {[{ k: 'pl', label: 'งบกำไรขาดทุน (P&L)' }, { k: 'bs', label: 'งบดุล (Balance Sheet)' }].map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as 'pl' | 'bs')}
            style={{
              padding: '10px 16px', border: 'none',
              borderBottom: tab === t.k ? '2px solid var(--primary-light)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t.k ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: tab === t.k ? 600 : 400, cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text-secondary)', padding: 12 }}>กำลังคำนวณ…</div>}

      {tab === 'pl' && pl && (
        <PLView data={pl} range={plRange} setRange={setPLRange} onReload={loadPL} />
      )}
      {tab === 'bs' && bs && (
        <BSView data={bs} asOf={bsAsOf} setAsOf={setBSAsOf} onReload={loadBS} />
      )}
    </div>
  );
}

// ── P&L View ─────────────────────────────────────────────────────────────
function PLView({
  data, range, setRange, onReload,
}: {
  data: PLData;
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
  onReload: () => void;
}) {
  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่วงวันที่</span>
        <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} style={inputSx} />
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <input type="date" value={range.to}   onChange={e => setRange({ ...range, to:   e.target.value })} style={inputSx} />
        <button onClick={onReload} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>คำนวณ</button>
      </FilterBar>

      <Section title="รายได้ (Revenue)" rows={data.revenue} total={data.totals.revenue} color="#166534" bg="#f0fdf4" />
      <Section title="ค่าใช้จ่าย (Expense)" rows={data.expense} total={data.totals.expense} color="#991b1b" bg="#fee2e2" />

      <div className="pms-card pms-transition" style={{
        padding: 16, marginTop: 12,
        background: data.totals.netIncome >= 0
          ? 'linear-gradient(135deg, #166534 0%, #16a34a 100%)'
          : 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
        color: '#fff',
      }}>
        <div style={{ fontSize: 13, opacity: 0.9 }}>กำไร(ขาดทุน)สุทธิ</div>
        <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          ฿{fmtBaht(data.totals.netIncome)}
        </div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
          {fmtDate(new Date(range.from))} – {fmtDate(new Date(range.to))}
        </div>
      </div>
    </>
  );
}

// ── Balance Sheet View ────────────────────────────────────────────────────
function BSView({
  data, asOf, setAsOf, onReload,
}: {
  data: BSData; asOf: string;
  setAsOf: (v: string) => void; onReload: () => void;
}) {
  const balanced = Math.abs(data.totals.balanceCheck) < 0.01;
  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ณ วันที่</span>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={inputSx} />
        <button onClick={onReload} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>คำนวณ</button>
      </FilterBar>

      <Section title="สินทรัพย์ (Assets)" rows={data.assets} total={data.totals.assets} color="#1e40af" bg="#eff6ff" />
      <Section title="หนี้สิน (Liabilities)" rows={data.liabilities} total={data.totals.liabilities} color="#92400e" bg="#fef3c7" />
      <Section
        title="ส่วนของเจ้าของ (Equity)"
        rows={data.equity}
        total={data.totals.equity}
        color="#6b21a8" bg="#faf5ff"
        extraFooter={
          <div style={{ ...footRowSx, fontStyle: 'italic', color: 'var(--text-muted)' }}>
            <span>กำไรสะสม (คำนวณจากรายได้ − ค่าใช้จ่าย)</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>฿{fmtBaht(data.retainedEarnings)}</span>
          </div>
        }
      />

      <div className="pms-card pms-transition" style={{
        padding: 16, marginTop: 12,
        background: balanced ? '#f0fdf4' : '#fee2e2',
        color: balanced ? '#166534' : '#991b1b',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>
            {balanced ? '✓ สมการบัญชีสมดุล' : '⚠ บัญชีไม่สมดุล — ตรวจสอบการโพสต์'}
          </span>
          <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            สินทรัพย์ ฿{fmtBaht(data.totals.assets)} = หนี้สิน ฿{fmtBaht(data.totals.liabilities)} + ส่วนของเจ้าของ ฿{fmtBaht(data.totals.equity)}
          </span>
        </div>
        {!balanced && (
          <div style={{ fontSize: 12, marginTop: 6 }}>ส่วนต่าง: ฿{fmtBaht(data.totals.balanceCheck)}</div>
        )}
      </div>
    </>
  );
}

// ── Shared subcomponents ──────────────────────────────────────────────────
function Section({
  title, rows, total, color, bg, extraFooter,
}: {
  title: string; rows: AccountRow[]; total: number;
  color: string; bg: string;
  extraFooter?: React.ReactNode;
}) {
  return (
    <section className="pms-card pms-transition" style={{ padding: 16, marginBottom: 12 }}>
      <h2 style={{
        padding: '6px 10px', marginBottom: 10, borderRadius: 4,
        background: bg, color,
        fontSize: 14, fontWeight: 600,
      }}>{title}</h2>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 10px' }}>ไม่มีรายการ</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={{ ...tdSx, width: 110, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.code}</td>
                <td style={tdSx}>{r.name}</td>
                <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBaht(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {extraFooter}
      <div style={{ ...footRowSx, fontWeight: 600, borderTop: '1px solid var(--border-default)', marginTop: 8, paddingTop: 8 }}>
        <span>รวม</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>฿{fmtBaht(total)}</span>
      </div>
    </section>
  );
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="pms-card pms-transition" style={{
      padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
    }}>{children}</div>
  );
}

const tdSx: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--border-light)',
};
const inputSx: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
};
const footRowSx: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', padding: '4px 10px', fontSize: 13,
};
