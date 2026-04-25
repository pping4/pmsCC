'use client';

/**
 * TerminationDialog — 5-step wizard for terminating an ACTIVE contract.
 *
 * Sprint 3B / Module B / T13. Follows `.claude/skills/multi-step-dialog-wizard.md`
 * and `.claude/skills/mutation-toast-pattern.md`.
 *
 * Flow
 *   1) Reason        — category dropdown + freeform notes (≤ 1000 chars)
 *   2) Date          — termination date (default today; must fall between
 *                      contract.startDate and contract.endDate, inclusive)
 *   3) Preview       — calls POST /api/contracts/[id]/terminate/preview to
 *                      show the forfeit / refund / outstanding / additional-
 *                      charge breakdown. READ-ONLY.
 *   4) Adjustments   — optional operator overrides. `manualForfeitOverride`
 *                      replaces the computed forfeit; `additionalDeductions`
 *                      add ad-hoc charges (damages, utilities etc). Preview
 *                      re-runs locally so the UI reflects changes instantly.
 *   5) Review        — full summary + ConfirmDialog before POSTing to
 *                      /api/contracts/[id]/terminate. On success → close,
 *                      toast, fire `onSuccess` (caller refetches contract).
 *
 * API surface (stable):
 *   { open, onClose, contractId, contractNumber, startDate, endDate,
 *     monthlyRent, securityDeposit, onSuccess? }
 *
 * Security / discipline
 *   - Validates every transition client-side; the server re-validates with
 *     the same Zod schema (`TerminateBody`) so untrusted input cannot skip
 *     the preview or post beyond range.
 *   - Mutation uses the guard + try/finally + toast pattern; `busy` flag
 *     is the SINGLE SOURCE OF TRUTH for button-disable / dialog-lock.
 *   - No PII leakage: everything logged / toasted is contract-level.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  ConfirmDialog,
  Button,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';

// ─── Types ──────────────────────────────────────────────────────────────────

type ReasonCategory =
  | 'guest_request'
  | 'default'
  | 'property_damage'
  | 'mutual_agreement'
  | 'other';

interface AdditionalDeduction {
  label: string;
  amount: number;
}

interface PreviewBreakdown {
  depositHeld: number;
  lockInViolated: boolean;
  monthsRemainingInLockIn: number;
  penaltyBase: number;
  method: string;
}

interface PreviewResult {
  contract: { id: string; contractNumber: string; status: string };
  deposit: { id: string; amount: number } | null;
  outstandingBalance: number;
  forfeit: {
    forfeitedAmount: number;
    refundableAmount: number;
    breakdown: PreviewBreakdown;
  };
  netRefund: number;
  additionalCharge: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: string;
  contractNumber: string;
  /** YYYY-MM-DD or Date — used to validate termination date range. */
  startDate: string | Date;
  endDate: string | Date;
  /** For default-suggest / fallback preview when deposit service not wired. */
  monthlyRent: number;
  securityDeposit: number;
  onSuccess?: () => void;
}

const STEPS = [
  { id: 1, label: 'เหตุผล' },
  { id: 2, label: 'วันยกเลิก' },
  { id: 3, label: 'ดูสรุป' },
  { id: 4, label: 'ปรับแต่ง' },
  { id: 5, label: 'ยืนยัน' },
];

