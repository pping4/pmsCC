'use client';

/**
 * ProcessRefundModal — Phase 3 three-mode refund picker.
 *
 * Operator picks ONE of three modes, then provides the necessary supporting
 * fields. The server validates again + posts the matching ledger pair(s) +
 * issues a GuestCredit when the credit portion > 0.
 *
 *   1. cash    — pay back the full amount via cash/transfer/card
 *   2. credit  — keep all on guest account as GuestCredit (no money out)
 *   3. split   — partial cash + remaining credit
 */

import { useState } from 'react';
import { fmtBaht } from '@/lib/date-format';

type PaymentMethod = 'cash' | 'transfer' | 'credit_card' | 'promptpay' | 'ota_collect';
type RefundMode    = 'cash' | 'credit' | 'split';

export interface RefundProcessInput {
  mode:             RefundMode;
  method?:          PaymentMethod;       // required for cash/split
  cashAmount?:      number;              // required for split
  bankName?:        string;
  bankAccount?:     string;
  bankAccountName?: string;
  notes?:           string;
  creditExpiresAt?: string;              // ISO datetime
}

interface Props {
  refund: {
    refundNumber:  string;
    amount:        number;
    source:        string;
    sourceLabel:   string;
    reason:        string;
    guestName:     string;
    bookingNumber: string;
  };
  submitting: boolean;
  onCancel:   () => void;
  onConfirm:  (input: RefundProcessInput) => void;
}

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string; bank: boolean }> = [
  { value: 'cash',        label: '💵 เงินสด',       bank: false },
  { value: 'transfer',    label: '🏦 โอนธนาคาร',    bank: true  },
  { value: 'promptpay',   label: '📱 PromptPay',    bank: true  },
  { value: 'credit_card', label: '💳 บัตรเครดิต',    bank: false },
];

const MODE_OPTIONS: Array<{ value: RefundMode; label: string; sub: string; emoji: string }> = [
  { value: 'cash',   emoji: '💵', label: 'คืนเงินทั้งหมด',          sub: 'จ่ายเงินสด/โอนคืนเต็มจำนวน' },
  { value: 'credit', emoji: '🎫', label: 'เก็บเป็นเครดิต',           sub: 'ไม่จ่ายเงิน — เก็บไว้ในบัญชีลูกค้า' },
  { value: 'split',  emoji: '✂️', label: 'คืนบางส่วน + เก็บเครดิต',  sub: 'แบ่งเป็น 2 ส่วน' },
];

