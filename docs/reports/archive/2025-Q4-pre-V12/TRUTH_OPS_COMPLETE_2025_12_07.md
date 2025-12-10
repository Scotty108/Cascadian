# Terminal 1 Truth Ops - COMPLETE

**Date:** 2025-12-07
**Terminal:** Claude 1
**Mission:** Build clean, verified UI truth set in ClickHouse
**Status:** ✅ ALL OBJECTIVES ACHIEVED

---

## Mission Summary

Successfully completed full truth pipeline:
1. ✅ Captured fresh UI PnL snapshot (50 wallets)
2. ✅ Loaded into `pm_ui_pnl_benchmarks_v2` ClickHouse table
3. ✅ Verified data integrity
4. ✅ Generated audit report

---

## Deliverables

### 1. UI PnL Snapshot
**File:** `tmp/ui_pnl_live_snapshot_2025_12_07.json`

**Stats:**
- Total wallets: 50
- Successful: 42 (84%)
- Nonexistent: 8 (16% - anon profiles)
- Errors: 0 (0%)

**Quality:** 100% success rate on existing profiles

---

### 2. ClickHouse Truth Table
**Table:** `pm_ui_pnl_benchmarks_v2`
**Benchmark Set:** `trader_strict_v2_2025_12_07`

**Schema:**
```sql
CREATE TABLE pm_ui_pnl_benchmarks_v2 (
  wallet_address String,
  benchmark_set String,
  ui_pnl_value Nullable(Float64),
  captured_at DateTime64(3),
  source String,
  status String,  -- 'success', 'nonexistent', 'error'
  error_message Nullable(String),
  raw_text Nullable(String)
)
ENGINE = ReplacingMergeTree(captured_at)
ORDER BY (wallet_address, benchmark_set)
```

**Data Loaded:**
- 42 success records (with PnL values)
- 8 nonexistent records (flagged, excluded from validation)
- Top 3 wallets by PnL:
  1. `0x7724f6f8023f40bc9ad3e4496449f5924fa56deb` - $170,000
  2. `0x17b4aa863bf1add299f3ece1a54a9bf19cf44d48` - $98,000
  3. `0x688beacb04b6b329f38e5da04c212e5c3d594fe1` - $95,000

---

### 3. Audit Report
**File:** `docs/reports/UI_SNAPSHOT_AUDIT_2025_12_07.md`

**Findings:**
- ✅ 42 OK wallets (84%) - ready for validation
- ⚠️  8 nonexistent wallets (16%) - properly excluded
- ❌ 0 errors (0%) - clean fetch
- 🔍 0 outliers (0%) - all PnL values reasonable

**Recommendation:** Use 42 OK wallets as primary truth set for V29 validation

---

## Tools Created

### 1. `scripts/pnl/upsert-ui-pnl-benchmarks-v2.ts`
**Purpose:** Load UI snapshots into ClickHouse truth table

**Usage:**
```bash
npx tsx scripts/pnl/upsert-ui-pnl-benchmarks-v2.ts \
  --snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json \
  --benchmark-set=trader_strict_v2_2025_12_07
```

**Features:**
- Creates table if not exists
- Upserts with ReplacingMergeTree (automatic deduplication)
- Preserves metadata (captured_at, source, status, error)

---

### 2. `scripts/pnl/audit-ui-snapshot.ts`
**Purpose:** Generate quality audit reports for UI snapshots

**Usage:**
```bash
npx tsx scripts/pnl/audit-ui-snapshot.ts \
  --snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json \
  --output=docs/reports/UI_SNAPSHOT_AUDIT_2025_12_07.md
```

**Output:**
- Summary statistics (OK/nonexistent/error/outlier counts)
- Top wallets by PnL
- Nonexistent wallet list (for exclusion)
- Error wallet list (for retry)
- Outlier wallet list (for manual verification)
- Recommendations for next steps

---

### 3. `scripts/pnl/verify-benchmarks-v2.ts`
**Purpose:** Quick verification of ClickHouse benchmark table contents

**Usage:**
```bash
npx tsx scripts/pnl/verify-benchmarks-v2.ts
```

**Output:**
- Status breakdown (success/nonexistent counts)
- PnL data coverage
- Top wallets sample

---

## Usage for Terminal 2

### Query OK Wallets
```sql
SELECT
  wallet_address,
  ui_pnl_value,
  captured_at
FROM pm_ui_pnl_benchmarks_v2
WHERE benchmark_set = 'trader_strict_v2_2025_12_07'
  AND status = 'success'
ORDER BY ui_pnl_value DESC
```

### Exclude Nonexistent Wallets
```sql
SELECT wallet_address
FROM pm_ui_pnl_benchmarks_v2
WHERE benchmark_set = 'trader_strict_v2_2025_12_07'
  AND status = 'nonexistent'
```

