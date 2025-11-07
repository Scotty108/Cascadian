# Dune Schema Consolidation - Implementation Checklist

**Project:** Cascadian App Schema Cleanup (87 → 18 tables)
**Based on:** Dune Analytics Polymarket Spellbook reference architecture
**Timeline:** 6 weeks (5 phases)
**Status:** Ready to start Phase 1

---

## Phase 1: Audit & Document Current Schema (Week 1)

### 1.1 Inventory All 87 Tables

- [ ] Create spreadsheet with all current tables
  - Column 1: Table name
  - Column 2: Estimated row count (SELECT COUNT(*) FROM table_name LIMIT 1000000)
  - Column 3: Last modified timestamp
  - Column 4: Purpose/description
  - Column 5: Source table(s)
  - Column 6: Target tier (raw/base/staging/marts)

**Recommended tools:**
```sql
-- Get all table names and sizes
SELECT
  name,
  formatReadableSize(bytes) as size,
  rows,
  parts
FROM system.tables
WHERE database = 'default'
ORDER BY bytes DESC;
```

- [ ] Categorize each table into Dune tiers:
  - Tier 1: Raw (blockchain events, immutable)
  - Tier 2: Base (simple mappings/joins)
  - Tier 3: Staging (enriched, normalized)
  - Tier 4: Analytics (final marts)
  - Deprecated: Not used, can archive

### 1.2 Identify Raw Sources

- [ ] List all tables that ingest raw blockchain data
  - Which are duplicates? (trades_raw vs. clob_trades vs. clob_fills)
  - Which is authoritative?
  - Mark others as deprecated with deprecation reason

- [ ] Document deduplication logic for each raw table
  - How does it dedup? (ROW_NUMBER, DISTINCT, etc.)
  - What's the dedup key? (tx_hash, block_time, evt_index, etc.)
  - Is dedup applied consistently?

### 1.3 Document Table Grain

- [ ] For each table, document its grain
  - "One row per..." (trade, position, address/token/day, etc.)
  - Unique constraint(s)
  - Historical or snapshot?

**Example format:**
```markdown
### positions_raw
- **Grain:** One row per (address, token_id, day)
- **Unique constraint:** (day, address, token_id)
- **Type:** Snapshot (daily balance)
- **Source:** ERC1155 balance tracking macro
- **Row count:** ~500M
```

### 1.4 Find Circular Dependencies

- [ ] Create data lineage diagram (use SQL query or graph tool)
- [ ] Identify any circular joins/dependencies
  - A → B → C → A (circular, not allowed)
- [ ] Document data flow for each table
  - Which tables feed into it?
  - Which tables depend on it?

### 1.5 Document Current P&L Calculations

- [ ] Find all tables with payout_numerator, payout_denominator, pnl, realized_pnl, unrealized_pnl
- [ ] Document where P&L is calculated
  - Which staging tables contain PnL logic?
  - How is the formula implemented?
  - Is it consistent across tables?

---

## Phase 2: Build Tier 2 Base/Mapping Tables (Week 2)

### 2.1 Create base_ctf_tokens

- [ ] Create table structure
  ```sql
  CREATE TABLE base_ctf_tokens (
    condition_id String,
    token_id String,
    outcome_index UInt32,
    block_time DateTime,
    tx_hash String,
    CONSTRAINT CHECK condition_id != ''
  ) ENGINE = MergeTree
  ORDER BY (condition_id, token_id, outcome_index);
  ```

- [ ] Populate from raw token registration events
  - Union CTFExchange + NegRiskCtfExchange events
  - Apply dedup: ROW_NUMBER() OVER (PARTITION BY condition_id, token_id ORDER BY block_time) = 1
  - Test: Row count matches authoritative source

- [ ] Document grain: "One row per (condition_id, token_id) at first occurrence"
- [ ] Validate: All condition_ids and token_ids are non-null

### 2.2 Create base_market_conditions

