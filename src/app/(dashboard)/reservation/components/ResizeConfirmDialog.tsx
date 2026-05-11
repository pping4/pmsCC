'use client';

/**
 * ResizeConfirmDialog — preview + confirm drag-resize edits.
 *
 * Phase 6.2: when the resize produces a refund (`preview.rateDiff < 0`) the
 * dialog now exposes the 3-mode refund picker (cash / credit / split) inline
 * so the cashier doesn't have to bounce to /refunds to finalize. Modes mirror
 * `ProcessRefundModal` / `CancelBookingDialog`. When no refund is involved
 * the dialog stays simple (just the comparison + confirm button).
 */

import React, { useEffect, useState } from 'react';
import { FONT } from '../lib/constants';
import { fmtBaht } from '@/lib/date-format';

interface PreviewData {
  scenario: string;
  scenarioLabel: string;
  oldNights: number;
  newNights: number;
  oldRate: number;
  newRate: number;
  oldTotal: number;
  newTotal: number;
  rateDiff: number;
  requiresConfirmation: boolean;
  refundDue?: number;
}

type RefundMode    = 'cash' | 'credit' | 'split';
type PaymentMethod = 'cash' | 'transfer' | 'credit_card' | 'promptpay';

export interface ResizeRefundInput {
  mode:             RefundMode;
  method?:          PaymentMethod;
  cashAmount?:      number;
  bankName?:        string;
  bankAccount?:     string;
  bankAccountName?: string;
}

