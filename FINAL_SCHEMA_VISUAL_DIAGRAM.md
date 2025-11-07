# Cascadian Final Schema: Visual Diagram
**18 Tables - Clean 4-Tier Architecture**

---

## Overview: Data Flow

```
BLOCKCHAIN EVENTS
      │
      ├──→ CLOB Fills ────────────┐
      ├──→ ERC1155 Transfers ─────┤
      ├──→ ERC20 Transfers ────────┤
      └──→ Polymarket API ─────────┤
                                   │
                              TIER 0: RAW (5 tables)
                              Append-only, immutable
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      │                                                          │
      ├──→ trades_raw (159.5M)                                  │
      ├──→ erc1155_transfers (388M)                             │
      ├──→ erc20_transfers (500M)                               │
      ├──→ market_resolutions_final (224K)                      │
      └──→ gamma_markets (150K)                                 │
                                   │
                                   │
                              TIER 1: BASE (3 tables)
                              Mappings, normalized IDs
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      │                                                          │
      ├──→ base_ctf_tokens (token → condition + outcome)        │
      ├──→ base_market_conditions (condition metadata)          │
      └──→ base_outcome_resolver (outcome text → index)         │
                                   │
                                   │
                              TIER 2: STAGING (6 tables)
                              Enriched with context
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      │                                                          │
      ├──→ trades (159.5M) - Enriched with market context       │
      ├──→ positions (1M) - Daily balances with metadata        │
      ├──→ capital_flows (10M) - USDC in/out                    │
      ├──→ market_details (150K) - Merged API + on-chain        │
      ├──→ prices_hourly (2M) - OHLCV aggregates                │
      └──→ prices_daily (100K) - Daily OHLCV                    │
                                   │
                                   │
                              TIER 3: MARTS (4 tables)
                              Final analytics, dashboards
                                   │
      ┌────────────────────────────┴────────────────────────────┐
      │                                                          │
      ├──→ markets (150K) - Market directory                    │
      ├──→ users (43K) - User directory                         │
      ├──→ wallet_pnl (43K) - SINGLE SOURCE OF TRUTH            │
      └──→ prices_latest (300K) - Latest price snapshot         │
                                   │
                                   │
                              APPLICATIONS
                              Dashboard, API, Strategies
```

---

## Tier 0: Raw Tables (5)

```
┌─────────────────────────────────────────────────────────────────┐
│                         TIER 0: RAW DATA                        │
│                    (Append-only, Immutable)                     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│     trades_raw           │  Primary Key: (wallet_address, timestamp, trade_id)
├──────────────────────────┤  Rows: 159,574,259
│ • trade_id               │  Source: Polymarket CLOB fills
│ • wallet_address         │  Update: Append-only
│ • market_id              │  Partition: toYYYYMM(timestamp)
│ • condition_id           │
│ • side (BUY/SELL)        │  Used By: trades (staging)
│ • outcome_index          │
│ • shares                 │
│ • entry_price            │
│ • timestamp              │
└──────────────────────────┘

┌──────────────────────────┐
│   erc1155_transfers      │  Primary Key: (block_number, log_index)
├──────────────────────────┤  Rows: ~388M
│ • block_number           │  Source: Polygon blockchain ERC1155 events
│ • log_index              │  Update: Append-only
│ • from_address           │  Partition: toYYYYMM(block_time)
│ • to_address             │
│ • token_id               │  Used By: positions (staging)
│ • value                  │
│ • block_time             │
└──────────────────────────┘

┌──────────────────────────┐
│    erc20_transfers       │  Primary Key: (block_number, log_index)
├──────────────────────────┤  Rows: ~500M
│ • block_number           │  Source: Polygon blockchain ERC20 (USDC) events
│ • log_index              │  Update: Append-only
│ • from_address           │  Partition: toYYYYMM(block_time)
│ • to_address             │
│ • value                  │  Used By: capital_flows (staging)
│ • block_time             │
└──────────────────────────┘

┌──────────────────────────┐
│market_resolutions_final  │  Primary Key: condition_id_norm
├──────────────────────────┤  Rows: 223,973
│ • condition_id           │  Source: CTF contract + Polymarket API
│ • condition_id_norm      │  Update: ReplacingMergeTree (idempotent)
│ • winning_outcome        │
│ • resolved_at            │  Used By: base_outcome_resolver, wallet_pnl
│ • payout_hash            │
│ • is_resolved            │
└──────────────────────────┘

┌──────────────────────────┐
│     gamma_markets        │  Primary Key: market_id
├──────────────────────────┤  Rows: 149,907
│ • market_id              │  Source: Polymarket Gamma API
│ • condition_id           │  Update: ReplacingMergeTree (idempotent)
│ • question               │
│ • outcomes[]             │  Used By: market_details (staging)
│ • end_date_iso           │
│ • category               │
│ • volume                 │
└──────────────────────────┘
```

