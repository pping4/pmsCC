'use client';

/**
 * CancelBookingDialog — cancel with refund-policy + refund-mode selector.
 *
 * Two orthogonal dimensions, asked in one dialog so the cashier can finish
 * everything without going to /refunds afterward:
 *
 *  1. Policy (how much to refund)
 *       forfeit  → no refund (guest forfeits paid amount)
 *       full     → refund full paid amount
 *       partial  → refund custom amount (≤ totalPaid)
 *
 *  2. Mode (how to pay it back) — only shown when refund amount > 0
 *       cash    → pay back via cash/transfer/promptpay/credit-card
 *       credit  → keep on guest account as GuestCredit (no money leaves)
 *       split   → cash portion + credit portion
 *
 * When totalPaid === 0 both pickers are suppressed — no refund possible.
 *
 * Phase 6.1 — supports cancellation of checked-in bookings (the server now
 * voids invoiced line items via partialVoidInvoice so GL stays balanced).
 */

import { useState, useEffect } from 'react';
import { fmtBaht } from '@/lib/date-format';

type Policy       = 'forfeit' | 'full' | 'partial';
type RefundMode   = 'cash' | 'credit' | 'split';
type PaymentMethod = 'cash' | 'transfer' | 'credit_card' | 'promptpay';

export interface CancelConfirmInput {
  refundAmount: number; // 0 for forfeit
  reason?: string;
  /** Phase 6.1 — when set, server processes the refund in the same tx. */
  mode?:            RefundMode;
  method?:          PaymentMethod;
  cashAmount?:      number;
  bankName?:        string;
  bankAccount?:     string;
  bankAccountName?: string;
}

interface Props {
  open: boolean;
  bookingNumber: string;
  bookingStatus?: string;   // optional: drives the "was checked in" banner
  totalPaid: number;
  loading: boolean;
  onConfirm: (input: CancelConfirmInput) => void;
  onCancel:  () => void;
}

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string; bank: boolean }> = [
  { value: 'cash',        label: '💵 เงินสด',       bank: false },
  { value: 'transfer',    label: '🏦 โอนธนาคาร',    bank: true  },
  { value: 'promptpay',   label: '📱 PromptPay',    bank: true  },
  { value: 'credit_card', label: '💳 บัตรเครดิต',    bank: false },
];

const MODE_OPTIONS: Array<{ value: RefundMode; emoji: string; label: string; sub: string }> = [
  { value: 'cash',   emoji: '💵', label: 'คืนเงินทั้งหมด',          sub: 'จ่ายเงินสด/โอนคืนเต็มจำนวน' },
  { value: 'credit', emoji: '🎫', label: 'เก็บเป็นเครดิต',           sub: 'ไม่จ่ายเงิน — เก็บไว้ในบัญชีลูกค้า' },
  { value: 'split',  emoji: '✂️', label: 'คืนบางส่วน + เก็บเครดิต',  sub: 'แบ่งเป็น 2 ส่วน' },
];

