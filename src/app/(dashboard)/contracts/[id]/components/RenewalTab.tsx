'use client';

/**
 * RenewalTab — Sprint 3B Module C / T18
 *
 * Renders the "การต่อสัญญา" tab content on the contract detail page. Fetches
 * a `RenewalPreview` from `POST /api/contracts/[id]/renewal/preview` on mount
 * and caches it in local state. Exposes a refresh button, an inline utility-
 * override form, and a primary action that opens `RenewalWizardDialog`
 * (stubbed by T18; overwritten by T19).
 *
 * Security / architecture notes:
 *  - Read-only POST call (preview endpoint performs its own RBAC + Zod).
 *  - No direct Prisma access. No secrets exposed.
 *  - Follows the mutation-toast-pattern for the refresh/override calls
 *    (double-click guard + try/finally + toast).
 *  - All dates via `@/lib/date-format` — no `th-TH` locale anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, useToast } from '@/components/ui';
import { fmtBaht, fmtDate } from '@/lib/date-format';
import RenewalWizardDialog from './RenewalWizardDialog';

// ─── RenewalPreview shape (mirrors src/services/renewal.service.ts) ─────────

type BillingCycle = 'rolling' | 'calendar';

interface OtherCharge {
  label: string;
  amount: number;
}

interface RenewalPreview {
  contractId: string;
  contractNumber: string;
  guestName: string;
  roomNumber: string;
  currentPeriodEnd: string; // serialized Date
  nextPeriodStart: string;
  nextPeriodEnd: string;
  billingCycle: BillingCycle;
  baseRent: number;
  furnitureRent: number;
  proratedAdjustment: number;
  utilityWater: number | null;
  utilityElectric: number | null;
  otherCharges: OtherCharge[];
  subtotal: number;
  total: number;
  warnings: string[];
  effectiveMonthlyRent: number;
  rateChangedFromAmendment: boolean;
}

interface UtilityOverrideSide {
  prev: number;
  curr: number;
  rate?: number;
}
interface UtilityOverride {
  water?: UtilityOverrideSide;
  electric?: UtilityOverrideSide;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface RenewalTabProps {
  contractId: string;
  onRenewed?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CYCLE_LABEL: Record<BillingCycle, string> = {
  rolling: 'รายเดือนตามวันเข้าพัก (Rolling)',
  calendar: 'รายเดือนตามปฏิทิน (Calendar)',
};

function toNumberOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RenewalTab({ contractId, onRenewed }: RenewalTabProps) {
  const toast = useToast();

  const [preview, setPreview] = useState<RenewalPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Utility override form
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [wPrev, setWPrev] = useState('');
  const [wCurr, setWCurr] = useState('');
  const [wRate, setWRate] = useState('');
  const [ePrev, setEPrev] = useState('');
  const [eCurr, setECurr] = useState('');
  const [eRate, setERate] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);

  // Last override payload — re-applied to subsequent refresh calls until cleared
  const [activeOverride, setActiveOverride] = useState<UtilityOverride | null>(
    null,
  );

  // Wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchPreview = useCallback(
    async (override: UtilityOverride | null) => {
      const body: Record<string, unknown> = {};
      if (override) body.utilityOverride = override;
      const res = await fetch(`/api/contracts/${contractId}/renewal/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as
        | RenewalPreview
        | { error?: string };
      if (!res.ok) {
        const msg =
          (json as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return json as RenewalPreview;
    },
    [contractId],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPreview(null)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPreview]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const p = await fetchPreview(activeOverride);
      setPreview(p);
      toast.success('รีเฟรชการคำนวณสำเร็จ');
    } catch (e) {
      toast.error(
        'รีเฟรชไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleApplyOverride() {
    if (submittingOverride) return;

    const wp = toNumberOrUndef(wPrev);
    const wc = toNumberOrUndef(wCurr);
    const wr = toNumberOrUndef(wRate);
    const ep = toNumberOrUndef(ePrev);
    const ec = toNumberOrUndef(eCurr);
    const er = toNumberOrUndef(eRate);

    const next: UtilityOverride = {};
    if (wp !== undefined && wc !== undefined) {
      if (wc < wp) {
        toast.warning('เลขมิเตอร์น้ำไม่ถูกต้อง', 'เลขปัจจุบันต้องมากกว่าเลขก่อน');
        return;
      }
      next.water = { prev: wp, curr: wc, ...(wr !== undefined ? { rate: wr } : {}) };
    }
    if (ep !== undefined && ec !== undefined) {
      if (ec < ep) {
        toast.warning('เลขมิเตอร์ไฟไม่ถูกต้อง', 'เลขปัจจุบันต้องมากกว่าเลขก่อน');
        return;
      }
      next.electric = { prev: ep, curr: ec, ...(er !== undefined ? { rate: er } : {}) };
    }
    if (!next.water && !next.electric) {
      toast.warning('กรุณากรอกเลขมิเตอร์อย่างน้อยหนึ่งรายการ');
      return;
    }

    setSubmittingOverride(true);
    try {
      const p = await fetchPreview(next);
      setPreview(p);
      setActiveOverride(next);
      toast.success('ใช้เลขมิเตอร์ที่กำหนดเองแล้ว');
      setOverrideOpen(false);
    } catch (e) {
      toast.error(
        'คำนวณไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setSubmittingOverride(false);
    }
  }

  function handleClearOverride() {
    setActiveOverride(null);
    setWPrev('');
    setWCurr('');
    setWRate('');
    setEPrev('');
    setECurr('');
    setERate('');
    // Trigger a fresh (no-override) fetch.
    void (async () => {
      setRefreshing(true);
      try {
        const p = await fetchPreview(null);
        setPreview(p);
      } catch (e) {
        toast.error(
          'รีเฟรชไม่สำเร็จ',
          e instanceof Error ? e.message : undefined,
        );
      } finally {
        setRefreshing(false);
      }
    })();
  }

  // ── Render states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="pms-card pms-transition"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 24,
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
      >
        กำลังคำนวณการต่อสัญญา…
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div
        className="pms-card pms-transition"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {error ?? 'ไม่พบข้อมูลการต่อสัญญา'}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            ลองอีกครั้ง
          </Button>
        </div>
      </div>
    );
  }

  // ── Build charges breakdown rows ─────────────────────────────────────────
  const rows: Array<{ label: string; amount: number; hint?: string }> = [];
  rows.push({ label: 'ค่าเช่าห้อง', amount: preview.baseRent });
  if (preview.furnitureRent > 0) {
    rows.push({ label: 'ค่าเฟอร์นิเจอร์', amount: preview.furnitureRent });
  }
  if (preview.proratedAdjustment !== 0) {
    rows.push({
      label: 'ปรับตามสัดส่วน',
      amount: preview.proratedAdjustment,
      hint: 'งวดนี้ไม่ครบเดือนเต็ม ค่าเช่าถูกคิดตามจำนวนวันจริง',
    });
  }
  if (preview.utilityWater !== null) {
    rows.push({ label: 'ค่าน้ำ', amount: preview.utilityWater });
  }
  if (preview.utilityElectric !== null) {
    rows.push({ label: 'ค่าไฟ', amount: preview.utilityElectric });
  }
  for (const oc of preview.otherCharges) {
    rows.push({ label: oc.label, amount: oc.amount });
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Summary card */}
      <div
        className="pms-card pms-transition"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            งวดถัดไป
          </h3>
          {preview.rateChangedFromAmendment && (
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: '#eff6ff',
                color: '#1e40af',
                border: '1px solid #bfdbfe',
              }}
            >
              อัตราใหม่จากการแก้ไขสัญญา
            </span>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <SummaryCell
            label="สิ้นสุดงวดปัจจุบัน"
            value={fmtDate(preview.currentPeriodEnd)}
          />
          <SummaryCell
            label="เริ่มงวดถัดไป"
            value={fmtDate(preview.nextPeriodStart)}
          />
          <SummaryCell
            label="สิ้นสุดงวดถัดไป"
            value={fmtDate(preview.nextPeriodEnd)}
          />
          <SummaryCell label="รอบบิล" value={CYCLE_LABEL[preview.billingCycle]} />
        </div>
      </div>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            color: '#92400e',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>ข้อควรระวัง</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Charges breakdown */}
      <div
        className="pms-card pms-transition"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 18,
        }}
      >
        <h3
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          รายการเรียกเก็บ
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-subtle)' }}>
                <th
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-default)',
                    fontSize: 12,
                  }}
                >
                  รายการ
                </th>
                <th
                  style={{
                    padding: '8px 10px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-default)',
                    fontSize: 12,
                  }}
                >
                  จำนวน (บาท)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={`${r.label}-${idx}`}
                  style={{
                    background:
                      idx % 2 === 0
                        ? 'var(--surface-card)'
                        : 'var(--surface-subtle)',
                  }}
                >
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border-light)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {r.label}
                    {r.hint && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginTop: 2,
                        }}
                      >
                        {r.hint}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border-light)',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color:
                        r.amount < 0
                          ? 'var(--danger)'
                          : 'var(--text-primary)',
                    }}
                  >
                    ฿{fmtBaht(r.amount)}
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface-muted)' }}>
                <td
                  style={{
                    padding: '10px',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                  }}
                >
                  รวม
                </td>
                <td
                  style={{
                    padding: '10px',
                    textAlign: 'right',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    fontSize: 15,
                    color: 'var(--text-primary)',
                  }}
                >
                  ฿{fmtBaht(preview.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {activeOverride && (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              fontSize: 12,
              color: '#1e40af',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>ใช้เลขมิเตอร์ที่กำหนดเองอยู่</span>
            <button
              type="button"
              onClick={handleClearOverride}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#1e40af',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              ล้างและใช้ค่าจากมิเตอร์จริง
            </button>
          </div>
        )}
      </div>

      {/* Utility override form */}
      {overrideOpen && (
        <div
          className="pms-card pms-transition"
          style={{
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-default)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h4
            style={{
              margin: 0,
              marginBottom: 10,
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            ระบุเลขมิเตอร์เอง
          </h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            <Input
              label="น้ำ: เลขก่อน"
              type="number"
              value={wPrev}
              onChange={(e) => setWPrev(e.target.value)}
            />
            <Input
              label="น้ำ: เลขปัจจุบัน"
              type="number"
              value={wCurr}
              onChange={(e) => setWCurr(e.target.value)}
            />
            <Input
              label="น้ำ: อัตรา/หน่วย (ว่างได้)"
              type="number"
              value={wRate}
              onChange={(e) => setWRate(e.target.value)}
            />
            <Input
              label="ไฟ: เลขก่อน"
              type="number"
              value={ePrev}
              onChange={(e) => setEPrev(e.target.value)}
            />
            <Input
              label="ไฟ: เลขปัจจุบัน"
              type="number"
              value={eCurr}
              onChange={(e) => setECurr(e.target.value)}
            />
            <Input
              label="ไฟ: อัตรา/หน่วย (ว่างได้)"
              type="number"
              value={eRate}
              onChange={(e) => setERate(e.target.value)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 12,
            }}
          >
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOverrideOpen(false)}
              disabled={submittingOverride}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleApplyOverride}
              disabled={submittingOverride}
            >
              {submittingOverride ? 'กำลังคำนวณ…' : 'คำนวณใหม่'}
            </Button>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          type="button"
          variant="secondary"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'กำลังรีเฟรช…' : 'รีเฟรชการคำนวณ'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOverrideOpen((v) => !v)}
        >
          {overrideOpen ? 'ปิดฟอร์มมิเตอร์' : 'ระบุเลขมิเตอร์เอง'}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => setWizardOpen(true)}
        >
          ดำเนินการต่อสัญญา
        </Button>
      </div>

      <RenewalWizardDialog
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        contractId={contractId}
        onSuccess={() => {
          setWizardOpen(false);
          onRenewed?.();
          void handleRefresh();
        }}
      />
    </div>
  );
}

// ─── Small sub-component ────────────────────────────────────────────────────

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
