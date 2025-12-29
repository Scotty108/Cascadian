# ClickHouse Database Audit Summary

**Generated:** 2025-11-29
**Database:** default
**Total Tables:** 18
**Total Rows:** 1,019,392,656 (1.02 billion)
**Total Storage:** 75.38 GB

---

## Executive Summary

The Cascadian ClickHouse database contains **18 production tables** organized into 7 primary categories:
- **TRADING/CLOB** (2 tables, 62.72 GB)
- **ERC1155/BLOCKCHAIN** (4 tables, 10.19 GB)
- **PNL** (2 tables, 1.01 GB)
- **MARKETS** (5 tables, 112.3 MB)
- **WALLETS** (3 tables, 13.2 MB)
- **POSITIONS** (2 tables, 15.1 KB)
- **OTHER** (1 table, 178.3 MB - ERC20 USDC flows)

### Critical Data Quality Notes

All tables use **SharedMergeTree** or **SharedReplacingMergeTree** engines:
- Duplicates are possible before final merge
- **ALWAYS use `GROUP BY` for deduplication** when aggregating
- `pm_trader_events_v2` requires special handling (see deduplication pattern below)

---

## Tables by Category

### 1. TRADING/CLOB (785M rows, 63.1 GB)

#### pm_trader_events_v2
- **Size:** 62.72 GiB (780,642,432 rows)
- **Engine:** SharedMergeTree
- **Sort Key:** trader_wallet, token_id, trade_time
- **Purpose:** All CLOB trading fills from Polymarket
- **Critical:** Known duplicates - MUST use GROUP BY event_id pattern
- **Key Columns:** event_id, trader_wallet, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash

**Deduplication Pattern (REQUIRED):**
```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc,
    any(token_amount) / 1000000.0 as tokens,
    any(trade_time) as trade_time
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) ...
```

