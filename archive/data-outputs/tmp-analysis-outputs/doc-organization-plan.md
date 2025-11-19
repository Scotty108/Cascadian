# Repository Documentation Organization Plan
**Generated**: 2025-11-10
**Agent**: Repository Cleanup (Inventory Mode - No Deletions)

---

## Executive Summary

**Current State**: 866 markdown files across 6 organizational systems with significant duplication and scattered root directory.

**Scale of the Problem**:
- **564 files** in root directory (should be ~10-15)
- **5 competing organizational systems** layered on top of each other
- **~200+ duplicate/similar documents** on same topics
- **10.51 MB** of documentation (mixture of canonical + investigation debris)

**Key Finding**: The repository has excellent content in `docs/` (163 files, well-organized) but the root directory became a dumping ground for investigation outputs, creating severe navigation problems.

---

## Current Inventory Breakdown

### By Location
| Location | Files | Status | Action Needed |
|----------|-------|--------|---------------|
| **root** | 564 | 🚨 CHAOS | Triage, move, archive |
| **docs/** | 163 | ✅ GOOD | Minor cleanup, establish as primary |
| **.agent-os/** (hidden) | 101 | ⚠️ FROZEN | Archive to docs/archive/ |
| **agent-os/** (visible) | 24 | ⚠️ DUPLICATE | Review for unique content, likely delete |
| **runtime/** | 10 | ⚠️ TEMP | Keep recent logs only |
| **scripts/** | 4 | ✅ OK | Minimal cleanup |

### By Suggested State
| State | Files | Definition |
|-------|-------|-----------|
| **WIP** | 472 | Investigation/analysis files needing review |
| **Historical** | 255 | Superseded, point-in-time, or archived content |
| **Canonical** | 139 | Current reference documentation to keep |

### By Topic (Top 10 with duplicates)
| Topic | Files | Notes |
|-------|-------|-------|
| General | 506 | Catch-all category |
| PNL | 83 | 🔁 High duplication |
| Database | 51 | 🔁 High duplication |
| Resolution | 45 | 🔁 High duplication |
| API | 38 | 🔁 High duplication |
| Backfill | 33 | 🔁 High duplication |
| Coverage | 19 | 🔁 Moderate duplication |
| Wallet | 17 | 🔁 Moderate duplication |
| Trading | 16 | 🔁 Moderate duplication |
| Market | 13 | 🔁 Moderate duplication |

---

## Major Documentation Clusters

### 1. Root Directory (564 files - HIGHEST PRIORITY)

**Pattern Analysis**:
- Investigation/Analysis: ~150 files
- Status/Reports/Summaries: ~200 files
- "Final"/"Complete" markers: ~80 files
- Guides/References: ~50 files
- Misc: ~84 files

**Top Topics in Root**:
- General: 337 files
- PNL: 50 files
- Database: 30 files
- Backfill: 20 files
- Resolution: 19 files
- API: 17 files

**Notable High-Value Files** (Keep, but move to docs/):
- `ARCHITECTURE_OVERVIEW.md` → docs/architecture/
- `OPERATIONAL_GUIDE.md` → docs/operations/
- `PIPELINE_QUICK_START.md` → docs/systems/data-pipeline/
- `POLYMARKET_QUICK_START.md` → docs/systems/polymarket/
- `CASCADIAN_DATABASE_MASTER_REFERENCE.md` → docs/systems/database/

**Files to Keep in Root**:
- `README.md` ✅
- `CLAUDE.md` ✅
- `CHANGELOG.md` ✅
- `LICENSE.md` ✅

### 2. docs/ Directory (163 files - BASELINE GOOD)

**Current Structure** (Already well-organized):
```
docs/
├── systems/          # Technical subsystems
│   ├── database/
│   ├── data-pipeline/
│   ├── polymarket/
│   ├── goldsky/
│   └── authentication/
├── features/         # Feature documentation
│   ├── strategy-builder/
│   ├── smart-money-signals/
│   ├── wallet-analytics/
│   └── copy-trading/
├── operations/       # Runbooks, deployment
│   ├── runbooks/
│   ├── troubleshooting/
│   └── deployment/
├── archive/          # Historical material
│   ├── session-reports/
│   ├── completed-features/
│   └── historical-status/
└── Root docs         # 20 high-level docs
```

**Status**: ✅ This structure is EXCELLENT and should be the single source of truth.

**Action**: Minor cleanup only, establish as canonical structure.

### 3. .agent-os/ (Hidden, 101 files - FROZEN Oct 27)

**Content**:
- Product specs and architecture (Oct 23-27)
- Feature specifications (AI copilot, strategy builder)
- Agent OS workflow documentation
- Historical completion reports

**Status**: Frozen - no updates since Oct 27, 2025

**Recommendation**: Archive entire directory to `docs/archive/agent-os-oct-2025/` with README explaining historical context.

### 4. agent-os/ (Visible, 24 files - ABANDONED Oct 28)

**Content**:
- One spec folder (backend-setup)
- Config files
- Standards documentation

**Status**: Minimal content, likely duplicate of .agent-os/

**Recommendation**: Review for any unique content not in .agent-os/, then archive to docs/archive/agent-os-visible-oct-2025/.

### 5. runtime/ (10 files - TEMP LOGS)

**Content**: Agent runtime logs, status files

**Recommendation**: Keep last 7 days only, already in .gitignore.

---

## Duplicate Topic Analysis

### Topics with Highest Duplication (15+ files each)

#### PNL (83 files)
**Locations**: Root (50), docs (20), agent-os (13)
**Pattern**: Multiple investigation phases, "final" reports, executive summaries
**Recommendation**: Consolidate to 2-3 canonical docs in `docs/systems/pnl/`
- Keep: Latest architecture doc, calculation guide, troubleshooting
- Archive: Investigation reports with dates → docs/archive/investigations/pnl/
- Archive: Duplicate "final" reports → docs/archive/duplicates/pnl/

#### Database (51 files)
**Locations**: Root (30), docs (15), agent-os (6)
**Pattern**: Schema guides, audit reports, architecture docs
**Recommendation**: Consolidate to `docs/systems/database/`
- Keep: Schema reference, architecture overview
- Archive: Audit reports (dated) → docs/archive/investigations/database/
- Archive: Duplicate schema snapshots → docs/archive/duplicates/database/

#### Resolution (45 files)
**Locations**: Root (19), docs (18), agent-os (8)
**Pattern**: Coverage analysis, API integration, investigation reports
**Recommendation**: Consolidate to `docs/systems/resolution/`
- Keep: API integration guide, coverage metrics
- Archive: Investigation reports → docs/archive/investigations/resolution/
- Archive: Multiple "final" analyses → docs/archive/duplicates/resolution/

#### API/Polymarket (38 files)
**Locations**: Root (17), docs (15), agent-os (6)
**Pattern**: API discovery, endpoint documentation, integration guides
**Recommendation**: Consolidate to `docs/systems/polymarket/`
- Keep: API reference, quick start guide
- Archive: Discovery reports → docs/archive/investigations/api/
- Archive: Multiple endpoint lists → docs/archive/duplicates/api/

#### Backfill (33 files)
**Locations**: Root (20), docs (8), agent-os (5)
**Pattern**: Investigation reports, recovery guides, execution plans
**Recommendation**: Consolidate to `docs/operations/runbooks/`
- Keep: Backfill runbook, troubleshooting guide
- Archive: Investigation reports with dates → docs/archive/investigations/backfill/
- Archive: Multiple recovery plans → docs/archive/duplicates/backfill/

---

## Similar Filename Groups (Likely Exact Duplicates)

**High-priority consolidation targets** (3+ variants each):

1. **BACKFILL** variants (15+ files)
   - BACKFILL_INVESTIGATION_REPORT
   - BACKFILL_STATUS_REPORT
   - BACKFILL_ANSWER_EXECUTIVE_SUMMARY
   - BACKFILL_RECOVERY_QUICKSTART
   - etc.

2. **PNL** variants (20+ files)
   - PNL_INVESTIGATION_SUMMARY
   - PNL_INVESTIGATION_FINDINGS
   - PNL_ROOT_CAUSE_FOUND
   - PNL_FIX_COMPLETE_SUMMARY
   - etc.

3. **DATABASE** variants (10+ files)
   - DATABASE_AUDIT_EXECUTIVE_SUMMARY
   - DATABASE_ARCHITECTURE_AUDIT_2025
   - DATABASE_VERIFICATION_FINAL_REPORT
   - etc.

4. **RESOLUTION** variants (12+ files)
   - RESOLUTION_COVERAGE_FINAL_REPORT
   - RESOLUTION_INVESTIGATION_EXECUTIVE_SUMMARY
   - RESOLUTION_DATA_COMPLETENESS_REPORT
   - etc.

5. **COVERAGE** variants (8+ files)
   - COVERAGE_ANALYSIS_COMPLETE
   - COVERAGE_SUFFICIENCY_FINAL_REPORT
   - COVERAGE_VERIFICATION_FINAL_REPORT
   - etc.

---

## High-Value Canonical Candidates

**Documents to definitely preserve** (sorted by size/value):

### From docs/ (already in good location):
1. `target-tech-spec.md` (365KB, 10,944 lines) - Comprehensive technical spec
2. `ARCHITECTURE_OVERVIEW.md` (20KB) - System architecture
3. `CRON_REFRESH_SETUP.md` - Operational runbook
4. `SMART_MONEY_COMPLETE.md` - Feature documentation
5. `COPY_TRADING_MODES_COMPLETE.md` - Feature documentation
6. Various subsystem docs in proper folders

### From root (need to move to docs/):
1. `CASCADIAN_DATABASE_MASTER_REFERENCE.md` → docs/systems/database/
2. `POLYMARKET_TECHNICAL_ANALYSIS.md` → docs/systems/polymarket/
3. `OPERATIONAL_GUIDE.md` → docs/operations/
4. `PIPELINE_QUICK_START.md` → docs/systems/data-pipeline/
5. `POLYMARKET_QUICK_START.md` → docs/systems/polymarket/
6. Large architecture docs → docs/architecture/
7. Reference guides → docs/reference/

### From .agent-os/ (archive with context):
1. Product specs and architecture docs
2. Feature completion reports (historical context)
3. Agent OS workflow documentation

---

## Recommended Organization Strategy

### Target Structure (Minimal Changes to docs/)

```
docs/
├── README.md                    # Navigation guide
├── architecture/                # High-level architecture
│   ├── OVERVIEW.md
│   ├── data-flow.md
│   └── decisions/
├── systems/                     # Technical subsystems
│   ├── database/
│   │   ├── schema-reference.md
│   │   ├── query-optimization.md
│   │   └── migrations/
│   ├── data-pipeline/
│   │   ├── pipeline-overview.md
│   │   ├── backfill-guide.md
│   │   └── monitoring.md
│   ├── polymarket/
│   │   ├── quick-start.md
│   │   ├── api-reference.md
│   │   └── integration-guide.md
│   ├── pnl/
│   │   ├── calculation-guide.md
│   │   ├── architecture.md
│   │   └── troubleshooting.md
│   └── resolution/
│       ├── coverage-metrics.md
│       └── api-integration.md
├── features/                    # Feature documentation
│   └── [existing structure] ✅
├── operations/                  # Runbooks and operations
│   ├── runbooks/
│   │   ├── backfill-runbook.md
│   │   ├── cron-refresh.md
│   │   └── deployment.md
│   ├── troubleshooting/
│   └── monitoring/
├── reference/                   # Quick reference materials
│   ├── api-quick-reference.md
│   └── cli-commands.md
├── investigations/              # 🆕 Key investigation reports (10-20 max)
│   ├── 2025-11-backfill-recovery.md
│   ├── 2025-11-pnl-calculation-fix.md
│   └── README.md
└── archive/                     # Historical material
    ├── agent-os-oct-2025/       # 🆕 Archived .agent-os/ (hidden)
    ├── agent-os-visible-oct-2025/ # 🆕 Archived agent-os/ (visible)
    ├── investigations/          # 🆕 Dated investigation reports by topic
    │   ├── pnl/
    │   ├── database/
    │   ├── resolution/
    │   ├── api/
    │   ├── backfill/
    │   └── YYYY-MM/             # Organized by date when applicable
    ├── duplicates/              # 🆕 Duplicate versions of documents
    │   ├── pnl/
    │   ├── database/
    │   ├── resolution/
    │   ├── api/
    │   └── backfill/
    ├── wip/                     # 🆕 Work-in-progress/temp files
    │   ├── tmp-files/
    │   ├── debug-files/
    │   └── checkpoint-files/
    ├── session-reports/
    ├── completed-features/
    └── historical-status/
```

---

## Migration Phases (100% NON-DESTRUCTIVE - NO DELETIONS)

**CRITICAL**: All cleanup operations are NON-DESTRUCTIVE. Nothing gets deleted in Phases 1-4. Everything moves to organized archive locations where it can be reviewed before any final deletion decisions.

### Phase 1: Root Directory Triage (564 files)

**Step 1A: Identify & Move Canonical Docs** (~50 files)
- Review high-value root docs
- Move to appropriate docs/ subdirectories
- Preserve content, change location only
- ✅ NO DELETIONS

**Step 1B: Archive Historical Reports** (~200 files)
- Investigation reports with dates
- Status reports that are point-in-time
- Move to docs/archive/investigations/[topic]/YYYY-MM/
- ✅ NO DELETIONS

**Step 1C: Archive Duplicates** (~200 files)
- Multiple "final" reports on same topic
- Repeated executive summaries
- Keep most recent/complete version as canonical
- Move others to docs/archive/duplicates/[topic]/
- ✅ NO DELETIONS

**Step 1D: Archive Pure WIP** (~100 files)
- tmp-* files
- Debug/check files
- Checkpoint files
- Move to docs/archive/wip/[category]/
- ✅ NO DELETIONS

### Phase 2: Consolidate Agent OS Folders

**Step 2A: .agent-os/ (Hidden)**
- Create docs/archive/agent-os-oct-2025/
- Move entire .agent-os/ directory
- Add README explaining historical context (frozen Oct 27)
- ✅ NO DELETIONS

**Step 2B: agent-os/ (Visible)**
- Review for unique content
- Merge any unique docs into docs/
- Move remaining to docs/archive/agent-os-visible-oct-2025/
- Add README with verification notes
- ✅ NO DELETIONS

### Phase 3: Duplicate Topic Consolidation

For each major topic (PNL, Database, Resolution, API, Backfill):
1. Identify the most recent/complete document
2. Move canonical version to proper docs/ location
3. Archive dated investigation reports to docs/archive/investigations/[topic]/
4. Archive duplicate summaries to docs/archive/duplicates/[topic]/
5. ✅ NO DELETIONS

### Phase 4: Establish RULES.md

Create root-level RULES.md with:
- Folder taxonomy
- Documentation guidelines
- Where each type of file belongs
- Examples of canonical locations
- Enforcement through PR checklist
- ✅ NO DELETIONS

### Phase 5: Review Period & Final Cleanup (FUTURE - WEEKS LATER)

**ONLY AFTER** all files have been in archive for review (minimum 2-4 weeks):

1. **Review Archive Contents**:
   - Verify nothing in archive is needed
   - Check docs/archive/duplicates/ - confirm truly duplicates
   - Check docs/archive/wip/ - confirm no valuable content
   - Check docs/archive/investigations/ - confirm superseded

2. **Deletion Approval Process**:
   - Generate deletion proposal with file list
   - Human review and explicit approval required
   - Create backup before any deletions
   - Document what was deleted and why

3. **Execution**:
   - Only delete after explicit approval
   - Keep archive backup for 30 days
   - Document in CHANGELOG

**Timeline**: Phase 5 should not happen until late November / early December 2025 at earliest

**Safety**: If uncertain whether to delete, keep archived indefinitely

---

## Files Flagged for Special Attention

### Keep (Already in Good Location)
- Everything in docs/systems/
- Everything in docs/features/
- Everything in docs/operations/
- docs/ARCHITECTURE_OVERVIEW.md
- docs/target-tech-spec.md

### Keep (But Move from Root to docs/)
- CASCADIAN_DATABASE_MASTER_REFERENCE.md
- POLYMARKET_TECHNICAL_ANALYSIS.md
- OPERATIONAL_GUIDE.md
- PIPELINE_QUICK_START.md
- POLYMARKET_QUICK_START.md
- Any large architecture docs

### Archive (Historical Value)
- .agent-os/ entire directory → docs/archive/agent-os-oct-2025/
- agent-os/ visible directory → docs/archive/agent-os-visible-oct-2025/
- Investigation reports with breakthrough findings → docs/archive/investigations/[topic]/
- Dated status reports → docs/archive/investigations/[topic]/YYYY-MM/
- Major architectural decision docs → docs/archive/investigations/[topic]/

### Archive (Duplicates - For Later Review)
- Duplicate "final" reports → docs/archive/duplicates/[topic]/
- Multiple executive summaries on same topic → docs/archive/duplicates/[topic]/
- tmp-* and debug files → docs/archive/wip/tmp-files/
- Checkpoint status reports → docs/archive/wip/checkpoint-files/
- Intermediate investigation files → docs/archive/wip/investigations/

### Final Deletion (Phase 5 - FUTURE ONLY)
**NOT IN INITIAL PHASES** - Only after 2-4 weeks of review:
- Generate deletion proposal from archive
- Human review and explicit approval required
- Create backup before deletion
- Document in CHANGELOG

---

## Implementation Recommendations

### Immediate (No Approval Needed)
1. ✅ Generate this inventory (DONE)
2. ✅ Create tmp/doc-inventory.csv (DONE)
3. Review inventory and mark decisions

### Phase 1 (Approval Required)
1. Create docs/investigations/ folder
2. Create docs/archive/agent-os-oct-2025/
3. Create docs/systems/pnl/
4. Create docs/systems/resolution/

### Phase 2 (Execute Moves - 100% Non-Destructive)
1. Move canonical root docs to docs/ subdirectories (✅ NO DELETIONS)
2. Move .agent-os/ to docs/archive/agent-os-oct-2025/ (✅ NO DELETIONS)
3. Move dated investigation reports to docs/archive/investigations/ (✅ NO DELETIONS)
4. Move duplicates to docs/archive/duplicates/ (✅ NO DELETIONS)
5. Move WIP files to docs/archive/wip/ (✅ NO DELETIONS)

### Phase 3 (Consolidation - 100% Non-Destructive)
1. Consolidate duplicate topics (✅ NO DELETIONS)
2. Move agent-os/ visible directory to docs/archive/agent-os-visible-oct-2025/ (✅ NO DELETIONS)
3. Final root directory organization (✅ NO DELETIONS)
4. Verify all files accounted for (✅ NO DELETIONS)

### Phase 4 (Enforcement - 100% Non-Destructive)
1. Create/update RULES.md (✅ NO DELETIONS)
2. Update PR template (✅ NO DELETIONS)
3. Add to CLAUDE.md (✅ NO DELETIONS)
4. Document archive structure (✅ NO DELETIONS)

### Phase 5 (Final Review & Deletion - FUTURE ONLY, 2-4 weeks later)
**THIS PHASE DOES NOT HAPPEN IMMEDIATELY**
1. Review period: Minimum 2-4 weeks with archive in place
2. Generate deletion proposal with full file list
3. Human review and explicit approval required
4. Create backup before any deletions
5. Document what was deleted and why in CHANGELOG
6. Timeline: Late November / Early December 2025 at earliest

---

## Next Steps

**For Human Review**:
1. Review `tmp/doc-inventory.csv` and mark decisions
2. Identify any additional canonical docs to preserve
3. Approve migration phases
4. Provide RULES.md template for customization

**For Next Agent**:
1. Execute approved moves (non-destructive)
2. Create archive folders with READMEs
3. Generate consolidation proposals for duplicate topics
4. Update CLAUDE.md with new structure

---

## Deliverables Summary

✅ **Generated**:
- `tmp/doc-inventory.csv` - Complete inventory with metadata (868 lines)
- `tmp/doc-organization-plan.md` - This comprehensive plan
- `tmp/inventory-summary.txt` - Statistical summary
- `tmp/duplicate-analysis.md` - Detailed duplicate analysis

**Status**: Inventory phase COMPLETE. No files modified, moved, or deleted.

**Ready For**: Human review and approval of migration phases.
