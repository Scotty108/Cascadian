# Archive Master Index

**Searchable, comprehensive guide to 600+ archived files spanning October 2024 through November 2025.**

Use this index to find specific investigations, session records, scripts, or data by topic, date, or keyword.

---

## Quick Navigation

### By Topic

#### 📊 **P&L Calculation & Analysis**
- **Investigation Reports:** `investigation-reports/pnl-investigation/` (50 files)
  - Formula bug discovery and fix
  - Wallet-specific P&L validation
  - Reconciliation reports
- **Scripts:** `diagnostic-scripts/prefixed-scripts/calculate-*.ts`, `verify-*-pnl.ts`
- **Session:** Claude 1 (P&L fix initiative)

#### 📈 **Data Coverage & Quality**
- **Investigation Reports:** `investigation-reports/data-coverage-audit/` (15 files)
  - Wallet coverage metrics
  - Trade completeness analysis
  - Resolution data availability
- **Scripts:** `diagnostic-scripts/prefixed-scripts/audit-*.ts`, `check-*-coverage.ts`
- **Session:** Claude 2 (phases 1-9: coverage expansion)

#### 🗄️ **Database & Schema**
- **Investigation Reports:** `investigation-reports/database-audit/` (9 files)
  - Schema analysis
  - Table relationships
  - Query performance
- **Scripts:** `diagnostic-scripts/prefixed-scripts/describe-*.ts`, `check-*-schema.ts`
- **Session:** Claude 3 (database audit)

#### 🔄 **Data Deduplication**
- **Investigation Reports:** `investigation-reports/deduplication/` (4 files)
  - Root causes identified
  - Filtering strategies
  - Deduplication implementation
- **Scripts:** Various trade-dedup related scripts

#### 🆔 **ID Standardization**
- **Investigation Reports:** `investigation-reports/id-normalization/` (3 files)
  - Format inconsistencies
  - Normalization approach
  - Global repair strategy
- **Scripts:** ID format analysis and normalization scripts

#### 🔐 **Wallet Identity & Tracking**
- **Investigation Reports:** `investigation-reports/other-investigations/` (contains wallet sections)
  - XCN strategy wallet deep dive (8+ files)
  - Multi-executor wallet clustering
  - Wallet schema discovery
- **Scripts:** `diagnostic-scripts/sequences/50-61_*`, wallet identity mapping scripts

#### 💾 **External Data Integration**
- **Session:** Claude 2 (phases 3-5: external ingestion)
- **Reports:** `session-records/claude-2-sessions/C2_*INGESTION*.md`, `C2_*EXTERNAL*.md`

---

## By Date Range

### October 2024
- Initial system implementation
- P&L bug discovery
- Basic investigation infrastructure
- **Location:** `investigation-reports/pnl-investigation/` (earliest files)

### November 2024
- P&L fix implementation
- ID normalization work
- Initial coverage analysis
- **Location:** `investigation-reports/*` (across all categories)
- **Sessions:** Claude 1 completion, Claude 2 startup

### December 2024 - February 2025
- Data pipeline development
- External integration (Phase 2-3)
- Ghost market discovery
- **Sessions:** Claude 2 (phases 2-3)

### March - August 2025
- Massive coverage expansion (Phases 4-5)
- Market resolution backfill
- Data source consolidation
- **Sessions:** Claude 2 (phases 4-9)

### September - October 2025
- Final data cleanup
- Performance optimization
- Coverage verification
- **Reports:** Phase completion documents

### November 2025
- Database validation
- Archive preparation
- Goldsky migration planning
- **Sessions:** Claude 3 (audit & validation)
- **Handoff:** Preparation for Goldsky rebuild

---

## By Claude Session

### Claude 1 (2 records)
**Focus:** P&L bug fix and implementation
- **Location:** `session-records/claude-1-sessions/`
- **Key Documents:**
  - `C1_PNL_V2_ACTION_PLAN.md`
  - `C1_POST_C3_ACTION_PLAN.md`