---

## Tier 1: Base Tables (3)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 1: BASE MAPPINGS                        │
│               (Derived from raw, idempotent)                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│   base_ctf_tokens        │  Primary Key: (condition_id_norm, token_id)
├──────────────────────────┤  Rows: ~2,000
│ • token_id               │  Source: ctf_token_map + api_ctf_bridge + ...
│ • condition_id_norm      │  Purpose: Token → Condition + Outcome mapping
│ • outcome_index          │  Update: ReplacingMergeTree
│ • outcome_text           │
│ • market_id              │  Used By: trades, positions
└──────────────────────────┘
         │
         └──→ Consolidates:
              - ctf_token_map
              - ctf_condition_meta
              - api_ctf_bridge
              - api_ctf_bridge_final

┌──────────────────────────┐
│ base_market_conditions   │  Primary Key: condition_id_norm
├──────────────────────────┤  Rows: ~152,000
│ • condition_id_norm      │  Source: condition_market_map + gamma_markets
│ • market_id              │  Purpose: Condition metadata + payout vectors
│ • oracle                 │  Update: ReplacingMergeTree
│ • status                 │
│ • payout_numerators[]    │  Used By: wallet_pnl (settlement calc)
│ • payout_denominator     │
│ • resolved_at            │
└──────────────────────────┘
         │
         └──→ Consolidates:
              - condition_market_map
              - ctf_payout_data
              - gamma_markets (partial)

┌──────────────────────────┐
│ base_outcome_resolver    │  Primary Key: (condition_id_norm, outcome_text)
├──────────────────────────┤  Rows: ~224,000
│ • condition_id_norm      │  Source: market_resolutions_final + outcome matching
│ • outcome_text           │  Purpose: Outcome text → index lookup
│ • outcome_index          │  Update: ReplacingMergeTree
│ • confidence             │
│ • resolution_method      │  Used By: wallet_pnl (match winning outcome)
└──────────────────────────┘
         │
         └──→ Computed via outcome resolver algorithm
              (exact match → alias match → fuzzy match)
```

---

## Tier 2: Staging Tables (6)

```
┌─────────────────────────────────────────────────────────────────┐
│                   TIER 2: ENRICHED STAGING                      │
│              (Raw + joins + computed fields)                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│        trades            │  Primary Key: (wallet_address, timestamp, trade_id)
├──────────────────────────┤  Rows: 159,574,259
│ FROM: trades_raw         │  Purpose: Enriched trades with market context
│                          │  Update: ReplacingMergeTree
│ Core:                    │  Partition: toYYYYMM(timestamp)
│ • trade_id               │
│ • wallet_address         │  Consolidates 9 tables:
│ • market_id              │  - vw_trades_canonical
│ • condition_id_norm      │  - vw_trades_canonical_v2
│ • tx_hash                │  - trades_with_direction
│                          │  - trades_with_recovered_cid
│ Trade Details:           │  - trades_with_pnl (move P&L to marts)
│ • side (BUY/SELL)        │  - trade_direction_assignments
│ • outcome_index          │  - trades_dedup_mat
│ • shares                 │  - trades_dedup_mat_new
│ • entry_price            │  - trades_with_pnl_old
│ • fee_usd                │
│                          │  Used By: wallet_pnl, markets, prices_*
│ Enrichment:              │
│ • direction (computed)   │
│ • direction_confidence   │
│ • market_question        │
│ • outcome_text           │
│ • market_category        │
│                          │
│ • timestamp              │
└──────────────────────────┘
         │
         └──→ JOIN base_ctf_tokens (outcome_text)
              JOIN market_details (market_question, category)

┌──────────────────────────┐
│       positions          │  Primary Key: (wallet_address, day, token_id)
├──────────────────────────┤  Rows: ~1M (daily snapshots)
│ FROM: erc1155_transfers  │  Purpose: Daily position balances with context
│                          │  Update: ReplacingMergeTree
│ Core:                    │  Partition: toYYYYMM(day)
│ • day                    │
│ • wallet_address         │  Consolidates 4 tables:
│ • token_id               │  - outcome_positions_v2
│ • condition_id_norm      │  - pm_erc1155_flats
│ • outcome_index          │  - pm_trades
│ • balance                │  - wallet_resolution_outcomes
│                          │
│ Enrichment:              │  Used By: wallet_pnl (unrealized)
│ • market_question        │
│ • market_status          │
│ • resolved_at            │
└──────────────────────────┘
         │
         └──→ JOIN base_ctf_tokens (condition_id_norm)
              JOIN market_details (market context)

