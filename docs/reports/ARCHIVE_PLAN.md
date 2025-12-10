# Reports Archive Plan

> **Status:** ACTIONABLE | **Created:** 2025-12-09

This document specifies which reports should be archived and which are current.

---

## GUARD CLAUSE (READ FIRST)

**Before archiving ANY object:**

1. **Check `lib/pnl/dataSourceConstants.ts`** - Do not archive any table exported there
2. **Check V12 engine files** - Grep for the object name in `lib/pnl/`
3. **Check active scripts** - Grep for the object name in `scripts/pnl/`
4. **Check PnL system docs** - Grep for the object name in `docs/systems/pnl/`

**Currently protected objects:**
- `pm_unified_ledger_v8_tbl` (CANONICAL - Full ledger)
- `pm_unified_ledger_v9_clob_tbl` (CANONICAL - V1 Leaderboard)
- `pm_trader_events_v2` (CANONICAL)
- `pm_token_to_condition_map_v5` (CANONICAL)
- `pm_condition_resolutions` (CANONICAL)
- `pm_market_metadata` (SUPPORTING)
- `pm_ui_pnl_benchmarks_v2` (SUPPORTING)

**Rule:** If an object is referenced in `lib/pnl/*.ts`, it is NOT safe to archive.

---

## Safety Check Script

**Before ANY move, run this grep-based safety check:**

```bash
# Replace OBJECT_NAME with the table/view name you want to archive
OBJECT_NAME="pm_unified_ledger_v8_tbl"

echo "=== Checking references for: $OBJECT_NAME ==="

echo -e "\n1. lib/pnl/ references:"
grep -r "$OBJECT_NAME" lib/pnl/ 2>/dev/null || echo "  (none)"

echo -e "\n2. scripts/pnl/ references:"
grep -r "$OBJECT_NAME" scripts/pnl/ 2>/dev/null || echo "  (none)"

echo -e "\n3. docs/systems/pnl/ references:"
grep -r "$OBJECT_NAME" docs/systems/pnl/ 2>/dev/null || echo "  (none)"

echo -e "\n4. dataSourceConstants.ts references:"
grep "$OBJECT_NAME" lib/pnl/dataSourceConstants.ts 2>/dev/null || echo "  (none)"
```

**If ANY references are found, DO NOT archive that object.**

---

## Do Not Archive Yet

The following files are referenced by active code or docs and must NOT be archived:

| File/Object | Referenced By |
|-------------|--------------|
| `pm_unified_ledger_v8_tbl` | `lib/pnl/dataSourceConstants.ts`, V12 engine |
| `pm_unified_ledger_v9_clob_tbl` | `lib/pnl/dataSourceConstants.ts`, V1 Leaderboard |
| `pm_trader_events_v2` | `lib/pnl/dataSourceConstants.ts`, dedup helpers |
| `pm_token_to_condition_map_v5` | `lib/pnl/dataSourceConstants.ts` |
| `pm_condition_resolutions` | `lib/pnl/dataSourceConstants.ts` |
| Any `scripts/pnl/*.ts` file | Active validation harnesses |
| `TIER_A_COMPARABLE_SPEC.md` | Authoritative V1 spec |
| `PNL_VOCABULARY_V1.md` | Authoritative definitions |
| `PERSISTED_OBJECTS_MANIFEST.md` | Authoritative inventory |
| `PRODUCT_SURFACE_CANONICALS.md` | Authoritative routing |

---

## Folder Structure

```
docs/reports/
├── current/           # Active, relevant reports
├── archive/
│   └── 2025-Q4-pre-V12/  # Pre-V12 era reports
└── ARCHIVE_PLAN.md    # This file
```

---

## Reports to Keep in Current

These reports are actively referenced or contain current system state:

| File | Reason |
|------|--------|
| `GAP_WALLET_DEEP_DIVE_2025_12_09.md` | Current V12 investigation |
| `V12_50_WALLET_VALIDATION_FINAL_2025_12_09.md` | Current V12 validation |
| `V12_TOOLTIP_VALIDATION_2025_12_09.md` | Current V12 validation |
| `V12_TRIPLE_BENCHMARK_2025_12_09.md` | Current V12 benchmark |
| `REALIZED_PNL_LARGE_SCALE_STATUS_2025_12_09.md` | Current status |
| `REALIZED_PNL_V12_RECONCILIATION_2025_12_09.md` | Current reconciliation |
| `LEADERBOARD_VALIDATION_PLAN_2025_12_07.md` | Active plan |
| `PNL_TAXONOMY.md` | Reference taxonomy |
| `FAST_PNL_VALIDATION_RUNBOOK.md` | Active runbook |

---

## Reports to Archive (Pre-V12 Era)

### November 2025 Reports (Archive to `2025-Q4-pre-V12/`)