- [ ] Create table structure
  ```sql
  CREATE TABLE base_market_conditions (
    condition_id String,
    oracle_address String,
    status String, -- 'active', 'resolved', 'paused'
    outcome_slot_count UInt32,
    created_at DateTime,
    CONSTRAINT CHECK condition_id != ''
  ) ENGINE = MergeTree
  ORDER BY condition_id;
  ```

- [ ] Populate from on-chain condition registration events
- [ ] Document grain: "One row per condition_id"
- [ ] Validate: All required fields populated

### 2.3 Create base_outcome_resolver

- [ ] Create table structure
  ```sql
  CREATE TABLE base_outcome_resolver (
    condition_id String,
    outcome_index UInt32,
    outcome_text String,
    outcome_name String,
    CONSTRAINT CHECK condition_id != ''
  ) ENGINE = MergeTree
  ORDER BY (condition_id, outcome_index);
  ```

- [ ] Populate: Map outcome text to outcome_index
  - How is outcome_index determined? (payout vector array index, 0-based or 1-based?)
  - Ensure consistency with Polymarket API
- [ ] Test: outcome_index matches CTF token array index
- [ ] Document: Explain array indexing (1-based in ClickHouse!)

### 2.4 Validate Tier 2 Tables

- [ ] Row count audit: Verify counts don't exceed source tables
- [ ] Foreign key check: Every entry in staging tables has corresponding base table entry
- [ ] Dedup check: No duplicate (condition_id, token_id) pairs
- [ ] Null check: No nulls in critical fields

**Test queries:**
```sql
-- Find missing mappings
SELECT t.condition_id
FROM trades_raw t
WHERE NOT EXISTS (
  SELECT 1 FROM base_ctf_tokens b
  WHERE b.condition_id = t.condition_id
);

-- Check for duplicates
SELECT condition_id, token_id, COUNT(*) as cnt
FROM base_ctf_tokens
GROUP BY condition_id, token_id
HAVING cnt > 1;
```

---

## Phase 3: Consolidate Staging Tables (Weeks 3-4)

### 3.1 Consolidate trades_* Tables

- [ ] Identify all trades_* tables (trades_enriched, trades_canonical, trades_deduped, trades_with_direction, etc.)
- [ ] Choose target table: `trades` (simple, clear naming)
- [ ] Design trades schema:
  ```sql
  CREATE TABLE trades (
    -- Raw event fields
    block_time DateTime,
    tx_hash String,
    evt_index UInt32,
    action String,
    -- Market mapping
    condition_id String,
    token_id String,
    outcome_index UInt32,
    -- Trade details
    maker String,
    taker String,
    amount Decimal128(6),
    shares Decimal128(18),
    price Decimal128(6),
    fee Decimal128(6),
    -- Computed fields (one-time only)
    direction String, -- BUY/SELL
    outcome_name String,
    market_question String
  ) ENGINE = MergeTree
  ORDER BY (block_time, tx_hash, evt_index);
  ```

- [ ] Populate trades table:
  ```sql
  INSERT INTO trades
  SELECT
    -- Raw
    r.block_time, r.tx_hash, r.evt_index, r.action,
    -- Mapped
    r.condition_id, r.token_id, 
    b.outcome_index,
    -- Trade details
    r.maker, r.taker, r.amount, r.shares, r.price, r.fee,
    -- Direction (compute once)
    CASE
      WHEN r.usdc_net > 0 AND r.token_net > 0 THEN 'BUY'
      WHEN r.usdc_net < 0 AND r.token_net < 0 THEN 'SELL'
      ELSE 'UNKNOWN'
    END,
    -- Market context
    o.outcome_name,
    m.question
  FROM trades_raw r
  LEFT JOIN base_ctf_tokens b USING (condition_id, token_id)
  LEFT JOIN base_outcome_resolver o ON r.condition_id = o.condition_id AND b.outcome_index = o.outcome_index
  LEFT JOIN market_details m USING (condition_id);
  ```

- [ ] Validate:
  - Row count matches trades_raw (LEFT JOIN preserves all rows)
  - No duplicates on (tx_hash, evt_index)
  - All direction values are either BUY/SELL/UNKNOWN
  - PnL fields REMOVED (moved to final marts only)