┌──────────────────────────┐
│     capital_flows        │  Primary Key: (wallet_address, timestamp, tx_hash)
├──────────────────────────┤  Rows: ~10M
│ FROM: erc20_transfers    │  Purpose: USDC deposits/withdrawals
│                          │  Update: ReplacingMergeTree
│ • tx_hash                │  Partition: toYYYYMM(timestamp)
│ • wallet_address         │
│ • action_type            │  New table (no prior equivalent)
│   (DEPOSIT/WITHDRAW)     │
│ • usdc_amount            │  Used By: users (wallet activity)
│ • timestamp              │
└──────────────────────────┘

┌──────────────────────────┐
│    market_details        │  Primary Key: condition_id_norm
├──────────────────────────┤  Rows: ~150,000
│ FROM: gamma_markets      │  Purpose: Unified market metadata
│                          │  Update: ReplacingMergeTree
│ • condition_id_norm      │
│ • market_question        │  Consolidates:
│ • market_category        │  - market_metadata
│ • outcomes[]             │  - market_outcomes
│ • end_date_iso           │  - market_outcome_catalog
│ • volume                 │  - market_resolution_map
│ • description            │
│ • tags[]                 │  Used By: trades, positions, markets
└──────────────────────────┘

┌──────────────────────────┐
│     prices_hourly        │  Primary Key: (condition_id_norm, outcome_index, hour)
├──────────────────────────┤  Rows: ~2M
│ FROM: trades (aggregate) │  Purpose: Hourly OHLCV candles
│                          │  Update: Materialized view (auto-refresh)
│ • condition_id_norm      │
│ • outcome_index          │  Aggregation:
│ • hour                   │  - GROUP BY toStartOfHour(timestamp)
│ • open                   │  - argMin(price, timestamp) AS open
│ • high                   │  - max(price) AS high
│ • low                    │  - min(price) AS low
│ • close                  │  - argMax(price, timestamp) AS close
│ • volume                 │  - sum(shares) AS volume
└──────────────────────────┘

