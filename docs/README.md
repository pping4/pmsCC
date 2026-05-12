# pms-next/docs

Documentation home for the PMS Next.js codebase.

## Start here

| File | When to read |
|---|---|
| **[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)** | First read — ground-truth inventory of the codebase: tech stack, folder structure, schema, routes, services, business rules, current backlog. |
| **[PHASE_HANDOFF.md](./PHASE_HANDOFF.md)** | Before touching ANY money-path file on the `feat/receipt-standardization` branch. Documents the 7 mandatory ledger invariants + every Phase 1–6.11 change. |

## Active reference

| File | Topic |
|---|---|
| [data-table-handoff.md](./data-table-handoff.md) | Shared `<DataTable>` component — how to use, props, filter/sort/groupBy contract |
| [data-table-roadmap.md](./data-table-roadmap.md) | DataTable long-term roadmap |
| [ACTIVITY_LOG_IMPLEMENTATION_PLAN.md](./ACTIVITY_LOG_IMPLEMENTATION_PLAN.md) | Activity log implementation pattern (already shipped — useful as reference) |
| [PLAN-RATE-RECALCULATION.md](./PLAN-RATE-RECALCULATION.md) | **P0 backlog** — drag-resize rate recalculation execute path |
| [PLAN-DRAG-CREATE-BOOKING.md](./PLAN-DRAG-CREATE-BOOKING.md) | Drag-create booking feature plan (partially implemented) |
| [PLAN-RESERVATION-TAPECHART.md](./PLAN-RESERVATION-TAPECHART.md) | Tape chart bug list + improvement plan |
| [CityLedger_Implementation_Plan_FINAL.md](./CityLedger_Implementation_Plan_FINAL.md) | City Ledger (corporate AR) — phases 4–8 pending |

## Archive

[`archive/`](./archive/) — sprint plans whose implementation already
shipped + old analyses. Kept for context only; do **not** implement from
these documents. Current state of the codebase is in `SYSTEM_OVERVIEW.md`.

## Reference

[`reference/`](./reference/) — original PMS 2.0 master plan + early
development plan. Pre-dates the Next.js rewrite; useful for understanding
business intent only.

## Other resources at project root (not in docs/)

| Path | Why it's not here |
|---|---|
| `pms-next/CLAUDE.md` | Claude harness auto-loads from this path |
| `../CLAUDE.md` (parent) | Same content; harness loads both |
| `pms-next/README.md` | GitHub project entry |
| `pms-next/SETUP.md` | Dev setup |
| `pms-next/src/components/ui/README.md` | Lives next to its code |
| `.claude/skills/*.md` | Claude skill convention path |