const REASON_LABELS: Record<ReasonCategory, string> = {
  guest_request: 'ลูกค้าขอยกเลิก',
  default: 'ลูกค้าผิดสัญญา',
  property_damage: 'ห้องเสียหาย',
  mutual_agreement: 'ตกลงร่วมกัน',
  other: 'อื่นๆ',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function toIsoDate(d: string | Date): string {
  if (d instanceof Date) return toDateStr(d);
  // Supplied already ISO — normalize via Date to strip any time component.
  const p = new Date(d);
  return Number.isNaN(p.getTime()) ? '' : toDateStr(p);
}

/** Strictly compare YYYY-MM-DD strings — avoids timezone drift. */
function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function n(v: string): number {
  if (v === '' || v == null) return 0;
  const p = Number(v);
  return Number.isFinite(p) ? p : 0;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TerminationDialog({
  open,
  onClose,
  contractId,
  contractNumber,
  startDate,
  endDate,
  monthlyRent,
  securityDeposit,
  onSuccess,
}: Props) {
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Step 1
  const [reasonCategory, setReasonCategory] =
    useState<ReasonCategory>('guest_request');
  const [notes, setNotes] = useState('');

  // Step 2
  const [terminationDate, setTerminationDate] = useState<string>(
    toDateStr(new Date()),
  );

  // Step 3 — preview (fetched from server)
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Step 4 — operator adjustments
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState<string>('');
  const [deductions, setDeductions] = useState<AdditionalDeduction[]>([]);

  // Derived range bounds as YYYY-MM-DD for comparison
  const startIso = useMemo(() => toIsoDate(startDate), [startDate]);
  const endIso = useMemo(() => toIsoDate(endDate), [endDate]);

  // Reset on reopen
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBusy(false);
    setConfirmOpen(false);
    setReasonCategory('guest_request');
    setNotes('');
    setTerminationDate(toDateStr(new Date()));
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setOverrideEnabled(false);
    setOverrideAmount('');
    setDeductions([]);
  }, [open]);

  // ── Step validation ──────────────────────────────────────────────────────
  const stepError = useMemo<string | null>(() => {
    if (step === 1) {
      if (!reasonCategory) return 'โปรดเลือกเหตุผล';
      if (notes.length > 1000) return 'หมายเหตุยาวเกิน 1000 ตัวอักษร';
      return null;
    }
    if (step === 2) {
      if (!terminationDate) return 'โปรดระบุวันที่ยกเลิก';
      if (startIso && cmpDate(terminationDate, startIso) < 0) {
        return `วันยกเลิกต้องไม่ก่อนวันเริ่มสัญญา (${startIso})`;
      }
      if (endIso && cmpDate(terminationDate, endIso) > 0) {
        return `วันยกเลิกต้องไม่เกินวันสิ้นสุดสัญญา (${endIso})`;
      }
      return null;
    }
    if (step === 3) {
      if (previewLoading) return 'กำลังคำนวณ...';
      if (previewError) return previewError;
      if (!preview) return 'ยังไม่มีผลการคำนวณ';
      return null;
    }
    if (step === 4) {
      if (overrideEnabled) {
        const v = n(overrideAmount);
        if (v < 0) return 'ค่าปรับต้องไม่ติดลบ';
        const cap = preview?.deposit?.amount ?? securityDeposit;
        if (v > cap) return `ค่าปรับต้องไม่เกินเงินประกัน (${fmtBaht(cap)})`;
      }
      for (const d of deductions) {
        if (!d.label.trim()) return 'ทุกรายการต้องมีชื่อ';
        if (!Number.isFinite(d.amount) || d.amount < 0) {
          return 'ทุกรายการต้องมียอดไม่ติดลบ';
        }
      }
      return null;
    }
    return null;
  }, [
    step, reasonCategory, notes, terminationDate,
    startIso, endIso,
    previewLoading, previewError, preview,
    overrideEnabled, overrideAmount, deductions, securityDeposit,
  ]);

  // ── Fetch server-side preview (step 3 entry or date change) ──────────────
  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/terminate/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminationDate }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setPreview(json as PreviewResult);
    } catch (e) {
      setPreview(null);
      setPreviewError(
        e instanceof Error ? e.message : 'คำนวณไม่สำเร็จ',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [contractId, terminationDate]);

  // Trigger preview when entering step 3 for the first time, or when date changes
  useEffect(() => {
    if (!open || step < 3) return;
    // Fetch every time the user lands on step 3 with a date — cheap.
    fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step >= 3, terminationDate]);

  // ── Locally-adjusted preview (step 4) ────────────────────────────────────
  const adjusted = useMemo(() => {
    if (!preview) return null;
    const depositAmt = preview.deposit?.amount ?? securityDeposit;
    const forfeitBase = overrideEnabled
      ? Math.max(0, Math.min(n(overrideAmount), depositAmt))
      : preview.forfeit.forfeitedAmount;
    const refundable = Math.max(0, depositAmt - forfeitBase);
    const extraTotal = deductions.reduce(
      (acc, d) => acc + Math.max(0, Number(d.amount) || 0),
      0,
    );
    const outstanding = Math.max(0, preview.outstandingBalance + extraTotal);
    const coveredByRefundable = Math.min(outstanding, refundable);
    const netRefund = Math.max(0, refundable - outstanding);
    const additionalCharge = Math.max(0, outstanding - coveredByRefundable);
    return {
      depositAmt,
      forfeited: forfeitBase,
      refundable,
      outstanding,
      netRefund,
      additionalCharge,
      extraTotal,
    };
  }, [preview, overrideEnabled, overrideAmount, deductions, securityDeposit]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const goNext = () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    setStep((s) => Math.min(5, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // ── Submit ───────────────────────────────────────────────────────────────
  const doTerminate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Derive terminationType from reason category — plan §5.3 mapping.
      const terminationType =
        reasonCategory === 'default' || reasonCategory === 'property_damage'
          ? 'lessor_initiated'
          : 'early_termination';

      const body = {
        terminationType,
        terminationDate,
        moveOutDate: terminationDate, // legacy alias kept for back-compat
        reasonCategory,
        notes: notes.trim() || undefined,
        reason: `[${REASON_LABELS[reasonCategory]}] ${notes.trim() || '-'}`,
        forfeitAmount: adjusted?.forfeited ?? 0,
        deductions: [] as Array<{ reason: string; amount: number }>,
        refundAmount: adjusted?.netRefund ?? 0,
        manualForfeitOverride: overrideEnabled ? n(overrideAmount) : undefined,
        additionalDeductions: deductions
          .filter((d) => d.label.trim() && d.amount > 0)
          .map((d) => ({ label: d.label.trim(), amount: Number(d.amount) })),
      };

      const res = await fetch(`/api/contracts/${contractId}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }

      toast.success(
        'ยกเลิกสัญญาสำเร็จ',
        `สัญญา ${contractNumber} ถูกยกเลิกและคำนวณการคืนเงินประกันแล้ว`,
      );
      setConfirmOpen(false);
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(
        'ยกเลิกสัญญาไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Deduction row helpers ────────────────────────────────────────────────
  const addDeduction = () =>
    setDeductions((d) => [...d, { label: '', amount: 0 }]);
  const updateDeduction = (
    i: number,
    patch: Partial<AdditionalDeduction>,
  ) =>
    setDeductions((d) =>
      d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  const removeDeduction = (i: number) =>
    setDeductions((d) => d.filter((_, idx) => idx !== i));

  // ── Stepper header ───────────────────────────────────────────────────────
  const Stepper = (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 18,
        alignItems: 'center',
        padding: '4px 0',
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s, i) => {
        const active = step === s.id;
        const done = step > s.id;
        return (
          <div
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: done
                  ? 'var(--success, #22c55e)'
                  : active
                    ? 'var(--primary-light, #3b82f6)'
                    : 'var(--surface-muted)',
                color: done || active ? '#fff' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {done ? '✓' : s.id}
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                style={{
                  width: 18,
                  height: 1,
                  background: 'var(--border-default)',
                  margin: '0 4px',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Status badge for forfeit amount (red/yellow/green) ───────────────────
  const forfeitBadge = (() => {
    if (!adjusted) return null;
    const d = adjusted.depositAmt;
    if (d <= 0) return null;
    const f = adjusted.forfeited;
    if (f <= 0) {
      return { bg: '#f0fdf4', fg: '#166534', border: '#86efac', label: 'คืนเต็มจำนวน' };
    }
    if (f >= d) {
      return { bg: '#fef2f2', fg: '#991b1b', border: '#fca5a5', label: 'ริบเต็ม' };
    }
    return { bg: '#fefce8', fg: '#854d0e', border: '#fde68a', label: 'ริบบางส่วน' };
  })();

  // ── Footer ───────────────────────────────────────────────────────────────
  const footer = (
    <>
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
        ปิด
      </Button>
      {step > 1 && (
        <Button type="button" variant="secondary" onClick={goBack} disabled={busy}>
          ← ย้อนกลับ
        </Button>
      )}
      {step < 5 && (
        <Button
          type="button"
          variant="primary"
          onClick={goNext}
          disabled={busy || !!stepError}
        >
          ถัดไป →
        </Button>
      )}
      {step === 5 && (
        <Button
          type="button"
          variant="danger"
          onClick={() => setConfirmOpen(true)}
          loading={busy}
          disabled={busy}
        >
          ยืนยันยกเลิกสัญญา
        </Button>
      )}
    </>
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? () => {} : onClose}
        title={`ยกเลิกสัญญา ${contractNumber}`}
        size="lg"
        footer={footer}
      >
        {Stepper}

        {/* ── Step 1 · Reason ───────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Select
              label="เหตุผลในการยกเลิก"
              value={reasonCategory}
              onChange={(e) =>
                setReasonCategory(e.target.value as ReasonCategory)
              }
              required
            >
              <option value="guest_request">{REASON_LABELS.guest_request}</option>
              <option value="default">{REASON_LABELS.default}</option>
              <option value="property_damage">{REASON_LABELS.property_damage}</option>
              <option value="mutual_agreement">{REASON_LABELS.mutual_agreement}</option>
              <option value="other">{REASON_LABELS.other}</option>
            </Select>
            <Textarea
              label="หมายเหตุ"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
              hint={`${notes.length} / 1000 ตัวอักษร`}
            />
          </div>
        )}

        {/* ── Step 2 · Date ─────────────────────────────────────────────── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                padding: '8px 10px',
                background: 'var(--surface-subtle)',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
              }}
            >
              ระยะสัญญา: <strong>{fmtDate(startIso)}</strong> → <strong>{fmtDate(endIso)}</strong>
            </div>
            <Input
              label="วันที่ยกเลิกสัญญา"
              type="date"
              value={terminationDate}
              min={startIso || undefined}
              max={endIso || undefined}
              onChange={(e) => setTerminationDate(e.target.value)}
              required
              hint="เลือกวันที่ที่ลูกค้าย้ายออก / วันที่สิ้นสุดการเช่าจริง"
            />
          </div>
        )}

        {/* ── Step 3 · Preview ──────────────────────────────────────────── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {previewLoading && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                กำลังคำนวณยอดคืนเงินประกัน…
              </div>
            )}
            {previewError && !previewLoading && (
              <div
                style={{
                  padding: 12,
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: 8,
                  color: '#991b1b',
                  fontSize: 13,
                }}
              >
                {previewError}
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={fetchPreview}
                  >
                    ลองอีกครั้ง
                  </Button>
                </div>
              </div>
            )}
            {preview && !previewLoading && adjusted && (
              <>
                <div
                  className="pms-card"
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: '1px solid var(--border-default)',
                    background: 'var(--surface-subtle)',
                  }}
                >
                  <PreviewRows
                    depositHeld={adjusted.depositAmt}
                    forfeited={adjusted.forfeited}
                    refundable={adjusted.refundable}
                    outstanding={preview.outstandingBalance}
                    netRefund={adjusted.netRefund}
                    additionalCharge={adjusted.additionalCharge}
                  />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    padding: '10px 12px',
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 8,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  <strong>วิธีคำนวณ: </strong>
                  {preview.forfeit.breakdown.method}
                  {preview.forfeit.breakdown.lockInViolated && (
                    <div style={{ marginTop: 4 }}>
                      ⚠️ ยกเลิกก่อนครบ lock-in — เหลืออีก{' '}
                      <strong>
                        {preview.forfeit.breakdown.monthsRemainingInLockIn} เดือน
                      </strong>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 4 · Adjustments ──────────────────────────────────────── */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: 12,
                border: '1px solid var(--border-default)',
                borderRadius: 8,
                background: 'var(--surface-subtle)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  onChange={(e) => setOverrideEnabled(e.target.checked)}
                />
                ปรับยอดริบเงินประกัน (override)
              </label>
              {overrideEnabled && (
                <div style={{ marginTop: 10 }}>
                  <Input
                    label={`ยอดริบใหม่ (บาท) — ไม่เกิน ${fmtBaht(preview?.deposit?.amount ?? securityDeposit)}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={overrideAmount}
                    onChange={(e) => setOverrideAmount(e.target.value)}
                    hint={`ค่าเดิมจากกติกา: ฿${fmtBaht(preview?.forfeit.forfeitedAmount ?? 0)}`}
                  />
                </div>
              )}
            </div>

            <div
              style={{
                padding: 12,
                border: '1px solid var(--border-default)',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  รายการหักเพิ่มเติม
                </strong>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addDeduction}
                >
                  + เพิ่มรายการ
                </Button>
              </div>
              {deductions.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    padding: 8,
                    textAlign: 'center',
                  }}
                >
                  ยังไม่มีรายการหัก — เช่น ค่าซ่อม, ค่าน้ำ-ไฟค้างชำระ
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {deductions.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 160px 40px',
                        gap: 8,
                        alignItems: 'end',
                      }}
                    >
                      <Input
                        label={i === 0 ? 'ชื่อรายการ' : undefined}
                        value={d.label}
                        onChange={(e) =>
                          updateDeduction(i, { label: e.target.value })
                        }
                        placeholder="เช่น ค่าซ่อมแอร์"
                      />
                      <Input
                        label={i === 0 ? 'ยอด (บาท)' : undefined}
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(d.amount)}
                        onChange={(e) =>
                          updateDeduction(i, {
                            amount: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => removeDeduction(i)}
                        style={{ padding: '6px 10px' }}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live-updating summary */}
            {adjusted && (
              <div
                className="pms-card"
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-subtle)',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: 8,
                  }}
                >
                  สรุปหลังปรับแต่ง
                </div>
                <PreviewRows
                  depositHeld={adjusted.depositAmt}
                  forfeited={adjusted.forfeited}
                  refundable={adjusted.refundable}
                  outstanding={adjusted.outstanding}
                  netRefund={adjusted.netRefund}
                  additionalCharge={adjusted.additionalCharge}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Step 5 · Review ───────────────────────────────────────────── */}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              className="pms-card"
              style={{
                padding: 14,
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--surface-subtle)',
              }}
            >
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr',
                  gap: '6px 12px',
                  fontSize: 13,
                  margin: 0,
                }}
              >
                <dt style={{ color: 'var(--text-muted)' }}>สัญญา</dt>
                <dd style={{ margin: 0 }}>{contractNumber}</dd>

                <dt style={{ color: 'var(--text-muted)' }}>เหตุผล</dt>
                <dd style={{ margin: 0 }}>
                  {REASON_LABELS[reasonCategory]}
                  {notes.trim() && (
                    <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                      “{notes.trim()}”
                    </div>
                  )}
                </dd>

                <dt style={{ color: 'var(--text-muted)' }}>วันยกเลิก</dt>
                <dd style={{ margin: 0 }}>{fmtDate(terminationDate)}</dd>

                <dt style={{ color: 'var(--text-muted)' }}>เงินประกันที่ถือไว้</dt>
                <dd style={{ margin: 0 }}>
                  ฿{fmtBaht(adjusted?.depositAmt ?? 0)}
                </dd>

                <dt style={{ color: 'var(--text-muted)' }}>ริบเงินประกัน</dt>
                <dd style={{ margin: 0 }}>
                  <span style={{ fontWeight: 600 }}>
                    ฿{fmtBaht(adjusted?.forfeited ?? 0)}
                  </span>
                  {forfeitBadge && (
                    <span
                      style={{
                        marginLeft: 8,
                        display: 'inline-block',
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 999,
                        background: forfeitBadge.bg,
                        color: forfeitBadge.fg,
                        border: `1px solid ${forfeitBadge.border}`,
                      }}
                    >
                      {forfeitBadge.label}
                    </span>
                  )}
                </dd>

                {overrideEnabled && (
                  <>
                    <dt style={{ color: 'var(--text-muted)' }}>Override</dt>
                    <dd style={{ margin: 0 }}>
                      ผู้ใช้ปรับยอดริบเป็น ฿{fmtBaht(n(overrideAmount))}
                    </dd>
                  </>
                )}

                {deductions.filter((d) => d.label.trim() && d.amount > 0).length > 0 && (
                  <>
                    <dt style={{ color: 'var(--text-muted)' }}>หักเพิ่มเติม</dt>
                    <dd style={{ margin: 0 }}>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {deductions
                          .filter((d) => d.label.trim() && d.amount > 0)
                          .map((d, i) => (
                            <li key={i}>
                              {d.label.trim()} · ฿{fmtBaht(d.amount)}
                            </li>
                          ))}
                      </ul>
                    </dd>
                  </>
                )}

                <dt style={{ color: 'var(--text-muted)' }}>ยอดค้างรวม</dt>
                <dd style={{ margin: 0 }}>
                  ฿{fmtBaht(adjusted?.outstanding ?? 0)}
                </dd>

                <dt style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                  คืนให้ลูกค้า
                </dt>
                <dd style={{ margin: 0, fontWeight: 700, color: '#166534' }}>
                  ฿{fmtBaht(adjusted?.netRefund ?? 0)}
                </dd>

                {(adjusted?.additionalCharge ?? 0) > 0 && (
                  <>
                    <dt style={{ color: '#991b1b', fontWeight: 700 }}>
                      เก็บเพิ่มจากลูกค้า
                    </dt>
                    <dd style={{ margin: 0, fontWeight: 700, color: '#991b1b' }}>
                      ฿{fmtBaht(adjusted?.additionalCharge ?? 0)}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div
              style={{
                padding: 10,
                fontSize: 12,
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                color: '#991b1b',
              }}
            >
              ⚠️ การยกเลิกสัญญาเป็นการดำเนินการแบบถาวร สัญญาจะเปลี่ยนสถานะเป็น <strong>terminated</strong> ทันที
              และจะไม่สามารถยกเลิกการดำเนินการนี้ได้
            </div>
          </div>
        )}

        {stepError && step !== 5 && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 8,
              background: '#fef2f2',
              color: '#991b1b',
              fontSize: 12,
              border: '1px solid #fecaca',
            }}
          >
            {stepError}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการยกเลิกสัญญา"
        description={`สัญญา ${contractNumber} จะถูกยกเลิกในวันที่ ${fmtDate(terminationDate)} · คืนเงิน ฿${fmtBaht(adjusted?.netRefund ?? 0)}`}
        confirmText="ยืนยันยกเลิกสัญญา"
        cancelText="ยกเลิก"
        variant="danger"
        loading={busy}
        onConfirm={doTerminate}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ─── Small presentational sub-component — the preview rows grid ────────────

