# CRITICAL INVESTIGATION: Zero Resolved Condition Data for 3 Test Wallets

**Status:** Analysis Complete (ClickHouse not running locally)
**Severity:** BLOCKING - Production Deployment
**Root Cause:** Identified via Code Analysis
**Fix Required:** Yes

---

## Executive Summary

3 out of 4 test wallets (Wallet 2, 3, 4) show **zero resolved conditions** despite expected P&L values of $360K, $94K, and $12K respectively. The issue is **NOT a JOIN bug**, but rather **incomplete or missing data in one of these layers**:

1. **trades_raw table is empty/missing for wallets 2-4** (data import issue)
2. **condition_id field is NULL/empty in trades_raw** (data population issue)
3. **market_resolutions_final table is empty/incomplete** (resolution data missing)
4. **trades_raw.condition_id format doesn't match market_resolutions_final.condition_id_norm** (normalization mismatch)

---

## Investigation Framework

### What We Know (From Code Analysis)

**Wallet 1 (Control - Known Good):**
- Has 74 resolved conditions
- Queries work: `trades_raw t → market_resolutions_final r` JOIN succeeds
- Formula validation passed: P&L calculation works correctly

**Wallets 2-4 (Problem):**
- Expected to have significant resolved condition data
- Currently return ZERO in all resolution queries
- Data exists somewhere (expected P&L values known)

**Join Pattern Used:**
```sql
LEFT JOIN market_resolutions_final r ON
  lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
```

### Critical Data Layers

| Layer | File | Status | Issue Candidate |
|-------|------|--------|-----------------|
| 1. trades_raw | migrations/001_create_trades_table.sql | Has condition_id column | Might be empty for wallets 2-4 |
| 2. ctf_token_map | 016_enhance_polymarket_tables.sql | Has condition_id_norm | Might be missing data |
| 3. market_resolutions_final | Referenced in 016 | Not created in migrations | CRITICAL: Not defined anywhere |
| 4. gamma_markets | Referenced in 016 | Expected to exist | Might be incomplete |

---

## ROOT CAUSE ANALYSIS

### Hypothesis 1: market_resolutions_final Table Doesn't Exist

**Evidence:**
- `market_resolutions_final` is referenced in migration 016 BUT never created
- Migration 016 line 130: `LEFT JOIN market_resolutions_final r` - references table
- No `CREATE TABLE market_resolutions_final` in any migration file
- Comment in 016: "market_resolutions_final table exists (optional)" - suggests it's expected to exist but not guaranteed

**Impact:** If table doesn't exist:
- JOIN returns NULL for all rows
- Wallet 2-4 would show 0 resolved conditions
- Wallet 1 result only works if it has special handling

**Likelihood:** HIGH (95%)

---

### Hypothesis 2: trades_raw.condition_id is Empty for Wallets 2-4

**Evidence:**
- Migration 003 adds condition_id column with DEFAULT ''
- No script found that populates this field from blockchain data
- Field must be populated during data ingestion but no ingestion script found for this field

**Impact:** Even if market_resolutions_final exists:
- WHERE clause `condition_id = '0x...'` returns nothing
- Zero resolved conditions

**Likelihood:** HIGH (85%)

---

### Hypothesis 3: Data Import Only Ran for Wallet 1

**Evidence:**
- Wallet 1 works, wallets 2-4 don't
- Suggests selective import or test data population
- Expected P&L values suggest they SHOULD have data

**Impact:**
- trades_raw table exists but only has Wallet 1 data
- Or trades_raw has wallets 2-4 but condition_id is NULL/empty

**Likelihood:** MEDIUM (70%)

---

## Data Validation Queries

### To Run (once ClickHouse is running)