These are from the Nov 10-11 cleanup era, before V12 was established:

| File | Reason |
|------|--------|
| `BENCHMARK_VALIDATION_FINDINGS.md` | Pre-V12 benchmark |
| `CRITICAL_DATA_QUALITY_FINDINGS.md` | Addressed |
| `CRITICAL_FINDINGS_EXECUTIVE_SUMMARY.txt` | Superseded |
| `DATA_SOURCE_ROLES_EXPLAINED.md` | Superseded by vocabulary doc |
| `GROUND_TRUTH_AUDIT_REPORT.json` | Old audit |
| `GROUND_TRUTH_FINDINGS_SUMMARY.txt` | Old findings |
| `GROUND_TRUTH_REPORT.json` | Old report |
| `GROUND_TRUTH_VISUAL_SUMMARY.txt` | Old summary |
| `MAPPING_TABLE_GAP_ANALYSIS.md` | Addressed |
| `TODAY_NOV_11_CLEANUP_NARRATIVE.md` | Historical |
| `TOKEN_MAPPING_INVESTIGATION_FINDINGS.md` | Addressed |
| `WEEK_OF_NOV_4-11_NARRATIVE.md` | Historical narrative |
| `data_inventory_2025-11-11.md` | Old inventory |
| `enrichment_execution_log.json` | Old log |
| `token-mapping-investigation-report.md` | Addressed |
| `wallet-benchmark-delta.md` | Old benchmark |
| `wallet-spotcheck-2025-11-11.md` | Old spotcheck |

### Old Engine Version Reports (Archive to `2025-Q4-pre-V12/`)

Reports for engines that are no longer canonical:

| File | Reason |
|------|--------|
| `V20_PNL_BENCHMARK_HANDOFF.md` | Old engine |
| `V23B_MARK_TO_MARKET_BENCHMARK_REPORT.md` | Old engine |
| `V23C_UI_ORACLE_BENCHMARK_REPORT.md` | Old engine |
| `V23C_V29_COHORT_SUMMARY_2025_12_06.md` | Old comparison |
| `V23C_VS_V29_MIXED_SAMPLE_2025_12_06.md` | Old comparison |
| `V23C_VS_V29_TRADER_STRICT_FAST_2025_12_06.md` | Old comparison |
| `V23_FORENSIC_DIAGNOSTIC_REPORT.md` | Old engine |
| `V27_INVENTORY_ENGINE_BENCHMARK_REPORT.md` | Old engine |
| `V27b_INVENTORY_ENGINE_BENCHMARK_REPORT.md` | Old engine |
| `V28_CONDITION_LEVEL_BENCHMARK_REPORT.md` | Old engine |
| `V29_*.md` (all V29 reports) | Superseded by V12 |
| `V11_*.md` (all V11 reports) | Superseded by V12 |

### Old Validation Reports (Archive to `2025-Q4-pre-V12/`)

| File | Reason |
|------|--------|
| `CLOB_ONLY_VALIDATION_2025_12_07.md` | Pre-V12 |
| `COVERAGE_GAP_ROOT_CAUSE_2025_12_07.md` | Addressed |
| `DEDUPE_VALIDATION_RESULTS_2025_12_08.md` | Addressed |
| `DOME_COVERAGE_GATING_2025_12_07.md` | Pre-V12 |
| `DOME_REALIZED_TRUTH_LOCK_2025_12_07.md` | Pre-V12 |
| `DUAL_BENCHMARK_PRELIMINARY_2025_12_07.md` | Superseded |
| `ENGINE_ACCURACY_INVESTIGATION_2025_12_07.md` | Superseded |
| `ENGINE_DUAL_BENCHMARK_SCORECARD_2025_12_07.md` | Superseded |
| `EXTERNAL_REPO_SILVER_BULLETS_2025_12_06.md` | Reference only |
| `FRESH_20_WALLET_VALIDATION_2025_12_07.md` | Superseded |
| `GOLDSKY_SIMPLE_HANDOFF.md` | Historical |
| `GOLDSKY_TECHNICAL_REPORT.md` | Historical |
| `HARNESS_SANITY_REPORT_2025_12_06.md` | Superseded |
| `HEAD_TO_HEAD_V23C_V29_2025_12_06.md` | Old comparison |
| `INVESTIGATOR_PROOF_2025_12_05.md` | Historical |
| `LIVE_TRUTH_INTEGRATION_2025_12_06.md` | Historical |
| `PIPELINE_INTEGRITY_STATUS_2025_12_07.md` | Superseded |
| `PM_TRADER_EVENTS_DEDUP_AUDIT_2025_12_06.md` | Addressed |
| `PNL_DISCREPANCY_RESEARCH_2025_12_06.md` | Addressed |
| `PNL_FAST_LOOP_STATUS_2025_12_06.md` | Superseded |
| `PNL_GAP_ANALYSIS_2025-12-04.md` | Superseded |
| `PNL_TESTING_INFRASTRUCTURE_HARDENING_2025_12_06.md` | Historical |
| `POLYMARKET_SUBGRAPH_PNL_ANALYSIS.md` | Reference only |
| `PURE_TRADER_FILTER_REPORT_2025_12_05.md` | Historical |
| `STRATEGY_BUILDER_DATA_V1.md` | Keep (different domain) |
| `TERMINAL_1_HANDOFF_2025_12_07.md` | Historical |
| `TERMINAL_1_HANDOFF_V12_CTF_2025_12_09.md` | Keep (recent) |
| `TRUTH_OPS_COMPLETE_2025_12_07.md` | Historical |
| `UI_BENCHMARK_V2_PROGRESS_2025_12_07.md` | Historical |
| `UI_MIMIC_DATASET_MAPPING_2025_12_07.md` | Reference |
| `UI_PARITY_COPY_TRADE_READY_V1.md` | Reference |
| `UI_PARITY_SILVER_BULLET_2025_12_07.md` | Historical |
| `UI_SNAPSHOT_AUDIT_*.md` | Historical |
| `UI_TRUTH_V2_LIVE_SNAPSHOT_READY_2025_12_07.md` | Historical |
| `UNIFIED_LEDGER_V8_HEALTH_2025_12_06.md` | Addressed |
| `UNIFIED_SCORECARD_2025_12_07.md` | Superseded |
| `unified_scorecard.md` | Duplicate |