export default function ProcessRefundModal({ refund, submitting, onCancel, onConfirm }: Props) {
  const [mode, setMode]                       = useState<RefundMode>('cash');
  const [method, setMethod]                   = useState<PaymentMethod>('transfer');
  const [cashAmount, setCashAmount]           = useState<string>('');
  const [bankName, setBankName]               = useState('');
  const [bankAccount, setBankAccount]         = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [notes, setNotes]                     = useState('');
  const [error, setError]                     = useState('');

  const needsBank   = (mode === 'cash' || mode === 'split') &&
                      (METHOD_OPTIONS.find(o => o.value === method)?.bank ?? false);
  const needsMethod = mode === 'cash' || mode === 'split';
  const cashNum     = Number(cashAmount) || 0;
  const creditPart  = mode === 'split' ? Math.max(0, refund.amount - cashNum) : 0;

  function handleSubmit() {
    setError('');
    if (needsBank && !bankAccount.trim()) {
      setError('กรุณาระบุเลขบัญชีปลายทาง');
      return;
    }
    if (mode === 'split') {
      if (cashNum <= 0)              { setError('จำนวนเงินที่คืนสด ต้องมากกว่า 0'); return; }
      if (cashNum >= refund.amount)  { setError('จำนวนเงินที่คืนสด ต้องน้อยกว่ายอดรวม (ใช้ "คืนเงินทั้งหมด" แทน)'); return; }
    }
    onConfirm({
      mode,
      method:          needsMethod ? method : undefined,
      cashAmount:      mode === 'split' ? cashNum : undefined,
      bankName:        needsBank ? bankName.trim()        || undefined : undefined,
      bankAccount:     needsBank ? bankAccount.trim()     || undefined : undefined,
      bankAccountName: needsBank ? bankAccountName.trim() || undefined : undefined,
      notes:           notes.trim() || undefined,
    });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={submitting ? undefined : onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, padding: 24,
          width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
            💸 ดำเนินการคืนเงิน
          </h2>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: submitting ? 'not-allowed' : 'pointer', color: '#6b7280' }}
          >
            ✕
          </button>
        </div>

        {/* Refund summary */}
        <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#92400e', marginBottom: 4 }}>
            <span>{refund.refundNumber}</span>
            <span>{refund.sourceLabel}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#b45309', fontFamily: 'ui-monospace, monospace' }}>
            ฿{fmtBaht(refund.amount)}
          </div>
          <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6 }}>
            <div>Booking {refund.bookingNumber} — {refund.guestName}</div>
            <div style={{ color: '#6b7280', marginTop: 2 }}>{refund.reason}</div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── Mode picker ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            ผู้มีอำนาจเลือกวิธีการ
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {MODE_OPTIONS.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                disabled={submitting}
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `2px solid ${mode === m.value ? '#2563eb' : '#e5e7eb'}`,
                  background: mode === m.value ? '#eff6ff' : '#fff',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ fontSize: 22 }}>{m.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: mode === m.value ? '#1e40af' : '#111827' }}>
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

        {/* ── Cash split breakdown (mode=split only) ──────────────────────── */}
        {mode === 'split' && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0c4a6e', marginBottom: 6 }}>
              จำนวนเงินที่คืนสด/โอน (ที่เหลือจะเก็บเป็นเครดิต)
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: '#0c4a6e' }}>฿</span>
              <input
                type="number"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
                disabled={submitting}
                min={1}
                max={refund.amount - 1}
                step="0.01"
                style={{
                  flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
                  fontSize: 14, fontFamily: 'ui-monospace, monospace', boxSizing: 'border-box',
                }}
                placeholder={`มากกว่า 0 น้อยกว่า ${fmtBaht(refund.amount)}`}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#0c4a6e' }}>
              คืนสด: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>฿{fmtBaht(cashNum)}</strong>
              <span style={{ margin: '0 8px', color: '#94a3b8' }}>•</span>
              เก็บเป็นเครดิต: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>฿{fmtBaht(creditPart)}</strong>
            </div>
          </div>
        )}

        {/* ── Method picker (cash + split only) ───────────────────────────── */}
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
                  disabled={submitting}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${method === o.value ? '#2563eb' : '#d1d5db'}`,
                    background: method === o.value ? '#eff6ff' : '#fff',
                    color: method === o.value ? '#1e40af' : '#374151',
                    fontSize: 13, fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
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
            <Field label="ธนาคาร" value={bankName} onChange={setBankName} disabled={submitting} />
            <Field label="เลขบัญชี *" value={bankAccount} onChange={setBankAccount} disabled={submitting} />
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="ชื่อบัญชี" value={bankAccountName} onChange={setBankAccountName} disabled={submitting} />
            </div>
          </div>
        )}

        {/* Credit info banner (mode=credit / split) */}
        {(mode === 'credit' || mode === 'split') && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#166534' }}>
            🎫 จะออก <strong>เครดิตคงเหลือ</strong> ฿{fmtBaht(mode === 'credit' ? refund.amount : creditPart)} ให้ลูกค้า — สามารถใช้ในการจองครั้งถัดไป
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>หมายเหตุ</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={submitting}
            rows={2}
            placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '10px 18px', border: '1px solid #d1d5db', borderRadius: 8,
              background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
            }}
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '10px 18px', border: 'none', borderRadius: 8,
              background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {submitting && (
              <div style={{
                width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
                borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite',
              }} />
            )}
            ✓ ยืนยันดำเนินการ
          </button>
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
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
