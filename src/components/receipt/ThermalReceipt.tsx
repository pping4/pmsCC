'use client';

/**
 * ThermalReceipt.tsx
 *
 * 58mm thermal printer receipt — ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ
 *
 * Layout spec (58mm paper):
 *  - Width    : 58mm (print), 240px (screen preview)
 *  - Font     : 'Sarabun', system Thai, monospace fallback
 *  - Line     : ~32 chars at 8pt
 *  - Margins  : 2mm left/right, 3mm top/bottom
 *
 * Thai tax invoice requirements (ใบกำกับภาษีอย่างย่อ):
 *  ✔ คำว่า "ใบกำกับภาษีอย่างย่อ" ปรากฏชัดเจน
 *  ✔ ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษีของผู้ขาย
 *  ✔ วัน เดือน ปี ที่ออกใบกำกับภาษี
 *  ✔ รายการสินค้า/บริการ จำนวน และราคา
 *  ✔ ราคาสินค้า/บริการ รวมภาษีมูลค่าเพิ่มแล้ว
 *  ✔ เลขที่ใบกำกับภาษี (serialised receipt number)
 */

import type { ReceiptData } from './types';
import {
  PROPERTY_CONFIG,
  RECEIPT_CONFIG,
  PAYMENT_METHOD_LABEL,
  RECEIPT_TYPE_LABEL,
} from '@/lib/receipt-config';
import { fmtDate, fmtTime, fmtBaht } from '@/lib/date-format';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHARS = 32;
const DIVIDER_SOLID  = '═'.repeat(CHARS);
const DIVIDER_DASHED = '─'.repeat(CHARS);
const DIVIDER_DOT    = '·'.repeat(CHARS);

const BOOKING_TYPE_LABEL: Record<string, string> = {
  daily:         'รายวัน',
  monthly_short: 'รายเดือน (สั้น)',
  monthly_long:  'รายเดือน (ยาว)',
};

