# ClickHouse Table Relationships - Visual Reference

**Database:** default
**Last Updated:** 2025-11-29

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES (External)                          │
├─────────────────────────────────────────────────────────────────────────┤
│  • Polymarket CLOB API (fills)                                          │
│  • Polygon Blockchain (ERC1155 transfers, CTF events)                   │
│  • Polymarket Gamma API (market metadata)                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       RAW DATA TABLES (75.4 GB)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │ pm_trader_events_v2  │    │   pm_ctf_events      │                  │
│  │   62.72 GB, 781M     │    │   6.71 GB, 116M      │                  │
│  │  [CLOB Fills]        │    │  [CTF Blockchain]    │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │pm_erc1155_transfers  │    │  pm_fpmm_trades      │                  │
│  │   1.76 GB, 42.6M     │    │  380 MB, 4.4M        │                  │
│  │ [ERC1155 Transfers]  │    │   [AMM Trades]       │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │ pm_erc20_usdc_flows  │    │pm_market_metadata    │                  │
│  │   178 MB, 6.7M       │    │   52.8 MB, 180K      │                  │
│  │  [USDC Transfers]    │    │  [Market Info]       │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    PROCESSED/DERIVED TABLES (3.6 GB)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────┐              │
│  │     pm_ctf_split_merge_expanded                      │              │
│  │          1.99 GB, 31.7M rows                         │              │
│  │    [CTF events expanded by outcome]                  │              │
│  └──────────────────────────────────────────────────────┘              │
│                          │                                              │
│                          ↓                                              │
│  ┌──────────────────────────────────────────────────────┐              │
│  │        pm_ctf_flows_inferred                         │              │
│  │          530 MB, 10.4M rows                          │              │
│  │    [Inferred cash/share flows from CTF]              │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────┐              │
│  │     pm_wallet_condition_ledger_v9                    │              │
│  │          13.2 MB, 939K rows                          │              │
│  │    [Transaction ledger per wallet/condition]         │              │
│  └──────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      PNL CALCULATION TABLES (1.01 GB)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────┐              │
│  │      pm_cascadian_pnl_v1_new                         │              │
│  │          1.01 GB, 24.7M rows                         │              │
│  │    [Primary PnL calculation table]                   │              │
│  │                                                       │              │
│  │  • trade_cash_flow: Net USDC spent/received          │              │
│  │  • final_shares: Current position                    │              │
│  │  • realized_pnl: Actual profit/loss                  │              │
│  │  • resolution_price: 0, 1, or NULL                   │              │
│  └──────────────────────────────────────────────────────┘              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────┐              │
│  │     pm_wallet_pnl_ui_activity_v1                     │              │
│  │          2.55 KB, 7 rows                             │              │
│  │    [UI activity-based PnL (experimental)]            │              │
│  └──────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                   REFERENCE/LOOKUP TABLES (47.5 MB)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │pm_token_to_condition │    │pm_condition_         │                  │
│  │     _map_v3          │    │   resolutions        │                  │
│  │   25.8 MB, 359K      │    │   20.8 MB, 193K      │                  │
│  │ [Token→Condition]    │    │  [Resolutions]       │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │  pm_fpmm_pool_map    │    │pm_wallet_            │                  │
│  │   1.69 MB, 26K       │    │  classification      │                  │
│  │  [Pool→Condition]    │    │   5.6 KB, 196        │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │pm_market_data_quality│    │ pm_ui_positions_new  │                  │
│  │    931 B, 2          │    │   9.2 KB, 84         │                  │
│  │  [Quality Flags]     │    │ [UI Positions]       │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────┐                                               │
│  │  pm_api_positions    │                                               │
│  │    5.9 KB, 70        │                                               │
│  │  [API Positions]     │                                               │
│  └──────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Join Patterns

### Primary Key Relationships

