# Indexer Reconciliation Strategy

**Date:** 2025-11-15
**Author:** C1
**Status:** SPECIFICATION

---

## Executive Summary

This document defines the reconciliation strategy between two P&L data sources:

1. **Goldsky Indexer** (pm_positions_indexer) - Global coverage, pre-computed P&L
2. **Data API** (external_trades_raw via C2) - Fill-level detail, targeted cohorts

**Primary Truth:** Indexer is authoritative for global positions and P&L
**Supplementary Detail:** Data API provides fill-level granularity and ghost market coverage

---

## Reconciliation Principles

### 1. Source Hierarchy

**Tier 1 - Global Truth:** Goldsky Indexer
- **Use for:** All wallet P&L, global leaderboards, position tracking
- **Coverage:** 100% of Polymarket on-chain activity
- **Granularity:** Position-level (aggregated fills)
- **Update frequency:** Every 5 minutes (incremental sync)

**Tier 2 - Detailed Supplement:** Data API (via C2)
- **Use for:** Fill-level detail, ghost markets, targeted cohorts
- **Coverage:** 12,717+ ghost wallets, rare markets not in CLOB
- **Granularity:** Individual fills
- **Update frequency:** On-demand backfills by C2

**Tier 3 - Validation Source:** pm_trades_complete
- **Use for:** Cross-checking both sources
- **Coverage:** CLOB fills + on-chain CTF events + external trades
- **Managed by:** C2 (black box)

---

### 2. Reconciliation Rules

**Rule 1: Indexer as Primary**
```
IF wallet in indexer:
  Use indexer P&L as canonical truth
  Use Data API for fill-level detail only
```

**Rule 2: Data API for Gaps**
```
IF wallet NOT in indexer:
  Use Data API P&L (rare edge case)
  Flag for investigation
```

**Rule 3: Ghost Cohort Priority**
```
IF wallet in ghost cohort (12,717 wallets):
  Validate indexer P&L against Data API P&L
  Flag discrepancies > $100 OR > 10%
```

**Rule 4: Consistency Check**
```
IF |indexer_pnl - data_api_pnl| > max($100, 10% * indexer_pnl):
  Log discrepancy
  Investigate systematically if pattern emerges
```

---

## Detection Logic

### Discrepancy Thresholds

**Absolute Threshold:** $100 USD
**Relative Threshold:** 10% of indexer P&L

**Trigger:** Alert when BOTH thresholds exceeded:
```sql
ABS(indexer_pnl - data_api_pnl) > 100
AND
ABS(indexer_pnl - data_api_pnl) / NULLIF(ABS(indexer_pnl), 0) > 0.10
```

**Severity Levels:**

| Delta | % Diff | Severity | Action |
|-------|--------|----------|--------|
| < $100 | Any | Acceptable | No action |
| $100-$1K | 10-25% | Low | Log only |
| $1K-$10K | 25-50% | Medium | Weekly review |
| > $10K | > 50% | High | Immediate investigation |

---

### Comparison Queries

**Query 1: Single Wallet Reconciliation**

```sql
-- Compare indexer vs Data API P&L for specific wallet
WITH indexer_pnl AS (
  SELECT
    wallet_address,
    total_realized_pnl_usd as indexer_pnl,
    distinct_markets as indexer_markets,
    total_positions as indexer_positions
  FROM pm_wallet_pnl_summary_indexer
  WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
),
data_api_pnl AS (
  SELECT
    wallet_address,
    SUM(pnl_net) as data_api_pnl,
    COUNT(DISTINCT condition_id) as data_api_markets,
    COUNT(DISTINCT market_slug) as data_api_market_count
  FROM pm_wallet_market_pnl_resolved
  WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
    AND source = 'external'  -- Only external trades
  GROUP BY wallet_address
)
SELECT
  COALESCE(i.wallet_address, d.wallet_address) as wallet,
  i.indexer_pnl,
  d.data_api_pnl,
  i.indexer_pnl - d.data_api_pnl as delta_pnl,
  ABS(i.indexer_pnl - d.data_api_pnl) / NULLIF(ABS(i.indexer_pnl), 0) * 100 as pct_diff,
  i.indexer_markets,
  d.data_api_markets,
  CASE
    WHEN ABS(i.indexer_pnl - d.data_api_pnl) < 100 THEN 'ACCEPTABLE'
    WHEN ABS(i.indexer_pnl - d.data_api_pnl) < 1000 THEN 'LOW'
    WHEN ABS(i.indexer_pnl - d.data_api_pnl) < 10000 THEN 'MEDIUM'
    ELSE 'HIGH'
  END as severity
FROM indexer_pnl i
FULL OUTER JOIN data_api_pnl d ON i.wallet_address = d.wallet_address;
```

