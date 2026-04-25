'use client';

/**
 * AutoPrint — client-side wrapper that fires `window.print()` once on mount.
 *
 * Kept as a leaf client component so the surrounding print page stays a
 * pure Server Component (no client data fetching, no leaked PII to the
 * client bundle beyond the already-rendered HTML).
 *
 * Also exposes a small "พิมพ์เอกสาร" / "Print" button for users who
 * dismissed the initial print dialog and want to re-trigger it.
 */

import { useEffect } from 'react';

interface Props {
  /** Delay (ms) before auto-triggering print — lets fonts + layout settle. */
  delayMs?: number;
  /** Disable the auto-fire (still renders the manual button). */
  disableAuto?: boolean;
  buttonLabel?: string;
}

export default function AutoPrint({
  delayMs = 400,
  disableAuto = false,
  buttonLabel = 'พิมพ์เอกสาร',
}: Props) {
  useEffect(() => {
    if (disableAuto) return;
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore — the manual button below still works
      }
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs, disableAuto]);

  return (
    <div className="no-print" style={{ textAlign: 'right', margin: '8px 0' }}>
      <button
        type="button"
        onClick={() => window.print()}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          border: '1px solid #1d4ed8',
          background: '#1d4ed8',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