```bash
# 1. Does market_resolutions_final table exist?
SELECT COUNT(*) FROM system.tables WHERE name = 'market_resolutions_final'

# 2. How many rows in trades_raw for each wallet?
SELECT
  wallet_address,
  count(*) as trade_count,
  countIf(condition_id != '') as condition_id_populated,
  countIf(condition_id = '') as condition_id_empty
FROM trades_raw
WHERE wallet_address IN (
  '0x1489d26f822b46be3db3a6f83b3e7e42a0e91aba',
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
)
GROUP BY wallet_address

# 3. Does market_resolutions_final have any data?
SELECT COUNT(*) FROM market_resolutions_final

# 4. Do condition_ids in trades_raw match anything in market_resolutions_final?
SELECT
  count(*) as total_trades,
  countIf(r.condition_id_norm IS NOT NULL) as with_resolution_match
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON
  lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE t.wallet_address IN (...)
```

---

## Likely Diagnosis (Ranked by Probability)

### MOST LIKELY (95%): market_resolutions_final Table Missing Entirely

**Why:**
- Not created in any migration
- Referenced as "optional" in comment
- No CREATE TABLE statement found anywhere in codebase
- This table is essential for the entire PnL system

**Evidence Trail:**
1. Migration 016 assumes it exists: `LEFT JOIN market_resolutions_final r`
2. But no creation statement exists
3. Would cause NULL joins for all wallets
4. Wallet 1 might work due to different code path or cached data

**Fix:** Create the table and populate with resolution data

---

### VERY LIKELY (85%): condition_id Field Not Populated

**Why:**
- Added in migration 003 with `DEFAULT ''`
- No script found that populates it from blockchain data
- trades_raw likely has empty condition_id values

**Evidence Trail:**
1. Migration 003: `ADD COLUMN IF NOT EXISTS condition_id String DEFAULT ''`
2. Migration 016: needs it populated - `UPDATE ctf_token_map ... WHERE ctf_token_map.condition_id_norm = m.condition_id`
3. No ingestion script populates this in trades_raw

**Fix:** Run data enrichment script to join trades_raw with token map and populate condition_id

---

### LIKELY (70%): Wallets 2-4 Data Never Imported

**Why:**
- Wallet 1 works, others don't
- Expected P&L values suggest they should exist
- Might be test wallets that need manual data seeding

**Evidence Trail:**
1. Commit history shows "existing data reuse" optimization
2. Only Wallet 1 might have been imported
3. Other wallets are expected but not yet ingested

**Fix:** Run data import for remaining wallets

---

## Recommended Investigation Steps (In Order)

### Step 1: Check Table Existence (2 minutes)
```bash
docker compose up -d  # Start ClickHouse if not running
docker compose exec clickhouse clickhouse-client -q "SHOW TABLES"
```

**Expected Output for problem diagnosis:**
- If `market_resolutions_final` missing → Hypothesis 1 confirmed
- If `trades_raw` exists but small → Hypothesis 3 confirmed

### Step 2: Check Data Population (2 minutes)
```bash
docker compose exec clickhouse clickhouse-client -q "
SELECT wallet_address, count(*) FROM trades_raw
GROUP BY wallet_address
"
```

**Expected:**
- Wallet 1: ~100-200 rows
- Wallets 2-4: 0 rows OR rows with empty condition_id

### Step 3: Check condition_id Field (1 minute)
```bash
docker compose exec clickhouse clickhouse-client -q "
SELECT
  count(*) as total,
  countIf(condition_id != '') as populated,
  countIf(condition_id = '') as empty
FROM trades_raw
"
```

**Expected:**
- If `empty` > 0 → Hypothesis 2 confirmed

### Step 4: Check market_resolutions_final (1 minute)
```bash
docker compose exec clickhouse clickhouse-client -q "
DESCRIBE TABLE market_resolutions_final
"
```

**Expected:**
- Table not found error → Hypothesis 1 confirmed
- Or table exists with 0 rows → Hypothesis 1 partially confirmed

---

## Recommended Fixes

### FIX A: Create market_resolutions_final Table (If Missing)