const INVOICE_TYPE_LABEL: Record<string, string> = {
  deposit_receipt:   'INV-BK  (ชำระล่วงหน้า)',
  daily_stay:        'INV-CI  (เช็คอิน)',
  checkout_balance:  'INV-CO  (เช็คเอาท์)',
  monthly_rent:      'INV-MN  (รายเดือน)',
  utility:           'INV-UT  (ค่าสาธารณูปโภค)',
  extra_service:     'INV-EX  (บริการเสริม)',
  general:           'INV-GN  (ทั่วไป)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pad label + value to exactly `totalChars` characters */
function padLine(label: string, value: string, totalChars = CHARS): string {
  const pad = Math.max(1, totalChars - label.length - value.length);
  return label + ' '.repeat(pad) + value;
}

/** Format Thai Baht */
function fmt(n: number): string {
  return fmtBaht(n);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT = "'Sarabun', 'TH Sarabun New', 'Courier New', monospace";

const s = {
  wrap:   { width: 240, backgroundColor: '#fff', fontFamily: FONT, fontSize: 11, lineHeight: 1.5, color: '#111', padding: '8px 4px', boxSizing: 'border-box' as const },
  center: { textAlign: 'center' as const },
  right:  { textAlign: 'right' as const },
  bold:   { fontWeight: 700 as const },
  sm:     { fontSize: 9 },
  lg:     { fontSize: 13, fontWeight: 700 as const },
  div:    { fontFamily: FONT, letterSpacing: 0, fontSize: 10 },
  pre:    { fontFamily: FONT, whiteSpace: 'pre' as const, fontSize: 10, margin: 0 },
  mb1:    { marginBottom: 1 },
  mb2:    { marginBottom: 2 },
  mb4:    { marginBottom: 4 },
  mt4:    { marginTop: 4 },
  gray:   { color: '#555' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface ThermalReceiptProps {
  receipt: ReceiptData;
  /** Pass a ref to the container so the parent can clone innerHTML for print */
  printRef?: React.RefObject<HTMLDivElement>;
  /** True when reprinting — adds "สำเนา" watermark */
  isReprint?: boolean;
}

export default function ThermalReceipt({ receipt, printRef, isReprint = false }: ThermalReceiptProps) {
  const issueDate    = new Date(receipt.issueDate);
  const typeSubtitle = RECEIPT_TYPE_LABEL[receipt.receiptType] ?? 'ใบเสร็จรับเงิน';
  const payLabel     = PAYMENT_METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod;
  const btLabel      = BOOKING_TYPE_LABEL[receipt.bookingType] ?? receipt.bookingType;
  const invTypeLabel = INVOICE_TYPE_LABEL[receipt.invoiceNumber?.split('-')[1]?.toLowerCase() === 'bk'
    ? 'deposit_receipt'
    : receipt.invoiceNumber?.startsWith('INV-CO')
      ? 'checkout_balance'
      : receipt.invoiceNumber?.startsWith('INV-CI')
        ? 'daily_stay'
        : receipt.invoiceNumber?.startsWith('INV-MN')
          ? 'monthly_rent'
          : 'general'] ?? '';

  const hasVat       = receipt.vatAmount > 0;
  const hasTaxId     = Boolean(PROPERTY_CONFIG.taxId);
  const showTaxInv   = hasTaxId; // show tax invoice title when property has a tax ID

  return (
    <div ref={printRef} style={s.wrap} id="thermal-receipt-content">

      {/* ── Reprint watermark ──────────────────────────────────────────────── */}
      {isReprint && (
        <div style={{ ...s.center, ...s.sm, color: '#dc2626', fontWeight: 700, marginBottom: 2, letterSpacing: 2 }}>
          *** สำเนา / COPY ***
        </div>
      )}

      {/* ── Header: Property ───────────────────────────────────────────────── */}
      <div style={{ ...s.center, ...s.mb1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>{PROPERTY_CONFIG.name}</div>
        <div style={{ ...s.sm, ...s.gray }}>{PROPERTY_CONFIG.nameTH}</div>
      </div>
      <div style={{ ...s.center, ...s.sm, ...s.gray, ...s.mb1 }}>
        <div>{PROPERTY_CONFIG.address}</div>
        <div>{PROPERTY_CONFIG.city}</div>
        <div>โทร: {PROPERTY_CONFIG.phone}</div>
        {hasTaxId && (
          <div style={{ fontWeight: 700, color: '#111', marginTop: 1 }}>
            เลขผู้เสียภาษี: {PROPERTY_CONFIG.taxId}
          </div>
        )}
      </div>

      {/* ── Divider ────────────────────────────────────────────────────────── */}
      <div style={{ ...s.center, ...s.div, ...s.mb2 }}>{DIVIDER_SOLID}</div>

      {/* ── Document Title ─────────────────────────────────────────────────── */}
      <div style={{ ...s.center, ...s.mb1 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>ใบเสร็จรับเงิน</div>
        {showTaxInv && (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', marginTop: 1 }}>
            ใบกำกับภาษีอย่างย่อ
          </div>
        )}
        <div style={{ ...s.sm, color: '#444', marginTop: 2 }}>{typeSubtitle}</div>
      </div>

      <div style={{ ...s.center, ...s.div, ...s.mb2 }}>{DIVIDER_DASHED}</div>

      {/* ── Document Numbers ───────────────────────────────────────────────── */}
      <div style={{ ...s.pre, ...s.mb2 }}>
        {padLine('เลขที่ใบเสร็จ:', receipt.receiptNumber)}{'\n'}
        {receipt.paymentNumber ? padLine('เลขที่การชำระ:', receipt.paymentNumber) + '\n' : ''}
        {receipt.invoiceNumber ? padLine('เลขที่ใบแจ้งหนี้:', receipt.invoiceNumber) + '\n' : ''}
        {padLine('วันที่ออก:', fmtDate(issueDate))}{'\n'}
        {padLine('เวลา:', fmtTime(issueDate))}
      </div>

      <div style={{ ...s.center, ...s.div, ...s.mb2 }}>{DIVIDER_DASHED}</div>

      {/* ── Booking Context ────────────────────────────────────────────────── */}
      <div style={{ ...s.pre, ...s.mb1 }}>
        {padLine('เลขที่การจอง:', receipt.bookingNumber)}{'\n'}
        {padLine('ห้องพัก:', `${receipt.roomNumber} (${btLabel})`)}{'\n'}
        {padLine('วันเข้าพัก:', receipt.checkIn)}{'\n'}
        {padLine('วันเช็คเอาท์:', receipt.checkOut)}
      </div>
      <div style={{ fontSize: 10, ...s.mb4 }}>
        ผู้เข้าพัก: <span style={s.bold}>{receipt.guestName}</span>
      </div>

      <div style={{ ...s.center, ...s.div, ...s.mb2 }}>{DIVIDER_DASHED}</div>

      {/* ── Line Items ─────────────────────────────────────────────────────── */}
      <div style={{ fontSize: 9, fontWeight: 700, ...s.mb2, color: '#374151' }}>รายการ / Description</div>
      {receipt.items.map((item, idx) => (
        <div key={idx} style={{ ...s.mb2 }}>
          <div style={{ fontSize: 10, lineHeight: 1.4 }}>{item.description}</div>
          {item.quantity !== undefined && item.unitPrice !== undefined && (
            <div style={{ fontSize: 9, ...s.gray, paddingLeft: 8 }}>
              {item.quantity} × ฿{fmt(item.unitPrice)}
            </div>
          )}
          <div style={{ ...s.right, fontSize: 10, fontWeight: item.amount < 0 ? 400 : 600 }}>
            {item.amount < 0 ? `-฿${fmt(Math.abs(item.amount))}` : `฿${fmt(item.amount)}`}
          </div>
        </div>
      ))}

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div style={{ ...s.center, ...s.div, ...s.mb1 }}>{DIVIDER_DASHED}</div>
      <div style={{ ...s.pre, ...s.mb1, fontSize: 10 }}>
        {padLine('ยอดรวมก่อนภาษี:', `฿${fmt(hasVat ? receipt.subtotal : receipt.grandTotal)}`)}
        {hasVat
          ? '\n' + padLine('ภาษีมูลค่าเพิ่ม 7%:', `฿${fmt(receipt.vatAmount)}`)
          : '\n' + padLine('ภาษีมูลค่าเพิ่ม:', 'ยกเว้น / Exempt')}
      </div>

      {/* Grand Total */}
      <div style={{ ...s.center, ...s.div, ...s.mb1 }}>{DIVIDER_SOLID}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', ...s.mb1, padding: '1px 0' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>ยอดรวมทั้งสิ้น (รวม VAT)</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>฿{fmt(receipt.grandTotal)}</span>
      </div>
      <div style={{ ...s.center, ...s.div, ...s.mb4 }}>{DIVIDER_SOLID}</div>

      {/* ── Payment Details ────────────────────────────────────────────────── */}
      <div style={{ ...s.pre, ...s.mb2, fontSize: 10 }}>
        {padLine('ชำระด้วย:', payLabel)}{'\n'}
        {padLine('ยอดชำระ:', `฿${fmt(receipt.paidAmount)}`)}
        {receipt.change !== undefined && receipt.change > 0
          ? '\n' + padLine('ทอนเงิน:', `฿${fmt(receipt.change)}`)
          : ''}
      </div>

      {/* Cashier */}
      {receipt.cashierName && (
        <div style={{ ...s.sm, ...s.gray, ...s.mb2 }}>
          แคชเชียร์: {receipt.cashierName}
        </div>
      )}

      {/* Notes */}
      {receipt.notes && (
        <div style={{ ...s.sm, ...s.gray, fontStyle: 'italic', ...s.mb4 }}>
          หมายเหตุ: {receipt.notes}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{ ...s.center, ...s.div, ...s.mb2 }}>{DIVIDER_DOT}</div>
      <div style={{ ...s.center, ...s.mb1 }}>
        <div style={{ fontSize: 11, fontWeight: 700 }}>{RECEIPT_CONFIG.thankYouTH}</div>
        <div style={{ ...s.sm, ...s.gray }}>{RECEIPT_CONFIG.thankYouEN}</div>
      </div>
      <div style={{ ...s.center, ...s.sm, color: '#777', ...s.mb2 }}>{RECEIPT_CONFIG.footerNote}</div>
      {PROPERTY_CONFIG.website && (
        <div style={{ ...s.center, ...s.sm, color: '#777', ...s.mb1 }}>{PROPERTY_CONFIG.website}</div>
      )}
      {PROPERTY_CONFIG.lineId && (
        <div style={{ ...s.center, ...s.sm, color: '#777' }}>LINE: {PROPERTY_CONFIG.lineId}</div>
      )}
      <div style={{ ...s.center, ...s.div, marginTop: 4 }}>{DIVIDER_SOLID}</div>

    </div>
  );
}
