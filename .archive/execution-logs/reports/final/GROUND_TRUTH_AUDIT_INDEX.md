# GROUND TRUTH AUDIT - COMPLETE REPORT INDEX

**Execution Date:** November 10, 2025  
**Status:** Data Collection Complete (Facts Only)  
**Database:** ClickHouse (default)

---

## Report Files

### Primary Report
- **File:** `/Users/scotty/Projects/Cascadian-app/GROUND_TRUTH_AUDIT_REPORT.md`
- **Format:** Markdown (structured)
- **Length:** 346 lines
- **Content:** Complete detailed audit with all findings, facts, and data consistency issues
- **Audience:** Technical teams, data engineers

### Quick Reference
- **File:** `/Users/scotty/Projects/Cascadian-app/GROUND_TRUTH_FINDINGS_SUMMARY.txt`
- **Format:** Plain text (executive summary)
- **Length:** 160 lines
- **Content:** Key findings, critical inconsistencies, pending investigations
- **Audience:** Managers, quick reference

---

## Key Metrics at a Glance

| Metric | Value | Status |
|--------|-------|--------|
| ERC-1155 Total Rows | 13,378,076 | Concentrated in recent blocks |
| ERC-1155 Block Coverage | 37.5M-78.3M | Hard cliff at 35M (zero before) |
| trades_raw Row Count | 80,109,651 | Down from documented 159.5M |
| vw_trades_canonical Count | 157,541,131 | LARGER than source (impossible) |
| direction_assignments Count | 129,599,951 | LARGER than input (impossible) |
| trades_with_direction Count | 82,138,586 | NET GAIN of 2M rows |
| fact_trades_clean Count | 63,541,461 | Found (not missing) |
| Test Wallet ERC-1155 Matches | 0 | Zero blockchain matches |
| Test Wallet CLOB Trades | 38 | June-Sept 2024 activity |

---

## Critical Findings

### FACT 1: ERC-1155 Data Cliff at Block 35M
- **Evidence:** 100% of blocks 0-35M are empty (0 rows)
- **Implication:** All historical trades before block 35M cannot be blockchain-enriched
- **Impact:** Unknown percentage of historical data unreachable

### FACT 2: Test Wallet Isolation
- **Evidence:** 38 CLOB trades + 0 ERC-1155 transfers
- **Problem:** Trades occur during backfill window but have no blockchain match
- **Possible Causes:** Address encoding, incomplete backfill, or on-chain settlement mismatch

### FACT 3: Impossible Row Count Pattern
- **Issue 1:** vw_trades_canonical (157.5M) > trades_raw (80.1M)
- **Issue 2:** direction_assignments (129.6M) > trades_raw (80.1M)
- **Issue 3:** Final output (82.1M) > initial input (80.1M) [should be lossy]
- **Implication:** Tables have inconsistent source data or were measured at different times

### FACT 4: Documentation vs Reality Mismatch
- **Documentation claims:** 159.5M rows in trades_raw
- **Current measurement:** 80.1M rows
- **Delta:** -79.4M rows (-49.8%)
- **Implication:** Either trades_raw was truncated/rebuilt or docs are stale

### FACT 5: Schema Inconsistency
- **Issue:** trades_with_direction table has no `direction` column
- **Evidence:** Query `WHERE direction IS NULL` fails with "column not found"
- **Implication:** Column exists in trades_raw but not in downstream table

---

## Data by Section

### STEP 2: ERC-1155 Coverage
- ERC-1155 hard cliff at block 35M (zero data before)
- 99.66% concentration in blocks 40M-80M
- Only 13.3M total rows (small relative to trade volume)

**Read:** Section "STEP 2: ERC-1155 COVERAGE ANALYSIS" in GROUND_TRUTH_AUDIT_REPORT.md

### STEP 3: Test Wallet Coverage
- Wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad
- ERC-1155: 0 matches
- CLOB: 38 trades (June-Sept 2024)

**Read:** Section "STEP 3: TEST WALLET COVERAGE" in GROUND_TRUTH_AUDIT_REPORT.md

