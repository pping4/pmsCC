# DataTable Refactor — Handoff & Backlog

**Status as of 2026-04-21.** Phase 1–4b complete + rollout. This doc is a cold-start brief for the next session.

---

## 1. Architecture (what exists today)

**Shared component:** `src/components/data-table/`

| File | Purpose |
|---|---|
| `DataTable.tsx` | Main table. Per-col filter/sort, global search, row-count summary, footer aggregates, date-range filter, group-by rows. |
| `types.ts` | `ColDef<T, K>`, `DataTableProps<T, K>`. All columns use `getValue` (stable key for sort/filter), optional `getLabel` (human label), `render` (JSX), `aggregate` (`sum`/`avg`/`min`/`max`/`count`), `aggValue`, `noFilter`. |
| `ColFilterDropdown.tsx` | Google-Sheets-style per-column dropdown. |
| `SavedViewsMenu.tsx` | Owner/shared views persisted to DB via `SavedView` model + `/api/saved-views`. |
| `ExportMenu.tsx` + `lib/export-csv.ts` / `lib/export-excel.ts` | CSV/Excel export. |
| `ColVisibilityMenu.tsx` | Show/hide columns, localStorage persist. |
| `DateRangeMenu.tsx` + `lib/date-presets.ts` | 8 presets (today, yesterday, thisWeek, lastWeek, thisMonth, lastMonth, last7, last30, last90, thisYear) + custom `<input type="date">` range. URL encoding: `p:thisMonth` or `c:YYYY-MM-DD..YYYY-MM-DD`. |
| `GroupByMenu.tsx` | Dropdown to pick a column from `groupByCols`. |

**Props surface** (see `types.ts` for full shape):
- `tableKey` — required for persistence / URL sync. Keys scoped as `${tableKey}.s` (sort), `.v` (visibility), `.f.<col>` (filters), `.dr` (date range), `.g` (group).
- `syncUrl` — mirrors (sort, filters, visibility, date-range, group) into the query string; URL wins over localStorage on mount.
- `persistPreferences` (default `true`) — column visibility only.
- `dateRange={{ col, getDate, label? }}` — enables the 📅 preset menu.
- `groupByCols={[...keys]}` — enables 🗂 group-by.
- `onRowClick`, `onRowContextMenu`, `rowHighlight`, `summaryLabel`, `summaryRight`, `emptyText`, `defaultSort`, `exportFilename`, `exportSheetName`.

**Saved-view re-hydration:** `SAVED_VIEW_APPLIED_EVENT` custom event dispatched on apply; DataTable listens and re-seeds state from payload.

---

## 2. Rollout status — every `<DataTable` in the codebase

| File | tableKey | `syncUrl` | `dateRange` | `groupByCols` |
|---|---|:-:|:-:|:-:|
| `(dashboard)/reservation/components/BookingTableView.tsx` | `reservation.bookings` | ✅ | checkIn | bookingStatus, paymentStatus, type, source |
| `(dashboard)/cashier/page.tsx` | `cashier.history` | ✅ | openedAt | status, openedBy |
| `(dashboard)/bad-debt/page.tsx` | `bad-debt.${filter}` | ✅ | checkout | status, reason |
| `(dashboard)/housekeeping/components/TasksTab.tsx` | `housekeeping.tasks.${filter}` | ✅ | scheduled | status, taskType, assigned |
| `(dashboard)/products/page.tsx` | `products.${tab}` | ✅ | — | categoryLabel, taxTypeLabel, activeLabel |
| `(dashboard)/city-ledger/page.tsx` | `city-ledger.list.${filter}` | ✅ | — (no date col) | status, terms |
| `(dashboard)/city-ledger/[id]/page.tsx` (Invoices) | `city-ledger.detail.invoices` | ❌ | issued | clStatus |
| `(dashboard)/city-ledger/[id]/page.tsx` (Payments) | `city-ledger.detail.payments` | ❌ | date | status, method |
| `(dashboard)/city-ledger/[id]/page.tsx` (Statement) | `city-ledger.detail.statement` | ❌ | — | — |
| `(dashboard)/dashboard/page.tsx` (multiple mini-tables) | various | ❌ | — | — |
| `(dashboard)/billing-cycle/page.tsx` (Generate/Penalties) | various | ❌ | — | — |
| `(dashboard)/sales/components/GoogleSheetTable.tsx` | — | — | — | (separate legacy component; see §6) |

**Skipped intentionally:**
- Dashboard mini-tables — ephemeral, data scoped to current view, URL sync would collide with drill-down state.
- Billing-cycle preview tables — one-shot results, not a persisted list.
- City-ledger detail tabs — intentionally kept simple (no `syncUrl`) so the URL only tracks the account id + tab.

---

## 3. Phase 5+ backlog (ordered by value)

### P1 — Highest leverage

1. **Bulk actions (multi-row selection)**
   - Add `selectable?: boolean` + `onSelectionChange?: (rows: T[]) => void` to `DataTableProps`.
   - Render checkbox column when enabled; shift-click range select; "select all filtered" in header.
   - Render action bar (`summaryRight` receives selected rows) for bulk delete/update/export.
   - Critical for: reservation (bulk status update), housekeeping (bulk assign), products (bulk activate/deactivate), bad-debt (bulk write-off).

