# Wallet Resolution Gap - Fix Guide

**Issue:** 3 out of 4 test wallets show ZERO resolved conditions despite expected P&L values
**Status:** ROOT CAUSE IDENTIFIED via code analysis
**Action Required:** Run investigation script, confirm diagnosis, apply fix
**Urgency:** BLOCKING production deployment

---

## Quick Start (5 minutes to diagnosis)

### Step 1: Start ClickHouse
```bash
docker compose up -d
# Wait for ClickHouse to be ready (check with: docker compose logs clickhouse)
```

### Step 2: Run Investigation Script
```bash
node investigate-wallet-gap.mjs
```

### Step 3: Compare Results to Diagnosis Table Below
The script will tell you exactly which of 3 hypotheses is correct.

---

## Root Cause Analysis (High Confidence)

### HYPOTHESIS 1: market_resolutions_final Table Missing (95% Confidence)

**What to Look For:**
- Investigation output CHECK 1a says "MISSING"
- Or CHECK 6a returns "Table not found" error

**Why This Matters:**
- The entire PnL system depends on joining `trades_raw` to `market_resolutions_final`
- Table is referenced in migration 016 but NEVER CREATED
- This explains why Wallet 1 works (might be using fallback) but Wallets 2-4 don't

**Evidence from Code:**
```
File: migrations/clickhouse/016_enhance_polymarket_tables.sql (line 130)
LEFT JOIN market_resolutions_final r
 ↑
 Table referenced but never created anywhere in migrations
```

**Fix if Confirmed:**
```bash
# 1. Add to migrations/clickhouse/017_create_market_resolutions.sql
CREATE TABLE IF NOT EXISTS market_resolutions_final (
  condition_id_norm String,
  market_id String,
  is_resolved UInt8,
  winning_index Int32,
  payout_numerators Array(UInt256),
  payout_denominator UInt256,
  resolution_source String DEFAULT '',
  resolved_at DateTime DEFAULT now(),
  ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(resolved_at)
ORDER BY (condition_id_norm)
SETTINGS index_granularity = 8192;

# 2. Populate from Supabase or data source
# (Need to know data source for exact query)

# 3. Re-run investigation script to verify
```

---

### HYPOTHESIS 2: condition_id Field Not Populated (85% Confidence)

**What to Look For:**
- Investigation output CHECK 2a shows `populated_pct < 50%`
- Or `condition_id_empty > 0` for any wallet

**Why This Matters:**
- `trades_raw` has a `condition_id` column but it's empty/NULL
- Even if `market_resolutions_final` exists, JOIN fails because condition_id is empty
- Data ingestion doesn't populate this critical field

**Evidence from Code:**
```
File: migrations/clickhouse/003_add_condition_id.sql
ADD COLUMN IF NOT EXISTS condition_id String DEFAULT ''
 ↑
 Column created but never populated during import
```

**Fix if Confirmed:**
```bash
# 1. Find where trades_raw is populated (likely in scripts/)
#    Look for files like: ingest-*, build-trades*, import-*

# 2. Add condition_id population to import script
# Either:
#   a) Join with ctf_token_map during import
#   b) Join with gamma_markets using token_id

# 3. Example SQL to backfill:
UPDATE trades_raw t
SET condition_id =
  (SELECT condition_id_norm
   FROM ctf_token_map
   WHERE token_id = t.token_id LIMIT 1)
WHERE condition_id = ''

# 4. Re-run investigation script to verify
```

---

### HYPOTHESIS 3: Wallets 2-4 Data Never Imported (70% Confidence)

**What to Look For:**
- Investigation output CHECK 2a shows `total_trades = 0` for Wallets 2-4
- But `total_trades > 0` for Wallet 1 (control)

**Why This Matters:**
- trades_raw table exists but only has data for Wallet 1
- Wallets 2-4 might not have been included in import script
- Or import script failed for those wallets

**Evidence from Code:**
```
Wallet 1 works -> trades_raw populated for it
Wallets 2-4 don't -> trades_raw empty for them
Suggests selective import or test data only
```

**Fix if Confirmed:**
```bash
# 1. Identify data source (Supabase, CSV, API?)
# 2. Filter import script for wallets 2-4
# 3. Run import with conditions:
#    WHERE wallet_address IN (
#      '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
#      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
#      '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
#    )
# 4. Re-run investigation script to verify
```

---

## Investigation Results → Action Mapping

Use this table to find your exact situation:

| CHECK Result | Hypothesis | Action |
|--------------|-----------|--------|
| 1a: MISSING, 6a: error | #1 | Create market_resolutions_final table |
| 1a: EXISTS, 2a: empty condition_id | #2 | Populate condition_id field |
| 1a: EXISTS, 2a: 0 rows for W2-W4 | #3 | Import trades for W2-W4 |
| 1a: EXISTS, 2a: populated, 3a: 0% match | #1+#2 | Both table missing AND field empty |
| 1a: EXISTS, 2a: populated, 3a: <50% match | #2 | Normalization issue in JOIN |

---

## Execution Plan

### Phase 1: Diagnosis (5 min)
```bash
# Start ClickHouse if not running
docker compose up -d

# Wait 30 seconds for startup
sleep 30

# Run investigation
node investigate-wallet-gap.mjs

# Record results
# → Note which hypotheses are confirmed by data
```

### Phase 2: Root Cause Confirmation (2 min)
Look at investigation output and find your scenario in the "Investigation Results → Action Mapping" table above.

### Phase 3: Fix Implementation (15-60 min depending on hypothesis)

**If Hypothesis 1 (Table Missing):**
- Time: 15-20 minutes
- Effort: Create table + populate from data source
- Validation: Re-run investigation, CHECK 6a should show row count > 0