### Join for Validation
```typescript
// TypeScript example for V29 validation
const benchmarkResult = await client.query({
  query: `
    SELECT
      b.wallet_address,
      b.ui_pnl_value as ui_truth,
      v29.realized_pnl as cascadian_realized
    FROM pm_ui_pnl_benchmarks_v2 b
    INNER JOIN vw_wallet_pnl_v29 v29
      ON lower(b.wallet_address) = lower(v29.wallet)
    WHERE b.benchmark_set = 'trader_strict_v2_2025_12_07'
      AND b.status = 'success'
  `,
  format: 'JSONEachRow',
});
```

---

## Truth Hierarchy (Updated)

For Terminal 2 validation workflows:

1. **Primary Truth:** `pm_ui_pnl_benchmarks_v2` (status='success')
   - 42 wallets
   - Live UI data captured 2025-12-07
   - Verified and audited

2. **Secondary Truth:** Dome API (coverage-aware)
   - See `tmp/dome_truth_map_2025_12_07_fresh.json`
   - Filter by `dome_confidence !== 'none'`
   - 23 reliable wallets (57.5% coverage)

3. **Validation Target:** V29 Engine
   - Test against primary/secondary truth
   - Identify discrepancies
   - Measure accuracy

---

## Key Findings

### Success Metrics
- ✅ 100% fetch success rate on existing profiles
- ✅ 0 errors during scraping
- ✅ Perfect nonexistent detection (8/8 flagged correctly)
- ✅ All data loaded to ClickHouse successfully

### Data Quality
- 42 wallets with valid PnL data
- PnL range: $-28,806.50 to $170,000
- No extreme outliers detected (|PnL| > $500k threshold)
- Clean dataset ready for validation

### Coverage
- 84% coverage of TRADER_STRICT v2 cohort
- 16% nonexistent (expected - anon profiles with no activity)
- Nonexistent wallets properly excluded from validation set

---

## Next Steps for Terminal 2

### Recommended Validation Workflow

1. **Load Truth from ClickHouse**
   ```sql
   SELECT * FROM pm_ui_pnl_benchmarks_v2
   WHERE benchmark_set = 'trader_strict_v2_2025_12_07'
     AND status = 'success'
   ```

2. **Run V29 Validation**
   - Compare V29 realized PnL vs UI truth
   - Calculate error metrics (MAE, RMSE, correlation)
   - Identify wallets with >10% divergence

3. **Cross-Check with Dome** (optional)
   - Use Dome truth map for triangulation
   - Only for wallets with `dome_confidence='high'`

4. **Generate Validation Report**
   - Overall accuracy metrics
   - Per-wallet error analysis
   - Categorize discrepancies (rounding, data gaps, formula differences)

---

## Files Ready

```bash
# Truth sources
tmp/ui_pnl_live_snapshot_2025_12_07.json              # Raw snapshot
tmp/dome_truth_map_2025_12_07_fresh.json              # Dome truth (supplementary)

# ClickHouse table
pm_ui_pnl_benchmarks_v2                               # Main truth table
  └─ benchmark_set: trader_strict_v2_2025_12_07       # 42 success + 8 nonexistent

# Documentation
docs/reports/UI_SNAPSHOT_AUDIT_2025_12_07.md          # Audit report
docs/reports/TRUTH_OPS_COMPLETE_2025_12_07.md         # This file
docs/reports/TERMINAL_1_HANDOFF_2025_12_07.md         # Previous handoff (Dome work)

# Tools
scripts/pnl/upsert-ui-pnl-benchmarks-v2.ts            # Snapshot loader
scripts/pnl/audit-ui-snapshot.ts                      # Audit generator
scripts/pnl/verify-benchmarks-v2.ts                   # Quick verifier
scripts/pnl/fetch-polymarket-profile-pnl.ts           # Snapshot fetcher (hardened)
```

---

## Truth Table Governance

### Benchmark Set Naming Convention
Format: `{cohort}_{version}_{date}`

Examples:
- `trader_strict_v2_2025_12_07` (current)
- `smart_money_v1_2025_12_08` (future)
- `high_volume_v1_2025_12_10` (future)

### Age Gating
Use `captured_at` column to filter stale data:

```sql
-- Only use truth captured in last 7 days
SELECT * FROM pm_ui_pnl_benchmarks_v2
WHERE captured_at > now() - INTERVAL 7 DAY
  AND status = 'success'
```

### Re-capture Policy
- Recapture UI truth every 7 days for active validation
- Keep historical benchmark sets for regression testing
- Archive sets older than 30 days

---

## Terminal 1 Sign-Off

**Mission Status:** ✅ COMPLETE
**Quality Gate:** ✅ PASSED
**Data Integrity:** ✅ VERIFIED
**Documentation:** ✅ COMPLETE

**Ready For:** Terminal 2 (V29 Validation)

---

**Generated:** 2025-12-07T01:45 UTC
**Terminal:** Claude 1
**Operator:** Truth Ops Pipeline
**Next Terminal:** Claude 2 (Validation Engine)
