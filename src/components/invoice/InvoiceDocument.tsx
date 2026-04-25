'use client';

/**
 * InvoiceDocument.tsx
 *
 * A4 Thai invoice (ใบแจ้งหนี้) — designed for browser print.
 * Layout: 210mm × auto, 12mm margins.
 *
 * Thai legal requirements for ใบแจ้งหนี้:
 *  ✔ ชื่อ / ที่อยู่ผู้ออก + เลขผู้เสียภาษี
 *  ✔ เลขที่ใบแจ้งหนี้ วัน เดือน ปี
 *  ✔ ชื่อผู้รับบริการ / ที่อยู่
 *  ✔ รายการสินค้า/บริการ จำนวน ราคาต่อหน่วย จำนวนเงิน
 *  ✔ ยอดรวม VAT ยอดสุทธิ
 *  ✔ ช่องลงนาม
 */

import type { InvoiceDocumentData } from './types';
import { PROPERTY_CONFIG } from '@/lib/receipt-config';
import { fmtBaht } from '@/lib/date-format';

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Sarabun', 'TH Sarabun New', Arial, sans-serif";

const INVOICE_TYPE_TH: Record<string, string> = {
  proforma:         'ใบแจ้งหนี้ล่วงหน้า (Proforma)',
  deposit_receipt:  'ใบแจ้งหนี้ — รับเงินล่วงหน้า / มัดจำ',
  daily_stay:       'ใบแจ้งหนี้ — ค่าที่พักรายวัน',
  checkout_balance: 'ใบแจ้งหนี้ — ยอดชำระ ณ เช็คเอาท์',
  monthly_rent:     'ใบแจ้งหนี้ — ค่าเช่ารายเดือน',
  utility:          'ใบแจ้งหนี้ — ค่าสาธารณูปโภค',
  extra_service:    'ใบแจ้งหนี้ — บริการเสริม',
  general:          'ใบแจ้งหนี้',
};

const BOOKING_TYPE_TH: Record<string, string> = {
  daily:         'รายวัน',
  monthly_short: 'รายเดือน (สั้น)',
  monthly_long:  'รายเดือน (ยาว)',
};

const PAYMENT_METHOD_TH: Record<string, string> = {
  cash:        'เงินสด',
  transfer:    'โอนเงิน',
  credit_card: 'บัตรเครดิต',
  promptpay:   'พร้อมเพย์',
  ota_collect: 'OTA เรียกเก็บ',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  unpaid:    { label: 'ค้างชำระ',        color: '#dc2626', bg: '#fef2f2' },
  paid:      { label: 'ชำระแล้ว',        color: '#16a34a', bg: '#f0fdf4' },
  partial:   { label: 'ชำระบางส่วน',     color: '#d97706', bg: '#fffbeb' },
  voided:    { label: 'ยกเลิก',          color: '#6b7280', bg: '#f3f4f6' },
  cancelled: { label: 'ยกเลิก',          color: '#6b7280', bg: '#f3f4f6' },
  proforma:  { label: 'ล่วงหน้า',         color: '#7c3aed', bg: '#f5f3ff' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return fmtBaht(n);
}

function amountToWords(amount: number): string {
  // Simple Thai baht text — covers up to 9-digit values
  if (amount === 0) return 'ศูนย์บาทถ้วน';
  const ones  = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const tens  = ['', 'สิบ', 'ยี่สิบ', 'สามสิบ', 'สี่สิบ', 'ห้าสิบ', 'หกสิบ', 'เจ็ดสิบ', 'แปดสิบ', 'เก้าสิบ'];
  const units = ['', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  const satang = Math.round((amount % 1) * 100);
  const baht   = Math.floor(amount);

  const convertGroup = (n: number): string => {
    if (n === 0) return '';
    if (n < 10)  return ones[n];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return tens[t] + (o ? ones[o] : '');
    }
    // hundreds
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return (h === 1 ? 'หนึ่งร้อย' : ones[h] + 'ร้อย') + convertGroup(rest);
  };

  const convertFull = (n: number): string => {
    if (n === 0) return 'ศูนย์';
    let result = '';
    const groups: number[] = [];
    let remaining = n;
    while (remaining > 0) {
      groups.push(remaining % 1000);
      remaining = Math.floor(remaining / 1000);
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i] !== 0) {
        result += convertGroup(groups[i]);
        if (i > 0) result += units[i] ?? '';
      }
    }
    return result;
  };

  const bahtText   = convertFull(baht) + 'บาท';
  const satangText = satang > 0 ? convertFull(satang) + 'สตางค์' : 'ถ้วน';
  return bahtText + satangText;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  width: '210mm',
  minHeight: '297mm',
  margin: '0 auto',
  padding: '12mm 14mm',
  backgroundColor: '#fff',
  fontFamily: FONT,
  fontSize: 13,
  color: '#111',
  boxSizing: 'border-box',
  lineHeight: 1.6,
};