```
pm_market_metadata (condition_id)
    ├── 1:N → pm_trader_events_v2 (via token_id → token_to_condition_map)
    ├── 1:N → pm_cascadian_pnl_v1_new (condition_id)
    ├── 1:N → pm_wallet_condition_ledger_v9 (condition_id)
    ├── 1:N → pm_ctf_events (condition_id)
    ├── 1:N → pm_ctf_split_merge_expanded (condition_id)
    ├── 1:N → pm_ctf_flows_inferred (condition_id)
    ├── 1:1 → pm_condition_resolutions (condition_id)
    ├── 1:N → pm_token_to_condition_map_v3 (condition_id)
    └── 1:1 → pm_fpmm_pool_map (condition_id)

pm_trader_events_v2 (trader_wallet)
    ├── 1:N → pm_cascadian_pnl_v1_new (trader_wallet)
    ├── 1:N → pm_wallet_condition_ledger_v9 (wallet)
    └── N:1 → pm_wallet_classification (wallet)

pm_trader_events_v2 (token_id)
    └── N:1 → pm_token_to_condition_map_v3 (token_id_dec)
              └── 1:1 → pm_market_metadata (condition_id)

pm_fpmm_trades (fpmm_pool_address)
    └── N:1 → pm_fpmm_pool_map (fpmm_pool_address)
              └── 1:1 → pm_market_metadata (condition_id)

pm_ctf_events (condition_id, user_address)
    ├── 1:1 → pm_ctf_split_merge_expanded (id)
    └── N:1 → pm_market_metadata (condition_id)

pm_ctf_split_merge_expanded (wallet, condition_id)
    ├── 1:1 → pm_ctf_flows_inferred (wallet, condition_id, tx_hash)
    └── N:1 → pm_market_metadata (condition_id)

pm_erc1155_transfers (token_id)
    └── N:1 → pm_token_to_condition_map_v3 (token_id_dec)
```

### Common Join Examples

#### 1. Get trades with market info

```sql
SELECT
  t.trader_wallet,
  t.side,
  t.usdc / 1000000.0 as usdc,
  m.question,
  m.outcome_label
FROM (
  SELECT
    event_id,
    any(trader_wallet) as trader_wallet,
    any(side) as side,
    any(token_id) as token_id,
    any(usdc_amount) as usdc
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
) t
LEFT JOIN pm_token_to_condition_map_v3 map
  ON t.token_id = map.token_id_dec
LEFT JOIN pm_market_metadata m
  ON map.condition_id = m.condition_id
```

#### 2. Get PnL with market and resolution info

```sql
SELECT
  p.trader_wallet,
  p.condition_id,
  m.question,
  m.outcomes,
  p.outcome_index,
  p.realized_pnl,
  r.payout_numerators,
  r.resolved_at
FROM pm_cascadian_pnl_v1_new p
LEFT JOIN pm_market_metadata m
  ON p.condition_id = m.condition_id
LEFT JOIN pm_condition_resolutions r
  ON p.condition_id = r.condition_id
WHERE p.trader_wallet = '0x...'
```

#### 3. Get wallet activity across all sources

```sql
-- CLOB trades
SELECT 'CLOB' as source, trader_wallet, COUNT(*) as count
FROM (SELECT event_id, any(trader_wallet) as trader_wallet FROM pm_trader_events_v2 WHERE is_deleted = 0 GROUP BY event_id)
WHERE trader_wallet = '0x...'
GROUP BY trader_wallet

UNION ALL

-- FPMM trades
SELECT 'FPMM' as source, trader_wallet, COUNT(*) as count
FROM pm_fpmm_trades
WHERE trader_wallet = '0x...' AND is_deleted = 0
GROUP BY trader_wallet

UNION ALL

-- CTF events
SELECT 'CTF' as source, user_address as trader_wallet, COUNT(*) as count
FROM pm_ctf_events
WHERE user_address = '0x...' AND is_deleted = 0
GROUP BY user_address
```

---

## Data Flow Diagram

```
┌─────────────────┐
│ POLYMARKET CLOB │
│      API        │
└────────┬────────┘
         │
         ↓
┌───────────────────────────────┐
│  pm_trader_events_v2          │ ────┐
│  (CLOB fills)                 │     │
└───────────────────────────────┘     │
                                      │
┌─────────────────┐                   │
│  POLYGON CHAIN  │                   │
│  (ERC1155 CTF)  │                   ↓
└────────┬────────┘         ┌──────────────────────────┐
         │                  │  pm_token_to_condition   │
         │                  │       _map_v3            │
         ↓                  │  (Token ID → Condition)  │
┌───────────────────────────────┐    └──────────┬───────────┘
│  pm_ctf_events                │               │
│  (Splits, Merges, Payouts)    │               │
└────────┬──────────────────────┘               │
         │                                      │
         ↓                                      │
┌───────────────────────────────┐               │
│  pm_ctf_split_merge_expanded  │               │
│  (Per-outcome deltas)         │               │
└────────┬──────────────────────┘               │
         │                                      │
         ↓                                      │
┌───────────────────────────────┐               │
│  pm_ctf_flows_inferred        │               │
│  (MINT, BURN flows)           │               │
└───────────────────────────────┘               │
                                                │
         ┌──────────────────────────────────────┘
         │
         ↓
┌───────────────────────────────┐
│  pm_wallet_condition_ledger   │
│  (Transaction ledger)         │
└────────┬──────────────────────┘
         │
         ↓
┌───────────────────────────────┐
│  pm_cascadian_pnl_v1_new      │ ←─── pm_condition_resolutions
│  (PnL calculations)           │      (Resolution data)
└───────────────────────────────┘
         │
         ↓
┌───────────────────────────────┐
│   APPLICATION / API LAYER     │
└───────────────────────────────┘
```

