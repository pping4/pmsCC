'use client';

/**
 * ProcessRefundModal — confirms method + bank details, then fires onConfirm.
 * Purely presentational; server validates + posts ledger.
 */

import { useState } from 'react';
import { fmtBaht } from '@/lib/date-format';

type PaymentMethod = 'cash' | 'transfer' | 'credit_card' | 'promptpay' | 'ota_collect';

export interface RefundProcessInput {
  method:          PaymentMethod;
  bankName?:       string;
  bankAccount?:    string;
  bankAccountName?: string;
  notes?:          string;
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

export default function ProcessRefundModal({ refund, submitting, onCancel, onConfirm }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const needsBank = METHOD_OPTIONS.find(o => o.value === method)?.bank ?? false;

  function handleSubmit() {
    setError('');
    if (needsBank && !bankAccount.trim()) {
      setError('กรุณาระบุเลขบัญชีปลายทาง');
      return;
    }
    onConfirm({
      method,
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
          width: 520, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
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

        {/* Method */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            วิธีคืนเงิน
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
            ยืนยันจ่ายคืน
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