export default function CancelBookingDialog({
  open, bookingNumber, bookingStatus, totalPaid, loading, onConfirm, onCancel,
}: Props) {
  const hasPayment = totalPaid > 0;
  const wasCheckedIn = bookingStatus === 'checked_in';

  const [policy, setPolicy] = useState<Policy>(hasPayment ? 'full' : 'forfeit');
  const [customAmount, setCustomAmount] = useState<string>(String(totalPaid));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Mode + method (only meaningful when refund > 0)
  const [mode, setMode] = useState<RefundMode>('cash');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [splitCashAmount, setSplitCashAmount] = useState<string>('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');

  useEffect(() => {
    if (open) {
      setPolicy(hasPayment ? 'full' : 'forfeit');
      setCustomAmount(String(totalPaid));
      setReason('');
      setError('');
      setMode('cash');
      setMethod('cash');
      setSplitCashAmount('');
      setBankName('');
      setBankAccount('');
      setBankAccountName('');
    }
  }, [open, hasPayment, totalPaid]);

  if (!open) return null;

  const refundAmount =
    policy === 'full'    ? totalPaid
    : policy === 'partial' ? Number(customAmount) || 0
    : 0;
  const hasRefund   = refundAmount > 0;
  const needsMethod = hasRefund && (mode === 'cash' || mode === 'split');
  const needsBank   = needsMethod && (METHOD_OPTIONS.find(o => o.value === method)?.bank ?? false);
  const splitCashNum = Number(splitCashAmount) || 0;
  const splitCreditPart = mode === 'split' ? Math.max(0, refundAmount - splitCashNum) : 0;

  function handleSubmit() {
    // Policy validation
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
    // Mode validation
    if (hasRefund) {
      if (mode === 'split') {
        if (splitCashNum <= 0) { setError('จำนวนเงินที่คืนสด ต้องมากกว่า 0'); return; }
        if (splitCashNum >= refundAmount) {
          setError('จำนวนเงินที่คืนสด ต้องน้อยกว่ายอดคืนทั้งหมด (ใช้ "คืนเงินทั้งหมด" แทน)');
          return;
        }
      }
      if (needsBank && !bankAccount.trim()) {
        setError('กรุณาระบุเลขบัญชีปลายทาง');
        return;
      }
    }

    onConfirm({
      refundAmount,
      reason: reason.trim() || undefined,
      // Phase 6.1 — only forward mode info when there's actually a refund.
      // No refund (forfeit) → server skips processRefund entirely.
      ...(hasRefund ? {
        mode,
        method:          needsMethod ? method : undefined,
        cashAmount:      mode === 'split' ? splitCashNum : undefined,
        bankName:        needsBank ? bankName.trim()        || undefined : undefined,
        bankAccount:     needsBank ? bankAccount.trim()     || undefined : undefined,
        bankAccountName: needsBank ? bankAccountName.trim() || undefined : undefined,
      } : {}),
    });
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
          width: 540, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
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

        {wasCheckedIn && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#991b1b',
          }}>
            ⚠️ การจองนี้ <strong>เช็คอินแล้ว</strong> — การยกเลิกจะส่งห้องไปสถานะ "ทำความสะอาด" และลดรายรับตามจำนวนเงินที่คืน
          </div>
        )}

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
              นโยบายการคืนเงิน
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

        {/* Mode picker (only when refund > 0) */}
        {hasRefund && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              วิธีคืนเงิน
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              {MODE_OPTIONS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  disabled={loading}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: `2px solid ${mode === m.value ? '#2563eb' : '#e5e7eb'}`,
                    background: mode === m.value ? '#eff6ff' : '#fff',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{m.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: mode === m.value ? '#1e40af' : '#111827' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{m.sub}</div>
                  </div>
                  {mode === m.value && (
                    <span style={{ color: '#2563eb', fontSize: 14, fontWeight: 700 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Split breakdown */}
        {hasRefund && mode === 'split' && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0c4a6e', marginBottom: 6 }}>
              จำนวนเงินที่คืนสด/โอน (ที่เหลือเก็บเป็นเครดิต)
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: '#0c4a6e' }}>฿</span>
              <input
                type="number"
                value={splitCashAmount}
                onChange={e => setSplitCashAmount(e.target.value)}
                disabled={loading}
                min={1}
                max={refundAmount - 1}
                step="0.01"
                style={{
                  flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
                  fontSize: 14, fontFamily: 'ui-monospace, monospace', boxSizing: 'border-box',
                }}
                placeholder={`มากกว่า 0 น้อยกว่า ${fmtBaht(refundAmount)}`}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#0c4a6e' }}>
              คืนสด: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>฿{fmtBaht(splitCashNum)}</strong>
              <span style={{ margin: '0 8px', color: '#94a3b8' }}>•</span>
              เก็บเป็นเครดิต: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>฿{fmtBaht(splitCreditPart)}</strong>
            </div>
          </div>
        )}

        {/* Method picker (cash + split only) */}
        {needsMethod && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              ช่องทางคืนเงิน {mode === 'split' && <span style={{ color: '#6b7280', fontWeight: 400 }}>(สำหรับเงินสดส่วน)</span>}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {METHOD_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setMethod(o.value)}
                  disabled={loading}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${method === o.value ? '#2563eb' : '#d1d5db'}`,
                    background: method === o.value ? '#eff6ff' : '#fff',
                    color: method === o.value ? '#1e40af' : '#374151',
                    fontSize: 13, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bank fields */}
        {needsBank && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <Field label="ธนาคาร" value={bankName} onChange={setBankName} disabled={loading} />
            <Field label="เลขบัญชี *" value={bankAccount} onChange={setBankAccount} disabled={loading} />
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="ชื่อบัญชี" value={bankAccountName} onChange={setBankAccountName} disabled={loading} />
            </div>
          </div>
        )}

        {/* Credit info banner */}
        {hasRefund && (mode === 'credit' || mode === 'split') && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
            padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#166534',
          }}>
            🎫 จะออก <strong>เครดิตคงเหลือ</strong> ฿{fmtBaht(mode === 'credit' ? refundAmount : splitCreditPart)} ให้ลูกค้า — สามารถใช้ในการจองครั้งถัดไป
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

function Field({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8,
          fontSize: 13, boxSizing: 'border-box',
        }}
      />
    </div>
  );
}