- [ ] Mark old tables as deprecated:
  - Rename: trades_enriched → trades_enriched_DEPRECATED
  - trades_canonical → trades_canonical_DEPRECATED
  - etc.

### 3.2 Consolidate positions_* Tables

- [ ] Identify all positions_* tables
- [ ] Design positions schema:
  ```sql
  CREATE TABLE positions (
    day Date,
    address String,
    token_id String,
    balance Decimal128(18),
    -- Market context (denormalized)
    condition_id String,
    outcome_index UInt32,
    outcome_name String,
    market_question String,
    market_status String,
    resolved_at DateTime
  ) ENGINE = MergeTree
  ORDER BY (day, address, token_id);
  ```

- [ ] Populate and validate similarly to trades
- [ ] Grain: "One row per (day, address, token_id)"

### 3.3 Consolidate price_* Tables

- [ ] Identify all price_history_daily, price_history_hourly, etc.
- [ ] Create two tables: prices_hourly and prices_daily
- [ ] Populate from trades aggregates:
  ```sql
  SELECT
    condition_id, token_id,
    toStartOfHour(block_time) as period,
    last(price) as close,
    max(price) as high,
    min(price) as low,
    sum(amount) as volume_usdc
  FROM trades
  GROUP BY condition_id, token_id, period;
  ```

### 3.4 Consolidate capital_flows Tables

- [ ] Identify: deposits, withdrawals, conversions (separate tables)
- [ ] Create single capital_flows table with action_type:
  ```sql
  CREATE TABLE capital_flows (
    block_time DateTime,
    tx_hash String,
    evt_index UInt32,
    address String,
    from_address String,
    to_address String,
    amount Decimal128(6),
    symbol String,
    action_type String, -- 'DEPOSIT', 'WITHDRAWAL', 'CONVERSION'
    usd_value Decimal128(6)
  ) ENGINE = MergeTree
  ORDER BY (block_time, tx_hash, evt_index);
  ```

### 3.5 Keep User Proxy Tables Separate

- [ ] Keep: users_safe_proxies (unchanged)
- [ ] Keep: users_magic_wallet_proxies (unchanged)
- [ ] Create: users (UNION of both)
  ```sql
  CREATE VIEW users AS
  SELECT
    eoa as address,
    safe_proxy as proxy,
    'SAFE' as proxy_type,
    creation_time,
    first_funder
  FROM users_safe_proxies
  UNION ALL
  SELECT
    eoa,
    magic_proxy,
    'MAGIC',
    creation_time,
    NULL
  FROM users_magic_wallet_proxies;
  ```

### 3.6 Validate Tier 3 Consolidation

- [ ] Row counts: Old vs. new tables should match (within ±0.5%)
  - Compare: SELECT COUNT(*) FROM old_table vs. new table
  - Document any discrepancies
- [ ] Grain compliance: Every table has documented grain
- [ ] No circular deps: Data flows one direction only
- [ ] Left joins preserve all rows: No data loss
- [ ] Test: Recreate 5 application queries on new schema

**Test queries for validation:**
```sql
-- Check row count consistency
SELECT 'trades_raw' as table_name, COUNT(*) as cnt FROM trades_raw
UNION ALL
SELECT 'trades', COUNT(*) FROM trades;

-- Check for nulls in critical fields
SELECT column_name, COUNT(*) as null_count
FROM trades
WHERE column_name IS NULL
GROUP BY column_name
HAVING null_count > 0;

-- Verify left join didn't lose rows
SELECT COUNT(DISTINCT tx_hash) as raw_count
FROM trades_raw
WHERE COUNT(DISTINCT tx_hash) != (SELECT COUNT(DISTINCT tx_hash) FROM trades);
```

---

## Phase 4: Clean Analytics Marts (Week 4-5)

### 4.1 Identify Core Marts

- [ ] Query application code to find which marts are actually used
- [ ] List currently queried marts:
  - wallet_pnl (keep)
  - market_pnl (keep)
  - markets (keep)
  - prices_latest (keep)
  - users (keep)
  - leaderboard_metrics (deprecated? archive)
  - smart_money_scores (deprecated? archive)