interface ResizeConfirmDialogProps {
  isOpen: boolean;
  /**
   * Phase 6.2 — if `refund` is provided the caller wants the refund
   * processed in the same PATCH request. Omit for non-refund resizes.
   */
  onConfirm: (refund?: ResizeRefundInput) => void;
  onCancel: () => void;
  preview: PreviewData | null;
  isLoading: boolean;
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

export default function ResizeConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  preview,
  isLoading,
}: ResizeConfirmDialogProps) {
  const isDiffPositive = preview ? preview.rateDiff >= 0 : true;
  const isRefund       = !!preview && !isDiffPositive;
  const refundAmount   = isRefund ? Math.abs(preview!.rateDiff) : 0;

  const [mode, setMode]                       = useState<RefundMode>('cash');
  const [method, setMethod]                   = useState<PaymentMethod>('cash');
  const [splitCash, setSplitCash]             = useState<string>('');
  const [bankName, setBankName]               = useState('');
  const [bankAccount, setBankAccount]         = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [error, setError]                     = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode('cash');
      setMethod('cash');
      setSplitCash('');
      setBankName('');
      setBankAccount('');
      setBankAccountName('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen || !preview) return null;

  const formatCurrency = (value: number): string => `฿${fmtBaht(value)}`;

  const diffLabel = isDiffPositive ? 'เพิ่มขึ้น' : 'คืนเงิน';
  const diffColor = isDiffPositive ? '#dc2626' : '#16a34a';

  const isScenarioD = preview.scenario === 'D';
  const warningText = isScenarioD
    ? '⚠️ ระบบจะสร้าง Invoice เพิ่มเติมสำหรับค่าใช้สอยที่เพิ่มขึ้น หากหดวันพัก ระบบจะบันทึกรายการคืนเงินตามวิธีที่เลือก'
    : isRefund
    ? '💰 เลือกวิธีการคืนเงินด้านล่าง — ระบบจะดำเนินการคืนทันทีพร้อม void รายการห้องที่ลดลง'
    : null;

  const needsMethod = isRefund && (mode === 'cash' || mode === 'split');
  const needsBank   = needsMethod && (METHOD_OPTIONS.find(o => o.value === method)?.bank ?? false);
  const splitCashNum = Number(splitCash) || 0;
  const splitCreditPart = mode === 'split' ? Math.max(0, refundAmount - splitCashNum) : 0;

  function handleSubmit() {
    setError('');
    if (!isRefund) {
      // No refund — pass undefined and let the caller fire the plain PATCH.
      onConfirm(undefined);
      return;
    }
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
    onConfirm({
      mode,
      method:          needsMethod ? method : undefined,
      cashAmount:      mode === 'split' ? splitCashNum : undefined,
      bankName:        needsBank ? bankName.trim()        || undefined : undefined,
      bankAccount:     needsBank ? bankAccount.trim()     || undefined : undefined,
      bankAccountName: needsBank ? bankAccountName.trim() || undefined : undefined,
    });
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, fontFamily: FONT,
      }}
      onClick={isLoading ? undefined : onCancel}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12,
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.15)',
          maxWidth: 520, width: '92%', padding: 24, position: 'relative',
          maxHeight: '90vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#6b7280',
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
          }}>
            ยืนยันการปรับแต่งการจอง
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
            {preview.scenarioLabel}
          </div>
        </div>

        {/* Warning box */}
        {warningText && (
          <div style={{
            background: isRefund ? '#dcfce7' : '#fef08a',
            border: `1px solid ${isRefund ? '#86efac' : '#eab308'}`,
            borderRadius: 8, padding: 12, marginBottom: 16,
            fontSize: 13, color: isRefund ? '#166534' : '#713f12', lineHeight: 1.5,
          }}>
            {warningText}
          </div>
        )}

        {/* Comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {(['เดิม', 'ใหม่'] as const).map((label, idx) => {
            const nights = idx === 0 ? preview.oldNights : preview.newNights;
            const rate   = idx === 0 ? preview.oldRate   : preview.newRate;
            const total  = idx === 0 ? preview.oldTotal  : preview.newTotal;
            return (
              <div key={label} style={{ background: '#f3f4f6', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>{nights} คืน</div>
                <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>@ {formatCurrency(rate)}/คืน</div>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: '#111827',
                  paddingTop: 8, borderTop: '1px solid #d1d5db',
                }}>
                  {formatCurrency(total)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff */}
        <div style={{
          background: isDiffPositive ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${isDiffPositive ? '#fecaca' : '#bbf7d0'}`,
          borderRadius: 8, padding: 12, marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>ผลต่าง</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: diffColor }}>
            {diffLabel} {formatCurrency(Math.abs(preview.rateDiff))}
          </div>
        </div>

        {/* Refund mode picker (only when shortening) */}
        {isRefund && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                วิธีคืนเงิน
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                {MODE_OPTIONS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    disabled={isLoading}
                    style={{
                      padding: '10px 14px', borderRadius: 8,
                      border: `2px solid ${mode === m.value ? '#2563eb' : '#e5e7eb'}`,
                      background: mode === m.value ? '#eff6ff' : '#fff',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                      fontFamily: FONT,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{m.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: mode === m.value ? '#1e40af' : '#111827' }}>{m.label}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{m.sub}</div>
                    </div>
                    {mode === m.value && <span style={{ color: '#2563eb', fontSize: 14, fontWeight: 700 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'split' && (
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0c4a6e', marginBottom: 6 }}>
                  จำนวนเงินที่คืนสด/โอน (ที่เหลือเก็บเป็นเครดิต)
                </label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: '#0c4a6e' }}>฿</span>
                  <input
                    type="number"
                    value={splitCash}
                    onChange={e => setSplitCash(e.target.value)}
                    disabled={isLoading}
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
                      disabled={isLoading}
                      style={{
                        padding: '10px 12px', borderRadius: 8,
                        border: `1px solid ${method === o.value ? '#2563eb' : '#d1d5db'}`,
                        background: method === o.value ? '#eff6ff' : '#fff',
                        color: method === o.value ? '#1e40af' : '#374151',
                        fontSize: 13, fontWeight: 600,
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        textAlign: 'left', fontFamily: FONT,
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {needsBank && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <Field label="ธนาคาร"   value={bankName}        onChange={setBankName}        disabled={isLoading} />
                <Field label="เลขบัญชี *" value={bankAccount}    onChange={setBankAccount}    disabled={isLoading} />
                <div style={{ gridColumn: 'span 2' }}>
                  <Field label="ชื่อบัญชี" value={bankAccountName} onChange={setBankAccountName} disabled={isLoading} />
                </div>
              </div>
            )}

            {(mode === 'credit' || mode === 'split') && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
                padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#166534',
              }}>
                🎫 จะออก <strong>เครดิตคงเหลือ</strong> ฿{fmtBaht(mode === 'credit' ? refundAmount : splitCreditPart)} ให้ลูกค้า — สามารถใช้ในการจองครั้งถัดไป
              </div>
            )}
          </>
        )}

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
            disabled={isLoading}
            style={{
              padding: '10px 18px', border: '1px solid #d1d5db', borderRadius: 8,
              background: '#fff', color: '#374151', fontSize: 14, fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.6 : 1,
              transition: 'all 0.2s', fontFamily: FONT,
            }}
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            style={{
              padding: '10px 18px', border: 'none', borderRadius: 8,
              background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.7 : 1,
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: FONT,
            }}
          >
            {isLoading && (
              <div style={{
                width: 14, height: 14, border: '2px solid rgba(255, 255, 255, 0.3)',
                borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite',
              }} />
            )}
            ยืนยัน
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
