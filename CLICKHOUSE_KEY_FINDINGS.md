# ClickHouse Database - Key Findings Summary

## Quick Reference Guide

### 1. Two Core Trade Tables

**pm_trades** (CLOB API Fills - Primary for Polymarket)
- Source: Polymarket CLOB API endpoint
- Format: maker_address/taker_address (addresses of counterparties in order book)
- Side: "BUY" / "SELL" (string)
- Key for: Identifying which proxy wallet executed a trade
- Ordered by: (market_id, timestamp, id)
- Join hint: maker_address OR taker_address → pm_user_proxy_wallets.proxy_wallet → user_eoa

**trades_raw** (Generic/Legacy Trades)
- Format: wallet_address (single wallet, role unclear)
- Side: "YES" / "NO" (enum 1/2)
- For: Portfolio aggregation and P&L calculation
- Ordered by: (wallet_address, timestamp)
- Engine: Simple MergeTree (vs pm_trades uses ReplacingMergeTree)

### 2. Proxy Wallet Mapping Chain

```
user EOA (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)
    |
    | (one EOA → many proxies possible)
    v
pm_user_proxy_wallets (user_eoa → proxy_wallet)
    |
    | Source: pm_erc1155_flats (grouped by from_address, address)
    |
    v
on-chain proxy wallets (used in pm_trades as maker_address/taker_address)
    |
    | can also appear in pm_erc1155_flats as to_address
    |
    v
erc1155_transfers_enriched (shows which transfers → which EOAs)
```

### 3. P&L Calculation Architecture

**Three Settlement Rules:**

1. **Signed Cashflow (per fill)**
   - BUY: -(price * shares) - fees
   - SELL: +(price * shares) - fees

2. **Settlement on Resolution (per market)**
   - Winning long: +$1 per share
   - Winning short: +$1 per share (shorts win when outcome loses)
   - Losing position: $0

3. **Realized P&L (SIDE-DEPENDENT)**
   - Long Win: settlement - cashflow
   - Long Loss: cashflow (stays negative)
   - Short Win: settlement + cashflow (keep premium + payout)
   - Short Loss: -cashflow (negate premium - lost position)

**View Chain:**
```
trades_raw
    ↓
trade_flows_v2 (compute cashflow per fill)
    ↓
realized_pnl_by_market_v2 (per wallet, per market)
    ↓
wallet_realized_pnl_v2 (aggregate per wallet)
    ↓
wallet_pnl_summary_v2 (add unrealized for total)
```

### 4. Table Dependencies for P&L

To calculate complete P&L, you need:

```
trades_raw
    ↓
    +→ canonical_condition (maps market_id → condition_id_norm)
    |   Sources: ctf_token_map OR condition_market_map
    |
    +→ winning_index (maps condition_id_norm → winning outcome)
    |   Sources: market_resolutions_final + market_outcomes + resolutions_norm
    |
    +→ outcome_index mapping
        Sources: ctf_token_map or trades_raw itself
```

**Critical tables that must be populated:**
1. trades_raw - the actual trades
2. condition_market_map OR ctf_token_map - to map market → condition
3. market_resolutions_final - to know who won each market
4. market_outcomes table - to understand outcome indices

### 5. Wallet 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 Data Flow

1. **Find proxy wallets:**
   ```sql
   SELECT proxy_wallet FROM pm_user_proxy_wallets 
   WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
   ```

2. **Find ERC1155 token transfers:**
   ```sql
   SELECT * FROM pm_erc1155_flats 
   WHERE lower(from_address) = lower(<proxy>)
   ```

3. **Find CLOB trades:**
   ```sql
   SELECT * FROM pm_trades 
   WHERE lower(maker_address) = lower(<proxy>) 
      OR lower(taker_address) = lower(<proxy>)
   ```

4. **Get realized P&L:**
   ```sql
   SELECT * FROM wallet_pnl_summary_v2 
   WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
   ```

### 6. Data Enrichment Views

**Key intermediate views (from migration 016):**

- `markets_enriched` - market data + resolution info
- `token_market_enriched` - token data + market + winning side
- `proxy_wallets_active` - filtered active proxy mappings
- `erc1155_transfers_enriched` - transfers + market context + proxy resolution
- `wallet_positions_current` - current holdings per token per wallet

These views handle the complex left joins and null handling needed for analysis.

### 7. Engine Types Used

