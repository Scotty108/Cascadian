# Cascadian Database Architecture Reference

**Date:** 2025-11-09  
**Owners:** Data Platform / P&L Engineering  
**Scope:** Authoritative description of how raw data, reference tables, and analytic views relate inside ClickHouse.

---

## 1. Environment Overview

| Layer | Purpose | Location / Notes |
| --- | --- | --- |
| **Raw Warehouse** | All immutable blockchain + CLOB ingest tables | `default` database on `igm38nvzub.us-central1.gcp.clickhouse.cloud` |
| **Clean Views** | Canonicalized joins, wallet/market views, P&L layers | `cascadian_clean` database (built entirely from `default`) |
| **Application** | Supabase + Next.js app reads only from `cascadian_clean` | Wallet UI, reports, dashboards |

Two schemas matter:

1. `default.*` contains the ingestion result of every worker (CLOB logs, token transfers, resolution feeds, metadata).
2. `cascadian_clean.*` contains SQL views/materializations that normalize IDs, filter bad rows, and expose product-friendly schemas.

---

## 2. Canonical Raw Tables (default)

| Table | Contents | Key Columns / Notes |
| --- | --- | --- |
| `trades_raw` | Every on-chain order-fill emitted by the CTF exchange worker. Source of truth for trades. | `tx_hash`, `block_time`, `market_id`, `token_id`, `wallet`, `side` (Enum8), `shares`, `price`, `cashflow_usdc`. **Never trust derived P&L columns**; use `cashflow_usdc` + share deltas. |
| `market_resolutions_final` | Authoritative payout vectors prepared from on-chain UMA/CTF events plus legacy exports. | `condition_id_norm` (`FixedString(64)` – must cast to `String`), `payout_numerators` (Array(UInt8)), `payout_denominator`, `winning_index`, `resolved_at`. Filters: `payout_denominator > 0` and `arraySum(numerators)=denominator`. |
| `condition_market_map` | Maps Polygon market IDs to CTF condition IDs and metadata. | `market_id`, `condition_id_norm`, `event_id`. Used for enrichment only. |
| `gamma_markets` | Snapshot of Polymarket metadata (titles, categories, end timestamps). | Keys: `market_id`, `slug`, `event_type`, `neg_risk`, `end_time`. Join on market ID. |
| `market_candles_5m` | OHLCV per market/outcome, 5 minute buckets. | `market_id`, `outcome`, `bucket_start`, `open`, `high`, `low`, `close`, `volume`. Drives fallback price logic. |
| `api_ctf_bridge` / `token_condition_market_map` (cascadian_clean) | Derived mapping table built from ERC-1155 token registrations. | (See §3) |

Other supporting “raw” tables (`gamma_resolved`, `resolution_candidates`, `staging_resolutions_union`) exist but **do not contain payout vectors**; they are used for QA only.

---

## 3. Canonical Mapping Layer

| View / Table | Source | Purpose |
| --- | --- | --- |
| `cascadian_clean.token_condition_market_map` | Built from `default.api_ctf_bridge` + ERC-1155 registration events. | Provides the authoritative triplet used everywhere else: `token_id_erc1155`, `condition_id_32b` (lowercase hex string), `market_id_cid` (0x…00 market address). **Every join from trades → resolutions must go through this map.** |
| `cascadian_clean.vw_trades_canonical` | `trades_raw` + map + metadata tables. | Normalizes condition IDs, removes `market_id='12'` placeholders, and computes signed `shares_net` / `cash_net`. This is the base for all downstream views. |
| `cascadian_clean.vw_positions_open` | Aggregation over `vw_trades_canonical`. | Current net position per wallet/market/outcome with live quote columns (`midprice`, `best_bid`, `best_ask`). |

**Normalization rules:** always `lower(replaceAll(condition_id, '0x',''))` before joining. `market_resolutions_final.condition_id_norm` is `FixedString(64)` and must be wrapped in `toString(...)` before comparison.

---

## 4. P&L Stack (cascadian_clean)

| View | Inputs | Description |
| --- | --- | --- |
| `vw_wallet_pnl_closed` | `vw_trades_canonical` | Pure trading/realized P&L (entry vs exit cashflows). Works for every wallet. |
| `vw_wallet_pnl_all` | `vw_positions_open`, `market_candles_5m`, `midprice` snapshots | Adds unrealized P&L when a midprice or last-trade exists. Marks coverage quality (`QUOTED`, `LAST_TRADE`, `AWAITING`). |
| `vw_wallet_pnl_settled` | `vw_trades_canonical`, `token_condition_market_map`, `vw_resolutions_truth` | Adds redemption P&L for resolved markets. Requires payout vectors; currently blocked until `vw_resolutions_truth` unions `market_resolutions_final` via `toString(condition_id_norm)`. |
| `vw_resolutions_truth` | `resolutions_by_cid` + (pending) `market_resolutions_final` | Single source of payout vectors. Apply strict filters (`payout_denominator>0`, sum match, non-null `resolved_at`). |