**Query 2: Ghost Cohort Batch Reconciliation**

```sql
-- Compare indexer vs Data API P&L for all ghost wallets
WITH ghost_wallets AS (
  SELECT DISTINCT wallet_address
  FROM external_trades_raw
  WHERE wallet_address IN (
    SELECT wallet_address FROM global_ghost_ingestion_checkpoints
    WHERE status = 'completed'
  )
),
indexer_stats AS (
  SELECT
    wallet_address,
    total_realized_pnl_usd as indexer_pnl,
    distinct_markets as indexer_markets
  FROM pm_wallet_pnl_summary_indexer
  WHERE wallet_address IN (SELECT wallet_address FROM ghost_wallets)
),
data_api_stats AS (
  SELECT
    wallet_address,
    SUM(pnl_net) as data_api_pnl,
    COUNT(DISTINCT condition_id) as data_api_markets
  FROM pm_wallet_market_pnl_resolved
  WHERE wallet_address IN (SELECT wallet_address FROM ghost_wallets)
    AND source = 'external'
  GROUP BY wallet_address
)
SELECT
  COALESCE(i.wallet_address, d.wallet_address) as wallet,
  i.indexer_pnl,
  d.data_api_pnl,
  i.indexer_pnl - d.data_api_pnl as delta,
  ABS(i.indexer_pnl - d.data_api_pnl) / NULLIF(ABS(i.indexer_pnl), 0) * 100 as pct_diff,
  CASE
    WHEN ABS(i.indexer_pnl - d.data_api_pnl) > 100
     AND ABS(i.indexer_pnl - d.data_api_pnl) / NULLIF(ABS(i.indexer_pnl), 0) > 0.10
    THEN 'DISCREPANCY'
    ELSE 'OK'
  END as status
FROM indexer_stats i
FULL OUTER JOIN data_api_stats d ON i.wallet_address = d.wallet_address
ORDER BY ABS(i.indexer_pnl - d.data_api_pnl) DESC;
```

**Query 3: Market-Level Reconciliation**

```sql
-- Compare indexer vs Data API P&L for specific market
WITH indexer_market AS (
  SELECT
    wallet_address,
    SUM(realized_pnl) / 1e6 as indexer_pnl
  FROM pm_positions_indexer FINAL
  WHERE condition_id = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
  GROUP BY wallet_address
),
data_api_market AS (
  SELECT
    wallet_address,
    pnl_net as data_api_pnl
  FROM pm_wallet_market_pnl_resolved
  WHERE condition_id = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
    AND source = 'external'
)
SELECT
  i.wallet_address,
  i.indexer_pnl,
  d.data_api_pnl,
  i.indexer_pnl - d.data_api_pnl as delta
FROM indexer_market i
FULL OUTER JOIN data_api_market d ON i.wallet_address = d.wallet_address
WHERE ABS(i.indexer_pnl - d.data_api_pnl) > 10  -- Flag >$10 difference
ORDER BY ABS(i.indexer_pnl - d.data_api_pnl) DESC;
```

---

## Logging Format

### Discrepancy Log Table

```sql
CREATE TABLE reconciliation_discrepancies (
  check_id UUID DEFAULT generateUUIDv4(),
  check_timestamp DateTime64(3) DEFAULT now(),
  wallet_address String,
  condition_id Nullable(String),  -- NULL for wallet-level checks
  indexer_pnl Decimal64(6),
  data_api_pnl Decimal64(6),
  delta_pnl Decimal64(6),
  pct_diff Float64,
  severity Enum8('ACCEPTABLE'=0, 'LOW'=1, 'MEDIUM'=2, 'HIGH'=3),
  status Enum8('NEW'=0, 'INVESTIGATING'=1, 'RESOLVED'=2, 'EXPECTED'=3),
  notes Nullable(String),
  resolved_at Nullable(DateTime64(3))
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(check_timestamp)
ORDER BY (severity, check_timestamp);
```

### Log Entry Example

```sql
INSERT INTO reconciliation_discrepancies (
  wallet_address,
  condition_id,
  indexer_pnl,
  data_api_pnl,
  delta_pnl,
  pct_diff,
  severity,
  status,
  notes
) VALUES (
  'cce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  150.50,
  140.00,
  10.50,
  7.0,
  'ACCEPTABLE',
  'NEW',
  'Minor difference, likely due to timing of sync'
);
```

