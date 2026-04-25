'use client';

/**
 * CancelBookingDialog — cancel with refund-policy selector.
 *
 * User picks one of:
 *  - 'forfeit' → no refund (guest forfeits paid amount)
 *  - 'full'    → refund full paid amount
 *  - 'partial' → refund custom amount (≤ totalPaid)
 *
 * When totalPaid === 0 the picker is suppressed — no refund possible.
 */

import { useState, useEffect } from 'react';
import { fmtBaht } from '@/lib/date-format';

type Policy = 'forfeit' | 'full' | 'partial';

export interface CancelConfirmInput {
  refundAmount: number; // 0 for forfeit
  reason?: string;
}

interface Props {
  open: boolean;
  bookingNumber: string;
  totalPaid: number;
  loading: boolean;
  onConfirm: (input: CancelConfirmInput) => void;
  onCancel:  () => void;
}

export default function CancelBookingDialog({
  open, bookingNumber, totalPaid, loading, onConfirm, onCancel,
}: Props) {
  const hasPayment = totalPaid > 0;
  const [policy, setPolicy] = useState<Policy>(hasPayment ? 'full' : 'forfeit');
  const [customAmount, setCustomAmount] = useState<string>(String(totalPaid));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPolicy(hasPayment ? 'full' : 'forfeit');
      setCustomAmount(String(totalPaid));
      setReason('');
      setError('');
    }
  }, [open, hasPayment, totalPaid]);

  if (!open) return null;

  function handleSubmit() {
    let refundAmount = 0;
    if (policy === 'full')    refundAmount = totalPaid;
    if (policy === 'partial') refundAmount = Number(customAmount);

    if (policy === 'partial') {
      if (!isFinite(refundAmount) || refundAmount <= 0) {
        setError('กรุณาระบุจำนวนเงินที่คืน (มากกว่า 0)');
        return;
      }
      if (refundAmount > totalPaid) {
        setError(`จำนวนเงินที่คืนเกินยอดที่จ่ายแล้ว (฿${fmtBaht(totalPaid)})`);
        return;
      }
    }
    onConfirm({ refundAmount, reason: reason.trim() || undefined });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={loading ? undefined : onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, padding: 24,
          width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            ยกเลิกการจอง
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', fontFamily: 'ui-monospace, monospace' }}>
            {bookingNumber}
          </div>
        </div>

        {/* Payment summary */}
        <div style={{
          background: hasPayment ? '#fef3c7' : '#f3f4f6',
          border: `1px solid ${hasPayment ? '#fcd34d' : '#d1d5db'}`,
          borderRadius: 8, padding: 12, marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>ยอดที่จ่ายแล้ว</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hasPayment ? '#b45309' : '#6b7280', fontFamily: 'ui-monospace, monospace' }}>
            ฿{fmtBaht(totalPaid)}
          </div>
        </div>

        {/* Policy selector (only when there's money to decide on) */}
        {hasPayment && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              Cancellation policy
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PolicyRadio
                label="คืนเต็มจำนวน"
                sub={`สร้างรายการคืนเงิน ฿${fmtBaht(totalPaid)}`}
                checked={policy === 'full'}
                onChange={() => setPolicy('full')}
                disabled={loading}
              />
              <PolicyRadio
                label="คืนบางส่วน"
                sub="ระบุจำนวนเงินที่จะคืน"
                checked={policy === 'partial'}
                onChange={() => setPolicy('partial')}
                disabled={loading}
              />
              {policy === 'partial' && (
                <div style={{ paddingLeft: 28 }}>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={totalPaid}
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    disabled={loading}
                    style={{
                      width: 180, padding: '6px 10px', border: '1px solid #d1d5db',
                      borderRadius: 6, fontSize: 14, fontFamily: 'ui-monospace, monospace',
                    }}
                  />
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>
                    (สูงสุด ฿{fmtBaht(totalPaid)})
                  </span>
                </div>
              )}
              <PolicyRadio
                label="ไม่คืนเงิน (forfeit)"
                sub="ลูกค้าสละสิทธิ์ตาม cancellation policy"
                checked={policy === 'forfeit'}
                onChange={() => setPolicy('forfeit')}
                disabled={loading}
              />
            </div>
          </div>
        )}

        {/* Reason */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            เหตุผล (ถ้ามี)
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={loading}
            rows={2}
            placeholder="เช่น ลูกค้าเปลี่ยนแผน / no-show / เกินวันยกเลิกฟรี"
            style={{
              width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
            padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '10px 18px', border: '1px solid #d1d5db', borderRadius: 8,
              background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            ย้อนกลับ
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              padding: '10px 18px', border: 'none', borderRadius: 8,
              background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {loading && (
              <div style={{
                width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
                borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite',
              }} />
            )}
            ยืนยันยกเลิกการจอง
          </button>
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function PolicyRadio({ label, sub, checked, onChange, disabled }: {
  label: string; sub: string; checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      padding: '8px 12px', borderRadius: 8,
      border: `1px solid ${checked ? '#2563eb' : '#e5e7eb'}`,
      background: checked ? '#eff6ff' : '#fff',
      opacity: disabled ? 0.6 : 1,
    }}>
      <input type="radio" checked={checked} onChange={onChange} disabled={disabled} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: checked ? '#1e40af' : '#374151' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{sub}</div>
      </div>
    </label>
  );
}
