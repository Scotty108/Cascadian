# Market ID Normalization - Complete Documentation Index

## Quick Start

**New to this issue?** Start here:
1. Read the [Summary](#executive-summary) (5 min)
2. Review the [Visual Diagram](#visual-guide) (3 min)
3. Execute the [Migration](#running-the-migration) (15-20 min)

**In a hurry?** Use the [Quick Reference](#quick-reference-guide) for copy-paste commands.

---

## Executive Summary

**Problem:** P&L validation failing due to market_id format inconsistency (HEX vs INTEGER) causing duplicate rows in GROUP BY operations.

**Solution:** Remove market_id from views, group by condition_id_norm only.

**Impact:** 67.9M trades affected, expect 5-10% row reduction from deduplication.

**Risk:** Low (view-only changes, backups created, 30-second rollback)

**Time:** 15-20 minutes total execution time

---

## Documentation Files

### 1. Executive Summary (This File)
**File:** `/Users/scotty/Projects/Cascadian-app/MARKET_ID_FIX_SUMMARY.md`

**Purpose:** High-level overview for decision makers and first-time readers

**Contents:**
- Problem statement with impact assessment
- Solution overview
- Risk assessment
- Complete deliverables list
- Success criteria
- Contact information

**Best For:** Project managers, stakeholders, getting buy-in

**Read Time:** 10 minutes

---

### 2. Comprehensive Plan Document
**File:** `/Users/scotty/Projects/Cascadian-app/MARKET_ID_NORMALIZATION_PLAN.md`

**Purpose:** Complete technical specification with all details

**Contents:**
- Detailed normalization function design
- Step-by-step table rebuild strategy
- Complete verification queries (7 checks)
- Risk mitigation plan with detection mechanisms
- Rollback procedures with timing
- Related tables dependency analysis
- Complete execution plan with time estimates
- Copy-paste ready SQL scripts
- Appendices with root cause analysis

**Best For:** Database architects, engineers executing the migration

**Read Time:** 30-45 minutes (reference document, not meant to read cover-to-cover)

**Length:** 800+ lines

---

### 3. Quick Reference Guide
**File:** `/Users/scotty/Projects/Cascadian-app/MARKET_ID_NORMALIZATION_QUICK_REF.md`

**Purpose:** Fast lookup for commands and procedures

**Contents:**
- Quick command reference (run, rollback)
- Before/after SQL comparison
- Verification checklist
- Troubleshooting guide
- Expected metrics table
- How to get market_id after migration
- Post-migration tasks

**Best For:** Engineers during execution, quick lookups

**Read Time:** 5 minutes

---

### 4. Visual Diagram
**File:** `/Users/scotty/Projects/Cascadian-app/MARKET_ID_NORMALIZATION_DIAGRAM.txt`

**Purpose:** Visual understanding of the problem and solution

**Contents:**
- Before/after table comparisons (ASCII art)
- Data flow diagrams
- Migration process flowchart
- Rollback visualization
- Key design decisions explained visually
- Execution command examples

**Best For:** Visual learners, onboarding new team members

**Read Time:** 10 minutes

---

### 5. Index (This File)
**File:** `/Users/scotty/Projects/Cascadian-app/MARKET_ID_NORMALIZATION_INDEX.md`

**Purpose:** Navigation hub for all documentation

**Contents:**
- Quick start guide
- File descriptions with use cases
- Read time estimates
- Navigation by role
- Navigation by task

**Best For:** Finding the right document for your needs

**Read Time:** 5 minutes

---

## Executable Files

### 1. SQL Migration Script
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/migrate-market-id-normalization.sql`

**Purpose:** Raw SQL for direct execution in ClickHouse

**Usage:**
```bash
cat scripts/migrate-market-id-normalization.sql | \
  docker compose exec -T clickhouse clickhouse-client \
    --host=localhost \
    --database=default
```

**Best For:**
- Automated deployments
- CI/CD pipelines
- Non-interactive execution

**Execution Time:** 15-20 minutes

---

### 2. TypeScript Migration Runner
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/run-market-id-normalization.ts`

**Purpose:** Interactive migration with progress reporting and verification

**Usage:**
```bash
npx tsx scripts/run-market-id-normalization.ts
```

**Features:**
- Interactive confirmation prompt
- Pretty formatted output with tables
- Progress indicators for each phase
- Automatic verification with PASS/FAIL status
- Before/after comparison

**Best For:**
- Manual execution
- Development/staging environments
- First-time migrations
- Debugging

**Execution Time:** 15-20 minutes

---

### 3. TypeScript Rollback Script
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/rollback-market-id-normalization.ts`

**Purpose:** Quick rollback to pre-migration state

**Usage:**
```bash
npx tsx scripts/rollback-market-id-normalization.ts
```

**Features:**
- Checks if backups exist before rolling back
- Restores original view definitions
- Verifies restoration
- Interactive confirmation

**Best For:**
- Emergency rollback
- Testing rollback procedure
- Reverting after failed migration

**Execution Time:** 30 seconds

---

## Navigation by Role

### Database Architect
1. **First:** Read [Comprehensive Plan](#2-comprehensive-plan-document) (30-45 min)
2. **Then:** Review [Visual Diagram](#4-visual-diagram) (10 min)
3. **Finally:** Execute [TypeScript Runner](#2-typescript-migration-runner) (15-20 min)

### Software Engineer (Executing Migration)
1. **First:** Read [Quick Reference](#3-quick-reference-guide) (5 min)
2. **Then:** Review [Visual Diagram](#4-visual-diagram) (10 min)
3. **Finally:** Execute [TypeScript Runner](#2-typescript-migration-runner) (15-20 min)

### Project Manager / Stakeholder
1. **First:** Read [Executive Summary](#1-executive-summary-this-file) (10 min)
2. **Then:** Review [Visual Diagram](#4-visual-diagram) (10 min)
3. **Optional:** Skim [Comprehensive Plan](#2-comprehensive-plan-document) risk section (5 min)

### DevOps Engineer (CI/CD Integration)
1. **First:** Read [Quick Reference](#3-quick-reference-guide) (5 min)
2. **Then:** Review [SQL Script](#1-sql-migration-script) (5 min)
3. **Finally:** Test [TypeScript Runner](#2-typescript-migration-runner) locally (15-20 min)

### QA Engineer (Verification)
1. **First:** Read [Quick Reference](#3-quick-reference-guide) verification section (3 min)
2. **Then:** Review [Comprehensive Plan](#2-comprehensive-plan-document) verification queries (10 min)
3. **Finally:** Execute verification queries after migration (5-10 min)

---

## Navigation by Task

### Understanding the Problem
1. Read [Executive Summary](#1-executive-summary-this-file) - Problem Statement
2. View [Visual Diagram](#4-visual-diagram) - Before/After comparison
3. Read [Comprehensive Plan](#2-comprehensive-plan-document) - Appendix A (Root Cause)

### Planning the Migration
1. Read [Comprehensive Plan](#2-comprehensive-plan-document) - Execution Plan section
2. Review [Quick Reference](#3-quick-reference-guide) - Expected metrics
3. Check [Visual Diagram](#4-visual-diagram) - Migration process flow

### Executing the Migration
1. Use [Quick Reference](#3-quick-reference-guide) - Quick commands
2. Run [TypeScript Runner](#2-typescript-migration-runner)
3. Follow [Comprehensive Plan](#2-comprehensive-plan-document) - Verification section

### Verifying Results
1. Use [Comprehensive Plan](#2-comprehensive-plan-document) - Verification queries
2. Check [Quick Reference](#3-quick-reference-guide) - Verification checklist
3. Review [TypeScript Runner](#2-typescript-migration-runner) output

### Troubleshooting Issues
1. Check [Quick Reference](#3-quick-reference-guide) - Troubleshooting section
2. Review [Comprehensive Plan](#2-comprehensive-plan-document) - Risk mitigation
3. Use [Rollback Script](#3-typescript-rollback-script) if needed

### Rolling Back
1. Run [Rollback Script](#3-typescript-rollback-script)
2. Follow [Comprehensive Plan](#2-comprehensive-plan-document) - Rollback procedures
3. Verify using queries in [Quick Reference](#3-quick-reference-guide)

---

## File Dependencies

```
MARKET_ID_NORMALIZATION_INDEX.md (this file)
├── Links to all other documentation
└── Navigation hub

MARKET_ID_FIX_SUMMARY.md
├── High-level overview
└── References comprehensive plan

MARKET_ID_NORMALIZATION_PLAN.md
├── Complete technical specification
├── Referenced by all other files
└── Copy-paste SQL source

MARKET_ID_NORMALIZATION_QUICK_REF.md
├── Quick lookup reference
└── Extracts from comprehensive plan

MARKET_ID_NORMALIZATION_DIAGRAM.txt
├── Visual guide
└── Complements all documentation

scripts/migrate-market-id-normalization.sql
├── Extracted from comprehensive plan
└── Executed by TypeScript runner

scripts/run-market-id-normalization.ts
├── Wraps SQL script
├── Adds interactivity
└── Provides verification

scripts/rollback-market-id-normalization.ts
├── Emergency rollback
└── Uses backup views
```

---

## Reading Order Recommendations

### First-Time Reader (Total: 30 min)
1. [Summary](#1-executive-summary-this-file) (10 min)
2. [Visual Diagram](#4-visual-diagram) (10 min)
3. [Quick Reference](#3-quick-reference-guide) (10 min)

### Technical Deep Dive (Total: 60 min)
1. [Comprehensive Plan](#2-comprehensive-plan-document) (30 min)
2. [Visual Diagram](#4-visual-diagram) (10 min)
3. [SQL Script](#1-sql-migration-script) review (10 min)
4. [TypeScript Runner](#2-typescript-migration-runner) code review (10 min)

### Execution-Focused (Total: 20 min)
1. [Quick Reference](#3-quick-reference-guide) (5 min)
2. [TypeScript Runner](#2-typescript-migration-runner) (15 min)

### Emergency Rollback (Total: 5 min)
1. [Quick Reference](#3-quick-reference-guide) rollback section (2 min)
2. [Rollback Script](#3-typescript-rollback-script) (3 min)

---

## Key Metrics Summary

| Metric | Value |
|--------|-------|
| Total Documentation Files | 5 |
| Total Executable Scripts | 3 |
| Total Pages (estimated) | 50+ |
| Total Lines of Code/Docs | 2000+ |
| Estimated Read Time (all docs) | 70-90 minutes |
| Estimated Execution Time | 15-20 minutes |
| Estimated Rollback Time | 30 seconds |
| Risk Level | Low |
| Affected Rows | 67.9M trades |
| Expected Row Reduction | 5-10% |

---

## Quick Command Reference

### Run Migration
```bash
npx tsx scripts/run-market-id-normalization.ts
```

### Rollback
```bash
npx tsx scripts/rollback-market-id-normalization.ts
```

### Verify Results
```sql
SELECT * FROM migration_baseline_2025_11_06
ORDER BY created_at DESC LIMIT 20;
```

### Check for Duplicates
```sql
SELECT wallet, condition_id_norm, count() as cnt
FROM outcome_positions_v2
GROUP BY wallet, condition_id_norm
HAVING cnt > 1;
```

---

## Support & Contact

**Questions about the plan?**
- See [Comprehensive Plan](#2-comprehensive-plan-document)

**Need quick help during execution?**
- See [Quick Reference](#3-quick-reference-guide)

**Visual learner?**
- See [Visual Diagram](#4-visual-diagram)

**Need to rollback?**
- See [Rollback Script](#3-typescript-rollback-script)

**Want to understand root cause?**
- See [Comprehensive Plan](#2-comprehensive-plan-document) Appendix A

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-06 | Initial release - Complete documentation suite |

---

## Next Steps

1. **Read** the appropriate documentation for your role (see [Navigation by Role](#navigation-by-role))
2. **Review** the visual diagram to understand the solution
3. **Plan** your execution window (15-20 minutes downtime tolerance)
4. **Execute** using the TypeScript runner
5. **Verify** results using verification queries
6. **Monitor** for 24 hours before dropping backups

---

**Document Status:** Ready for production
**Last Updated:** 2025-11-06
**Maintainer:** Database Architecture Team
