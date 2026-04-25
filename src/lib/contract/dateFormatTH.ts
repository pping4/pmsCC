/**
 * dateFormatTH.ts — Thai long-form date formatter for contract documents.
 *
 * ⚠️  This is a legal-document exception to the global CLAUDE.md date rule
 * (which forbids Buddhist-era / Thai-locale formatting). Thai rental
 * contracts legally require dates written in long form with พ.ศ. (Buddhist
 * Era) year. This helper is ONLY allowed inside `src/templates/contract-*`
 * and `src/lib/contract/renderContract.ts`. Use `fmtDate` from
 * `@/lib/date-format` for every other UI surface.
 */

const THAI_MONTHS_LONG = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/**
 * Returns "วันที่ 31 เดือน ตุลาคม พ.ศ. 2564" from a Date object.
 * Falls back to "วันที่ .......... เดือน .......... พ.ศ. ........" when
 * `d` is null/undefined/invalid so printed blank contracts still look right.
 */
export function fmtDateTH(d: Date | null | undefined): string {
  if (!d) return 'วันที่ .......... เดือน .......... พ.ศ. ........';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) {
    return 'วันที่ .......... เดือน .......... พ.ศ. ........';
  }
  const day = date.getDate();
  const month = THAI_MONTHS_LONG[date.getMonth()];
  const beYear = date.getFullYear() + 543;
  return `วันที่ ${day} เดือน ${month} พ.ศ. ${beYear}`;
}

/** Short variant without the "วันที่"/"เดือน"/"พ.ศ." labels — "31 ตุลาคม 2564". */
export function fmtDateTHShort(d: Date | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  const day = date.getDate();
  const month = THAI_MONTHS_LONG[date.getMonth()];
  const beYear = date.getFullYear() + 543;
  return `${day} ${month} ${beYear}`;
}