### 4.2 Create wallet_pnl Mart

- [ ] Design final PnL calculation table:
  ```sql
  CREATE TABLE wallet_pnl (
    address String,
    condition_id String,
    outcome_index UInt32,
    -- Position details
    final_shares Decimal128(18),
    cost_basis Decimal128(6),
    -- Payout vector
    payout_numerator UInt32,
    payout_denominator UInt32,
    -- PnL (computed)
    pnl_usd Decimal128(6),
    -- Metadata
    market_question String,
    outcome_name String,
    resolved_at DateTime
  ) ENGINE = MergeTree
  ORDER BY (address, condition_id);
  ```

- [ ] Populate with formula:
  ```sql
  INSERT INTO wallet_pnl
  SELECT
    p.address, p.condition_id, p.outcome_index,
    p.final_shares, p.cost_basis,
    w.payout_numerator, w.payout_denominator,
    -- PnL = shares * (payout / denom) - cost_basis
    p.final_shares * (w.payout_numerator / w.payout_denominator) - p.cost_basis as pnl_usd,
    p.market_question, p.outcome_name, p.resolved_at
  FROM positions p
  JOIN winning_outcomes w USING (condition_id, outcome_index)
  GROUP BY p.address, p.condition_id;
  ```

- [ ] **CRITICAL:** Remove all PnL fields from staging tables
  - trades should NOT have pnl, realized_pnl, unrealized_pnl
  - positions should NOT have pnl fields
  - Any table with payout_numerator/denominator should be deleted/archived

### 4.3 Create market_pnl Mart

- [ ] Market-level rollup:
  ```sql
  CREATE TABLE market_pnl AS
  SELECT
    condition_id,
    SUM(pnl_usd) as total_pnl,
    COUNT(DISTINCT address) as trader_count,
    COUNT(*) as position_count,
    AVG(pnl_usd) as avg_pnl
  FROM wallet_pnl
  GROUP BY condition_id;
  ```

### 4.4 Archive Deprecated Marts