---

## PnL System Docs to Archive

In `docs/systems/pnl/`, archive these superseded docs:

| File | Reason |
|------|--------|
| `V3_PNL_ENGINE_ACCURACY_REPORT.md` | Old engine |
| `V4_ACCURACY_IMPROVEMENT_PLAN.md` | Old plan |
| `V4_PNL_ENGINE_ACCURACY_REPORT.md` | Old engine |
| `V5_PNL_ENGINE_ACCURACY_REPORT.md` | Old engine |
| `V6_PNL_ENGINE_ACCURACY_REPORT.md` | Old engine |
| `V6_PNL_ENGINE_IMPLEMENTATION_PLAN.md` | Old plan |
| `V7_REALIZATION_MODE_GUIDE.md` | Superseded |
| `V17_UI_PARITY_INVESTIGATION.md` | Superseded |
| `V17_UI_PARITY_PHASE3_ATTRIBUTION.md` | Superseded |
| `V29_*.md` (all V29 docs) | Superseded by V12 |
| `ENGINE_STATUS_2025_12_04.md` | Old status |
| `ENGINE_V23C_FINAL_REPORT.md` | Old engine |
| `PNL_ENGINE_V12_INVESTIGATION.md` | Superseded by ARCHITECTURE |
| `PNL_ROOT_CAUSE_INVESTIGATION_2025-11-29.md` | Addressed |
| `PNL_RESEARCH_FINDINGS_2025-12-03.md` | Historical |
| `PNL_ACCURACY_IMPROVEMENT_PLAN.md` | Superseded |
| `PNL_ACCURACY_PLANNER_AGENT_PROMPT.md` | Historical |
| `PNL_ACCURACY_RESEARCH_PLAN.md` | Superseded |
| `PHASE2_COVERAGE_AUDIT_RESULTS.md` | Addressed |
| `ROOT_CAUSE_FIX_PLAN.md` | Addressed |
| `UI_PARITY_ROADMAP.md` | Superseded |
| `UI_PNL_EST_ANALYSIS.md` | Superseded |
| `V12_ACCURACY_REPORT.md` | Superseded by ARCHITECTURE |

---

## Execution Commands

Run these to move files to archive:

```bash
# Create archive folders
mkdir -p docs/reports/archive/2025-Q4-pre-V12
mkdir -p docs/systems/pnl/archive

# Move November reports
mv docs/reports/BENCHMARK_VALIDATION_FINDINGS.md docs/reports/archive/2025-Q4-pre-V12/
mv docs/reports/CRITICAL_DATA_QUALITY_FINDINGS.md docs/reports/archive/2025-Q4-pre-V12/
mv docs/reports/CRITICAL_FINDINGS_EXECUTIVE_SUMMARY.txt docs/reports/archive/2025-Q4-pre-V12/
# ... (continue for all files listed above)
```

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Current reports | ~10 | Keep in `docs/reports/` |
| Pre-V12 reports | ~80 | Move to `archive/2025-Q4-pre-V12/` |
| PnL system docs | ~20 | Move to `docs/systems/pnl/archive/` |

**After archival:** Reports folder will be clean with only active V12-era documents.