const thStyle: React.CSSProperties = {
  backgroundColor: '#1e3a5f',
  color: '#fff',
  padding: '6px 10px',
  fontWeight: 700,
  fontSize: 12,
  textAlign: 'left',
  borderBottom: '2px solid #1e3a5f',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 12,
  borderBottom: '1px solid #e5e7eb',
  verticalAlign: 'top',
};

// ─── Component ────────────────────────────────────────────────────────────────

export interface InvoiceDocumentProps {
  document: InvoiceDocumentData;
  printRef?: React.RefObject<HTMLDivElement>;
  isReprint?: boolean;
}

export default function InvoiceDocument({ document: doc, printRef, isReprint = false }: InvoiceDocumentProps) {
  const st = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG['unpaid'];
  const typeTH = INVOICE_TYPE_TH[doc.invoiceType] ?? 'ใบแจ้งหนี้';
  const hasPeriod = doc.billingPeriodStart && doc.billingPeriodEnd;
  const hasDiscount = doc.discountAmount > 0;
  const hasVat = doc.vatAmount > 0;
  const hasPayments = doc.payments.length > 0;
  const isCorporate = Boolean(doc.companyName);

  return (
    <div ref={printRef} style={page} id="invoice-document-content">

      {/* ── Reprint watermark ─────────────────────────────────────────────── */}
      {isReprint && (
        <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: 12, marginBottom: 6, letterSpacing: 2 }}>
          *** สำเนา / COPY ***
        </div>
      )}

      {/* ── Header: Property + Document Title ─────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, borderBottom: '3px solid #1e3a5f', paddingBottom: 14 }}>

        {/* Left: Property info */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e3a5f', marginBottom: 2 }}>
            {PROPERTY_CONFIG.name}
          </div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 1 }}>{PROPERTY_CONFIG.nameTH}</div>
          <div style={{ fontSize: 11, color: '#666', lineHeight: 1.7 }}>
            <div>{PROPERTY_CONFIG.address}</div>
            <div>{PROPERTY_CONFIG.city}</div>
            <div>โทร: {PROPERTY_CONFIG.phone}</div>
            {PROPERTY_CONFIG.website && <div>Web: {PROPERTY_CONFIG.website}</div>}
            {PROPERTY_CONFIG.taxId && (
              <div style={{ fontWeight: 700, color: '#333', marginTop: 2 }}>
                เลขผู้เสียภาษี: {PROPERTY_CONFIG.taxId}
              </div>
            )}
          </div>
        </div>

        {/* Right: Document title + number */}
        <div style={{ textAlign: 'right', minWidth: 200 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#1e3a5f', marginBottom: 4 }}>
            ใบแจ้งหนี้
          </div>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{typeTH}</div>
          <div style={{
            display: 'inline-block',
            padding: '3px 12px',
            borderRadius: 99,
            backgroundColor: st.bg,
            color: st.color,
            fontWeight: 700,
            fontSize: 11,
            marginBottom: 8,
          }}>
            {st.label}
          </div>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>เลขที่:</td>
                <td style={{ fontWeight: 700, textAlign: 'right' }}>{doc.invoiceNumber}</td>
              </tr>
              <tr>
                <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2 }}>วันที่ออก:</td>
                <td style={{ textAlign: 'right' }}>{doc.issueDate}</td>
              </tr>
              <tr>
                <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2 }}>ครบกำหนด:</td>
                <td style={{ textAlign: 'right', color: doc.status === 'unpaid' ? '#dc2626' : 'inherit', fontWeight: doc.status === 'unpaid' ? 600 : 400 }}>
                  {doc.dueDate}
                </td>
              </tr>
              {hasPeriod && (
                <tr>
                  <td style={{ color: '#666', paddingRight: 8 }}>ช่วงเวลา:</td>
                  <td style={{ textAlign: 'right' }}>{doc.billingPeriodStart} – {doc.billingPeriodEnd}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bill To / Booking Info ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Bill To */}
        <div style={{ padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a5f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            เรียกเก็บจาก / Bill To
          </div>
          {isCorporate ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{doc.companyName}</div>
              {doc.companyTaxId && (
                <div style={{ fontSize: 11, color: '#555' }}>เลขภาษี: {doc.companyTaxId}</div>
              )}
              <div style={{ fontSize: 12, marginTop: 3 }}>{doc.guestNameTH}</div>
            </>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 13 }}>{doc.guestNameTH}</div>
          )}
          {doc.guestNameEN && doc.guestNameEN !== doc.guestNameTH && (
            <div style={{ fontSize: 11, color: '#555' }}>{doc.guestNameEN}</div>
          )}
          {doc.guestAddress && (
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{doc.guestAddress}</div>
          )}
          {doc.guestPhone && (
            <div style={{ fontSize: 11, color: '#555' }}>โทร: {doc.guestPhone}</div>
          )}
          {doc.guestEmail && (
            <div style={{ fontSize: 11, color: '#555' }}>{doc.guestEmail}</div>
          )}
          {doc.guestIdNumber && (
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              {doc.guestIdType === 'thai_id' ? 'บัตรประชาชน' : 'Passport'}: {doc.guestIdNumber}
            </div>
          )}
        </div>

        {/* Booking Details */}
        <div style={{ padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a5f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            รายละเอียดการจอง
          </div>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {doc.bookingNumber && (
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2, whiteSpace: 'nowrap' }}>เลขที่จอง:</td>
                  <td style={{ fontWeight: 600 }}>{doc.bookingNumber}</td>
                </tr>
              )}
              {doc.roomNumber && (
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2 }}>ห้องพัก:</td>
                  <td style={{ fontWeight: 600 }}>{doc.roomNumber} ({BOOKING_TYPE_TH[doc.bookingType] ?? doc.bookingType})</td>
                </tr>
              )}
              {doc.checkIn && (
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2 }}>วันเข้าพัก:</td>
                  <td>{doc.checkIn}</td>
                </tr>
              )}
              {doc.checkOut && (
                <tr>
                  <td style={{ color: '#666', paddingRight: 8, paddingBottom: 2 }}>วันเช็คเอาท์:</td>
                  <td>{doc.checkOut}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Line Items Table ───────────────────────────────────────────────── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: '4%', textAlign: 'center' }}>#</th>
            <th style={{ ...thStyle, width: '52%' }}>รายการ / Description</th>
            <th style={{ ...thStyle, width: '10%', textAlign: 'right' }}>จำนวน</th>
            <th style={{ ...thStyle, width: '17%', textAlign: 'right' }}>ราคา/หน่วย (฿)</th>
            <th style={{ ...thStyle, width: '17%', textAlign: 'right' }}>จำนวนเงิน (฿)</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((item, idx) => (
            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
              <td style={{ ...tdStyle, textAlign: 'center', color: '#6b7280' }}>{idx + 1}</td>
              <td style={tdStyle}>
                <div>{item.description}</div>
                {item.periodStart && item.periodEnd && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, fontStyle: 'italic' }}>
                    📅 {item.periodStart} – {item.periodEnd}
                  </div>
                )}
                {item.periodStart && !item.periodEnd && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, fontStyle: 'italic' }}>
                    📅 {item.periodStart}
                  </div>
                )}
                {item.taxType === 'no_tax' && (
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>ไม่มี VAT</div>
                )}
                {item.taxType === 'included' && hasVat && (
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>รวม VAT แล้ว</div>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(item.unitPrice)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: item.amount < 0 ? 400 : 500 }}>
                {item.amount < 0 ? `(${fmt(Math.abs(item.amount))})` : fmt(item.amount)}
              </td>
            </tr>
          ))}
          {/* Empty rows for aesthetics (min 5 rows) */}
          {doc.items.length < 5 && Array.from({ length: 5 - doc.items.length }).map((_, i) => (
            <tr key={`empty-${i}`} style={{ backgroundColor: (doc.items.length + i) % 2 === 0 ? '#fff' : '#f9fafb' }}>
              <td style={{ ...tdStyle, color: '#fff' }}>-</td>
              <td style={tdStyle}>&nbsp;</td>
              <td style={tdStyle}></td>
              <td style={tdStyle}></td>
              <td style={tdStyle}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totals Section ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, borderTop: '2px solid #1e3a5f' }}>
        <table style={{ width: 280, fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '5px 10px', color: '#555' }}>ยอดรวมก่อนหักส่วนลด</td>
              <td style={{ padding: '5px 10px', textAlign: 'right' }}>฿{fmt(doc.subtotal)}</td>
            </tr>
            {hasDiscount && (
              <tr>
                <td style={{ padding: '5px 10px', color: '#d97706' }}>ส่วนลด</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: '#d97706' }}>(฿{fmt(doc.discountAmount)})</td>
              </tr>
            )}
            {hasVat ? (
              <tr>
                <td style={{ padding: '5px 10px', color: '#555' }}>ภาษีมูลค่าเพิ่ม 7%</td>
                <td style={{ padding: '5px 10px', textAlign: 'right' }}>฿{fmt(doc.vatAmount)}</td>
              </tr>
            ) : (
              <tr>
                <td style={{ padding: '5px 10px', color: '#9ca3af', fontSize: 11 }}>ภาษีมูลค่าเพิ่ม</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: '#9ca3af', fontSize: 11 }}>ยกเว้น</td>
              </tr>
            )}
            <tr style={{ backgroundColor: '#1e3a5f' }}>
              <td style={{ padding: '8px 10px', color: '#fff', fontWeight: 700, fontSize: 13 }}>ยอดรวมทั้งสิ้น</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#fff', fontWeight: 700, fontSize: 14 }}>฿{fmt(doc.grandTotal)}</td>
            </tr>
            {hasPayments && (
              <>
                <tr>
                  <td style={{ padding: '5px 10px', color: '#16a34a' }}>ชำระแล้ว</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: '#16a34a' }}>(฿{fmt(doc.paidAmount)})</td>
                </tr>
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 700, color: doc.balanceDue > 0 ? '#dc2626' : '#16a34a' }}>
                    {doc.balanceDue > 0 ? 'ยอดค้างชำระ' : 'ยอดรวม'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: doc.balanceDue > 0 ? '#dc2626' : '#16a34a' }}>
                    ฿{fmt(doc.balanceDue)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Amount in Words ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16, padding: '8px 12px', backgroundColor: '#f1f5f9', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
        <span style={{ color: '#555', marginRight: 8 }}>จำนวนเงินรวมเป็นตัวอักษร:</span>
        <span style={{ fontWeight: 600 }}>{amountToWords(doc.grandTotal)}</span>
      </div>

      {/* ── Payment History ────────────────────────────────────────────────── */}
      {hasPayments && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a5f', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            รายการชำระเงิน
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>เลขที่ใบเสร็จ</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>วันที่</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', color: '#374151', fontWeight: 600 }}>ช่องทาง</th>
                <th style={{ padding: '5px 8px', textAlign: 'right', color: '#374151', fontWeight: 600 }}>จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {doc.payments.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '4px 8px', color: '#374151' }}>{p.receiptNumber}</td>
                  <td style={{ padding: '4px 8px', color: '#374151' }}>{p.paymentDate}</td>
                  <td style={{ padding: '4px 8px', color: '#374151' }}>{PAYMENT_METHOD_TH[p.paymentMethod] ?? p.paymentMethod}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 500, color: '#16a34a' }}>฿{fmt(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────────── */}
      {doc.notes && (
        <div style={{ marginBottom: 16, padding: '8px 12px', backgroundColor: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a', fontSize: 12 }}>
          <span style={{ color: '#92400e', fontWeight: 600 }}>หมายเหตุ: </span>
          <span style={{ color: '#78350f' }}>{doc.notes}</span>
        </div>
      )}

      {/* ── Signature Area ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 30 }}>
        {/* Issuer */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid #374151', paddingTop: 8, marginTop: 40 }}>
            <div style={{ fontSize: 12, color: '#374151' }}>ผู้ออกใบแจ้งหนี้ / Issued by</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{PROPERTY_CONFIG.name}</div>
            {doc.createdBy && (
              <div style={{ fontSize: 11, color: '#6b7280' }}>{doc.createdBy}</div>
            )}
          </div>
        </div>
        {/* Recipient */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid #374151', paddingTop: 8, marginTop: 40 }}>
            <div style={{ fontSize: 12, color: '#374151' }}>ผู้รับ / Received by</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{doc.guestNameTH}</div>
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 10, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 10, color: '#9ca3af' }}>
        เอกสารนี้ออกโดยระบบคอมพิวเตอร์ / This document is computer-generated · {PROPERTY_CONFIG.website}
      </div>

    </div>
  );
}