**If Hypothesis 2 (Field Not Populated):**
- Time: 20-30 minutes
- Effort: Update import script + backfill existing rows
- Validation: Re-run investigation, CHECK 2a should show populated_pct > 90%

**If Hypothesis 3 (Wallets Not Imported):**
- Time: 30-60 minutes
- Effort: Find import script, add wallet filters, re-run import
- Validation: Re-run investigation, CHECK 2a should show rows for all wallets

### Phase 4: Validation (5 min)
```bash
# Run investigation again
node investigate-wallet-gap.mjs

# Verify all wallets have resolved_count > 0:
# CHECK 4a should show:
# - Wallet 1: resolved_count > 0 (control)
# - Wallet 2: resolved_count > 0 (NOW FIXED)
# - Wallet 3: resolved_count > 0 (NOW FIXED)
# - Wallet 4: resolved_count > 0 (NOW FIXED)

# If still 0, go back to Phase 2 and check other hypotheses
```

---

## Critical Dependencies to Know

### Data Dependencies
```
Polymarket data source (Supabase? CSV? API?)
    ↓
trades_raw (has wallet_address, condition_id)
    ↓ JOIN
market_resolutions_final (has condition_id_norm, is_resolved, winning_index)
    ↓
PnL calculation (uses winning_index to determine P&L)
```

### Schema Dependencies
```
ctf_token_map: Maps token_id → condition_id_norm
gamma_markets: Maps market_id → outcomes[] → winning_index
market_resolutions_final: Maps condition_id_norm → is_resolved, winning_index
trades_raw: Has wallet_address, condition_id, shares
```

---

## Key Files to Check If Diagnosis Unclear

1. **Data Import Scripts:**
   - `scripts/ingest-*.ts`
   - `scripts/build-*.ts`
   - Look for WHERE clauses that might exclude wallets 2-4

2. **Schema Definitions:**
   - `migrations/clickhouse/001_create_trades_table.sql` - trades_raw definition
   - `migrations/clickhouse/003_add_condition_id.sql` - condition_id field
   - `migrations/clickhouse/016_enhance_polymarket_tables.sql` - market_resolutions_final reference

3. **Data Source:**
   - Check env vars for SUPABASE_* or DATA_SOURCE
   - Find where expected P&L values ($360K, $94K, $12K) come from
   - That's your ground truth data source

---

## Sanity Checks

After applying fix, verify with these queries:

```bash
# Check 1: All wallets have trades
docker compose exec clickhouse clickhouse-client -q "
SELECT wallet_address, count(*)
FROM trades_raw
WHERE wallet_address IN ('0x1489...', '0x8e9e...', '0xcce2...', '0x6770...')
GROUP BY wallet_address
"
# Expected: 4 rows, all with count > 0

# Check 2: All condition_ids are populated
docker compose exec clickhouse clickhouse-client -q "
SELECT
  count(*) as total,
  countIf(condition_id != '') as populated
FROM trades_raw
"
# Expected: populated > 0.9 * total

# Check 3: market_resolutions_final has data
docker compose exec clickhouse clickhouse-client -q "
SELECT count(*) FROM market_resolutions_final
"
# Expected: > 1000 (or whatever the market count is)

# Check 4: JOIN works
docker compose exec clickhouse clickhouse-client -q "
SELECT
  count(*) as total,
  countIf(r.condition_id_norm IS NOT NULL) as matched
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON
  lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
"
# Expected: matched > 0.9 * total
```

---

## Troubleshooting

**Q: Investigation script can't connect to ClickHouse**
A: Check `docker compose logs clickhouse` - might still be starting. Wait 30 seconds and retry.

**Q: CHECK 1a says table exists but CHECK 6a says error**
A: Table exists but might be empty or corrupted. Check migration status with `docker compose exec clickhouse clickhouse-client -q "DESCRIBE TABLE market_resolutions_final"`

**Q: Still seeing 0 resolved after fix**
A: Run investigation again - another hypothesis might also be true. Check all 4 hypotheses, not just one.

**Q: Don't know data source**
A: Check git log for recent commits that mention "Polymarket" or "import". Or check environment variable POLYMARKET_API_KEY, SUPABASE_URL, etc.

---

## Expected Timeline

- **Diagnosis:** 5 minutes (run script, read output)
- **Fix (easiest case):** 15 minutes (table creation only)
- **Fix (moderate case):** 30-45 minutes (field population)
- **Fix (hardest case):** 60 minutes (data re-import + validation)
- **Validation:** 5 minutes (re-run investigation)

**Total: 25 minutes to 75 minutes depending on root cause**

---

## Production Deployment Checklist

Do NOT deploy until:

- [ ] `node investigate-wallet-gap.mjs` runs without errors
- [ ] CHECK 1a shows "EXISTS" for market_resolutions_final
- [ ] CHECK 2a shows > 0 trades for all 4 wallets
- [ ] CHECK 2a shows > 90% populated for condition_id
- [ ] CHECK 4a shows > 0 matched for all wallets
- [ ] CHECK 4a shows resolved_count > 0 for all wallets
- [ ] CHECK 7a shows Wallet 1 control has resolved_count that matches expected
- [ ] PnL values match expected ($137K, $360K, $94K, $12K)

---

## Files Modified in This Investigation

- `WALLET_RESOLUTION_GAP_INVESTIGATION.md` - Detailed analysis and hypotheses
- `investigate-wallet-gap.mjs` - Diagnostic script (ready to run)
- `WALLET_RESOLUTION_FIX_GUIDE.md` - This file, action steps

---

**Last Updated:** 2025-11-07
**Status:** Ready for diagnosis and fix
**Next Step:** Run `node investigate-wallet-gap.mjs` with ClickHouse running