---

## Key Constraints and Rules

### 1. Foreign Key Relationships (Logical, not enforced)

| Child Table | Parent Table | Join Column | Notes |
|------------|--------------|-------------|-------|
| pm_trader_events_v2 | pm_token_to_condition_map_v3 | token_id → token_id_dec | Token must exist in map |
| pm_token_to_condition_map_v3 | pm_market_metadata | condition_id | All conditions should have metadata |
| pm_cascadian_pnl_v1_new | pm_market_metadata | condition_id | PnL tied to conditions |
| pm_condition_resolutions | pm_market_metadata | condition_id | 1:1 relationship |
| pm_fpmm_pool_map | pm_market_metadata | condition_id | Pool tied to condition |
| pm_ctf_events | pm_market_metadata | condition_id | CTF events for conditions |

### 2. Data Integrity Rules

- **Deduplication:** Always GROUP BY event_id for `pm_trader_events_v2`
- **Soft Deletes:** Check `is_deleted = 0` on all queries
- **Nullable Joins:** Use `Nullable()` types for LEFT JOIN columns
- **Array Indexing:** ClickHouse arrays are 1-indexed (use `outcome_index + 1`)
- **Unit Conversion:** Divide by 1,000,000 for USDC/token amounts

### 3. Referential Integrity Checks

```sql
-- Find trades with no token mapping
SELECT COUNT(DISTINCT token_id) as unmapped_tokens
FROM pm_trader_events_v2 t
LEFT JOIN pm_token_to_condition_map_v3 m
  ON t.token_id = m.token_id_dec
WHERE m.token_id_dec IS NULL
  AND t.is_deleted = 0

-- Find PnL rows with no market metadata
SELECT COUNT(*) as missing_metadata
FROM pm_cascadian_pnl_v1_new p
LEFT JOIN pm_market_metadata m
  ON p.condition_id = m.condition_id
WHERE m.condition_id IS NULL

-- Find resolved conditions with no metadata
SELECT COUNT(*) as missing_metadata
FROM pm_condition_resolutions r
LEFT JOIN pm_market_metadata m
  ON r.condition_id = m.condition_id
WHERE m.condition_id IS NULL
  AND r.is_deleted = 0
```

---

## Performance Considerations

### Sort Keys (Index)

| Table | Sort Key | Use Case |
|-------|----------|----------|
| pm_trader_events_v2 | trader_wallet, token_id, trade_time | Wallet queries, token lookups |
| pm_fpmm_trades | trader_wallet, fpmm_pool_address, event_id | Wallet/pool queries |
| pm_cascadian_pnl_v1_new | trader_wallet, condition_id, outcome_index | Wallet PnL, market PnL |
| pm_market_metadata | condition_id | Market lookups |
| pm_condition_resolutions | condition_id | Resolution lookups |
| pm_token_to_condition_map_v3 | condition_id, token_id_dec | Token → condition mapping |
| pm_ctf_events | id | Event lookups |
| pm_ctf_split_merge_expanded | wallet, condition_id, outcome_index, id | Wallet/condition queries |

### Query Optimization Tips

1. **Filter on sort key first:** WHERE clauses should start with sort key columns
2. **Use PREWHERE:** For initial filtering on large tables
3. **Avoid SELECT \*:** Specify only needed columns
4. **Limit result sets:** Use LIMIT for exploratory queries
5. **Deduplicate early:** GROUP BY event_id before joins

---

## Related Documentation

- **Database Audit Summary:** [DATABASE_AUDIT_SUMMARY.md](./DATABASE_AUDIT_SUMMARY.md)
- **Quick Query Reference:** [QUICK_QUERY_REFERENCE.md](./QUICK_QUERY_REFERENCE.md)
- **Full Audit Report:** [COMPLETE_DATABASE_AUDIT.txt](./COMPLETE_DATABASE_AUDIT.txt)

---

**Last Updated:** 2025-11-29