- **Outcome:** Fixed P&L formula sign error, implemented correction

### Claude 2 (22 records)
**Focus:** Data pipeline development & coverage expansion
- **Location:** `session-records/claude-2-sessions/`
- **Work Phases:**
  - Phase 1: Bootstrap & initial ingestion
  - Phase 2: Blockchain data mapping
  - Phase 3: Ghost market discovery
  - Phase 4-5: External data integration
  - Phase 6-9: Coverage expansion to 100%
- **Key Outcomes:**
  - 388M+ USDC transfers indexed
  - 100% market coverage target achieved
  - External data sources integrated

### Claude 3 (2 records)
**Focus:** Database audit & validation
- **Location:** `session-records/claude-3-sessions/`
- **Key Documents:**
  - `C3_DATABASE_COVERAGE_AUDIT_REPORT.md`
  - `C3_AUDIT_ADDENDUM_XCNSTRATEGY.md`
- **Outcome:** Complete database audit, XCN wallet deep dive

---

## By Investigation Type

### Root Cause Analysis
Deep dives into system problems, finding and documenting root causes.
- **P&L Sign Error:** `investigation-reports/pnl-investigation/`
- **Data Corruption:** `investigation-reports/database-audit/`
- **Deduplication:** `investigation-reports/deduplication/`

### Feature Implementation
Documentation of implementing new features or capabilities.
- **External Ingestion:** `session-records/claude-2-sessions/C2_*INGESTION*.md`
- **Coverage Expansion:** `session-records/claude-2-sessions/C2_PHASE*` files
- **Market Integration:** `investigation-reports/other-investigations/`

### Validation & Verification
Testing and confirming system correctness.
- **Coverage Validation:** `investigation-reports/data-coverage-audit/`
- **Schema Verification:** `investigation-reports/database-audit/`
- **Data Quality:** Various check-*.ts scripts

### Performance & Optimization
Analyzing and improving system performance.
- **Query Performance:** `investigation-reports/database-audit/`
- **Backfill Optimization:** `diagnostic-scripts/goldsky-*.ts`

---

## By Script Type

### Sequential Investigation Series

#### Track A: Market Resolution Validation (42 scripts)
- **Location:** `diagnostic-scripts/sequences/01-42/`
- **Purpose:** Test fixture building for market resolution validation
- **Process:** Step-by-step from data discovery to final comparison

#### Track B: Wallet Identity Validation (12 scripts)
- **Location:** `diagnostic-scripts/sequences/50-61/`
- **Purpose:** Wallet-specific P&L and trade validation
- **Process:** Schema inspection → fixture building → validation

#### Database Inventory (4 scripts)
- **Location:** `diagnostic-scripts/sequences/100-103/`
- **Purpose:** Complete database structure discovery
- **Key:** `103-detailed-inventory.ts` for comprehensive audit

### Prefixed Script Families

#### Schema & Inspection (16 scripts)
- `check-*-schema.ts` - Validate table structures
- `describe-*.ts` - Describe database objects
- `inspect-*.ts` - Detailed inspection

#### Validation & Testing (47 scripts)
- `check-*.ts` - Quality checks
- `validate-*.ts` - Data validation
- `verify-*.ts` - Verification tasks
- `test-*.ts` - Test execution

#### Debugging & Analysis (48 scripts)
- `debug-*.ts` - Issue troubleshooting
- `diagnose-*.ts` - Root cause analysis
- `investigate-*.ts` - Deep exploration
- `analyze-*.ts` - Statistical analysis

#### Data Manipulation (25 scripts)
- `build-*.ts` - Create fixtures
- `rebuild-*.ts` - Rebuild tables/views
- `fix-*.ts` - Apply corrections
- `calculate-*.ts` - Compute values

---

## Keyword Search Map

### Common Investigation Topics

