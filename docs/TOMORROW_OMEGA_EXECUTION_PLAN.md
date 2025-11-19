# Omega Leaderboard Execution Plan (Nov 12, 2025)

This checklist captures the exact steps we’ll run tomorrow to unify the newly rebuilt datasets, verify realized P&L against Dome, and ship the Omega leaderboard to the interfaces. Follow the order; pause after each major section for validation.

---

## 1. Confirm Goldsky CLOB Backfill Completion
- Run the `backfill-monitor` skill workflow (log tail, process check, ClickHouse counts) to ensure the job covered all 171,305 markets.
- Execute `scripts/validate-clob-fills.ts` (or create it) to check price/size ranges, NULLs, timestamp coverage, and BUY/SELL ratios.
- Record final stats + any anomalies in `reports/sessions/2025-11-12-session-1.md`.

## 2. Promote CLOB Fills Into Production
- Snapshot current `clob_fills_v2` row counts and distinct condition IDs.
- If validation is clean, use CREATE → RENAME to promote the dataset (e.g., `staging.clob_fills_final` → `default.clob_fills`). No DROP commands.
- Refresh `pm_user_proxy_wallets_v2` if the new fills reveal additional proxy links; document deltas in `docs/research/polymarket_data_sources.md`.

## 3. Reconcile Realized P&L vs Dome API (read `docs/reference/DOME_API_PLAYBOOK.md`)
- Pull Dome’s P&L endpoint for the benchmark wallets listed in `docs/mg_wallet_baselines.md`.
- Run our local realized P&L + Omega pipeline (refer to `scripts/finalize-timestamps.sql` / `recover-and-finalize.sql`).
- Compare wallet-level outputs (absolute + percentage difference). Investigate any variance >1% and log findings in `tmp/ROOT_CAUSE_ANALYSIS_PNL_DISCREPANCY.md`.
- Once matched, save paired query outputs for regression.

## 4. Materialize the Omega Leaderboard Dataset
- Build a materialized table (e.g., `leaderboard_omega_daily`) with wallet_id, realized P&L, Omega ratio, trade count, last_activity, and category. Use the verified P&L logic and ensure proxy wallets map to real wallets.
- Add sample rows + schema notes to `docs/features/leaderboard/OMEGA_DATASET.md`.

## 5. Wire the Leaderboard to Interfaces
- API: expose `GET /api/leaderboard/omega?period=30d` (or similar) reading from the leaderboard table. Include pagination + sorting.
- Frontend: hook the API into the leaderboard view, reusing whale leaderboard components where possible. Add basic error states and loading indicators.
- Instrument logging/metrics so we can detect stale data or API failures.

## 6. Final Verification & Rollout Checklist
- Re-run smoke tests: API responses, UI renders, cache invalidations, auth gates.
- Update documentation (`erc1155_restore.md`, `PHASE_3_ENRICHMENT_PLAN.md`, new leaderboard spec) to reflect the final state.
- Draft the release note summarizing: ERC-1155 recovery, Goldsky ingestion, P&L/Dome reconciliation, and Omega leaderboard availability.

## Notes & Guardrails
- Continue using CREATE → RENAME for all table promotions; keep the Phase 1 backups until leadership signs off.
- For any ClickHouse mutation touching >1M rows, dry-run first and log counts before/after.
- If Dome API limits or discrepancies pop up, pause immediately and document before retrying.

Once every section above is checked off (with artifacts in git), we can announce the Omega leaderboard as production-ready.
