/**
 * receipt-config.ts
 *
 * Property configuration for thermal receipt printing.
 * Update these values to match the actual property details.
 */

export const PROPERTY_CONFIG = {
  name:       'The Residence Service Apartment',
  nameTH:     'เดอะ เรสซิเดนซ์ เซอร์วิส อพาร์ทเม้นท์',
  address:    '123 ถ.สุขุมวิท แขวงคลองเตย',
  city:       'กรุงเทพมหานคร 10110',
  phone:      '02-XXX-XXXX',
  taxId:      '0105XXXXXXXXX',
  website:    'www.theresidence.co.th',
  lineId:     '@theresidence',
} as const;

export const RECEIPT_CONFIG = {
  /** Paper width for 58mm thermal printer (mm) */
  paperWidthMM: 58,
  /** Characters per line at default font size */
  charsPerLine: 32,
  /** Footer message shown on every receipt */
  thankYouTH:   'ขอบคุณที่ใช้บริการ',
  thankYouEN:   'Thank you for your stay',
  footerNote:   'กรุณาเก็บใบเสร็จไว้เป็นหลักฐาน',
} as const;

/** Human-readable payment method labels */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash:         'เงินสด (Cash)',
  transfer:     'โอนเงิน (Transfer)',
  credit_card:  'บัตรเครดิต (Credit Card)',
  promptpay:    'พร้อมเพย์ (PromptPay)',
  ota_collect:  'OTA เรียกเก็บ',
};

/** Receipt type → title labels */
export const RECEIPT_TYPE_LABEL: Record<string, string> = {
  booking_full:     'ใบเสร็จรับเงิน — ชำระล่วงหน้า',
  booking_deposit:  'ใบเสร็จรับเงิน — เงินมัดจำ',
  checkin_security: 'ใบเสร็จรับเงิน — เงินประกัน',
  checkin_upfront:  'ใบเสร็จรับเงิน — ชำระ ณ เช็คอิน',
  checkout:         'ใบเสร็จรับเงิน — ชำระ ณ เช็คเอาท์',
};