| Table | Engine | Why |
|-------|--------|-----|
| trades_raw | MergeTree | Simple OLAP table, no deduplication needed |
| pm_trades | ReplacingMergeTree | CLOB API may send duplicates, deduplicate by created_at |
| pm_user_proxy_wallets | ReplacingMergeTree | Map data may be updated, keep latest version |
| pm_erc1155_flats | MergeTree | Raw event logs, no deduplication |
| condition_market_map | ReplacingMergeTree | Cache table, may be refreshed |
| markets_dim | ReplacingMergeTree | Dimension, may be updated |
| wallet_resolution_outcomes | ReplacingMergeTree | Track outcomes per wallet, may update |
| wallet_metrics_complete | ReplacingMergeTree | Metrics computed at specific times |

### 8. Indexes Strategy

ClickHouse uses **bloom filters** for address lookups (low cardinality):

```sql
CREATE INDEX idx_pm_trades_maker
  ON pm_trades (maker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX idx_ctf_token_map_condition
  ON ctf_token_map (condition_id_norm)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

These are **not** traditional B-tree indexes but probabilistic filters that skip blocks during queries.

### 9. Key Data Attributes

**Consistent Case Handling:**
- All addresses stored lowercase (0x4d97... not 0x4D97...)
- Use `lower()` function in queries
- Some fields use `replaceAll(value, '0x', '')` for comparison

**Timestamp Precision:**
- Block-time (blockchain events): DateTime (second precision)
- Trade timestamp: DateTime
- Market end_date: ISO string
- Various _at fields: DateTime

**Decimal Types:**
- P&L calculations: Float64 (for aggregations) or Decimal (for storage)
- Prices: Float64 in pm_trades, Decimal in trades_raw
- Shares: Decimal in trades_raw, String in pm_trades (!)

### 10. P&L Accuracy Notes

From settlement-rules.sql and realized-pnl-corrected.sql:

**Important caveats:**
- Settlement rules are "side-dependent" - formula changes based on long/short
- P&L differs from accuracy - you can be wrong and still profit (or right and lose)
- wallet_resolution_outcomes tracks "conviction accuracy" separately
- Realized P&L uses `trade_flows_v2` which handles side normalization

**Key formula insight:**
- Shorts receive premium (positive cashflow at entry)
- Shorts pay settlement if wrong (zero payout)
- So short P&L on loss is: -(premium received) = -cashflow
- This differs from long P&L where loss = negative cashflow

### 11. Critical Joins for P&L

The canonical_condition view is critical:

```sql
-- Maps market_id → condition_id_norm from TWO sources:
SELECT market_id, anyHeavy(condition_id_norm) as condition_id_norm
FROM (
  SELECT market_id, condition_id_norm FROM ctf_token_map
  UNION ALL
  SELECT market_id, condition_id FROM condition_market_map
)
GROUP BY market_id
```

This ensures 100% coverage if either source has the mapping.

### 12. Data Quality Checks

Before using for P&L, verify:

```sql
-- Check market bridges
SELECT COUNT(DISTINCT market_id) total_markets,
       COUNT(DISTINCT CASE WHEN condition_id_norm IS NOT NULL THEN market_id END) bridged
FROM (
  SELECT market_id FROM trades_raw
  LEFT JOIN canonical_condition USING (market_id)
);

-- Check resolutions
SELECT COUNT(DISTINCT market_id) total_markets,
       COUNT(DISTINCT CASE WHEN win_idx IS NOT NULL THEN market_id END) resolvable
FROM (
  SELECT market_id FROM trades_raw
  LEFT JOIN canonical_condition USING (market_id)
  LEFT JOIN winning_index ON condition_id_norm = condition_id_norm
);

-- Verify specific wallet
SELECT COUNT(*) from pm_user_proxy_wallets
WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');
```

---

## File Locations

- Full documentation: `/Users/scotty/Projects/Cascadian-app/CLICKHOUSE_EXPLORATION.md`
- Migration files: `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/`
- Key scripts:
  - `scripts/build-approval-proxies.ts` - Creates pm_user_proxy_wallets
  - `scripts/flatten-erc1155.ts` - Creates pm_erc1155_flats
  - `scripts/ingest-clob-fills.ts` - Populates pm_trades
  - `scripts/realized-pnl-corrected.sql` - P&L views
  - `scripts/settlement-rules.sql` - P&L formulas

