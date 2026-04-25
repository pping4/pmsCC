/**
 * EMVCo Thai QR Payment parser — Sprint 5 Phase 3.6
 *
 * Parses EMVCo Merchant Presented Mode (MPM) TLV strings produced by Thai
 * banking apps' "QR payment confirmation" / PromptPay scan outputs.
 *
 * Format: each field is  ID(2) | LEN(2) | VALUE(LEN)  — all ASCII digits
 * for ID/LEN. We extract the handful of fields the payment flow cares about
 * and leave the rest untouched. Full spec compliance is NOT required — we
 * only need to read, never to generate, and we never trust client input
 * past what the server re-validates.
 *
 * Relevant top-level tags:
 *   00  Payload Format Indicator        "01"
 *   01  Point of Initiation Method      "11"=static  "12"=dynamic
 *   29  Merchant Account Info — PromptPay (A000000677010111 AID)
 *   30  Merchant Account Info — BILL PAYMENT (Thai bank transfer)
 *   52  Merchant Category Code (MCC)
 *   53  Transaction Currency            "764" = THB
 *   54  Transaction Amount              e.g. "100.00"
 *   58  Country Code                    "TH"
 *   59  Merchant Name
 *   60  Merchant City
 *   62  Additional Data Field Template (nested TLV — 05 = bill/ref)
 *   63  CRC                             4 hex digits
 *
 * Nested 29 subfields:
 *   00  Globally Unique Identifier (AID) e.g. "A000000677010111"
 *   01  Mobile / PromptPay ID (13-digit citizen ID or phone)
 *   02  Tax ID
 *   03  E-wallet ID
 */

export interface EmvcoQr {
  raw: string;
  payloadFormat?: string;
  initiationMethod?: 'static' | 'dynamic';
  currency?: string;       // ISO 4217 numeric, e.g. "764"
  amount?: number;         // parsed from tag 54
  countryCode?: string;    // "TH"
  merchantName?: string;
  merchantCity?: string;
  promptpayId?: string;    // tag 29 → sub 01
  taxId?: string;          // tag 29 → sub 02
  billReference?: string;  // tag 62 → sub 05 (or 01 depending on bank)
  /** True if CRC tag (63) is present and matches the CRC16-CCITT (false) checksum. */
  crcValid?: boolean;
}

export function parseEmvcoQr(input: string): EmvcoQr | null {
  const s = (input ?? '').trim();
  if (s.length < 8) return null;

  const top = parseTlv(s);
  if (!top) return null;

  const get = (id: string) => top.get(id);

  // Prefer tag 29 (PromptPay); fall back to tag 30 (BILL PAYMENT)
  const accountRaw = get('29') ?? get('30');
  const accountSub = accountRaw ? parseTlv(accountRaw) : null;

  const addlRaw = get('62');
  const addlSub = addlRaw ? parseTlv(addlRaw) : null;

  const init = get('01');
  const crcField = get('63');
  const amountStr = get('54');
  const amount = amountStr && /^\d+(\.\d+)?$/.test(amountStr) ? Number(amountStr) : undefined;

  // CRC check — the CRC covers everything up to and including "6304" (the
  // 4-char ID+LEN of tag 63), computed as CRC-16/CCITT-FALSE, hex upper.
  let crcValid: boolean | undefined;
  if (crcField && /^[0-9A-Fa-f]{4}$/.test(crcField)) {
    const idx = s.lastIndexOf('6304');
    if (idx >= 0) {
      const covered = s.slice(0, idx + 4);
      const computed = crc16ccittFalse(covered).toString(16).toUpperCase().padStart(4, '0');
      crcValid = computed === crcField.toUpperCase();
    }
  }

  return {
    raw: s,
    payloadFormat: get('00'),
    initiationMethod: init === '11' ? 'static' : init === '12' ? 'dynamic' : undefined,
    currency: get('53'),
    amount,
    countryCode: get('58'),
    merchantName: get('59'),
    merchantCity: get('60'),
    promptpayId: accountSub?.get('01'),
    taxId: accountSub?.get('02'),
    billReference: addlSub?.get('05') ?? addlSub?.get('01'),
    crcValid,
  };
}

/** Parse a flat TLV string into id → value map. Returns null on any length-over-run. */
function parseTlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const id = s.slice(i, i + 2);
    const lenStr = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) return null;
    const len = Number(lenStr);
    const start = i + 4;
    const end = start + len;
    if (end > s.length) return null;
    out.set(id, s.slice(start, end));
    i = end;
  }
  return out;
}

/** CRC-16/CCITT-FALSE — poly 0x1021, init 0xFFFF, no reflect, xorOut 0. */
function crc16ccittFalse(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}