---

## Investigation Workflow

### Step 1: Detect Discrepancies

**Run daily reconciliation check:**

```bash
# Check ghost cohort
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --cohort ghost \
  --threshold-usd 100 \
  --threshold-pct 10
```

**Output:** List of wallets with discrepancies

---

### Step 2: Categorize Discrepancies

**Expected (No Action):**
- Timing differences (indexer synced 5 min after Data API)
- Small rounding errors (<$1)
- Position closed between syncs

**Unexpected (Investigate):**
- Large systematic bias (indexer always higher/lower)
- Missing markets in one source
- Opposite signs (profit vs loss)

---

### Step 3: Deep Dive Investigation

**For each flagged wallet:**

1. **Check fill counts:**
```sql
-- Compare number of fills
SELECT
  'indexer' as source,
  COUNT(*) as fills
FROM pm_positions_indexer FINAL
WHERE wallet_address = '0x...'
UNION ALL
SELECT
  'data_api' as source,
  COUNT(*) as fills
FROM external_trades_raw
WHERE wallet_address = '0x...';
```

2. **Check market overlap:**
```sql
-- Find markets in one source but not the other
SELECT condition_id, 'indexer_only' as flag
FROM pm_positions_indexer FINAL
WHERE wallet_address = '0x...'
  AND condition_id NOT IN (
    SELECT DISTINCT condition_id
    FROM external_trades_raw
    WHERE wallet_address = '0x...'
  )
UNION ALL
SELECT condition_id, 'data_api_only' as flag
FROM external_trades_raw
WHERE wallet_address = '0x...'
  AND condition_id NOT IN (
    SELECT DISTINCT condition_id
    FROM pm_positions_indexer FINAL
    WHERE wallet_address = '0x...'
  );
```

3. **Check position sizes:**
```sql
-- Compare position sizes for same market
SELECT
  i.condition_id,
  i.amount / 1e18 as indexer_shares,
  SUM(d.size) as data_api_shares,
  i.amount / 1e18 - SUM(d.size) as delta_shares
FROM pm_positions_indexer FINAL i
LEFT JOIN external_trades_raw d
  ON i.wallet_address = d.wallet_address
  AND i.condition_id = d.condition_id
WHERE i.wallet_address = '0x...'
GROUP BY i.condition_id, i.amount
HAVING ABS(delta_shares) > 0.01;  -- Flag >0.01 share difference
```

---

### Step 4: Document Findings

**Update reconciliation_discrepancies table:**

```sql
UPDATE reconciliation_discrepancies
SET
  status = 'RESOLVED',
  notes = 'Difference due to ghost market not yet in indexer',
  resolved_at = now()
WHERE check_id = '...';
```

---

### Step 5: Escalate if Systematic

**Escalate to supervisor if:**
- > 5% of ghost cohort shows discrepancies
- Consistent bias (indexer always +/- X%)
- Opposite P&L signs for same wallet
- Missing markets systematically

**Escalation Report Format:**

```markdown
## Reconciliation Escalation Report

**Date:** YYYY-MM-DD
**Affected Wallets:** X wallets
**Pattern:** [Brief description]

### Summary Stats
- Total discrepancies: X
- Average delta: $XXX
- Median pct diff: X%
- Severity breakdown: X high, X medium, X low

### Sample Cases
[Top 3 examples with wallet addresses and deltas]

### Hypothesis
[Root cause theory]

### Recommendation
[Proposed fix or further investigation steps]
```

---

## Known Expected Differences

### 1. Timing Lag

**Cause:** Indexer syncs every 5 minutes, Data API backfill may be hours/days old

**Expected Behavior:**
- Indexer shows newer positions
- Data API shows older snapshot
- Delta increases with time since last Data API backfill

**Mitigation:** Compare timestamps, accept differences if Data API is stale

---

### 2. Ghost Markets

**Cause:** Some markets never hit CLOB (direct on-chain transfers)

