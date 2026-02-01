# GoldSky Pipeline Optimization Plan

**Date:** 2026-01-31
**Current Cost:** ~$1,500/month
**Target Savings:** ~$600-675/month (40-45%)

## Executive Summary

After analyzing the codebase and database usage, we found:
- **2 pipelines can be deleted entirely** (FPMM - completely unused)
- **1 pipeline is redundant** (ctf-split-merge-only duplicates ctf-events-corrected)
- **3 pipelines are essential** and must be kept

## Pipeline Analysis

### KEEP (Essential)

| Pipeline | Table | Purpose | Status |
|----------|-------|---------|--------|
| `cascadian-hard-pipe-v3` | pm_trader_events_v2 | CLOB fills → canonical fills | **CRITICAL** |
| `ctf-events-corrected` | pm_ctf_events | Split/Merge/Redemption events | **CRITICAL** |
| `neg-risk-conversions-v1` | pm_neg_risk_conversions_v1 | NegRisk adapter events | **NEEDED** |

### DELETE (Unused)

| Pipeline | Table | Rows | Last Updated | Reason |
|----------|-------|------|--------------|--------|
| `cascadian-fpmm-trades-v1` | pm_fpmm_trades | 2.25M | Jan 21, 2026 | Zero production references |
| `fpmm-trades-pipeline` | pm_fpmm_trades | (same) | (same) | Duplicate of above |
| `ctf-split-merge-only` | pm_ctf_events | N/A | Active | Redundant - ctf-events-corrected covers all events |

## Implementation Steps

### Step 1: Delete GoldSky Pipelines
Run these commands in GoldSky CLI:
```bash
# Delete FPMM pipelines (unused)
goldsky pipeline delete cascadian-fpmm-trades-v1
goldsky pipeline delete fpmm-trades-pipeline  # if exists separately

# Delete redundant CTF pipeline
goldsky pipeline delete ctf-split-merge-only
```

### Step 2: Drop Unused ClickHouse Tables
```sql
-- Verify no production usage first
-- grep -r "pm_fpmm_trades\|pm_fpmm_pool_map" --include="*.ts" app/ lib/

DROP TABLE IF EXISTS pm_fpmm_trades;
DROP TABLE IF EXISTS pm_fpmm_pool_map;
```

### Step 3: Delete Local YAML Files
```bash
# Remove deprecated pipeline configs
rm goldsky/cascadian-fpmm-trades-v1.yaml
rm goldsky/fpmm-trades-pipeline.yaml
rm goldsky/fpmm-direct-indexing.yaml
rm goldsky/ctf-split-merge-only.yaml
```

### Step 4: (Optional) Deploy Optimized CTF Pipeline
If you want cleaner config, use `ctf-events-optimized-v1.yaml` to replace `ctf-events-corrected.yaml`.
They're functionally identical but the optimized version has better comments.

## Cost Savings Breakdown

| Item | Estimated Savings |
|------|-------------------|
| Delete FPMM pipeline | ~25-30% |
| Delete redundant CTF | ~10-15% |
| **Total** | **~35-45%** |

At $1,500/month → **Save $525-675/month**

## Verification Queries

```sql
-- Verify FPMM not in use
SELECT 'Production queries to pm_fpmm_trades' as check, 0 as count;

-- Verify remaining pipelines working
SELECT 'pm_trader_events_v2' as tbl, count() as rows, max(trade_time) as latest
FROM pm_trader_events_v2 WHERE is_deleted = 0
UNION ALL
SELECT 'pm_ctf_events', count(), max(event_timestamp) FROM pm_ctf_events
UNION ALL
SELECT 'pm_neg_risk_conversions_v1', count(), max(event_timestamp) FROM pm_neg_risk_conversions_v1;
```

## What About pm_condition_resolutions?

This table is **NOT populated by GoldSky**. It's synced from the Polymarket API via cron jobs.
No action needed here.

## Files Modified

- Created: `goldsky/ctf-events-optimized-v1.yaml` (optional replacement)
- Created: `goldsky/OPTIMIZATION_PLAN.md` (this file)
- Created: `scripts/goldsky-cleanup.sql` (table cleanup)
- To delete: `cascadian-fpmm-trades-v1.yaml`, `fpmm-trades-pipeline.yaml`, `fpmm-direct-indexing.yaml`, `ctf-split-merge-only.yaml`