#### pm_fpmm_trades
- **Size:** 380.66 MiB (4,395,403 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** trader_wallet, fpmm_pool_address, event_id
- **Purpose:** AMM (FPMM) pool trades
- **Warning:** trade_time is epoch (1970-01-01) - use block_number for ordering
- **Key Columns:** event_id, fpmm_pool_address, trader_wallet, outcome_index, side, usdc_amount, token_amount, transaction_hash

---

### 2. ERC1155/BLOCKCHAIN (201M rows, 10.19 GB)

#### pm_ctf_events
- **Size:** 6.71 GiB (116,496,588 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** id
- **Purpose:** CTF (Conditional Token Framework) events from blockchain
- **Event Types:** PositionSplit, PositionsMerge, PayoutRedemption
- **Key Columns:** event_type, user_address, condition_id, partition_index_sets, amount_or_payout, event_timestamp, tx_hash, id

#### pm_ctf_split_merge_expanded
- **Size:** 1.99 GiB (31,710,366 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** wallet, condition_id, outcome_index, id
- **Purpose:** Expanded view of CTF split/merge events with per-outcome deltas
- **Key Columns:** wallet, condition_id, outcome_index, event_type, cash_delta, shares_delta, event_timestamp, tx_hash

#### pm_erc1155_transfers
- **Size:** 1.76 GiB (42,649,320 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** tx_hash, log_index
- **Purpose:** Raw ERC1155 token transfer events
- **Key Columns:** tx_hash, log_index, token_id, from_address, to_address, value, block_timestamp

#### pm_ctf_flows_inferred
- **Size:** 529.80 MiB (10,419,765 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** wallet, condition_id, tx_hash, flow_type
- **Purpose:** Inferred cash/share flows from CTF events (MINT, BURN, etc.)
- **Flow Types:** MINT, BURN, etc.
- **Key Columns:** wallet, condition_id, outcome_index, tx_hash, flow_type, usdc_delta, token_amount, source, confidence

---

### 3. PNL (24.7M rows, 1.01 GB)

#### pm_cascadian_pnl_v1_new
- **Size:** 1.01 GiB (24,695,013 rows)
- **Engine:** SharedMergeTree
- **Sort Key:** trader_wallet, condition_id, outcome_index
- **Purpose:** Primary PnL calculation table (Cascadian V1 spec)
- **Key Metrics:**
  - `trade_cash_flow`: Net USDC spent (-) or received (+) from trades
  - `final_shares`: Current share position (can be negative = short)
  - `realized_pnl`: Actual profit/loss realized
  - `resolution_price`: 0 or 1 (or NULL if unresolved)
  - `is_resolved`: Whether market has resolved
- **Key Columns:** trader_wallet, condition_id, outcome_index, trade_cash_flow, final_shares, resolution_price, realized_pnl, trade_count, first_trade, last_trade, resolved_at

#### pm_wallet_pnl_ui_activity_v1
- **Size:** 2.55 KiB (7 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** wallet
- **Purpose:** UI activity-based PnL (experimental, limited data)
- **Key Columns:** wallet, pnl_activity_total, gain_activity, loss_activity, volume_traded, fills_count, redemptions_count

---

### 4. MARKETS (732K rows, 112.3 MB)

#### pm_market_metadata
- **Size:** 52.76 MiB (179,830 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** condition_id
- **Purpose:** Complete market metadata from Polymarket Gamma API
- **48 Columns Including:**
  - Basic: market_id, slug, question, description, category, tags
  - Pricing: outcome_prices, best_bid, best_ask, spread
  - Volume: volume_usdc, volume_24hr, volume_1wk, volume_1mo
  - Outcomes: outcomes (array), outcome_label, token_ids (array)
  - Resolution: winning_outcome, resolution_source
  - Dates: start_date, end_date, created_at, updated_at
  - Status: is_active, is_closed, is_resolved, is_archived
  - Types: market_type, format_type
- **Key Columns:** condition_id, market_id, slug, question, outcome_label, outcomes, token_ids, volume_usdc, liquidity_usdc, is_active, is_closed

#### pm_token_to_condition_map_v3
- **Size:** 25.78 MiB (358,617 rows)
- **Engine:** SharedMergeTree
- **Sort Key:** condition_id, token_id_dec
- **Purpose:** Maps token IDs to conditions and outcome indices
- **Key Columns:** condition_id, token_id_dec, slug, question, category, tags, outcome_index

#### pm_condition_resolutions
- **Size:** 20.75 MiB (193,190 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** condition_id
- **Purpose:** On-chain resolution data
- **Payout Format:** payout_numerators array (e.g., [1,0] for binary, [1,0,0] for 3-outcome)
- **Key Columns:** condition_id, payout_numerators, payout_denominator, resolved_at, tx_hash, id

#### pm_wallet_condition_ledger_v9
- **Size:** 13.18 MiB (939,017 rows)
- **Engine:** SharedMergeTree
- **Sort Key:** wallet, condition_id, outcome_index, tx_time, tx_hash
- **Purpose:** Transaction-level ledger of wallet activity per condition
- **Sources:** CLOB_BUY, CLOB_SELL, MINT, BURN, etc.
- **Key Columns:** wallet, condition_id, outcome_index, tx_hash, tx_time, source, usdc_delta, token_delta

#### pm_market_data_quality
- **Size:** 931 B (2 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** condition_id
- **Purpose:** Data quality flags for specific markets
- **Quality Types:** ok, partial, missing_trades, missing_amm, missing_resolution
- **Key Columns:** condition_id, data_quality, note, flagged_at, verified_at

---

### 5. WALLETS (939K rows, 13.2 MB)

#### pm_wallet_classification
- **Size:** 5.59 KiB (196 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** wallet
- **Purpose:** Classify wallets (infra, market_maker, etc.)
- **Types:** infra, market_maker
- **Key Columns:** wallet, wallet_type, label, contract_name, classified_at, classification_source

---

### 6. POSITIONS (154 rows, 15.1 KB)

#### pm_ui_positions_new
- **Size:** 9.24 KiB (84 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** proxy_wallet, condition_id, outcome_index
- **Purpose:** UI-sourced position data (backfilled from Polymarket UI)
- **Key Columns:** proxy_wallet, condition_id, asset, outcome_index, total_bought, total_sold, net_shares, cash_pnl, realized_pnl, unrealized_pnl, current_value

#### pm_api_positions
- **Size:** 5.88 KiB (70 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** wallet, condition_id, outcome
- **Purpose:** API-sourced position data
- **Key Columns:** wallet, condition_id, outcome, size, avg_price, initial_value, current_value, cash_pnl, realized_pnl, is_closed, market_slug

---

### 7. OTHER

#### pm_erc20_usdc_flows
- **Size:** 178.28 MiB (6,686,671 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** tx_hash, log_index
- **Purpose:** ERC20 USDC transfer events
- **Flow Types:** other, ctf_deposit, ctf_payout
- **Key Columns:** tx_hash, log_index, from_address, to_address, amount_usdc, flow_type

#### pm_fpmm_pool_map
- **Size:** 1.69 MiB (26,085 rows)
- **Engine:** SharedReplacingMergeTree
- **Sort Key:** fpmm_pool_address
- **Purpose:** Maps FPMM pool addresses to condition IDs
- **Key Columns:** fpmm_pool_address, condition_id, question, created_at

---

## Critical Schema Notes

### ClickHouse-Specific Conventions

1. **Arrays are 1-indexed:** Use `arrayElement(outcomes, outcome_index + 1)` to get outcome label
2. **condition_id format:** 64-character lowercase hex (strip 0x prefix if present)
3. **token_id formats:** Can be decimal string or 0x-prefixed hex
4. **Nullable types:** Required for LEFT JOIN columns to avoid default values (0, epoch)
5. **Amounts:** Usually stored in raw units (divide by 1,000,000 for USDC)

### Common Pitfalls

- **pm_trader_events_v2 duplicates:** ALWAYS use GROUP BY event_id
- **pm_fpmm_trades timestamps:** trade_time is epoch, use block_number instead
- **outcome_index:** 0-indexed in tables, but outcomes arrays are 1-indexed
- **Shared/Replacing engines:** Duplicates possible, use GROUP BY for deduplication

---

## Query Patterns

### Get wallet PnL for a specific condition
```sql
SELECT
  trader_wallet,
  condition_id,
  outcome_index,
  trade_cash_flow,
  final_shares,
  resolution_price,
  realized_pnl,
  trade_count
FROM pm_cascadian_pnl_v1_new
WHERE trader_wallet = '0x...'
  AND condition_id = '...'
ORDER BY outcome_index
```

### Get all trades for a wallet (deduplicated)
```sql
SELECT
  event_id,
  any(trader_wallet) as wallet,
  any(side) as side,
  any(token_id) as token_id,
  any(usdc_amount) / 1000000.0 as usdc,
  any(token_amount) / 1000000.0 as tokens,
  any(trade_time) as trade_time
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...'
  AND is_deleted = 0
GROUP BY event_id
ORDER BY any(trade_time) DESC
LIMIT 100
```

### Get market metadata with resolution
```sql
SELECT
  m.condition_id,
  m.question,
  m.outcomes,
  m.volume_usdc,
  m.is_closed,
  r.payout_numerators,
  r.resolved_at
FROM pm_market_metadata m
LEFT JOIN pm_condition_resolutions r
  ON m.condition_id = r.condition_id
WHERE m.condition_id = '...'
```

### Get CTF events for a wallet
```sql
SELECT
  event_type,
  user_address,
  condition_id,
  partition_index_sets,
  amount_or_payout,
  event_timestamp,
  tx_hash
FROM pm_ctf_events
WHERE user_address = '0x...'
  AND is_deleted = 0
ORDER BY event_timestamp DESC
LIMIT 100
```

---

## Related Documentation

- **Full Audit Report:** [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt)
- **PnL System:** [docs/READ_ME_FIRST_PNL.md](../../READ_ME_FIRST_PNL.md)
- **Database Patterns:** [STABLE_PACK_REFERENCE.md](./STABLE_PACK_REFERENCE.md)
- **Table Relationships:** [TABLE_RELATIONSHIPS.md](./TABLE_RELATIONSHIPS.md)

---

**Last Updated:** 2025-11-29
**Audit Script:** `/Users/scotty/Projects/Cascadian-app/scripts/comprehensive-database-audit.ts`