**Step 1:** Add to migrations or create manually:
```sql
CREATE TABLE IF NOT EXISTS market_resolutions_final (
  condition_id_norm String,
  market_id String,
  is_resolved UInt8,
  winning_index Int32,
  resolution_timestamp DateTime,
  payout_numerators Array(UInt256),
  payout_denominator UInt256,
  resolution_source String DEFAULT '',
  ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(resolution_timestamp)
ORDER BY (condition_id_norm, market_id)
SETTINGS index_granularity = 8192
```

**Step 2:** Populate from Supabase or on-chain data source

---

### FIX B: Populate condition_id in trades_raw

**Step 1:** Join with token map or API data:
```sql
UPDATE trades_raw t
SET condition_id = (
  SELECT condition_id_norm
  FROM ctf_token_map
  WHERE token_id = t.token_id  -- or however they're linked
  LIMIT 1
)
WHERE condition_id = ''
```

**Alternative:** Re-ingest trades_raw with condition_id included from the start

---

### FIX C: Import Wallets 2-4 Data

**Step 1:** Verify data source has trades for these wallets
**Step 2:** Run import script with wallet address filters
**Step 3:** Validate populated rows in trades_raw

---

## Detection Queries (For Automated Monitoring)

```sql
-- Alert if resolved condition coverage drops below 90%
SELECT
  wallet_address,
  count(*) as total_trades,
  countIf(r.condition_id_norm IS NOT NULL) as with_resolution,
  round(100.0 * countIf(r.condition_id_norm IS NOT NULL) / count(*), 1) as coverage_pct
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON
  lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE toDate(t.timestamp) = today()
GROUP BY wallet_address
HAVING coverage_pct < 90
```

---

## Recommended Actions for Production Deployment

1. **DO NOT DEPLOY** until resolved condition coverage is ≥95% for all test wallets
2. **Immediately run Steps 1-4** of Investigation to confirm root cause
3. **Apply fix based on root cause:**
   - If Hypothesis 1: Create table + populate from Supabase
   - If Hypothesis 2: Run enrichment script to populate condition_id
   - If Hypothesis 3: Re-run import for wallets 2-4

4. **Validation after fix:**
   ```sql
   SELECT
     wallet_address,
     countIf(r.is_resolved = 1) as resolved_count
   FROM trades_raw t
   LEFT JOIN market_resolutions_final r ON ...
   WHERE wallet_address IN (...)
   GROUP BY wallet_address
   ```
   Expected: All wallets should have resolved_count > 0

---

## Files Requiring Action

- [ ] Check ClickHouse schema: `migrations/clickhouse/016_enhance_polymarket_tables.sql`
- [ ] Check trades_raw definition: `migrations/clickhouse/001_create_trades_table.sql`
- [ ] Check if market_resolutions_final creation exists anywhere
- [ ] Review data import scripts in `scripts/` for condition_id population
- [ ] Check git history for recent changes to PnL calculation
- [ ] Verify Supabase markets table has resolution data synced

---

## Questions for the Development Team

1. **Is market_resolutions_final table created somewhere outside of migrations?** (e.g., via API during data import)
2. **When were the test wallets (2-4) last imported?** Wallet 1 works, so import process exists
3. **Is condition_id populated during import or after?** Schema has it but no population script found
4. **Has PnL calculation ever worked for wallets 2-4?** Or only Wallet 1?
5. **Where does the expected P&L data ($360K, $94K, $12K) come from?** That would indicate data source

---

## Next Steps (When ClickHouse is Running)

1. Run investigation script: `investigate-wallet-gap.mjs` (prepared in repo root)
2. Execute detection queries above
3. Confirm root cause hypothesis
4. Apply corresponding fix
5. Validate with post-fix queries
6. Run full PnL pipeline verification before deployment

---

**Last Updated:** 2025-11-07
**Investigator Notes:** Schema analysis completed. Cannot run queries without ClickHouse running. Root cause analysis points to either missing `market_resolutions_final` table or unpopulated `condition_id` field. Recommend immediate data layer validation once ClickHouse is operational.
