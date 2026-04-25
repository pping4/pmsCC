---
name: google-sheet-filter-sort
description: Use when building any per-column filter/sort dropdown for a data table (Google-Sheets-style). Enforces consistent UX across all tables — Sort A→Z/Z→A, search-then-Enter-to-apply, checkbox list with counts, Select All, Clear, and the correct React key / getValue conventions that prevent stale-DOM and duplicate-bucket bugs.
type: pattern
---

# Google-Sheet-Style Column Filter/Sort

## When to use

Every data table / list view that needs per-column filter+sort. Reference implementation: `src/app/(dashboard)/reservation/components/BookingTableView.tsx` (the `ColFilterDropdown` component and its `COLS` column definitions).

## Required features (every column filter must have)

1. **Sort A→Z / Z→A** — two buttons at the top, check-marked when active.
2. **Search box** with placeholder `"ค้นหา แล้วกด Enter..."` — **Enter applies**, **Escape closes**.
3. **Select All** checkbox with `(N)` count showing filtered-values length.
4. **Checkbox list** of all distinct values, each with:
   - Human-readable label (via `getLabel`, falls back to `getValue`)
   - Row-count badge `(N)` on the right, `tabular-nums`, muted grey.
5. **`ล้างตัวกรอง` / `นำไปใช้`** buttons at the bottom. The Apply button label changes to `กรอง "xxx"` when search has text.
6. **Active-filter indicator** on the column header (tint background, bold border, `🔽` icon).
7. **Outside click** closes dropdown (without applying).

## The canonical column definition

```ts
interface ColDef {
  key:       SortCol;
  label:     string;
  align?:    'right' | 'center';
  minW?:     number;
  getValue:  (row) => string;    // sort/filter key — MUST be stable & normalize equivalents
  getLabel?: (row) => string;    // display label in dropdown; falls back to getValue
  render:    (row) => ReactNode; // cell content (can be rich JSX)
}
```

### `getValue` rules (the two bugs this prevents)

- **Numeric sort**: zero-pad so `"2" < "10"` via `localeCompare(..., { numeric: true })`:
  ```ts
  getValue: r => String(Math.round(r.amount)).padStart(10, '0')
  ```
- **Collapse equivalent rows into one bucket**: if multiple distinct `getValue`s map to the **same label**, users see "✓ ครบ" repeated 4× with different counts — visually broken. Normalize the key:
  ```ts
  // ❌ Each credit amount (-100, -500, 0) gets its own bucket, all labelled "✓ ครบ"
  getValue: r => String(Math.round(r.balance)).padStart(10, '0')

  // ✅ All "paid in full" collapses to one key
  getValue: r => r.balance > 0
    ? String(Math.round(r.balance)).padStart(10, '0')
    : '__paid__'
  ```
- **Non-confirmed rows should not map to `''`**: an empty-string bucket shows as `"(ว่าง)"` in the dropdown and silently merges unrelated rows (`checked_in` + `checked_out` + `cancelled`). Instead, return a meaningful fallback label (e.g. booking-status label).

### `getLabel` rules

- Provide `getLabel` whenever `getValue` is padded/raw (dates, numbers) so the dropdown shows what the user sees in the cell:
  ```ts
  getValue: r => r.booking.checkIn,               // "2026-04-03" for chronological sort
  getLabel: r => fmtThai(r.booking.checkIn),      // "3 เม.ย." matches the cell
  ```
- Use `@/lib/date-format` (`fmtDate`, `fmtDateTime`, `fmtBaht`) — never `toLocaleString('th-TH', ...)`.

## The canonical useMemo (values + labels + counts, one pass)

```ts
const { allValues, valueToLabel, counts } = useMemo(() => {
  const labelMap = new Map<string, string>();
  const countMap = new Map<string, number>();
  for (const row of allRows) {
    const key   = col.getValue(row);
    const label = col.getLabel ? col.getLabel(row) : key;
    labelMap.set(key, label);
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(labelMap.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  return { allValues: sorted, valueToLabel: labelMap, counts: countMap };
}, [allRows, col]);
```

O(n) — negligible cost even at 10k rows. Always include counts.

## The canonical `handleApply` (search = implicit filter)