### STEP 4: Canonical Table Health
- trades_raw: 80.1M
- vw_trades_canonical: 157.5M (IMPOSSIBLE if view)
- direction_assignments: 129.6M (IMPOSSIBLE if derived from trades_raw)
- trades_with_direction: 82.1M
- fact_trades_clean: 63.5M (EXISTS, contrary to docs)

**Read:** Section "STEP 4: CANONICAL TABLE HEALTH" in GROUND_TRUTH_AUDIT_REPORT.md

### STEP 5: Direction Pipeline Audit
- Direction pipeline shows impossible row gains
- Net result is +2.53% instead of expected loss
- Missing direction column in output table

**Read:** Section "STEP 5: DIRECTION PIPELINE AUDIT" in GROUND_TRUTH_AUDIT_REPORT.md

---

## Data Consistency Issues

| Issue | Details | Severity |
|-------|---------|----------|
| Row count mismatch | 159.5M docs vs 80.1M actual | HIGH |
| View larger than source | vw_trades_canonical > trades_raw | CRITICAL |
| Impossible gains | +49.6M then -47.5M = +2.5M net | CRITICAL |
| Missing column | direction column not in trades_with_direction | HIGH |
| Wallet isolation | 0 blockchain matches despite activity | HIGH |
| Documentation stale | Multiple tables/counts differ | MEDIUM |

---

## What This Report Contains

- Facts gathered from direct ClickHouse queries
- Row counts for all major tables
- ERC-1155 block range analysis
- Test wallet coverage assessment
- Data consistency issues
- Schema inconsistencies
- Queries that failed and why

## What This Report Does NOT Contain

- Recommendations for fixes
- Root cause analysis
- Blame assignment
- Solution strategies
- Backfill procedures
- Rebuild plans

---

## Next Steps for Investigation

### Fact-Gathering Queries (No Action)

These queries will provide additional facts without changing data:

1. **Schema verification:**
   ```sql
   SELECT * FROM system.tables WHERE name IN ('trades_raw', 'vw_trades_canonical', 'trade_direction_assignments', 'trades_with_direction')
   ```

2. **View definition check:**
   ```sql
   SELECT * FROM system.views WHERE name = 'vw_trades_canonical'
   ```

3. **Distinct wallet count:**
   ```sql
   SELECT count(DISTINCT wallet) FROM default.trades_raw
   SELECT count(DISTINCT wallet) FROM default.trade_direction_assignments
   SELECT count(DISTINCT wallet) FROM default.trades_with_direction
   ```

4. **Test wallet address formats:**
   ```sql
   SELECT DISTINCT wallet FROM default.trades_raw WHERE wallet LIKE '%4ce73141%'
   ```

5. **Current Polygon block height:**
   ```
   Check external source (Polygonscan, RPC endpoint)
   ```

---

## Report Navigation

| Question | Answer Location |
|----------|-----------------|
| "What's the ERC-1155 coverage?" | STEP 2 section |
| "Can we enrich the test wallet?" | STEP 3 section |
| "Are the tables consistent?" | STEP 4 section |
| "What's wrong with the pipeline?" | STEP 5 section |
| "What are the data issues?" | DATA CONSISTENCY ISSUES section |
| "What needs investigation?" | Next Steps section |
| "What's the one-sentence summary?" | Critical Findings (FAQs) |

---

## Document Versions

| File | Purpose | Last Updated |
|------|---------|--------------|
| GROUND_TRUTH_AUDIT_REPORT.md | Full technical report | 2025-11-10 |
| GROUND_TRUTH_FINDINGS_SUMMARY.txt | Quick reference | 2025-11-10 |
| GROUND_TRUTH_AUDIT_INDEX.md | This document | 2025-11-10 |

---

## Execution Details

- **Data Collection Method:** Direct ClickHouse queries via @clickhouse/client
- **Query Language:** SQL
- **Database:** default (ClickHouse instance)
- **Execution Time:** ~5 minutes (streaming queries)
- **Confidence Level:** 100% for facts, 0% for interpretations

---

**Generated:** 2025-11-10T15:05:00Z  
**Status:** Ready for Review  
**Distribution:** Technical teams, data engineers, project leads

