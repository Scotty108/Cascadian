# Investigation Reports Archive

This folder contains detailed investigation and audit reports documenting months of system analysis, bug discovery, and data quality work from October 2024 through November 2025.

## Report Categories

### 📊 [PnL Investigation](./pnl-investigation/)
**50 files | Oct 2024 - Nov 2025**

Comprehensive documentation of the P&L calculation bug discovery, diagnosis, and resolution. Includes:
- Initial formula sign error discovery
- Wallet-specific PnL analysis (Track A & B validation)
- Reconciliation reports comparing expected vs actual
- Final resolution verification

**Key Files:**
- `FINAL_PNL_INVESTIGATION_REPORT.md` - Canonical source
- `FINAL_PNL_RECONCILIATION_REPORT.md` - Resolution verification
- Multiple phase reports documenting fix iterations

---

### 📈 [Data Coverage Audit](./data-coverage-audit/)
**15 files | Nov 2024 - Nov 2025**

Data completeness analysis including trade counts, resolution coverage, and wallet analytics coverage metrics.

**Key Topics:**
- Wallet coverage by market
- Trade completeness across data sources
- Resolution data availability
- Period-by-period coverage analysis

---

### 🗄️ [Database Audit](./database-audit/)
**9 files | Multiple periods**

Schema analysis, table relationships, and data quality findings from ClickHouse database inspection.

**Key Topics:**
- Schema documentation
- ERC1155 token mapping
- Table relationship diagrams
- Query performance analysis

---

### 🔄 [Deduplication](./deduplication/)
**4 files | Investigation of trade duplication**

Analysis and solution for handling duplicate trades in the system.

**Key Topics:**
- Duplication root causes
- Filtering strategies
- Deduplication logic implementation
- Validation of deduplicated data

---

### 🆔 [ID Normalization](./id-normalization/)
**3 files | Condition ID format standardization**

Documentation of condition ID format issues and standardization to 64-char lowercase hex.

**Key Topics:**
- Format inconsistencies discovered
- Normalization approach
- Global repair strategy
- Validation results

---

### 📋 [Other Investigations](./other-investigations/)
**81 files | Miscellaneous audits and findings**

Various investigation topics including:
- Wallet identity and tracking
- Market resolutions
- Token mapping and bridges
- Blockchain data integrity
- XCN strategy wallet deep dive
- External data integration

---

## File Naming Convention

Investigation reports are named with **date prefix** for chronological sorting:
```
YYYY-MM-DD_REPORT_NAME.md
```

Example: `2025-11-15_FINAL_PNL_INVESTIGATION_REPORT.md`

This allows sorting by date while preserving original descriptive names.

---

## How to Use This Archive

### Finding a Specific Investigation
1. **By topic:** Browse subdirectories above
2. **By date:** Files in each folder are date-sorted
3. **By keyword:** Use `grep` in terminal:
   ```bash
   grep -r "wallet_address" archive/investigation-reports/
   ```

### Understanding Report Relationships

Reports often build on each other. Example P&L investigation chain:
```
1. PNL_INVESTIGATION_ROOT_CAUSE_REPORT.md
   ↓ (discovery of sign error)
2. PNL_PHASE_1_COMPLETE.md
   ↓ (verify fix on test wallets)
3. PNL_RECONCILIATION_README.md
   ↓ (check all wallets)
4. FINAL_PNL_INVESTIGATION_REPORT.md
   ↓ (comprehensive summary)
5. FINAL_PNL_RECONCILIATION_REPORT.md
   (confirmation that fix is complete)
```

### Restoring a Report

All archived files remain in git. To restore:

```bash
# Find in git history
git log --all -- archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md

# View at specific commit
git show COMMIT_SHA:archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md

# Restore to working directory
git checkout COMMIT_SHA -- archive/investigation-reports/pnl-investigation/FINAL_PNL_INVESTIGATION_REPORT.md
```

---

## Statistics

| Category | Reports | Date Range | Size |
|----------|---------|-----------|------|
| PnL Investigation | 50 | Oct 2024 - Nov 2025 | ~22 MB |
| Data Coverage Audit | 15 | Nov 2024 - Nov 2025 | ~8 MB |
| Database Audit | 9 | Various | ~4 MB |
| Deduplication | 4 | Oct 2024 | ~2 MB |
| ID Normalization | 3 | Nov 2024 | ~1 MB |
| Other Investigations | 81 | Various | ~41 MB |
| **TOTAL** | **162** | - | **~78 MB** |

---

## What These Reports Document

### Problem Discovery
- Bug detection and root cause analysis
- Data quality issues identification
- Unexpected behavior investigation

### Solution Development
- Analysis of potential fixes
- Implementation of corrections
- Testing against known cases

### Verification
- Cross-validation with external sources
- Reconciliation of results
- Performance impact assessment

### Handoff Documentation
- Summary of learnings
- Decision rationale
- Next steps and recommendations

---

## Related Locations

- **Active Documentation:** See `docs/` directory
- **Session Records:** See `archive/session-records/` (Claude agent work logs)
- **Diagnostic Scripts:** See `archive/diagnostic-scripts/` (one-off investigation tools)
- **Archive Index:** See `archive/MASTER-INDEX.md` (comprehensive search)

---

## Guidelines for Archived Reports

✅ **Read these reports to understand:**
- System problems and how they were solved
- Data quality issues and their resolutions
- Historical decision-making rationale

❌ **Don't rely on these reports for:**
- Current system behavior (may have changed)
- Configuration details (use active docs)
- Recent feature status (check docs/features/)

---

**Archive Created:** November 18, 2025
**Total Reports:** 162 files
**Total Size:** ~78 MB

