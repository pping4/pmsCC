'use client';

/**
 * CheckoutContractGuard — Sprint 3B / Phase I / T14.
 *
 * Wraps the existing checkout flow to handle early-termination of an active
 * monthly/long-stay contract. When a booking with a non-daily `bookingType`
 * enters the checkout step, we GET /api/contracts?bookingId=<id> and inspect
 * the most-recent row:
 *
 *   - No active contract                       → render nothing, guard off.
 *   - Active contract with endDate ≤ today     → render nothing (natural
 *                                                expiry, checkout proceeds).
 *   - Active contract with endDate > today     → render a warning banner and
 *                                                a "ยกเลิกสัญญาและเช็คเอาท์"
 *                                                button that opens the
 *                                                existing TerminationDialog.
 *                                                Parent disables its Confirm
 *                                                button while `blocking=true`.
 *
 * After TerminationDialog.onSuccess, settleDepositOnTermination has already
 * posted folio line items (forfeit / refund / additional charge), so the
 * caller just has to re-run its normal checkout confirm flow. We notify the
 * parent via `onTerminated` so it can refresh booking data and let the
 * operator click the usual "ยืนยันเช็คเอาท์" button.
 *
 * Daily bookings NEVER have contracts — parent simply doesn't mount us for
 * `bookingType === 'daily'`, so there is zero branching inside this file for
 * daily flows.
 */

import { useEffect, useState, useCallback } from 'react';
import TerminationDialog from '../../contracts/[id]/components/TerminationDialog';
import { fmtDate } from '@/lib/date-format';

// ─── Types (narrow shape from /api/contracts list rows) ────────────────────

interface ContractListRow {
  id: string;
  contractNumber: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRoomRent: number | string;
  bookingId: string;
}

interface ActiveContractLite {
  id: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  monthlyRoomRent: number;
  securityDeposit: number;
}

interface Props {
  bookingId: string;
  /** Parent hides this entirely for bookingType === 'daily'. */
  disabled?: boolean;
  /** Inverted boolean — true when an early-termination is required. */
  onBlockingChange?: (blocking: boolean) => void;
  /** Fired once termination succeeds. Parent should refresh booking. */
  onTerminated?: () => void;
}

// Strict YYYY-MM-DD comparison — avoids timezone drift when comparing
// `contract.endDate` (ISO at UTC midnight) against "today".
function todayIsoDate(): string {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function isoDate(v: string): string {
  // Contract endDate comes back as ISO string; slice the date part.
  if (v.length >= 10) return v.slice(0, 10);
  return v;
}

export default function CheckoutContractGuard({
  bookingId,
  disabled = false,
  onBlockingChange,
  onTerminated,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<ActiveContractLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlgOpen, setDlgOpen] = useState(false);

  const loadContract = useCallback(async () => {
    if (disabled || !bookingId) {
      setLoading(false);
      setContract(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contracts?bookingId=${encodeURIComponent(bookingId)}&status=active&limit=1`,
        { cache: 'no-store' },
      );
      const json: unknown = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(
          typeof json === 'object' && json && 'error' in json
            ? String((json as { error?: unknown }).error ?? `HTTP ${res.status}`)
            : `HTTP ${res.status}`,
        );
      }
      const rows = Array.isArray(json) ? (json as ContractListRow[]) : [];
      const active = rows.find((r) => r.status === 'active');
      if (!active) {
        setContract(null);
        return;
      }
      // We have the shape — hydrate by fetching the contract detail to get
      // `securityDeposit` (not returned in the list endpoint).
      const detailRes = await fetch(`/api/contracts/${active.id}`, {
        cache: 'no-store',
      });
      const detail: unknown = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) {
        throw new Error(
          typeof detail === 'object' && detail && 'error' in detail
            ? String((detail as { error?: unknown }).error ?? `HTTP ${detailRes.status}`)
            : `HTTP ${detailRes.status}`,
        );
      }
      const d = detail as {
        id?: string;
        contractNumber?: string;
        startDate?: string;
        endDate?: string;
        monthlyRoomRent?: number | string;
        securityDeposit?: number | string;
      };
      setContract({
        id: d.id ?? active.id,
        contractNumber: d.contractNumber ?? active.contractNumber,
        startDate: isoDate(d.startDate ?? active.startDate),
        endDate: isoDate(d.endDate ?? active.endDate),
        monthlyRoomRent: Number(d.monthlyRoomRent ?? active.monthlyRoomRent) || 0,
        securityDeposit: Number(d.securityDeposit ?? 0) || 0,
      });
    } catch (e) {
      setContract(null);
      setError(e instanceof Error ? e.message : 'ไม่สามารถตรวจสอบสถานะสัญญาได้');
    } finally {
      setLoading(false);
    }
  }, [bookingId, disabled]);

  useEffect(() => {
    void loadContract();
  }, [loadContract]);

  // Blocking = early termination required (active contract ending in the future).
  const blocking =
    !disabled &&
    !!contract &&
    contract.endDate > todayIsoDate();

  useEffect(() => {
    onBlockingChange?.(blocking);
  }, [blocking, onBlockingChange]);

  if (disabled) return null;
  if (loading) {
    return (
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '8px 12px',
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-light)',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        กำลังตรวจสอบสถานะสัญญา…
      </div>
    );
  }
  if (error) {
    return (
      <div
        style={{
          fontSize: 12,
          color: '#991b1b',
          padding: '8px 12px',
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        ⚠️ {error}
        <button
          type="button"
          onClick={() => void loadContract()}
          style={{
            marginLeft: 8,
            padding: '2px 8px',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fff',
            color: '#991b1b',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  // No active contract OR the contract naturally ended → no action needed.
  if (!contract || !blocking) return null;

  return (
    <>
      <div
        className="pms-card pms-transition"
        style={{
          padding: '12px 14px',
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: 8,
          marginBottom: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📑</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#92400e',
                lineHeight: 1.4,
              }}
            >
              สัญญา {contract.contractNumber} ยังมีผลอยู่ถึง {fmtDate(contract.endDate)}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#b45309',
                marginTop: 2,
                lineHeight: 1.5,
              }}
            >
              ต้องยกเลิกสัญญาก่อนเช็คเอาท์ เพื่อคำนวณการริบ/คืนเงินประกันและสร้างรายการในโฟลิโอ
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setDlgOpen(true)}
            style={{
              padding: '8px 14px',
              backgroundColor: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🚫 ยกเลิกสัญญาและเช็คเอาท์
          </button>
        </div>
      </div>

      <TerminationDialog
        open={dlgOpen}
        onClose={() => setDlgOpen(false)}
        contractId={contract.id}
        contractNumber={contract.contractNumber}
        startDate={contract.startDate}
        endDate={contract.endDate}
        monthlyRent={contract.monthlyRoomRent}
        securityDeposit={contract.securityDeposit}
        onSuccess={() => {
          // Dialog closes itself. Refresh our own state + notify parent.
          setDlgOpen(false);
          void loadContract();
          onTerminated?.();
        }}
      />
    </>
  );
}
