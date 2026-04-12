/**
 * OCR Utility — Extract text from Thai ID / Passport / Driving License images
 * Uses Tesseract.js (server-side, NOT bundled by webpack via serverComponentsExternalPackages)
 */

import { createWorker, Worker } from 'tesseract.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OcrResult {
  rawText: string;
  confidence: number;
  detected: {
    docType: 'thai_id' | 'passport' | 'driving_license' | 'unknown';
    firstName?: string;
    lastName?: string;
    firstNameTH?: string;
    lastNameTH?: string;
    idNumber?: string;
    nationality?: string;
    dateOfBirth?: string;
  };
}

// ─── Singleton worker ─────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerInstance) {
    workerInstance = await createWorker(['eng', 'tha'], 1);
  }
  return workerInstance;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize common OCR substitutions in MRZ zone */
function normalizeMrz(s: string): string {
  return s
    .replace(/«/g, '<')
    .replace(/\[/g, '<')
    .replace(/\(/g, '<')
    .replace(/0/g, 'O')   // digits → letters in name section (pre-<< split only)
    .replace(/\s/g, '');
}

/** Clean a name part extracted from MRZ (replace < with space, trim) */
function mrzNameClean(s: string): string {
  return s.replace(/</g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Check if a string looks like an English name (Latin letters, mostly uppercase) */
function isEnglishName(s: string): boolean {
  return /^[A-Z][A-Z\s'-]{1,40}$/.test(s.trim());
}

/** Check if a string is mostly Thai characters */
function isThai(s: string): boolean {
  const thaiCount = (s.match(/[\u0E00-\u0E7F]/g) || []).length;
  return thaiCount > s.length * 0.4;
}

/** Extract the first date found in text (returns as DD/MM/YYYY or raw string) */
function extractDate(text: string): string | undefined {
  // Thai month abbreviations
  const thaiMonths: Record<string, string> = {
    'ม.ค': '01', 'ม.ค.': '01', 'มค': '01',
    'ก.พ': '02', 'ก.พ.': '02', 'กพ': '02',
    'มี.ค': '03', 'มี.ค.': '03', 'มีค': '03',
    'เม.ย': '04', 'เม.ย.': '04', 'เมย': '04',
    'พ.ค': '05', 'พ.ค.': '05', 'พค': '05',
    'มิ.ย': '06', 'มิ.ย.': '06', 'มิย': '06',
    'ก.ค': '07', 'ก.ค.': '07', 'กค': '07',
    'ส.ค': '08', 'ส.ค.': '08', 'สค': '08',
    'ก.ย': '09', 'ก.ย.': '09', 'กย': '09',
    'ต.ค': '10', 'ต.ค.': '10', 'ตค': '10',
    'พ.ย': '11', 'พ.ย.': '11', 'พย': '11',
    'ธ.ค': '12', 'ธ.ค.': '12', 'ธค': '12',
  };
  // English months
  const engMonths: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // DD Mon YYYY (English)
  const engMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i);
  if (engMatch) {
    const m = engMonths[engMatch[2].toLowerCase().substring(0, 3)];
    const y = parseInt(engMatch[3]) > 2500 ? String(parseInt(engMatch[3]) - 543) : engMatch[3];
    return `${engMatch[1].padStart(2,'0')}/${m}/${y}`;
  }

  // DD Thai-month YYYY  (e.g. "12 ม.ค. 2533" or "12 ม.ค. 2533")
  for (const [abbr, mm] of Object.entries(thaiMonths)) {
    const re = new RegExp(`(\\d{1,2})\\s*${abbr.replace(/\./g, '\\.')}\\s*(\\d{4})`);
    const m = text.match(re);
    if (m) {
      const y = parseInt(m[2]) > 2500 ? String(parseInt(m[2]) - 543) : m[2];
      return `${m[1].padStart(2,'0')}/${mm}/${y}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const numMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (numMatch) {
    const y = parseInt(numMatch[3]) > 2500 ? String(parseInt(numMatch[3]) - 543) : numMatch[3];
    return `${numMatch[1].padStart(2,'0')}/${numMatch[2].padStart(2,'0')}/${y}`;
  }

  return undefined;
}

// ─── Detect document type ─────────────────────────────────────────────────────

function detectDocType(text: string): OcrResult['detected']['docType'] {
  const t = text.toLowerCase();

  if (
    t.includes('บัตรประจำตัวประชาชน') ||
    t.includes('บัตรประจําตัวประชาชน') ||
    t.includes('thai national id') ||
    t.includes('identification number') ||
    t.includes('เลขประจำตัวประชาชน') ||
    // 13-digit number in various spacings
    /\b\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d\b/.test(text)
  ) {
    return 'thai_id';
  }

  if (
    t.includes('passport') ||
    t.includes('หนังสือเดินทาง') ||
    /P[<«\[]\s*[A-Z]{3}/.test(text)   // MRZ start
  ) {
    return 'passport';
  }

  if (
    t.includes('driving') ||
    t.includes('ใบอนุญาตขับ') ||
    t.includes('ใบขับขี่')
  ) {
    return 'driving_license';
  }

  return 'unknown';
}

// ─── Thai ID Extraction ───────────────────────────────────────────────────────

function extractThaiId(text: string): Partial<OcrResult['detected']> {
  const result: Partial<OcrResult['detected']> = { docType: 'thai_id', nationality: 'Thai' };

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // ── 1. ID Number (13 digits) ──────────────────────────────────────────────
  // Try with separators: 1-4-5-2-1
  const withSep = text.match(/\b(\d)[\s.\-–](\d{4})[\s.\-–](\d{5})[\s.\-–](\d{2})[\s.\-–](\d)\b/);
  if (withSep) {
    result.idNumber = withSep[1] + withSep[2] + withSep[3] + withSep[4] + withSep[5];
  } else {
    // 13 consecutive digits
    const raw = text.replace(/\s/g, '');
    const plain = raw.match(/(?<!\d)(\d{13})(?!\d)/);
    if (plain) result.idNumber = plain[1];
  }

  // ── 2. Thai name (นาย/นาง/นางสาว + ชื่อ นามสกุล) ─────────────────────────
  const thaiPrefixRe = /(นาย|นาง(?:สาว)?|เด็กชาย|เด็กหญิง)/;
  for (const line of lines) {
    if (!isThai(line)) continue;
    const pm = line.match(thaiPrefixRe);
    if (pm) {
      // Name comes after the prefix
      const after = line.substring(line.indexOf(pm[0]) + pm[0].length).trim();
      // Split by whitespace — Thai names usually: "ชื่อ นามสกุล"
      const parts = after.split(/\s+/).filter(p => p.length > 0 && isThai(p));
      if (parts.length >= 2) {
        result.firstNameTH = parts[0];
        result.lastNameTH  = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        result.firstNameTH = parts[0];
        // Last name might be on next line
        const idx = lines.indexOf(line);
        if (idx + 1 < lines.length && isThai(lines[idx + 1])) {
          const nextParts = lines[idx + 1].split(/\s+/).filter(p => isThai(p));
          if (nextParts.length >= 1 && !thaiPrefixRe.test(nextParts[0])) {
            result.lastNameTH = nextParts[0];
          }
        }
      }
      break;
    }
  }

  // ── 3. English name ───────────────────────────────────────────────────────
  // Strategy A: look for "Mr./Mrs./Miss FIRSTNAME LASTNAME" anywhere
  for (const line of lines) {
    const engPrefix = line.match(/\b(Mr\.?|Mrs\.?|Miss|Ms\.?)\s+([A-Z][a-zA-Z'-]+)\s+([A-Z][a-zA-Z'-]+)/i);
    if (engPrefix) {
      result.firstName = toTitleCase(engPrefix[2]);
      result.lastName  = toTitleCase(engPrefix[3]);
      break;
    }
  }

  // Strategy B: look for "Name <value>" or "Given name <value>" labels
  if (!result.firstName) {
    for (const line of lines) {
      const nm = line.match(/(?:^|[\s/])(?:Name|Given\s*name|ชื่อ)[:\s]+([A-Za-z][A-Za-z\s'-]{1,40})/i);
      if (nm && !nm[1].match(/birth|date|sex|expiry|nation/i)) {
        result.firstName = toTitleCase(nm[1].trim());
      }
      const lm = line.match(/(?:^|[\s/])(?:Surname|Last\s*name|นามสกุล)[:\s]+([A-Za-z][A-Za-z\s'-]{1,40})/i);
      if (lm && !lm[1].match(/birth|date|sex|expiry|nation/i)) {
        result.lastName = toTitleCase(lm[1].trim());
      }
    }
  }

  // Strategy C: look for ALL-CAPS Latin line (English name on Thai ID card)
  if (!result.firstName) {
    for (const line of lines) {
      // Skip lines with numbers or thai chars or common keywords
      if (/\d/.test(line)) continue;
      if (isThai(line)) continue;
      if (/address|nation|birth|date|sex|expire|province|district/i.test(line)) continue;
      // Must be mostly uppercase Latin letters
      const latinOnly = line.replace(/[^A-Za-z\s'-]/g, '').trim();
      if (latinOnly.length < 3) continue;
      const parts = latinOnly.split(/\s+/).filter(p => p.length >= 2);
      if (parts.length >= 2 && isEnglishName(parts.join(' '))) {
        result.firstName = toTitleCase(parts[0]);
        result.lastName  = toTitleCase(parts.slice(1).join(' '));
        break;
      }
    }
  }

  // ── 4. Date of birth ──────────────────────────────────────────────────────
  for (const line of lines) {
    if (/เกิด|birth/i.test(line)) {
      const dob = extractDate(line);
      if (dob) { result.dateOfBirth = dob; break; }
    }
  }

  return result;
}

// ─── Passport Extraction ──────────────────────────────────────────────────────

function extractPassport(text: string): Partial<OcrResult['detected']> {
  const result: Partial<OcrResult['detected']> = { docType: 'passport' };

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // ── 1. Parse MRZ (most reliable) ─────────────────────────────────────────
  //   Line 1: P<COUNTRY<<LASTNAME<<FIRSTNAME<<<...
  //   Line 2: DOCNUM9COUNTRY6DDDDDDS6DDDDDDS<PERSONALNUM9
  for (const line of lines) {
    // Normalize common OCR errors in MRZ zone
    const norm = line
      .replace(/[«\[\(]/g, '<')
      .replace(/\s+/g, '');           // remove spaces Tesseract adds

    // Line 1 match: starts with P< (or P«, P[) + 3-char country + name
    if (/^P[<]/.test(norm) && norm.length >= 20) {
      const country = norm.substring(2, 5);
      if (country.match(/^[A-Z]{3}$/)) {
        const nameZone = norm.substring(5);
        const parts = nameZone.split('<<');
        if (parts.length >= 2) {
          const rawLast  = parts[0].replace(/</g, ' ').trim();
          const rawFirst = parts[1].replace(/</g, ' ').trim();
          if (rawLast)  result.lastName  = toTitleCase(rawLast);
          if (rawFirst) result.firstName = toTitleCase(rawFirst.split(' ')[0]); // first word only
          result.nationality = result.nationality || countryCodeToName(country);
        }
      }
    }

    // Line 2 match: starts with alphanumeric, length ~44 with numeric run
    if (!result.idNumber && /^[A-Z0-9]{9}/.test(norm) && norm.length >= 28) {
      const docNum = norm.substring(0, 9).replace(/O/g, '0').replace(/[<]/g, '');
      if (/^[A-Z0-9]{6,9}$/.test(docNum)) {
        result.idNumber = docNum;
        // DOB at position 13-18 (YYMMDD)
        const dobStr = norm.substring(13, 19);
        if (/^\d{6}$/.test(dobStr)) {
          const yy = parseInt(dobStr.substring(0, 2));
          const mm = dobStr.substring(2, 4);
          const dd = dobStr.substring(4, 6);
          const yyyy = yy > 30 ? `19${dobStr.substring(0,2)}` : `20${dobStr.substring(0,2)}`;
          result.dateOfBirth = `${dd}/${mm}/${yyyy}`;
        }
        // Nationality from position 10-12
        const nat = norm.substring(10, 13).replace(/</g, '').trim();
        if (/^[A-Z]{3}$/.test(nat) && !result.nationality) {
          result.nationality = countryCodeToName(nat);
        }
      }
    }
  }

  // ── 2. Visual zone parsing (if MRZ not found/incomplete) ─────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Surname / นามสกุล pattern — value on same line or next
    if (!result.lastName) {
      const m = line.match(/(?:Surname|นามสกุล)\s*[:/]\s*(.+)/i);
      if (m) {
        const val = m[1].replace(/\/.*/,'').trim(); // stop at next / separator
        if (val && !val.match(/given|name|nation|birth|sex|date/i)) {
          result.lastName = toTitleCase(val);
        } else if (i + 1 < lines.length) {
          const next = lines[i+1].trim();
          if (next && isEnglishName(next)) result.lastName = toTitleCase(next);
        }
      }
      // Standalone Surname: label on one line, value on next
      if (/^(?:Surname|นามสกุล)\s*$/i.test(line) && i + 1 < lines.length) {
        const next = lines[i+1].trim();
        if (isEnglishName(next)) result.lastName = toTitleCase(next);
      }
    }

    // Given names / ชื่อ pattern
    if (!result.firstName) {
      const m = line.match(/(?:Given\s*[Nn]ames?|ชื่อ)\s*[:/]\s*(.+)/i);
      if (m) {
        const val = m[1].replace(/\/.*/,'').trim();
        if (val && !val.match(/surname|nation|birth|sex|date|last/i)) {
          result.firstName = toTitleCase(val.split(/\s+/)[0]);
        } else if (i + 1 < lines.length) {
          const next = lines[i+1].trim();
          if (next && isEnglishName(next)) result.firstName = toTitleCase(next.split(/\s+/)[0]);
        }
      }
      if (/^(?:Given\s*[Nn]ames?|ชื่อ)\s*$/i.test(line) && i + 1 < lines.length) {
        const next = lines[i+1].trim();
        if (isEnglishName(next)) result.firstName = toTitleCase(next.split(/\s+/)[0]);
      }
    }

    // Nationality — ONLY pick up the value, not the whole label row
    // Thai passport: "THAI" or specific country names as standalone text
    if (!result.nationality) {
      const natValueRe = /^(THAI|THAI\b|THA|AMERICAN|BRITISH|CHINESE|JAPANESE|KOREAN|SINGAPOREAN|GERMAN|FRENCH|AUSTRALIAN|CANADIAN|INDIAN|RUSSIAN|ITALIAN|SPANISH|DUTCH|SWEDISH|NORWEGIAN|DANISH|SWISS|BELGIAN|POLISH|CZECH|PORTUGUESE|TURKISH|GREEK|HUNGARIAN|ROMANIAN|UKRAINIAN|VIETNAMESE|CAMBODIAN|LAOTIAN?|MYANMAR|BURMESE|INDONESIAN|MALAYSIAN|FILIPINO|PHILIPPINE|BANGLA|PAKISTAN|SRI LANKA|NEPALESE|NEPALI|BHUTANESE|MALDIVIAN|MONGOLIAN|KAZAKHSTANI?|UZBEKISTANI?|AZERBAIJANI?|ARMENIAN|GEORGIAN|BELARUSIAN|MOLDOVAN|LATVIAN|LITHUANIAN|ESTONIAN|FINNISH|IRISH|SCOTTISH|WELSH|ENGLISH|NEW ZEALAND|SOUTH AFRICAN|EGYPTIAN|MOROCCAN|NIGERIAN|KENYAN|GHANAIAN|ETHIOPIAN|TANZANIAN|UGANDAN|ZIMBABWEAN|ZAMBIAN|MOZAMBICAN|ANGOLAN|CONGOLESE|CAMEROON|IVORY COAST|SENEGALESE|TUNISIAN|ALGERIAN|LIBYAN|SUDANESE|SAUDI|EMIRATI|QATARI|KUWAITI|BAHRAINI|OMANI|YEMENI|JORDANIAN|LEBANESE|SYRIAN|IRAQI|IRANIAN|ISRAELI|MEXICAN|BRAZILIAN|ARGENTINIAN|COLOMBIAN|PERUVIAN|VENEZUELAN|CHILEAN|ECUADORIAN|BOLIVIAN|PARAGUAYAN|URUGUAYAN|SALVADORAN|HONDURAN|GUATEMALAN|NICARAGUAN|COSTA RICAN|PANAMANIAN|CUBAN|DOMINICAN|HAITIAN|JAMAICAN|TRINIDADIAN)\b/i;
      const standalone = natValueRe.exec(line);
      if (standalone) {
        result.nationality = toTitleCase(standalone[1].toLowerCase());
      }
    }

    // Passport number from "No." label
    if (!result.idNumber) {
      const nm = line.match(/(?:No\.|เลขที่|Passport\s*No)[:\s]*([A-Z]{1,2}\d{6,8})/i);
      if (nm) result.idNumber = nm[1];
    }
  }

  // ── 3. Fallback: passport number from body text ────────────────────────────
  if (!result.idNumber) {
    const pm = text.match(/\b([A-Z]{1,2}\d{6,8})\b/);
    if (pm) result.idNumber = pm[1];
  }

  // ── 4. DOB from visual zone ───────────────────────────────────────────────
  if (!result.dateOfBirth) {
    for (const line of lines) {
      if (/birth|เกิด/i.test(line)) {
        const dob = extractDate(line);
        if (dob) { result.dateOfBirth = dob; break; }
      }
    }
  }

  return result;
}

// ─── Driving License Extraction ───────────────────────────────────────────────

function extractDrivingLicense(text: string): Partial<OcrResult['detected']> {
  const result: Partial<OcrResult['detected']> = { docType: 'driving_license', nationality: 'Thai' };

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const thaiPrefixRe = /(นาย|นาง(?:สาว)?|เด็กชาย|เด็กหญิง)/;

  for (const line of lines) {
    if (isThai(line)) {
      const pm = line.match(thaiPrefixRe);
      if (pm) {
        const after = line.substring(line.indexOf(pm[0]) + pm[0].length).trim();
        const parts = after.split(/\s+/).filter(p => isThai(p));
        if (parts.length >= 2) {
          result.firstNameTH = parts[0];
          result.lastNameTH  = parts.slice(1).join(' ');
        } else if (parts.length === 1) {
          result.firstNameTH = parts[0];
        }
      }
    }

    // License number
    if (!result.idNumber) {
      const nm = line.match(/\b(\d{8,13})\b/);
      if (nm) result.idNumber = nm[1];
    }
  }

  // DOB
  for (const line of lines) {
    if (/เกิด|birth/i.test(line)) {
      const dob = extractDate(line);
      if (dob) { result.dateOfBirth = dob; break; }
    }
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

const COUNTRY_CODES: Record<string, string> = {
  THA: 'Thai', USA: 'American', GBR: 'British', CHN: 'Chinese',
  JPN: 'Japanese', KOR: 'Korean', SGP: 'Singaporean', DEU: 'German',
  FRA: 'French', AUS: 'Australian', CAN: 'Canadian', IND: 'Indian',
  RUS: 'Russian', ITA: 'Italian', ESP: 'Spanish', NLD: 'Dutch',
  MMR: 'Myanmar', KHM: 'Cambodian', LAO: 'Laotian', VNM: 'Vietnamese',
  IDN: 'Indonesian', MYS: 'Malaysian', PHL: 'Filipino', BGD: 'Bangladeshi',
  PAK: 'Pakistani', LKA: 'Sri Lankan', NPL: 'Nepalese',
};

function countryCodeToName(code: string): string {
  return COUNTRY_CODES[code.toUpperCase()] || code;
}

// ─── Main OCR function ────────────────────────────────────────────────────────

export async function ocrExtract(imageBuffer: Buffer): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageBuffer);

  const rawText    = data.text;
  const confidence = data.confidence;

  // Log raw text to server console for debugging
  console.log('[OCR] Raw text:\n', rawText);
  console.log('[OCR] Confidence:', confidence);

  const docType = detectDocType(rawText);
  console.log('[OCR] Detected doc type:', docType);

  let detected: OcrResult['detected'] = { docType };

  switch (docType) {
    case 'thai_id':
      detected = { ...detected, ...extractThaiId(rawText) };
      break;
    case 'passport':
      detected = { ...detected, ...extractPassport(rawText) };
      break;
    case 'driving_license':
      detected = { ...detected, ...extractDrivingLicense(rawText) };
      break;
  }

  console.log('[OCR] Extracted:', detected);

  return { rawText, confidence, detected };
}

// ─── Cleanup on exit ──────────────────────────────────────────────────────────

if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    if (workerInstance) {
      await workerInstance.terminate();
      workerInstance = null;
    }
  });
}
