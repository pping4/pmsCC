'use client';

/**
 * /accounting/tax-invoices/[id] — detail view for a single tax invoice.
 *
 * Shows seller info (from HotelSettings), frozen customer snapshot, covered
 * invoices, and totals. ISSUED invoices can be voided (with reason) or printed
 * (window.print → browser print dialog, styled via print-media CSS below).
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtDate, fmtDateTime, fmtBaht } from '@/lib/date-format';

interface CoveredInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  subtotal: number;
  vatAmount: number;
  serviceCharge: number;
  grandTotal: number;
}

interface TaxInvoiceDetail {
  id: string;
  number: string;
  issueDate: string;
  customerName: string;
  customerTaxId: string | null;
  customerBranch: string | null;
  customerAddress: string | null;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  coveredInvoiceIds: string[];
  coveredPaymentIds: string[];
  status: 'ISSUED' | 'VOIDED';
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  issuedByUserId: string;
  createdAt: string;
  invoices: CoveredInvoice[];
}

interface HotelSeller {
  hotelName: string | null;
  hotelAddress: string | null;
  hotelPhone: string | null;
  hotelEmail: string | null;
  vatRegistrationNo: string | null;
}

export default function TaxInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ti, setTi] = useState<TaxInvoiceDetail | null>(null);
  const [seller, setSeller] = useState<HotelSeller | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tiRes, setRes] = await Promise.all([
        fetch(`/api/tax-invoices/${params.id}`),
        fetch('/api/settings/hotel'),
      ]);
      if (!tiRes.ok) {
        const j = await tiRes.json().catch(() => ({}));
        throw new Error(j?.error ?? `โหลดไม่สำเร็จ (${tiRes.status})`);
      }
      setTi(await tiRes.json());
      if (setRes.ok) {
        const s = await setRes.json();
        const h = s?.settings ?? s;
        setSeller({
          hotelName: h?.hotelName ?? null,
          hotelAddress: h?.hotelAddress ?? null,
          hotelPhone: h?.hotelPhone ?? null,
          hotelEmail: h?.hotelEmail ?? null,
          vatRegistrationNo: h?.vatRegistrationNo ?? null,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const submitVoid = async () => {
    if (reason.trim().length < 3) { alert('กรุณาระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)'); return; }
    if (!confirm(`ยกเลิกใบกำกับภาษี ${ti?.number}?\n\nเหตุผล: ${reason.trim()}\n\nหมายเหตุ: หมายเลขจะไม่ถูกนำกลับมาใช้ใหม่`)) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/tax-invoices/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', reason: reason.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? 'ยกเลิกไม่สำเร็จ');
      setShowVoid(false); setReason('');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setVoiding(false);
    }
  };

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</div>;
  if (error)  return (
    <div className="p-6 max-w-3xl mx-auto space-y-3">
      <p className="text-sm text-red-600">{error}</p>
      <button onClick={() => router.back()} className="px-3 py-1.5 rounded-lg border text-sm"
        style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>← กลับ</button>
    </div>
  );
  if (!ti) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4 print:p-0 print:max-w-none">
      {/* Non-print toolbar */}
      <header className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Link href="/accounting/tax-invoices" className="text-sm text-blue-600 hover:underline">← ใบกำกับภาษีทั้งหมด</Link>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >🖨 พิมพ์</button>
          {ti.status === 'ISSUED' && (
            <button
              onClick={() => setShowVoid(true)}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm"
            >ยกเลิกใบกำกับภาษี</button>
          )}
        </div>
      </header>

      {/* Status banner (VOIDED) */}
      {ti.status === 'VOIDED' && (
        <div className="rounded-lg p-3 text-sm print:border print:border-red-600"
          style={{ background: '#fef2f2', color: '#991b1b' }}>
          <strong>ยกเลิกแล้ว</strong> — {ti.voidReason}
          {ti.voidedAt && <span className="ml-2 font-mono">({fmtDateTime(new Date(ti.voidedAt))})</span>}
        </div>
      )}

      {/* Printable document */}
      <article
        className="pms-card pms-transition p-8 space-y-6 print:shadow-none print:border-0"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}
      >
        {/* Title block */}
        <div className="flex items-start justify-between border-b pb-4" style={{ borderColor: 'var(--border-light)' }}>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>ใบกำกับภาษี / ใบเสร็จรับเงิน</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tax Invoice / Receipt</p>
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>เลขที่ / No.</div>
            <div className="text-xl font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{ti.number}</div>
            <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>วันที่ / Date</div>
            <div className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{fmtDate(new Date(ti.issueDate))}</div>
          </div>
        </div>

        {/* Seller + Customer */}
        <div className="grid grid-cols-2 gap-6 text-sm">
          <div>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>ผู้ขาย / Seller</h3>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{seller?.hotelName ?? '—'}</p>
            {seller?.hotelAddress && <p style={{ color: 'var(--text-primary)' }}>{seller.hotelAddress}</p>}
            {seller?.hotelPhone   && <p style={{ color: 'var(--text-muted)' }}>โทร: {seller.hotelPhone}</p>}
            {seller?.hotelEmail   && <p style={{ color: 'var(--text-muted)' }}>อีเมล: {seller.hotelEmail}</p>}
            {seller?.vatRegistrationNo && (
              <p className="mt-1" style={{ color: 'var(--text-primary)' }}>
                เลขประจำตัวผู้เสียภาษี: <span className="font-mono">{seller.vatRegistrationNo}</span>
              </p>
            )}
          </div>
          <div>
            <h3 className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>ผู้ซื้อ / Customer</h3>
            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{ti.customerName}</p>
            {ti.customerAddress && <p style={{ color: 'var(--text-primary)' }}>{ti.customerAddress}</p>}
            {ti.customerTaxId && (
              <p style={{ color: 'var(--text-primary)' }}>
                เลขประจำตัวผู้เสียภาษี: <span className="font-mono">{ti.customerTaxId}</span>
              </p>
            )}
            {ti.customerBranch && (
              <p style={{ color: 'var(--text-primary)' }}>สาขา: <span className="font-mono">{ti.customerBranch}</span></p>
            )}
          </div>
        </div>

        {/* Covered invoices */}
        <div>
          <h3 className="font-semibold mb-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            รายการใบแจ้งหนี้ที่คลุม / Covered Invoices
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)' }}>
                <th className="text-left px-3 py-2">เลขที่</th>
                <th className="text-left px-3 py-2">วันที่</th>
                <th className="text-right px-3 py-2">มูลค่าก่อน VAT</th>
                <th className="text-right px-3 py-2">VAT</th>
                <th className="text-right px-3 py-2">รวม</th>
              </tr>
            </thead>
            <tbody>
              {ti.invoices.map((inv, i) => (
                <tr key={inv.id} style={{ background: i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}>
                  <td className="px-3 py-2 font-mono">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2 font-mono">{fmtDate(new Date(inv.issueDate))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBaht(inv.subtotal)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBaht(inv.vatAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBaht(inv.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>มูลค่าสินค้า/บริการ</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{fmtBaht(ti.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>ภาษีมูลค่าเพิ่ม 7%</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{fmtBaht(ti.vatAmount)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-bold text-base"
              style={{ borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}>
              <span>รวมทั้งสิ้น</span>
              <span className="font-mono">{fmtBaht(ti.grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Signature blocks (print only) */}
        <div className="hidden print:grid grid-cols-2 gap-6 pt-12 text-xs">
          <div className="text-center">
            <div className="border-t pt-1" style={{ borderColor: '#000' }}>ผู้รับเงิน / Authorized Signature</div>
          </div>
          <div className="text-center">
            <div className="border-t pt-1" style={{ borderColor: '#000' }}>ผู้รับของ/บริการ / Customer Signature</div>
          </div>
        </div>

        {/* Footer meta (screen only) */}
        <div className="text-xs pt-2 border-t print:hidden" style={{ borderColor: 'var(--border-light)', color: 'var(--text-muted)' }}>
          ออกเมื่อ: <span className="font-mono">{fmtDateTime(new Date(ti.createdAt))}</span>
          {ti.coveredPaymentIds.length > 0 && <> · อ้างอิง {ti.coveredPaymentIds.length} รายการชำระ</>}
        </div>
      </article>

      {/* Void modal */}
      {showVoid && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 print:hidden">
          <div className="pms-card w-full max-w-md p-5 space-y-3"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>ยกเลิกใบกำกับภาษี</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              ระบุเหตุผลในการยกเลิก (จะถูกบันทึกเพื่อการตรวจสอบ). หมายเลขใบกำกับภาษีจะไม่ถูกนำกลับมาใช้ใหม่
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="เช่น ออกผิดข้อมูลลูกค้า / ยอดเงินผิด / ลูกค้าขอยกเลิก"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowVoid(false); setReason(''); }}
                disabled={voiding}
                className="px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >ยกเลิก</button>
              <button
                onClick={submitVoid}
                disabled={voiding || reason.trim().length < 3}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
              >{voiding ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