function PreviewRows({
  depositHeld,
  forfeited,
  refundable,
  outstanding,
  netRefund,
  additionalCharge,
}: {
  depositHeld: number;
  forfeited: number;
  refundable: number;
  outstanding: number;
  netRefund: number;
  additionalCharge: number;
}) {
  const rows: Array<{ label: string; value: string; bold?: boolean; color?: string }> = [
    { label: 'เงินประกันที่ถือไว้', value: `฿${fmtBaht(depositHeld)}` },
    { label: 'ริบเงินประกัน', value: `- ฿${fmtBaht(forfeited)}`, color: '#991b1b' },
    { label: 'ส่วนที่คืนได้', value: `฿${fmtBaht(refundable)}`, bold: true },
    { label: 'ยอดค้างในบิล', value: `- ฿${fmtBaht(outstanding)}`, color: '#991b1b' },
    {
      label: 'คืนให้ลูกค้า (สุทธิ)',
      value: `฿${fmtBaht(netRefund)}`,
      bold: true,
      color: '#166534',
    },
  ];
  if (additionalCharge > 0) {
    rows.push({
      label: 'เก็บเพิ่มจากลูกค้า',
      value: `฿${fmtBaht(additionalCharge)}`,
      bold: true,
      color: '#991b1b',
    });
  }
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '6px 12px',
        fontSize: 13,
        margin: 0,
      }}
    >
      {rows.map((r, i) => (
        <PreviewRow key={i} {...r} />
      ))}
    </dl>
  );
}

function PreviewRow({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <>
      <dt style={{ color: 'var(--text-muted)', fontWeight: bold ? 700 : 500 }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: 'monospace',
          fontWeight: bold ? 700 : 500,
          color: color ?? 'var(--text-primary)',
          textAlign: 'right',
        }}
      >
        {value}
      </dd>
    </>
  );
}