┌──────────────────────────┐
│      prices_daily        │  Primary Key: (condition_id_norm, outcome_index, day)
├──────────────────────────┤  Rows: ~100,000
│ FROM: trades (aggregate) │  Purpose: Daily OHLCV candles
│                          │  Update: Materialized view
│ • condition_id_norm      │
│ • outcome_index          │  Consolidates:
│ • day                    │  - market_price_history
│ • open                   │  - market_price_momentum (delete)
│ • high                   │
│ • low                    │  Used By: prices_latest, markets
│ • close                  │
│ • volume                 │
└──────────────────────────┘
```

---

## Tier 3: Marts (4)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 3: ANALYTICS MARTS                      │
│            (Final outputs for dashboards, APIs)                 │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│        markets           │  Primary Key: condition_id_norm
├──────────────────────────┤  Rows: ~150,000
│ FROM: market_details +   │  Purpose: Market directory with stats
│       trades (aggregate) │  Update: Materialized view (refresh daily)
│                          │
│ Metadata:                │  New table (consolidates logic)
│ • condition_id_norm      │
│ • market_question        │  Used By: Dashboard (market list)
│ • market_category        │
│ • end_date_iso           │
│                          │
│ Resolution:              │
│ • winning_outcome        │
│ • resolved_at            │
│ • is_resolved            │
│                          │
│ Stats:                   │
│ • unique_traders         │
│ • total_volume_shares    │
│ • total_volume_usd       │
└──────────────────────────┘

┌──────────────────────────┐
│         users            │  Primary Key: wallet_address
├──────────────────────────┤  Rows: ~43,000
│ FROM: trades +           │  Purpose: User directory
│       pm_user_proxy_wlts │  Update: Materialized view
│                          │
│ • wallet_address         │  Consolidates:
│ • wallet_type            │  - pm_user_proxy_wallets (rename)
│   (STANDARD/PROXY)       │  - wallets_dim (delete)
│ • first_trade_at         │
│ • last_trade_at          │  Used By: Dashboard (user lookup)
│ • total_trades           │
└──────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        wallet_pnl                                │
├──────────────────────────────────────────────────────────────────┤
│                   🎯 SINGLE SOURCE OF TRUTH                      │
│                         FOR P&L                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│       wallet_pnl         │  Primary Key: wallet_address
├──────────────────────────┤  Rows: ~43,000
│ FROM: trades +           │  Purpose: Wallet P&L (realized + unrealized)
│       positions +        │  Update: Materialized view (refresh hourly)
│       resolutions +      │
│       base_outcome_rslvr │  Consolidates 10+ tables:
│                          │  - wallet_pnl_correct
│ Realized:                │  - wallet_pnl_summary_final
│ • wallet_address         │  - wallet_realized_pnl_final
│ • realized_pnl_usd       │  - wallet_realized_pnl_v2 (BUG: 16,267x inflation!)
│ • total_resolved_trades  │  - wallet_pnl_summary_v2
│ • markets_traded         │  - realized_pnl_by_market_final
│                          │  - realized_pnl_corrected_v2
│ Unrealized:              │  - realized_pnl_by_market_v2 (BUG: index offset!)
│ • unrealized_pnl_usd     │  - trade_cashflows_v3 (BUG: 18.7x duplication!)
│ • open_positions_count   │  - ALL other P&L views/tables
│                          │
│ Total:                   │  Formula (CORRECT):
│ • total_pnl_usd          │  realized_pnl = SUM(
│ • last_updated_at        │    cost_basis +
│                          │    settlement -
│                          │    fees
│                          │  ) WHERE market_resolved = 1
│                          │
│                          │  settlement = shares * (
│                          │    payout_numerators[outcome_index + 1] /
│                          │    payout_denominator
│                          │  ) WHERE outcome_index = winning_index
│                          │
│                          │  Used By: Dashboard (main metric)
└──────────────────────────┘
         │
         └──→ TEST CASES:
              - niggemon: Expected $99,691 - $102,001
              - HolyMoses7: Expected match Polymarket
              - Total sanity: Not $1.9M per wallet!

┌──────────────────────────┐
│     prices_latest        │  Primary Key: (condition_id_norm, outcome_index)
├──────────────────────────┤  Rows: ~300,000
│ FROM: prices_daily       │  Purpose: Latest price snapshot
│       (latest only)      │  Update: Materialized view (refresh 5min)
│                          │
│ • condition_id_norm      │  Query:
│ • outcome_index          │  SELECT * FROM prices_daily
│ • day                    │  WHERE (condition_id_norm, outcome_index, day) IN (
│ • price                  │    SELECT condition_id_norm, outcome_index, MAX(day)
│ • volume_24h             │    FROM prices_daily
│ • change_24h_pct         │    GROUP BY condition_id_norm, outcome_index
│                          │  )
│                          │
│                          │  Used By: Dashboard (current prices)
└──────────────────────────┘
```

---

## Data Lineage: Trace Any Metric

### Example: wallet_pnl.realized_pnl_usd

```
wallet_pnl.realized_pnl_usd
    ↑
    FROM: trades + positions + market_resolutions_final + base_outcome_resolver
        ↑           ↑              ↑                          ↑
        │           │              │                          │
    trades      positions    market_resolutions    base_outcome_resolver
        ↑           ↑              ↑                          ↑
        │           │              │                          │
   trades_raw  erc1155_transfers  (raw source)      (computed from market_resolutions)
        ↑           ↑
        │           │
   CLOB fills   ERC1155 events
   (Polymarket) (Polygon blockchain)
```

**Lineage Summary:**
- Tier 0 (raw): CLOB fills, ERC1155 events, market resolutions
- Tier 1 (base): Outcome resolver (text → index)
- Tier 2 (staging): Enriched trades, daily positions
- Tier 3 (marts): Aggregated P&L

**No intermediate P&L tables:** Clean path from raw → mart

---

## Join Patterns: Common Queries

### Query 1: Get Wallet P&L
```sql
SELECT realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
FROM wallet_pnl
WHERE wallet_address = ?;
-- ✅ Single table, no joins needed
```

### Query 2: Get Market Trades
```sql
SELECT
  t.trade_id,
  t.wallet_address,
  t.side,
  t.shares,
  t.entry_price,
  t.market_question
FROM trades t
WHERE t.condition_id_norm = ?
ORDER BY t.timestamp DESC;
-- ✅ Single table, already enriched
```

### Query 3: Get Position Value
```sql
SELECT
  p.day,
  p.balance,
  pl.price,
  p.balance * pl.price AS position_value_usd
FROM positions p
JOIN prices_latest pl
  ON pl.condition_id_norm = p.condition_id_norm
  AND pl.outcome_index = p.outcome_index
WHERE p.wallet_address = ?
  AND p.day = today();
-- ✅ Simple join, clear grain
```