```ts
const handleApply = () => {
  // If user typed something, interpret it as "filter to these matches"
  // — do NOT require them to manually tick the checkboxes. This matches
  // Excel / Google Sheets UX.
  if (search.trim().length > 0) {
    if (filtered.length === 0) { onClose(); return; }  // no-op, don't wipe
    onFilter(col.key, new Set(filtered));
    onClose();
    return;
  }
  const isAll = allValues.every(v => selected.has(v));
  onFilter(col.key, isAll ? undefined : new Set(selected));
  onClose();
};
```

Bind `Enter` + `Escape` on the search input:

```tsx
onKeyDown={e => {
  if (e.key === 'Enter')  { e.preventDefault(); handleApply(); }
  if (e.key === 'Escape') { e.preventDefault(); onClose();     }
}}
```

## Checkbox row layout (label + count)

```tsx
<label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 4px' }}>
  <input type="checkbox" ... />
  <span style={{
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: 140,
  }} title={label}>
    {label || '(ว่าง)'}
  </span>
  <span style={{
    color: '#9ca3af', fontSize: 11,
    marginLeft: 6, flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  }}>
    {counts.get(v) ?? 0}
  </span>
</label>
```

**Do NOT** use `flex: 1` on the label — it pushes the count to the far right edge, creating a big empty gap for short numeric labels like `฿1,000` (looks broken).

## Row key rule (stale-DOM prevention)

When flattening hierarchical data into table rows, a single entity (e.g. a booking) may produce multiple rows (per room, per segment). **Using the entity id alone as the React key causes stale DOM on filter/sort changes** — React reuses old `<tr>`s instead of unmounting them, so the filter state is correct (`1/61`) but 8–16 rows stay visible.

```tsx
// ❌ Booking.id is shared across room segments → duplicate keys → stale DOM
<tr key={booking.id}>

// ✅ Composite key guaranteeing uniqueness
<tr key={`${booking.id}-${room.id}-${booking.segmentFrom ?? booking.checkIn}-${booking.segmentIndex ?? 0}`}>
```

**Checklist before shipping**: grep for `key={` in your table and verify every key is unique across the full flattened row set — especially for entities that span multiple rows.

## Column header + dropdown positioning

- Use `React.createRef<HTMLDivElement>()` per column (cached in `useRef<Partial<Record<SortCol, RefObject>>>`)
- Dropdown is `position: 'fixed'`, positioned at the anchor's `getBoundingClientRect().bottom + 2`
- Stop `mousedown` propagation on the dropdown root: `onMouseDown={e => e.stopPropagation()}`
- Close on outside click via a `document.addEventListener('mousedown', ...)` effect

## Summary bar requirements

Above the table, show: `📋 {filtered} / {total} การจอง` and a `ล้างทั้งหมด` button when `activeFilterCount > 0`.

## Anti-patterns (DO NOT)

- ❌ `key={row.id}` when rows can duplicate
- ❌ `getValue` returning `''` for "no value" rows — creates silent merge bucket
- ❌ Distinct `getValue` for rows that share a label (e.g. every negative balance → its own "✓ ครบ" bucket)
- ❌ `flex: 1` on the label span (pushes count to edge)
- ❌ Hardcoded Thai locale (`toLocaleString('th-TH', ...)`) — use `@/lib/date-format`
- ❌ Applying the filter on every keystroke (input onChange) — too jumpy, use Enter
- ❌ Wiping the filter to "nothing visible" when search has zero matches — close without changes instead

## Reference files

- `src/app/(dashboard)/reservation/components/BookingTableView.tsx` — canonical implementation (ColFilterDropdown + 14 column defs)
- `src/app/(dashboard)/reservation/lib/date-utils.ts` — `fmtThai`, `fmtCurrency`
- `src/lib/date-format.ts` — required date/money formatters

## Pre-delivery checklist

- [ ] `getValue` is stable and collapses equivalent rows into one bucket
- [ ] `getLabel` provided whenever `getValue` is padded/raw
- [ ] `counts` computed in the same useMemo, shown on every checkbox row
- [ ] Enter applies search as filter; Escape closes
- [ ] Apply button label flips to `กรอง "xxx"` when searching
- [ ] `<tr key>` is unique across all flattened rows (composite if needed)
- [ ] Active-filter header tinted; `ล้างทั้งหมด` button visible when any filter active
- [ ] Row count `{filtered}/{total}` shown in summary bar
- [ ] No `toLocaleString('th-TH', ...)` — only `@/lib/date-format`
