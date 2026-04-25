/**
 * VAT Sales Report — admin / accountant / manager.
 * Matches books via aggregated CR VAT_OUTPUT for the period.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fmtBaht, toDateStr } from '@/lib/date-format';

interface ReportItem {
  invoiceId:     string;
  invoiceNumber: string;
  issueDate:     string;
  customerName:  string;
  customerTaxId: string;
  subtotal:      number;
  serviceCharge: number;
  taxableBase:   number;
  vatAmount:     number;
  grandTotal:    number;
  vatInclusive:  boolean;
}
interface Totals {
  subtotal: number; serviceCharge: number; taxableBase: number;
  vatAmount: number; grandTotal: number;
}

export default function VatSalesReportPage() {
  const { status } = useSession();
  const today = toDateStr(new Date());
  const firstOfMonth = today.slice(0, 8) + '01';

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo]     = useState(today);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems]   = useState<ReportItem[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/reports/vat-sales?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setItems(j.items);
      setTotals(j.totals);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  function downloadCsv() {
    window.open(`/api/reports/vat-sales?from=${from}&to=${to}&format=csv`, '_blank');
  }

  if (status === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>🧾 รายงานภาษีขาย (VAT Sales)</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          ใบกำกับภาษี/ใบเสร็จที่ออกในช่วงเวลา — ใช้ยื่น ภ.พ. 30
        </p>
      </header>

      <div className="pms-card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ตั้งแต่</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputSx} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ถึง</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputSx} />
        </label>
        <button onClick={load} disabled={loading} style={{ ...btnSx, background: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}>
          {loading ? 'กำลังโหลด…' : 'ค้นหา'}
        </button>
        <button onClick={downloadCsv} disabled={loading || items.length === 0} style={{ ...btnSx, background: 'var(--surface-muted)' }}>
          📥 ส่งออก CSV
        </button>
      </div>

      {err && (
        <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>
          {err}
        </div>
      )}

      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi label="ฐานภาษี (Taxable)" value={totals.taxableBase} />
          <Kpi label="VAT รวม"          value={totals.vatAmount} accent="#2563eb" />
          <Kpi label="ค่าบริการ"        value={totals.serviceCharge} />
          <Kpi label="รวมทั้งสิ้น"      value={totals.grandTotal} />
          <Kpi label="จำนวนใบ"          value={items.length} raw />
        </div>
      )}

      <div className="pms-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-subtle)', textAlign: 'left' }}>
              <th style={thSx}>วันที่</th>
              <th style={thSx}>เลขใบกำกับ</th>
              <th style={thSx}>ลูกค้า</th>
              <th style={thSx}>เลขผู้เสียภาษี</th>
              <th style={{ ...thSx, textAlign: 'right' }}>มูลค่าสินค้า</th>
              <th style={{ ...thSx, textAlign: 'right' }}>ค่าบริการ</th>
              <th style={{ ...thSx, textAlign: 'right' }}>ฐานภาษี</th>
              <th style={{ ...thSx, textAlign: 'right' }}>VAT</th>
              <th style={{ ...thSx, textAlign: 'right' }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={i.invoiceId} style={{ background: idx % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={tdSx}>{i.issueDate}</td>
                <td style={tdSx}>{i.invoiceNumber}</td>
                <td style={tdSx}>{i.customerName}</td>
                <td style={tdSx}>{i.customerTaxId}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.subtotal)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.serviceCharge)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.taxableBase)}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#2563eb', fontWeight: 600 }}>{fmtBaht(i.vatAmount)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.grandTotal)}</td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>ไม่มีข้อมูลในช่วงนี้</td></tr>
            )}
          </tbody>
          {totals && items.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--surface-muted)', fontWeight: 600 }}>
                <td style={tdSx} colSpan={4}>รวม {items.length} รายการ</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.subtotal)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.serviceCharge)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.taxableBase)}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#2563eb' }}>{fmtBaht(totals.vatAmount)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, raw }: { label: string; value: number; accent?: string; raw?: boolean }) {
  return (
    <div className="pms-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? 'var(--text-primary)', marginTop: 4 }}>
        {raw ? value : fmtBaht(value)}
      </div>
    </div>
  );
}

const thSx: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border-default)' };
const tdSx: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-light)' };
const inputSx: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
};
const btnSx: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