### Query 4: Market Leaderboard
```sql
SELECT
  m.market_question,
  w.wallet_address,
  wp.realized_pnl_usd
FROM wallet_pnl wp
JOIN trades t ON t.wallet_address = wp.wallet_address
JOIN markets m ON m.condition_id_norm = t.condition_id_norm
WHERE m.condition_id_norm = ?
ORDER BY wp.realized_pnl_usd DESC
LIMIT 10;
-- ✅ Clear joins, no fanout
```

---

## Performance Characteristics

| Table | Rows | Query Latency (p95) | Index Strategy |
|-------|------|---------------------|----------------|
| trades_raw | 159.5M | N/A (not queried directly) | - |
| trades | 159.5M | < 100ms | wallet_address, condition_id_norm, timestamp |
| positions | 1M | < 50ms | wallet_address, day |
| wallet_pnl | 43K | < 10ms | wallet_address (primary key) |
| markets | 150K | < 20ms | condition_id_norm, category |
| prices_latest | 300K | < 20ms | condition_id_norm, outcome_index |

**Design Principles:**
- Tier 0-1: Optimized for writes (append-only, idempotent)
- Tier 2: Optimized for reads (denormalized, indexed)
- Tier 3: Optimized for aggregations (pre-computed, cached)

---

## Operational Tables (Not in Tier Structure)

```
┌──────────────────────────┐
│   backfill_checkpoint    │  Purpose: Track backfill progress
├──────────────────────────┤  Keep: Yes (operational)
│ • table_name             │
│ • last_processed_block   │
│ • last_processed_date    │
│ • updated_at             │
└──────────────────────────┘

┌──────────────────────────┐
│   worker_heartbeats      │  Purpose: Monitor worker health
├──────────────────────────┤  Keep: Yes (operational)
│ • worker_id              │
│ • last_heartbeat         │
│ • status                 │
└──────────────────────────┘

┌──────────────────────────┐
│   schema_migrations      │  Purpose: Track schema versions
├──────────────────────────┤  Keep: Yes (operational)
│ • version                │
│ • applied_at             │
│ • description            │
└──────────────────────────┘

┌──────────────────────────┐
│      events_dim          │  Purpose: Event dimension lookup
├──────────────────────────┤  Keep: Yes (dimension)
│ • event_id               │  Rows: 5,781
│ • event_name             │
│ • sport                  │
│ • league                 │
└──────────────────────────┘
```

---

## Migration Checklist

### Phase 0: Pre-Flight
- [ ] Tag current schema: `schema-v1-before-consolidation`
- [ ] Export all 87 table definitions
- [ ] Audit application queries
- [ ] Set up shadow schema: `default_v2`

### Phase 1: Raw (Week 1)
- [ ] Verify 5 core raw tables
- [ ] Archive 10 backup variants
- [ ] Document data completeness

### Phase 2: Base (Week 2)
- [ ] Create base_ctf_tokens
- [ ] Create base_market_conditions
- [ ] Create base_outcome_resolver
- [ ] Test all joins

### Phase 3: Staging (Week 3-4)
- [ ] Create trades (consolidate 9 → 1)
- [ ] Create positions (consolidate 4 → 1)
- [ ] Create capital_flows
- [ ] Create prices_hourly, prices_daily
- [ ] Update market_details

### Phase 4: Marts (Week 4-5)
- [ ] Create wallet_pnl (FIX P&L BUG)
- [ ] Create markets, users, prices_latest
- [ ] Validate P&L: niggemon, HolyMoses7, 10+ wallets
- [ ] Migrate application queries

### Phase 5: Cleanup (Week 5)
- [ ] Archive 20 old tables
- [ ] Delete 49 redundant tables
- [ ] Optimize indexes
- [ ] Update documentation

---

## Success Validation

### Quantitative Checks
- [ ] Table count: 87 → 18 ✅
- [ ] niggemon P&L: $117 → $99,691 - $102,001 (±2%) ✅
- [ ] Query latency: p95 < 500ms ✅
- [ ] Zero data loss: Row counts match ✅

### Qualitative Checks
- [ ] Schema is self-documenting ✅
- [ ] Clear data lineage ✅
- [ ] No competing formulas ✅
- [ ] Developer can understand in < 30min ✅

---

**Document Status:** Complete visual reference
**Related Docs:**
- Execution plan: `SCHEMA_CONSOLIDATION_MASTER_PLAN.md`
- Executive summary: `CONSOLIDATION_EXECUTIVE_SUMMARY.md`
- Table audit: `TABLE_BY_TABLE_AUDIT_87_TABLES.md`

**Next Step:** Begin Phase 0 (pre-flight checks)
