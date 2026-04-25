'use client';

/**
 * InvoiceModal.tsx
 *
 * Modal that previews an A4 invoice and lets the user pick a paper size
 * before printing.
 *
 * Supported paper sizes:
 *  • 58mm  — thermal roll (narrow, 32 chars/line)
 *  • 80mm  — thermal roll (wide, 44 chars/line)
 *  • A5    — half-A4 (148 mm × 210 mm)
 *  • A4    — standard (210 mm × 297 mm)  ← default
 */

import { useRef, useState } from 'react';
import InvoiceDocument from './InvoiceDocument';
import type { InvoiceDocumentData } from './types';
import { PROPERTY_CONFIG } from '@/lib/receipt-config';
import { fmtBaht } from '@/lib/date-format';

const FONT = "'Sarabun', 'TH Sarabun New', system-ui, sans-serif";

// ─── Paper size types ─────────────────────────────────────────────────────────

type PaperSize = '58mm' | '80mm' | 'A5' | 'A4';

interface PaperOption {
  value: PaperSize;
  label: string;
  desc:  string;
  icon:  string;
}

const PAPER_OPTIONS: PaperOption[] = [
  { value: '58mm', label: '58mm', desc: 'ความร้อน', icon: '🧻' },
  { value: '80mm', label: '80mm', desc: 'ความร้อน', icon: '🧻' },
  { value: 'A5',   label: 'A5',   desc: 'ครึ่ง A4',  icon: '📄' },
  { value: 'A4',   label: 'A4',   desc: 'มาตรฐาน',  icon: '📃' },
];

// ─── Thermal HTML builder ─────────────────────────────────────────────────────

const INVOICE_TYPE_TH_SHORT: Record<string, string> = {
  proforma:         'ใบแจ้งหนี้ล่วงหน้า',
  deposit_receipt:  'ใบแจ้งหนี้ (มัดจำ)',
  daily_stay:       'ใบแจ้งหนี้ (เช็คอิน)',
  checkout_balance: 'ใบแจ้งหนี้ (เช็คเอาท์)',
  monthly_rent:     'ใบแจ้งหนี้ (รายเดือน)',
  utility:          'ใบแจ้งหนี้ (สาธารณูปโภค)',
  extra_service:    'ใบแจ้งหนี้ (บริการเสริม)',
  general:          'ใบแจ้งหนี้',
};

/**
 * Builds a minimal thermal HTML document for 58 mm or 80 mm paper.
 * The outer wrapper width is fixed so the browser's @page rule can clip it.
 */
