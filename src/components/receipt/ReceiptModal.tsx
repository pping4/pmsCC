'use client';

/**
 * ReceiptModal.tsx
 *
 * Full-screen modal that previews the receipt and provides print/close actions.
 * Printing opens a dedicated 58mm-width popup window for reliable thermal output.
 */

import { useRef } from 'react';
import ThermalReceipt from './ThermalReceipt';
import type { ReceiptData } from './types';
import { PROPERTY_CONFIG } from '@/lib/receipt-config';

const FONT = "'Sarabun', 'TH Sarabun New', system-ui, sans-serif";

interface ReceiptModalProps {
  receipt: ReceiptData | null;
  onClose: () => void;
  /** True when reprinting a historical invoice — adds สำเนา watermark */
  isReprint?: boolean;
}

export default function ReceiptModal({ receipt, onClose, isReprint = false }: ReceiptModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!receipt) return null;

  // ── Print via dedicated popup window ──────────────────────────────────────
  // Opens a new window sized exactly to 58mm for reliable thermal printing.
  // This bypasses browser header/footer and uses the correct paper size.
  const handlePrint = () => {
    const content = receiptRef.current?.innerHTML ?? '';

    const printWindow = window.open(
      '',
      'receipt-print',
      'width=280,height=600,scrollbars=no,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!printWindow) {
      // Fallback: use window.print() on current page
      window.print();
      return;
    }

    printWindow.document.write(`
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>ใบเสร็จรับเงิน — ${receipt.receiptNumber}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Sarabun', 'TH Sarabun New', 'Courier New', monospace;
      font-size: 8pt;
      line-height: 1.5;
      background: #fff;
      color: #000;
      width: 58mm;
    }

    @media print {
      @page {
        size: 58mm auto;
        margin: 2mm;
      }
      body {
        width: 58mm;
        margin: 0;
        padding: 0;
      }
    }

    /* ── Reset all inline pixel sizes to relative for print ── */
    #thermal-receipt-content { width: 100% !important; padding: 0 !important; }
    #thermal-receipt-content * { max-width: 100%; }
  </style>
</head>
<body>
  ${content}
  <script>
    // Auto-print when fonts load (or after short delay as fallback)
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { window.print(); window.close(); });
    } else {
      setTimeout(() => { window.print(); window.close(); }, 600);
    }
  </script>
</body>
</html>
    `);
    printWindow.document.close();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
          zIndex: 200,
        }}
      />

      {/* Modal panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201,
          backgroundColor: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          width: 320,
          fontFamily: FONT,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)',
            color: '#fff',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {isReprint ? '🖨️ พิมพ์ซ้ำใบเสร็จ' : '🧾 ใบเสร็จรับเงิน'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {receipt.receiptNumber}{isReprint ? ' · สำเนา' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 18,
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Receipt preview — scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            justifyContent: 'center',
            backgroundColor: '#f3f4f6',
          }}
        >
          {/* Paper shadow effect */}
          <div
            style={{
              backgroundColor: '#fff',
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <ThermalReceipt receipt={receipt} printRef={receiptRef} isReprint={isReprint} />
          </div>
        </div>

        {/* Action footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px',
              borderRadius: 6, border: '1.5px solid #e5e7eb',
              background: '#fff', color: '#374151',
              fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: FONT,
            }}
          >
            ปิด
          </button>
          <button
            onClick={handlePrint}
            style={{
              flex: 2, padding: '10px',
              borderRadius: 6, border: 'none',
              background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)',
              color: '#fff',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            🖨️ พิมพ์ใบเสร็จ
          </button>
        </div>
      </div>
    </>
  );
}
