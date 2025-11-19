# Daily Table Swap Monitoring Guide

**Purpose**: Track table health and detect drift in trades_with_direction table
**Duration**: Run once daily for this week (Nov 10-17, 2025)
**Created**: November 10, 2025

---

## Quick Start

**Run the monitor once per day:**

```bash
./run-daily-monitor.sh
```

**Expected runtime**: 3-5 seconds

---

## What It Monitors

### 1. Row Count Drift
- Tracks active table (`trades_with_direction`) row count daily
- Compares to yesterday's snapshot
- **Alert threshold**: >0.1% change in row count

### 2. Quality Drift
- Tracks % of valid condition IDs (64-char hex, no 0x prefix)
- Compares to yesterday's baseline
- **Alert threshold**: >0.01% change in quality

### 3. Table Comparison
- Compares active vs backup table sizes
- Static comparison (drift between tables, not over time)

---

## Output Files

### `table-swap-monitor-log.json`
Daily snapshots of table health (keeps last 30 days):

```json
[
  {
    "date": "2025-11-11",
    "active_rows": 95354665,
    "backup_rows": 82138586,
    "drift_pct": 16.09,
    "quality_valid_pct": 100.00,
    "quality_issues": 0
  }
]
```

### `table-swap-mutations-YYYY-MM-DD.json` (only on drift)
Captured when drift detected, contains system.mutations output:

```json
[
  {
    "database": "default",
    "table": "trades_with_direction",
    "mutation_id": "0000000123",
    "command": "ALTER TABLE ... UPDATE ...",
    "create_time": "2025-11-11 00:00:00",
    "is_done": 1,
    "latest_fail_reason": ""
  }
]
```

---

## Example Outputs

### ✅ Normal Day (No Drift)

```
=== DAILY TABLE SWAP MONITOR ===
Date: 2025-11-11

--- TABLE STATUS ---
  Active:  95,354,665 rows
  Backup:  82,138,586 rows
  Drift:   +16.09%

--- QUALITY ---
  Valid:   95,354,665 / 95,354,665 (100.00%)
  Issues:  0

--- DRIFT DETECTION ---
  Yesterday: 95,354,665 rows (100.00% valid)
  Today:     95,354,665 rows (100.00% valid)
  Row drift: +0.0000%
  Quality drift: +0.0000%

✅ ALL STABLE - No drift detected
```

### ⚠️ Drift Detected

```
=== DAILY TABLE SWAP MONITOR ===
Date: 2025-11-12

--- TABLE STATUS ---
  Active:  95,450,000 rows
  Backup:  82,138,586 rows
  Drift:   +16.20%

--- QUALITY ---
  Valid:   95,449,500 / 95,450,000 (99.99%)
  Issues:  500

--- DRIFT DETECTION ---
  Yesterday: 95,354,665 rows (100.00% valid)
  Today:     95,450,000 rows (99.99% valid)
  Row drift: +0.1000%    ⚠️
  Quality drift: -0.0100% ⚠️

⚠️  ROW DRIFT DETECTED: +0.1000% change from yesterday
⚠️  QUALITY DRIFT DETECTED: -0.0100% change from yesterday

=== CAPTURING MUTATIONS (Drift Detected) ===

  Found 2 mutations:

  1. trades_with_direction - mutation_0000000123
     Command: ALTER TABLE default.trades_with_direction UPDATE condition_id_norm...
     Created: 2025-11-12 00:00:00
     Status: DONE ✅

  Mutations saved to: ./table-swap-mutations-2025-11-12.json

❌ DRIFT DETECTED - Review mutations output above
```

---

## Response Actions

### If Exit Code = 0 (Stable)
✅ No action needed - table is healthy

### If Exit Code = 1 (Drift Detected)
❌ **Action Required**:

1. **Review drift percentage**:
   - Row drift >0.1%: Investigate if new data was loaded or deleted
   - Quality drift >0.01%: Check for data corruption or normalization issues

2. **Check mutations file**:
   - Open `table-swap-mutations-YYYY-MM-DD.json`
   - Look for ALTER UPDATE commands or data modifications
   - Check `is_done` status (0 = in progress, 1 = complete)
   - Review `latest_fail_reason` for errors

3. **Investigate root cause**:
   - Were any ETL scripts run?
   - Did anyone manually modify the table?
   - Are there background mutations still running?

4. **Respond quickly**:
   - If intentional change: Document in session notes
   - If unexpected: Halt further changes, investigate
   - If data loss: Consider restoring from backup table

---

## Manual Commands

### Check current table state (without running full monitor):

```bash
npx tsx monitor-table-swap.ts
```

### View mutation history directly:

```sql
SELECT *
FROM system.mutations
WHERE database = 'default'
  AND table LIKE 'trades_with_direction%'
ORDER BY create_time DESC
LIMIT 10;
```

### Compare active vs backup:

```sql
SELECT
  'active' as table_type,
  count() as rows
FROM default.trades_with_direction

UNION ALL

SELECT
  'backup' as table_type,
  count() as rows
FROM default.trades_with_direction_backup;
```

---

## Baseline Established

**Date**: November 10, 2025, 4:35 PM PST

**Baseline Snapshot**:
```
Active rows:    95,354,665
Backup rows:    82,138,586
Quality:        100.00% valid
Issues:         0
```

This is the starting point. All future drift calculations compare to the previous day's snapshot.

---

## Schedule

**Week of Nov 10-17, 2025**:
- [x] **Nov 10** - Baseline established ✅
- [ ] **Nov 11** - Run monitor
- [ ] **Nov 12** - Run monitor
- [ ] **Nov 13** - Run monitor
- [ ] **Nov 14** - Run monitor
- [ ] **Nov 15** - Run monitor
- [ ] **Nov 16** - Run monitor
- [ ] **Nov 17** - Run monitor + Review week

**After Nov 17**: Decide if weekly monitoring is sufficient or if issues require continued daily checks.

---

## Files Reference

| File | Purpose |
|------|---------|
| `run-daily-monitor.sh` | Shell wrapper - run this daily |
| `monitor-table-swap-daily.ts` | Core monitoring logic |
| `monitor-table-swap.ts` | One-time check (no drift tracking) |
| `table-swap-monitor-log.json` | Historical snapshots (auto-generated) |
| `table-swap-mutations-*.json` | Mutation captures (only on drift) |

---

## Troubleshooting

### Monitor won't run
```bash
# Ensure script is executable
chmod +x run-daily-monitor.sh

# Or run TypeScript directly
npx tsx monitor-table-swap-daily.ts
```

### Missing log file
First run establishes baseline - this is normal. File created automatically.

### False positive drift
If row count changes intentionally (e.g., data load), drift is expected. Document the change and continue monitoring.

---

**Created**: November 10, 2025
**Owner**: Claude 1 (Infrastructure)
**Status**: Active monitoring (Week 1)