function buildThermalHtml(doc: InvoiceDocumentData, widthMM: number): string {
  const title   = INVOICE_TYPE_TH_SHORT[doc.invoiceType] ?? 'ใบแจ้งหนี้';
  const pxWidth = widthMM === 58 ? 216 : 302; // 1 mm ≈ 3.78 px
  const fmtAmt  = (n: number) => `฿${fmtBaht(n)}`;

  const rows = doc.items.map(item => `
    <div style="margin-bottom:4px;">
      <div style="word-break:break-word;">${item.description}</div>
      ${item.periodStart && item.periodEnd
        ? `<div style="font-size:9px;color:#1e40af;padding-left:4px;font-style:italic;">${item.periodStart} – ${item.periodEnd}</div>`
        : item.periodStart
          ? `<div style="font-size:9px;color:#1e40af;padding-left:4px;font-style:italic;">${item.periodStart}</div>`
          : ''}
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#444;padding-left:8px;">
        <span>${item.quantity} × ${fmtAmt(item.unitPrice)}</span>
        <span style="font-weight:700;">${fmtAmt(item.amount)}</span>
      </div>
    </div>
  `).join('');

  const totals = [
    doc.discountAmount > 0
      ? `<div style="display:flex;justify-content:space-between;"><span>รวมก่อนลด</span><span>${fmtAmt(doc.subtotal)}</span></div>
         <div style="display:flex;justify-content:space-between;"><span>ส่วนลด</span><span>-${fmtAmt(doc.discountAmount)}</span></div>`
      : '',
    doc.vatAmount > 0
      ? `<div style="display:flex;justify-content:space-between;"><span>VAT 7%</span><span>${fmtAmt(doc.vatAmount)}</span></div>`
      : '',
    `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;border-top:1px solid #000;margin-top:4px;padding-top:4px;">
       <span>ยอดรวม</span><span>${fmtAmt(doc.grandTotal)}</span>
     </div>`,
    doc.paidAmount > 0
      ? `<div style="display:flex;justify-content:space-between;"><span>ชำระแล้ว</span><span>${fmtAmt(doc.paidAmount)}</span></div>
         <div style="display:flex;justify-content:space-between;font-weight:700;color:#c00;">
           <span>ยังค้างชำระ</span><span>${fmtAmt(doc.balanceDue)}</span>
         </div>`
      : '',
  ].filter(Boolean).join('');

  const guestName = (doc.guestNameTH || doc.guestNameEN).trim();

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8"/>
  <title>${title} ${doc.invoiceNumber}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{
      font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;
      font-size:12px;color:#000;background:#fff;
      width:${pxWidth}px;
    }
    @media print{
      @page{size:${widthMM}mm auto;margin:2mm;}
      body{width:100%;margin:0;padding:0;}
    }
    .dashed{border-top:1px dashed #000;margin:6px 0;}
  </style>
</head>
<body>
  <div style="padding:4px 6px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:6px;">
      <div style="font-size:13px;font-weight:800;">${PROPERTY_CONFIG.nameTH}</div>
      <div style="font-size:10px;">${PROPERTY_CONFIG.address}</div>
      <div style="font-size:10px;">${PROPERTY_CONFIG.city}</div>
      <div style="font-size:10px;">โทร ${PROPERTY_CONFIG.phone}</div>
      ${PROPERTY_CONFIG.taxId
        ? `<div style="font-size:10px;">เลขผู้เสียภาษี ${PROPERTY_CONFIG.taxId}</div>`
        : ''}
    </div>

    <!-- Title -->
    <div class="dashed"></div>
    <div style="text-align:center;margin-bottom:4px;">
      <div style="font-size:13px;font-weight:700;">${title}</div>
      <div style="font-size:11px;color:#444;">${doc.invoiceNumber}</div>
    </div>
    <div class="dashed"></div>

    <!-- Booking info -->
    <div style="font-size:11px;margin-bottom:6px;">
      <div>วันที่ออก : ${doc.issueDate}</div>
      <div>การจอง   : BK-${doc.bookingNumber}</div>
      <div>ห้อง      : ${doc.roomNumber}</div>
      <div>เช็คอิน   : ${doc.checkIn}</div>
      <div>เช็คเอาท์ : ${doc.checkOut}</div>
    </div>

    <!-- Guest -->
    <div class="dashed"></div>
    <div style="font-size:11px;margin-bottom:6px;">
      <div style="font-weight:700;">ผู้เข้าพัก</div>
      <div>${guestName}</div>
      ${doc.companyName ? `<div>${doc.companyName}</div>` : ''}
      ${doc.companyTaxId ? `<div>Tax ID: ${doc.companyTaxId}</div>` : ''}
    </div>

    <!-- Items -->
    <div class="dashed"></div>
    <div style="font-size:11px;margin-bottom:6px;">${rows}</div>

    <!-- Totals -->
    <div class="dashed"></div>
    <div style="font-size:12px;margin-bottom:8px;">${totals}</div>

    <!-- Footer -->
    <div class="dashed"></div>
    <div style="text-align:center;font-size:10px;color:#555;">
      <div>${PROPERTY_CONFIG.website}</div>
      <div>LINE: ${PROPERTY_CONFIG.lineId}</div>
      <div style="margin-top:4px;font-style:italic;">เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน</div>
    </div>
  </div>

  <script>
    if(document.fonts&&document.fonts.ready){
      document.fonts.ready.then(()=>setTimeout(()=>window.print(),200));
    }else{
      setTimeout(()=>window.print(),900);
    }
  </script>
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InvoiceModalProps {
  document:   InvoiceDocumentData | null;
  onClose:    () => void;
  isReprint?: boolean;
}

export default function InvoiceModal({
  document: doc,
  onClose,
  isReprint = false,
}: InvoiceModalProps) {
  const invoiceRef                    = useRef<HTMLDivElement>(null);
  const [paperSize, setPaperSize]     = useState<PaperSize>('A4');

  if (!doc) return null;

  // ── Print handler ──────────────────────────────────────────────────────────
  const handlePrint = () => {
    const isThermal = paperSize === '58mm' || paperSize === '80mm';
    const widthMM   = paperSize === '58mm' ? 58 : 80;

    // ── Thermal branch ─────────────────────────────────────────────────────
    if (isThermal) {
      const pw = window.open(
        '',
        'thermal-invoice-print',
        `width=${widthMM === 58 ? 280 : 380},height=600,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no`,
      );
      if (!pw) { alert('กรุณาอนุญาต Popup เพื่อพิมพ์'); return; }
      pw.document.write(buildThermalHtml(doc, widthMM));
      pw.document.close();
      return;
    }

    // ── A4 / A5 branch ─────────────────────────────────────────────────────
    const content  = invoiceRef.current?.innerHTML ?? '';
    const pageCSS  = paperSize === 'A5'
      ? `@page { size: A5 portrait; margin: 0; }
         #invoice-document-content {
           width: 148mm !important;
           min-height: 210mm !important;
           padding: 8mm 10mm !important;
           font-size: 10px !important;
         }`
      : `@page { size: A4 portrait; margin: 0; }
         #invoice-document-content {
           width: 210mm !important;
           min-height: 297mm !important;
           padding: 12mm 14mm !important;
         }`;

    const pw = window.open(
      '',
      'invoice-print',
      'width=900,height=750,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no',
    );
    if (!pw) { alert('กรุณาอนุญาต Popup เพื่อพิมพ์'); return; }

    pw.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8"/>
  <title>ใบแจ้งหนี้ — ${doc.invoiceNumber}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:13px;background:#fff;color:#111;}
    @media print{${pageCSS}}
    @media screen{body{background:#f3f4f6;}#invoice-document-content{box-shadow:0 2px 12px rgba(0,0,0,.15);}}
  </style>
</head>
<body>
  ${content}
  <script>
    if(document.fonts&&document.fonts.ready){
      document.fonts.ready.then(()=>window.print());
    }else{
      setTimeout(()=>window.print(),800);
    }
  </script>
</body>
</html>`);
    pw.document.close();
  };

  // ── Thermal inline preview ─────────────────────────────────────────────────
  const isThermal    = paperSize === '58mm' || paperSize === '80mm';
  const thermalWidth = paperSize === '58mm' ? 220 : 304;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
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
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
          width: 'min(900px, 95vw)',
          fontFamily: FONT,
          overflow: 'hidden',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              📄 {isReprint ? 'พิมพ์ซ้ำใบแจ้งหนี้' : 'ใบแจ้งหนี้'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {doc.invoiceNumber}{isReprint ? ' · สำเนา' : ''} · {PROPERTY_CONFIG.name}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none', borderRadius: 6,
              color: '#fff', cursor: 'pointer',
              fontSize: 18, width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* ── Paper size picker ────────────────────────────────────────────── */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginRight: 4 }}>
            📐 ขนาดกระดาษ:
          </span>
          {PAPER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPaperSize(opt.value)}
              title={opt.desc}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                border: `1.5px solid ${paperSize === opt.value ? '#2563eb' : '#d1d5db'}`,
                background: paperSize === opt.value ? '#dbeafe' : '#fff',
                color: paperSize === opt.value ? '#1d4ed8' : '#374151',
                fontSize: 12,
                fontWeight: paperSize === opt.value ? 700 : 500,
                cursor: 'pointer',
                fontFamily: FONT,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s',
              }}
            >
              {opt.icon} {opt.label}
              <span style={{ fontSize: 10, color: paperSize === opt.value ? '#3b82f6' : '#9ca3af' }}>
                {opt.desc}
              </span>
            </button>
          ))}
        </div>

        {/* ── Preview area ─────────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            backgroundColor: '#f3f4f6',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {isThermal ? (
            /* ── Thermal preview ── */
            <div
              style={{
                width: thermalWidth,
                backgroundColor: '#fff',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                borderRadius: 2,
                padding: '8px 10px',
                fontFamily: FONT,
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {/* Header */}
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{PROPERTY_CONFIG.nameTH}</div>
                <div style={{ fontSize: 10, color: '#555' }}>{PROPERTY_CONFIG.address}</div>
                <div style={{ fontSize: 10, color: '#555' }}>{PROPERTY_CONFIG.city}</div>
                <div style={{ fontSize: 10, color: '#555' }}>โทร {PROPERTY_CONFIG.phone}</div>
                {PROPERTY_CONFIG.taxId && (
                  <div style={{ fontSize: 10, color: '#555' }}>
                    เลขผู้เสียภาษี {PROPERTY_CONFIG.taxId}
                  </div>
                )}
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Title */}
              <div style={{ textAlign: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {INVOICE_TYPE_TH_SHORT[doc.invoiceType] ?? 'ใบแจ้งหนี้'}
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>{doc.invoiceNumber}</div>
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Info */}
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                <div>วันที่ออก: {doc.issueDate}</div>
                <div>การจอง: BK-{doc.bookingNumber}</div>
                <div>ห้อง: {doc.roomNumber}</div>
                <div>เช็คอิน: {doc.checkIn}</div>
                <div>เช็คเอาท์: {doc.checkOut}</div>
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Guest */}
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>ผู้เข้าพัก</div>
                <div>{(doc.guestNameTH || doc.guestNameEN).trim()}</div>
                {doc.companyName && <div>{doc.companyName}</div>}
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Items */}
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                {doc.items.map((item, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <div>{item.description}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8, fontSize: 10, color: '#555' }}>
                      <span>{item.quantity} × ฿{fmtBaht(item.unitPrice)}</span>
                      <span style={{ fontWeight: 700, color: '#000' }}>฿{fmtBaht(item.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Totals */}
              <div style={{ fontSize: 12 }}>
                {doc.discountAmount > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>รวมก่อนลด</span><span>฿{fmtBaht(doc.subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>ส่วนลด</span><span>-฿{fmtBaht(doc.discountAmount)}</span>
                    </div>
                  </>
                )}
                {doc.vatAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>VAT 7%</span><span>฿{fmtBaht(doc.vatAmount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14, borderTop: '1px solid #000', marginTop: 4, paddingTop: 4 }}>
                  <span>ยอดรวม</span><span>฿{fmtBaht(doc.grandTotal)}</span>
                </div>
                {doc.paidAmount > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>ชำระแล้ว</span><span>฿{fmtBaht(doc.paidAmount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#dc2626' }}>
                      <span>ยังค้างชำระ</span><span>฿{fmtBaht(doc.balanceDue)}</span>
                    </div>
                  </>
                )}
              </div>
              <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

              {/* Footer */}
              <div style={{ textAlign: 'center', fontSize: 10, color: '#777' }}>
                <div>{PROPERTY_CONFIG.website}</div>
                <div>LINE: {PROPERTY_CONFIG.lineId}</div>
                <div style={{ marginTop: 4, fontStyle: 'italic' }}>เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน</div>
              </div>
            </div>
          ) : (
            /* ── A4 / A5 preview ── */
            <div
              style={{
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                borderRadius: 2,
                overflow: 'hidden',
                backgroundColor: '#fff',
                transform: paperSize === 'A5' ? 'scale(0.87)' : 'none',
                transformOrigin: 'top center',
              }}
            >
              <InvoiceDocument document={doc} printRef={invoiceRef} isReprint={isReprint} />
            </div>
          )}
        </div>

        {/* ── Footer actions ───────────────────────────────────────────────── */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
            backgroundColor: '#fff',
            alignItems: 'center',
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
              background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
              color: '#fff',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            🖨️ พิมพ์ ({paperSize})
          </button>
        </div>
      </div>
    </>
  );
}
