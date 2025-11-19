# Diagnostic Scripts Archive

This folder contains 322 one-off diagnostic and investigation scripts used during development, debugging, and system analysis. These are TypeScript/JavaScript utility scripts written to test, validate, explore, or fix specific issues.

## Organization

### 📊 Sequential Workflows
**67 scripts | Numbered sequences (01-61, 100-103)**

Step-by-step investigation workflows where each numbered script builds on previous ones.

**Examples:**
- `01-create-normalized-views.ts` through `42-compare-fixture-vs-dome.ts` - Track A fixture building
- `50-inspect-wallet-schema.ts` through `61-xcnstrategy-api-trades-counts.ts` - Track B wallet validation
- `100-list-all-databases.ts` through `103-detailed-inventory.ts` - Database discovery

**See:** `prefixed-scripts/SCRIPT_INDEX.md` for descriptions of script families.

### 🔧 Prefixed Scripts
**255 scripts | Organized by purpose prefix**

One-off utility scripts organized by what they do.

**Common Prefixes:**
- `check-*.ts` (59 files) - Schema checks, coverage validation, data quality
- `debug-*.ts` (29 files) - Troubleshooting specific issues
- `diagnose-*.ts` (6 files) - Diagnostic analysis
- `investigate-*.ts` (18 files) - Data exploration
- `analyze-*.ts` (13 files) - Analysis & metrics
- `calculate-*.ts` (7 files) - P&L calculations
- `build-*.ts`, `rebuild-*.ts` (10 files) - Test fixtures & rebuilds
- `test-*.ts` (15 files) - Validation & testing
- `verify-*.ts`, `validate-*.ts` (18 files) - Verification
- `describe-*.ts`, `inspect-*.ts` (7 files) - Schema introspection

---

## Script Categories

### 🏗️ Infrastructure & Schema
- `check-*-schema.ts` - Schema inspection
- `describe-*.ts` - Table/database description
- `inspect-*.ts` - Detailed inspection

**Purpose:** Understand database structure and relationships

### 🔍 Data Exploration
- `find-*.ts` - Data discovery
- `discover-*.ts` - System exploration
- `scan-*.ts` - Bulk scanning
- `list-*.ts` - Inventory generation

**Purpose:** Understand what data exists and where

### ✅ Validation & Testing
- `check-*.ts` - Validation checks
- `validate-*.ts` - Formal validation
- `verify-*.ts` - Verification tasks
- `test-*.ts` - Test execution

**Purpose:** Confirm data quality and system correctness

### 🐛 Debugging & Analysis
- `debug-*.ts` - Troubleshoot issues
- `diagnose-*.ts` - Root cause analysis
- `investigate-*.ts` - Deep investigation
- `analyze-*.ts` - Statistical analysis

**Purpose:** Understand and fix problems

### 🔧 Data Manipulation
- `build-*.ts` - Create test fixtures
- `rebuild-*.ts` - Rebuild tables/views
- `fix-*.ts` - Apply fixes
- `calculate-*.ts` - Compute values

**Purpose:** Modify data or create test environments

### 📊 Comparison & Analysis
- `compare-*.ts` - Cross-validation
- `calculate-*.ts` - Metrics computation
- `analyze-*.ts` - Detailed analysis

**Purpose:** Compare sources or understand metrics

---

## How to Use These Scripts

### Understanding a Script's Purpose

1. **Check the prefix:** Indicates general category
   - `check-` = validation
   - `debug-` = troubleshooting
   - `analyze-` = metrics/insights

2. **Read the filename:** Describes what it does
   - `check-erc1155-schema.ts` = Validates ERC1155 schema
   - `debug-payout-calc.ts` = Troubleshoots payout calculation

3. **See script index:** `SCRIPT_INDEX.md` has descriptions of major script families

### Running a Script

Most scripts are **one-off utilities**:

```bash
# Requires environment setup (.env.local)
set -a && source .env.local && set +a

# Run script with tsx
npx tsx archive/diagnostic-scripts/prefixed-scripts/check-resolution-coverage.ts

# Some scripts accept parameters
npx tsx archive/diagnostic-scripts/sequences/60-xcnstrategy-clickhouse-counts.ts
```

### Finding Related Scripts

Scripts often work together in families:

**Example - P&L Investigation Family:**
- `calculate-realized-pnl-from-fills.ts` - Calculate realized
- `calculate-unrealized-pnl.ts` - Calculate unrealized
- `calculate-with-resolutions.ts` - With resolution data
- `validate-pnl-after-fix.ts` - Verify fix correctness
- `test-pnl-calculation.ts` - Test edge cases

---

## Important Notes

⚠️ **These are investigation scripts, not production code:**
- Written for one-time use
- May have hard-coded values
- Incomplete error handling
- Documentation may be minimal

✅ **Safe to study for:**
- Understanding data structures
- Learning query patterns
- Seeing how to connect to ClickHouse
- Debugging methodology

❌ **Not suitable for:**
- Production use
- Reusing without modification
- Trusting output without verification
- Building features on

---

## Statistics

| Category | Scripts | Purpose |
|----------|---------|---------|
| Sequential Workflows | 67 | Investigation sequences |
| Schema/Inspection | 16 | Database structure |
| Data Exploration | 15 | Data discovery |
| Validation/Testing | 47 | Verification & testing |
| Debugging/Analysis | 48 | Problem-solving |
| Data Manipulation | 25 | Fixes & fixtures |
| Comparison/Analysis | 32 | Cross-validation |
| Miscellaneous | 72 | Various purposes |
| **TOTAL** | **322** | - |

---

## Script Index

For detailed descriptions of script families and what each does, see:

📖 **[SCRIPT_INDEX.md](./prefixed-scripts/SCRIPT_INDEX.md)** (in prefixed-scripts folder)

This index includes:
- Script family groupings
- Purpose of each script
- Dependencies and relationships
- Representative examples

---

## Recovering from Git

All scripts remain in git history and can be recovered:

```bash
# Find script in git history
git log --all -- archive/diagnostic-scripts/prefixed-scripts/check-resolution-coverage.ts

# View at specific commit
git show COMMIT_SHA:archive/diagnostic-scripts/prefixed-scripts/check-resolution-coverage.ts

# Restore to working directory
git checkout COMMIT_SHA -- archive/diagnostic-scripts/
```

---

## Related Documentation

- **Investigation Reports:** `archive/investigation-reports/` (findings from scripts)
- **Session Records:** `archive/session-records/` (context for script usage)
- **Archive Index:** `archive/MASTER-INDEX.md` (comprehensive search)
- **Active Codebase:** `/lib/clickhouse/`, `/scripts/` (production code)

---

**Archive Created:** November 18, 2025
**Total Scripts:** 322 files
**Approx Size:** 147 MB