**Data flow:** `trades_raw` → `vw_trades_canonical` → (`vw_positions_open`, `vw_wallet_pnl_closed`) → `vw_wallet_pnl_all` / `vw_wallet_pnl_settled`.

---

## 5. Known Gotchas (Must Document for Every Consumer)

1. **`market_resolutions_final.condition_id_norm` is `FixedString(64)`**  
   Always `toString(condition_id_norm)` before joining to prevent silent mismatches.
2. **Enum side fields**  
   `trades_raw.side` is Enum8 (`'YES'/'NO'`). Do not treat as numeric. Signed cashflows already exist in `cashflow_usdc`.
3. **Placeholder markets**  
   Rows with `market_id='12'` or `token_id=''` are placeholders—exclude them from analytics.
4. **Condition ID formats**  
   There are prefixed and unprefixed variants. Normalize both sides of every join.
5. **Resolution coverage**  
   218k payouts exist today, but `vw_resolutions_truth` must union `market_resolutions_final` (with cast) to expose them. Until that union is live, Settled P&L will under-report.

---

## 6. Authoritative Mapping Diagram (textual)

```
        ┌──────────────────────┐
        │ default.trades_raw   │
        └──────────┬───────────┘
                   │ normalize market/token IDs
                   ▼
        ┌──────────────────────┐
        │ cascadian_clean.token│◄── default.api_ctf_bridge + ERC1155
        │ _condition_market_map│
        └──────────┬───────────┘
                   │ join to trades/resolutions
        ┌──────────▼───────────┐
        │ vw_trades_canonical  │
        └──┬────────┬──────────┘
           │        │ aggregate/shares
           │        ▼
           │      vw_positions_open (quotes)
           ▼
   vw_wallet_pnl_closed (realized)
           │
 ┌─────────┼─────────┐
 │         │         │
 ▼         ▼         ▼
vw_wallet_pnl_all    vw_wallet_pnl_settled
     (midprice)         (joins vw_resolutions_truth)
```

---

## 7. Real-Time / Future Enhancements

- **Streaming ingest:** Subscribe to `polymarket-pnl@v0.3.1` Substreams modules (`map_ctf_exchange_order_filled`, `map_user_positions`) for low-latency price/position updates. Feed those into the same normalization pipeline before writing to `trades_raw`.
- **Coverage telemetry:** Add per-wallet metrics (% of positions with quotes/payouts, last price timestamp) so the UI can label data quality accurately.

---

## 8. Resolution Backfill Infrastructure

**Investigation Completed:** Nov 9, 2025 - Confirmed that 75.17% of markets (171,263 / 227,838) have no payout data in warehouse or on-chain yet. These are genuinely unresolved markets.

**Solution Implemented:**

| Component | Purpose |
| --- | --- |
| `default.resolutions_external_ingest` | Staging table for on-chain resolution backfill (ReplacingMergeTree on condition_id) |
| `backfill-condition-payouts.ts` | Script that queries Polygon CTF contract (`0x4D97...45`) for payout vectors and auto-inserts into staging table |

**Usage:**
```bash
# Backfill by wallet
npx tsx backfill-condition-payouts.ts --wallet 0x4ce7...

# Backfill by explicit condition_ids
npx tsx backfill-condition-payouts.ts --ids "cid1,cid2,cid3"
```

**When markets resolve:**
1. Script queries `getOutcomeSlotCount`, `payoutNumerators`, `payoutDenominator` from CTF contract
2. Auto-inserts into `resolutions_external_ingest` with `source='chain-backfill'`
3. Update `vw_resolutions_truth` to UNION this table
4. `vw_wallet_pnl_settled` will automatically calculate redemption P&L

**Current state:** Wallet `0x4ce73141dbfce41e65db3723e31059a730f0abad` has 30 open positions, 0/30 with payout data (markets not resolved by UMA oracle yet). Backfill script correctly returns "no payout data on-chain" for these condition_ids.

See: `RESOLUTION_GAP_FINAL_SUMMARY.md` for complete investigation details.

---

## 9. Action Items

1. **Update `vw_resolutions_truth`** to union `default.resolutions_external_ingest` (in addition to `market_resolutions_final`).
2. **Document joins**: require every new query touching condition IDs to import this reference (normalize, exclude placeholders).
3. **Keep this file authoritative**: when schemas or sources change, update here and link from `docs/` and runbooks.
4. **Optional:** Schedule `backfill-condition-payouts.ts` to run periodically for wallets with missing resolution data.

---

## 10. Cross-References

- `CLICKHOUSE_COMPLETE_TABLE_MAPPING.md` – inventory of all tables (use as appendix).
- `CLOB_TABLE_INVENTORY.md` – ingestion worker ownership.
- `RESOLUTION_GAP_FINAL_SUMMARY.md` – complete investigation of $333K gap (markets unresolved, not a bug).
- `backfill-condition-payouts.ts` – on-chain resolution backfill script.
- ⚠️ `CASCADIAN_DATABASE_MASTER_REFERENCE.md` – DEPRECATED (Nov 7, outdated schema references).
