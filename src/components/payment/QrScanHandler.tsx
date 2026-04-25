/**
 * QrScanHandler — Sprint 5 Phase 3.6 Quick Cashier Mode
 *
 * Listens for a USB/Bluetooth QR scanner that types characters very fast
 * followed by Enter. Captures the burst, parses as EMVCo Thai QR, and
 * invokes `onScan(qr)` when a full payload is detected.
 *
 * Heuristic: chars within 30 ms of each other are part of one scan.
 * Enter terminates the burst. Keyboard typing by humans is ignored because
 * inter-key delay is > 30 ms.
 *
 * The handler attaches to window-level keydown so it catches input
 * regardless of focused element — but skips when the user is focused in
 * a normal text input (except when explicitly `captureInInputs`).
 */
'use client';

import { useEffect, useRef } from 'react';
import { parseEmvcoQr, type EmvcoQr } from '@/lib/payment/emvco';

interface Props {
  /** Called with successfully parsed EMVCo QR. */
  onScan: (qr: EmvcoQr) => void;
  /** Called with the raw burst when parsing fails — optional, for error UI. */
  onInvalid?: (raw: string) => void;
  /** Max ms between chars to still count as one burst. Default 30. */
  burstGapMs?: number;
  /** If true, capture even when a text input is focused. Default false. */
  captureInInputs?: boolean;
  enabled?: boolean;
}

export function QrScanHandler({
  onScan, onInvalid, burstGapMs = 30, captureInInputs = false, enabled = true,
}: Props) {
  const bufRef   = useRef<string>('');
  const lastKeyRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    function handler(e: KeyboardEvent) {
      // Skip focused inputs unless explicitly enabled
      if (!captureInInputs) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) {
          return;
        }
      }

      const now = performance.now();
      const gap = now - lastKeyRef.current;
      lastKeyRef.current = now;

      // New burst if gap too large
      if (gap > burstGapMs) bufRef.current = '';

      if (e.key === 'Enter') {
        const raw = bufRef.current;
        bufRef.current = '';
        if (raw.length >= 20) {
          const parsed = parseEmvcoQr(raw);
          if (parsed && parsed.payloadFormat === '01') {
            e.preventDefault();
            onScan(parsed);
          } else if (onInvalid) {
            onInvalid(raw);
          }
        }
        return;
      }

      // Only accept printable ASCII that EMVCo QR uses
      if (e.key.length === 1 && /^[0-9A-Za-z.\- ]$/.test(e.key)) {
        bufRef.current += e.key;
        // Hard cap to avoid unbounded growth
        if (bufRef.current.length > 1024) bufRef.current = '';
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, burstGapMs, captureInInputs, onScan, onInvalid]);

  return null;
}