**Expected Behavior:**
- Data API has these markets (from chain events)
- Indexer may not have them (if subgraph doesn't index all transfers)

**Mitigation:** Flag as "ghost_market_gap", prioritize Data API for these

---

### 3. Decimal Precision

**Cause:** Different precision in indexer (18 decimals) vs Data API (variable)

**Expected Behavior:**
- Small rounding differences (<$0.01)

**Mitigation:** Use absolute threshold of $1 to ignore rounding

---

### 4. Settled vs Unsettled

**Cause:** Indexer may include unrealized P&L, Data API may be realized only

**Expected Behavior:**
- Indexer P&L >= Data API P&L (includes unrealized)

**Mitigation:** Compare `realized_pnl` field specifically, not total P&L

---

## Validation Test Cases

### Test Case 1: xcnstrategy Wallet

**Wallet:** `cce2b7c71f21e358b8e5e797e586cbc03160d58b`
**Known P&L (from previous session):** $6,894.99 (Data API)
**Markets:** 6 external markets, 46 trades

**Test:**
```bash
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b
```

**Expected Result:**
- Indexer P&L ≈ $6,895 (within $100)
- Markets: 6 (same as Data API)
- Severity: ACCEPTABLE

---

### Test Case 2: Top 5 Whales

**Cohort:** Top 5 by P&L from WHALE_LEADERBOARD.md
**Known Total P&L:** $1.89B

**Test:**
```bash
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --wallet-list whale_top5.txt
```

**Expected Result:**
- Total indexer P&L ≈ $1.89B (within 5%)
- Individual wallets: Most should be ACCEPTABLE
- Flag any HIGH severity cases

---

### Test Case 3: Random Sample (100 Wallets)

**Cohort:** Random 100 wallets from ghost cohort

**Test:**
```bash
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --cohort ghost \
  --sample 100
```

**Expected Result:**
- < 5 wallets with MEDIUM+ severity
- < 1 wallet with HIGH severity
- Mean delta < $50

---

## Reconciliation Script Specification

### Script: `scripts/reconcile-indexer-vs-data-api.ts`

**Purpose:** Automated reconciliation check

**Modes:**
1. Single wallet: `--wallet <ADDRESS>`
2. Wallet list: `--wallet-list <FILE>`
3. Cohort: `--cohort ghost|whale|all`
4. Random sample: `--cohort <X> --sample <N>`

**Thresholds:**
- `--threshold-usd <AMOUNT>` (default: 100)
- `--threshold-pct <PCT>` (default: 10)

**Output:**
- Console table with discrepancies
- Optional: `--save` writes to reconciliation_discrepancies table
- Optional: `--report` generates markdown report

**Example Usage:**

```bash
# Single wallet
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
  --save

# Ghost cohort
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --cohort ghost \
  --threshold-usd 100 \
  --threshold-pct 10 \
  --report reports/RECONCILIATION_$(date +%Y-%m-%d).md

# Random sample
npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --cohort ghost \
  --sample 100 \
  --save
```

---

## Monitoring and Alerts

### Daily Reconciliation Check

**Schedule:** Run daily at 2 AM PST

**Cron:**
```bash
0 2 * * * cd /app && npx tsx scripts/reconcile-indexer-vs-data-api.ts \
  --cohort ghost \
  --save \
  --report reports/daily/RECONCILIATION_$(date +\%Y-\%m-\%d).md
```

**Alert Conditions:**

| Condition | Threshold | Action |
|-----------|-----------|--------|
| HIGH severity count | > 5 wallets | Email supervisor |
| MEDIUM severity count | > 20 wallets | Slack notification |
| Mean delta | > $500 | Email supervisor |
| Systematic bias | > 80% same sign | Email supervisor |

---

## Success Criteria

**Reconciliation is considered successful if:**

- [ ] < 5% of ghost cohort shows MEDIUM+ severity discrepancies
- [ ] < 1% of ghost cohort shows HIGH severity discrepancies
- [ ] Mean delta < $100 across all wallets
- [ ] No systematic bias (50/50 split of positive/negative deltas)
- [ ] Known test wallets (xcnstrategy) within ACCEPTABLE threshold

---

## Future Enhancements

**If reconciliation reveals systematic issues:**

1. **Fill-level reconciliation** - Compare individual fills, not just aggregates
2. **Timestamp alignment** - Normalize both sources to same snapshot time
3. **Automated root cause detection** - ML to categorize discrepancy types
4. **Real-time alerts** - Slack/email when new HIGH severity case appears
5. **Hybrid P&L calculation** - Merge indexer + Data API for best accuracy

---

**Status:** Specification complete, ready for implementation after Phase A completion

**Dependencies:**
- Phase A.1: C2 completion (to have full ghost cohort in external_trades_raw)
- Phase B.5: Indexer backfill (to have data in pm_positions_indexer)

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
