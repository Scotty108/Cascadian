# CASCADIAN Archive - Technical Debt & Investigation History

> **Welcome to the archive.** This folder contains investigation reports, diagnostic scripts, session records, and deprecated systems that are no longer in active use. All files are preserved for historical reference and can be restored from git if needed.

**Archive Created:** November 18, 2025 (PST)
**Purpose:** Consolidate technical debt from ClickHouse migration and prepare for Goldsky implementation

---

## Quick Navigation

### 📊 Investigation Reports
Reports documenting bug discoveries, data audits, and system analysis.
- **[PnL Investigation](./investigation-reports/pnl-investigation/)** - P&L formula bug tracking (Nov 2024 - Nov 2025)
- **[Data Coverage Audit](./investigation-reports/data-coverage-audit/)** - Coverage metrics and completeness
- **[Database Audit](./investigation-reports/database-audit/)** - Schema and data quality findings
- **[Deduplication](./investigation-reports/deduplication/)** - Trade deduplication methodology
- **[ID Normalization](./investigation-reports/id-normalization/)** - Condition ID format standardization
- **[Other Investigations](./investigation-reports/other-investigations/)** - Miscellaneous audits and findings

### 📝 Session Records
Documentation from Claude Code sessions - track agent work, decisions, and outcomes.
- **[Claude 1 Sessions](./session-records/claude-1-sessions/)** - Implementation & PnL fixes (15+ records)
- **[Claude 2 Sessions](./session-records/claude-2-sessions/)** - Data pipeline work (28+ records)
- **[Claude 3 Sessions](./session-records/claude-3-sessions/)** - Audit & validation (5+ records)

### 🔧 Diagnostic Scripts
One-off investigation and debugging scripts used during development and troubleshooting.
- **[Sequential Workflows](./diagnostic-scripts/sequences/)** - Numbered scripts (01-61+) documenting step-by-step investigations
- **[Prefixed Scripts](./diagnostic-scripts/prefixed-scripts/)** - Utility scripts organized by purpose (check-, debug-, diagnose-, etc.)
- **[Script Index](./diagnostic-scripts/SCRIPT_INDEX.md)** - Searchable guide to what each script family did

### 📦 Data Outputs
Generated data files, checkpoints, and test fixtures from analysis runs.
- **[Checkpoint Results](./data-outputs/checkpoint-results/)** - Backfill progress snapshots (CSV exports)
- **[Snapshots](./data-outputs/snapshots/)** - JSON snapshots of wallet states, ID format analysis
- **[API Responses](./data-outputs/api-responses/)** - Sample API responses for reference

### ⚠️ Deprecated Systems
Files and structures that have been replaced or removed.
- **[Agent-OS Deleted](./deprecated-systems/agent-os-deleted/)** - Documentation of removed .agent-os/ structure (717 files)

---

## Archive Statistics

| Category | Files | Size | Date Range |
|----------|-------|------|------------|
| Investigation Reports | 70+ | ~78 MB | Oct 2024 - Nov 2025 |
| Session Records | 48+ | ~12 MB | Multi-month sessions |
| Diagnostic Scripts | 2,057 | ~147 MB | Investigation artifacts |
| Data Outputs | 48+ | ~300 MB | Backfill & analysis outputs |
| Deprecated Systems | 717 | ~85 MB | Removed .agent-os/ structure |
| **TOTAL** | **~2,940** | **~622 MB** | - |

---

## How to Use This Archive

### Finding Information
1. **By Topic:** Browse the investigation-reports/ subdirectories
2. **By Date:** Filenames are date-prefixed for chronological sorting
3. **By Claude Session:** Check session-records/ for agent work logs
4. **By Script:** Use diagnostic-scripts/SCRIPT_INDEX.md for script reference
5. **Full Index:** See [MASTER-INDEX.md](./MASTER-INDEX.md) for comprehensive searchable index

### Restoring a File
All archived files exist in git history and can be recovered:

```bash
# Find a file's last commit
git log --all -- archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md

# View file at specific commit
git show COMMIT_SHA:archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md

# Restore file to working directory
git show COMMIT_SHA:path/to/archived/file > path/to/restore
```

### Understanding What Was Archived
- **Investigation Reports:** Documents from detailed bug tracking and data quality work
- **Diagnostic Scripts:** One-off utility scripts written during debugging (not production code)
- **Session Records:** Agent handoff documents and work logs (historical reference)
- **Data Outputs:** Generated data from analysis runs (can be recreated)
- **Deprecated Systems:** Old agent-os/ structure replaced by /docs/ organization

### What's NOT in the Archive
- **Active source code** - See `/src/`, `/lib/`, `/app/`
- **Production configurations** - See `/` (package.json, tsconfig.json, etc.)
- **Active documentation** - See `/docs/`
- **Current scripts** - See `/scripts/`
- **Goldsky migration work** - See `/lib/goldsky/`

---

## Key Investigation Outcomes

### Critical Findings (Applied to Production)
✅ **PnL Formula Sign Error** - Fixed winning shares calculation (realized P&L)
✅ **Condition ID Standardization** - Normalized to 64-char hex format
✅ **ERC1155 Token Decoding** - Resolved asset ID mapping issues
✅ **Deduplication Logic** - Implemented trade duplicate detection
✅ **Resolution Backfill** - Completed market resolution data ingestion

### Ongoing Work (See Active Docs)
📈 **Goldsky Migration** - New data source replacing ClickHouse
🔄 **Metrics Recalculation** - Adapting all calculations to Goldsky
📊 **API Route Refactoring** - Updating 12 critical leaderboard routes

---

## Archive Organization Rules

**Before adding new files to archive:**
1. Does the file contain historical/reference value? (YES = archive)
2. Is it a one-off investigation artifact? (YES = archive)
3. Is it still used in production? (NO = archive)
4. Can it be recreated from git history? (YES = safe to archive)

**Files that should NOT be in archive:**
- Active source code (.ts/.tsx files in src/, lib/, app/)
- Production configurations (package.json, tsconfig.json, etc.)
- Current documentation (README.md, docs/, CLAUDE.md, RULES.md)
- Active scripts (/scripts/ directory)

---

## Related Documentation

See main project documentation for context:
- **[CLAUDE.md](../CLAUDE.md)** - Project overview & quick reference
- **[RULES.md](../RULES.md)** - Workflow patterns & guidelines
- **[docs/README.md](../docs/README.md)** - Active system documentation
- **[docs/operations/](../docs/operations/)** - Operational guides

---

## Master Index

For comprehensive searchable index of all archived files, see:
📖 **[MASTER-INDEX.md](./MASTER-INDEX.md)**

This file contains:
- Files organized by topic, date, and Claude session
- Quick reference table for finding specific investigations
- Links to related active documentation
- Recovery instructions for specific files

---

## Questions?

For information about:
- **A specific investigation:** Check investigation-reports/ subfolders
- **Script purposes:** See diagnostic-scripts/SCRIPT_INDEX.md
- **What happened in a session:** Check session-records/ by Claude number
- **Data format changes:** See data-outputs/snapshots/
- **Why something was deleted:** See deprecated-systems/agent-os-deleted/

---

**Archive Last Updated:** November 18, 2025
**Next Review:** Post-Goldsky migration completion
**Maintained by:** Claude Code + Development Team