2. **Inline edit**
   - `ColDef.editable?: boolean`, `ColDef.editor?: (row, onChange) => JSX`, `onCellCommit?: (row, key, value) => Promise<void>`.
   - Optimistic update + toast on failure (reuse `mutation-toast-pattern` skill).
   - Critical for: housekeeping (priority / status / assignee), products (price / active), rooms (status).

3. **Server-side pagination/sort/filter**
   - Currently every row is fetched and filtered client-side. Fine up to ~5k rows, painful beyond.
   - Add `server?: { page, pageSize, onChange, totalRows }`; when set, DataTable emits filter/sort state but does not apply — parent fetches.
   - Needed for: audit logs, transaction history, city-ledger statement (multi-year), any future analytics table.

### P2 — UX polish

4. **Pinned columns** — `ColDef.pin?: 'left' | 'right'` + sticky CSS. First 1–2 cols only (keep implementation simple). Most valuable on reservation (number/guest columns).
5. **Expandable rows** — `renderExpanded?: (row) => JSX` + toggle caret. Good for city-ledger invoices (show line items), reservation (show folio), products (show stock movement).
6. **Conditional formatting** — `ColDef.cellStyle?: (row) => CSS | undefined` or a rule builder. Already possible via `render`, but a dedicated API would enable "highlight overdue in red" via config.
7. **Column resize + reorder** — drag-to-resize + drag-handle reorder. localStorage per `tableKey`.

### P3 — Nice to have

8. **Column formulas** — derived columns computed from other cols (like Sheets). Low demand today.
9. **Freeze header on scroll** — sticky `<thead>`. Trivial but deferred; long tables rarely exceed viewport in this app.
10. **Export selected rows only** when bulk-select is active.

---

## 4. Tables worth revisiting after Phase 5 features land

- `dashboard/page.tsx` — once bulk-select exists, drill-down-table pattern can be unified.
- `billing-cycle/page.tsx` — enable `syncUrl` + `dateRange` after bulk-select (currently a "generate and discard" flow).
- `sales/components/GoogleSheetTable.tsx` — **legacy table** predating the shared component. Migrate to `<DataTable>` when touching sales next. Columns are already in the right shape.
- `city-ledger/[id]/page.tsx` — enable `syncUrl` after server-side pagination so tab + sort survive reloads.

---

## 5. Known issues / technical debt

**Pre-existing TS errors (5, not introduced by refactor):**
- `scripts/test-e2e.ts:110,265,383` — `createdBy` not in Prisma type.
- `src/app/api/billing/migrate-folios/route.ts:161` — missing `FolioChargeType` enum.
- `src/services/folio.service.ts:215` — missing `InvoiceType` discriminator.

**Silent `any` casts (26 files):**
- `src/lib/room-rate-db.ts` uses `(prisma as any).$queryRawUnsafe` — `roomRate` model missing from schema; should be added or the raw SQL moved to a service with proper typing.
- `src/app/api/debug/*` — schema introspection, acceptable.
- Other API routes — mostly `res.json() as any`; fixable with Zod response schemas.

**React warnings (~284 "Maximum update depth" in preview console):**
- Stale from earlier sessions, count stable (not growing), not blocking.
- Investigation: likely from one of the dashboard hooks (`useEffect` → `setState` loop). Add React strict-mode render counter or use React DevTools Profiler to isolate.
- **Do not** fix blind — instrument first.

**Prisma DLL lock on Windows:**
- `prisma generate` sometimes fails with EPERM because Next dev server holds the query engine open.
- Workaround: stop dev server → `npx prisma generate` → restart.
- Long-term: split dev into two terminals so Prisma changes don't require full restart.

**Incomplete dashboard modules (from route survey):**
- `maintenance/` — likely stub UI.
- `nightaudit/` — exists but minimal (critical feature, needs scoping).
- `guests/` — list only, no detail / edit.
- `tm30/`, `utilities/` — minimal.

---

## 6. Cross-cutting project standards (re-stated for the new session)

- **Dates:** `@/lib/date-format` only (`fmtDate`, `fmtDateTime`, `fmtBaht`). Never `toLocaleDateString('th-TH')`. Never `.toISOString()` for display.
- **Prisma:** always `select`, use `$transaction` for multi-step, catch P2002 for unique-violation UX.
- **Server Actions:** auth check as first line; Zod-validate input.
- **Skills:** load the relevant `.claude/skills/*.md` before editing money code (finance-invariants, tax-thailand, night-audit-checklist).
- **Tables:** every new list view must use the shared `<DataTable>` — do not create ad-hoc tables. Old `GoogleSheetTable` in `sales/` is the only legacy; migrate when touched.

---

## 7. How to pick up the next task

1. Read this doc.
2. If implementing a Phase 5 feature — open `src/components/data-table/DataTable.tsx` and `types.ts`, extend the props interface, then wire through.
3. Always verify in the preview with the claude-preview MCP (not just tsc) — the `SAVED_VIEW_APPLIED_EVENT` re-hydration path in particular is hard to catch at compile time.
4. `tsc --noEmit` clean except for the 5 pre-existing errors listed in §5.

---

**Last verified:** Phase 4b group-by e2e in preview (reservation table, bookingStatus group, 3 buckets with count pill + per-group aggregates, collapse/expand working, URL synced to `reservation.bookings.g=bookingStatus`).