- [ ] For each deprecated mart:
  - [ ] Document reason for deprecation
  - [ ] Move to archive/ directory (don't delete)
  - [ ] Add deprecation date to schema doc
  - [ ] Update application code to build dynamically if needed

**Example deprecated marts:**
- leaderboard_metrics → Build from wallet_pnl on-demand
- smart_money_scores → Build from wallet_pnl on-demand
- wallet_positions_final → Query positions directly
- market_trade_summary → Aggregate from trades on-demand

### 4.5 Validate Marts

- [ ] PnL reconciliation:
  - Sample 10 wallets from old schema
  - Compare PnL values to new schema
  - Difference should be <2% (allow for rounding)
- [ ] Application testing:
  - Run all dashboard queries against new marts
  - Compare results to old marts
  - Performance should be same or faster

**Reconciliation query:**
```sql
SELECT
  address, condition_id,
  old_pnl, new_pnl,
  abs(old_pnl - new_pnl) / abs(old_pnl) as pct_diff
FROM (
  SELECT address, condition_id, pnl_usd as old_pnl
  FROM wallet_pnl_OLD
  UNION ALL
  SELECT address, condition_id, pnl_usd as new_pnl
  FROM wallet_pnl
)
WHERE pct_diff > 0.02;
```

---

## Phase 5: Validation & Deployment (Week 5)

### 5.1 Full Backfill on Clean Schema

- [ ] Run complete data import from raw sources
- [ ] Populate all 18 tables in order:
  1. Raw tables (append)
  2. Base tables (derived)
  3. Staging tables (enriched)
  4. Marts (final)

- [ ] Monitor runtime and resource usage
- [ ] Verify incremental merge safety (rerun same blocks)

### 5.2 Row Count Verification

- [ ] Compare old vs. new row counts:
  ```
  Old schema:  trades_raw         300M rows
  New schema:  trades             300M rows ✓
  
  Old schema:  positions_raw      500M rows
  New schema:  positions          500M rows ✓
  ```

- [ ] Document any discrepancies and reason
- [ ] If >0.5% difference, investigate cause

### 5.3 PnL Accuracy Validation

- [ ] Compare PnL values for sample wallets:
  ```
  Address: 0x123...
  Market:  Polymarket#456
  Old PnL: 1234.56 USDC
  New PnL: 1234.67 USDC
  Diff:    0.01% ✓
  ```

- [ ] Test boundary cases:
  - All-winning positions (PnL should be positive)
  - All-losing positions (PnL should be negative)
  - Zero position (PnL should be zero)
  - Partial positions (weighted average)

### 5.4 Application Testing

- [ ] Update application queries to use new marts
- [ ] Test all dashboard features:
  - [ ] Wallet PnL page loads
  - [ ] Market leaderboard shows correct values
  - [ ] Price charts load correctly
  - [ ] Position tracking works
  - [ ] Capital flow history displays

- [ ] Performance testing:
  - Query response times same or faster?
  - No N+1 query problems?
  - Indexes being used correctly?

### 5.5 Archive Old Schema

- [ ] Rename old tables:
  - trades_enriched → trades_enriched_ARCHIVE_20251107
  - etc.

- [ ] Create archive documentation:
  - List of archived tables
  - Reason for archival
  - Migration date
  - Deprecation warning (if still in use)

### 5.6 Documentation

- [ ] Update schema documentation:
  - [ ] Document all 18 tables with grain
  - [ ] Add tier prefixes to schema
  - [ ] Add unique constraints
  - [ ] Add refresh cadence

- [ ] Create migration guide:
  - [ ] Old table → New table mapping
  - [ ] Updated query examples
  - [ ] Deprecation notices

- [ ] Update CLAUDE.md:
  - [ ] Reference new schema structure
  - [ ] Add schema tier diagram
  - [ ] Document Tier 2 base tables
  - [ ] Link to validation results

### 5.7 Final Sign-Off

- [ ] Performance: No regression in query times
- [ ] Correctness: PnL matches old schema (±2%)
- [ ] Completeness: All 18 tables documented
- [ ] Quality: Zero critical issues, all tests passing
- [ ] Timeline: Completed within 6-week estimate

---

## Rollback Plan (If Needed)

If critical issues found during Phases 1-5:

1. Keep old tables during consolidation (don't delete)
2. At validation phase, compare results
3. If new schema has issues:
   - Revert application queries to old marts
   - Keep new schema for reference/debugging
   - Document issue and resolution

4. Never delete old schema until 100% confident

---

## Success Criteria (Checkboxes)

- [ ] All 87 tables audited and classified
- [ ] 4 tiers defined with clear boundaries
- [ ] 3 base/mapping tables created and validated
- [ ] 8 staging tables consolidated from 40+
- [ ] 2-3 final marts clean and optimized
- [ ] Zero circular dependencies
- [ ] Row counts verified (±0.5%)
- [ ] PnL values verified (±2%)
- [ ] All 18 tables documented with grain
- [ ] Application tested and working
- [ ] Performance same or better
- [ ] Old schema archived with documentation
- [ ] Team trained on new schema
- [ ] Monitoring/alerts updated

---

## Time Tracking

| Phase | Planned | Actual | Notes |
|-------|---------|--------|-------|
| Phase 1: Audit | 1 week | | |
| Phase 2: Build Tier 2 | 1 week | | |
| Phase 3: Consolidate Staging | 2 weeks | | |
| Phase 4: Clean Marts | 1 week | | |
| Phase 5: Validate | 1 week | | |
| **TOTAL** | **6 weeks** | | |

---

## Contact & Escalation

- **Blocked on data access?** → Contact DBA
- **Unclear on Dune pattern?** → Refer to DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md
- **Need consolidation strategy?** → Refer to DUNE_VS_CASCADIAN_MAPPING.md
- **Critical issues?** → Escalate to architecture team

---

**Checklist Version:** 1.0
**Created:** 2025-11-07
**Based on:** Dune Analytics Polymarket Spellbook
**Next review:** After Phase 1 completion