| Topic | Location | Key Files |
|-------|----------|-----------|
| **P&L Calculation** | `investigation-reports/pnl-investigation/` | FINAL_PNL_*.md |
| **Wallet Analysis** | `investigation-reports/other-investigations/` | XCNSTRATEGY_*.md |
| **Market Coverage** | `investigation-reports/data-coverage-audit/` | COVERAGE_*.md |
| **ERC1155 Tokens** | `investigation-reports/database-audit/` | ERC1155_*.md |
| **Condition IDs** | `investigation-reports/id-normalization/` | ID_*.md |
| **Trade Data** | `diagnostic-scripts/prefixed-scripts/` | check-trades-*.ts |
| **Resolution Data** | `diagnostic-scripts/prefixed-scripts/` | check-resolution-*.ts |
| **Polymarket API** | `investigation-reports/other-investigations/` | API_*.md |
| **Goldsky** | `diagnostic-scripts/sequences/` | Phase 7 (resolution backfill) |
| **Performance** | `investigation-reports/database-audit/` | PERFORMANCE_*.md |

---

## Finding Specific Information

### "I need to understand the P&L bug"
→ Start with `investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md`
→ Then read `FINAL_PNL_RECONCILIATION_REPORT.md`
→ Check Claude 1 session for context

### "I need coverage metrics"
→ Check `investigation-reports/data-coverage-audit/` folder
→ Look for files with "COVERAGE_" prefix
→ See Claude 2 sessions for expansion phases

### "I need to understand wallet data"
→ Check `investigation-reports/other-investigations/XCNSTRATEGY_*.md` files (newest)
→ Or search `investigation-reports/other-investigations/` for wallet-specific reports
→ See `diagnostic-scripts/sequences/50-61/` for Track B workflow

### "I need API schema or responses"
→ Check `data-outputs/api-responses/`
→ Or search investigation reports for API-related docs

### "I need to run validation checks"
→ Check `diagnostic-scripts/prefixed-scripts/check-*.ts` and `validate-*.ts`
→ See diagnostic-scripts README for descriptions
→ Review script index for specific validation types

---

## Archive Statistics

| Category | Files | Size | Type |
|----------|-------|------|------|
| Investigation Reports | 162 | 78 MB | Markdown documentation |
| Session Records | 26 | 12 MB | Work logs & handoffs |
| Diagnostic Scripts | 322 | 147 MB | TypeScript utilities |
| Data Outputs | 38 | 305 MB | Snapshots & checkpoints |
| Deprecated Systems | 717 | 85 MB | Deleted .agent-os/ docs |
| Archive Documentation | 6 | <1 MB | README files |
| **TOTAL** | **~1,271** | **~627 MB** | - |

---

## Archive Access

### Viewing in Git

```bash
# List all archived files
git ls-tree -r --name-only HEAD | grep '^archive/'

# Search for specific term
git grep "search_term" -- archive/

# View file history
git log --all -- archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md
```

### Restoring Files

```bash
# Restore entire folder
git checkout HEAD -- archive/investigation-reports/

# Restore specific file
git checkout HEAD -- archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md

# View at specific commit
git show COMMIT_SHA:archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md
```

---

## Navigation Tips

1. **Start with topic of interest** → Go to corresponding folder in archive/
2. **Read README in that folder** → Understand folder organization
3. **Browse files by name** → Most are dated, sort chronologically
4. **Check session records** → Understand when work was done
5. **Review scripts used** → See diagnostic-scripts/ for analysis tools

---

## Related Active Documentation

| Need | Location |
|------|----------|
| Project overview | `CLAUDE.md` |
| Workflow patterns | `RULES.md` |
| Development guide | `docs/operations/DEVELOPMENT_GUIDE.md` |
| System architecture | `docs/systems/` |
| Active features | `docs/features/` |
| Database info | `docs/systems/database/` |

---

**Index Last Updated:** November 18, 2025
**Total Entries:** 1,271 files across 6 categories
**Search Capability:** Full-text via `git grep`

