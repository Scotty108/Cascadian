# CASCADIAN Project Root Directory Cleanup Audit
## Comprehensive Inventory of Non-Essential Files & Directories

**Scan Date:** November 18, 2025 (PST)  
**Target:** Clean up diagnostic, investigative, and analysis artifacts before Goldsky migration  
**Status:** Very Thorough Scan Complete

---

## EXECUTIVE SUMMARY

Total cleanup candidates identified: **~4.8 GB** across 550+ files/directories

| Category | Size | Files | Action | Keep/Archive |
|----------|------|-------|--------|--------------|
| **Root-level diagnostics** | 548K | 16 files | Archive immediately | Archive |
| **Agents directory** | 192K | 27 TS files | Archive (obsolete) | Archive |
| **Exports directory** | 2.2G | 26 files | Archive (old test data) | Archive |
| **Runtime directory** | 2.2G | 279+ files | Archive (analysis logs) | Archive |
| **Reports directory** | 11M | 26+ items | Archive (investigations) | Archive |
| **Logs directory** | 12M | 34+ files | Archive (build logs) | Archive |
| **Data directory** | 92M | 44+ files | Archive (sample/test data) | Archive |
| **Sandbox directory** | 280K | 41+ files | Archive (test scripts) | Archive |
| **Hidden checkpoints** | 24K | ~30 files | Archive (test data) | Archive |
| **Hidden cleanup-workspace** | 60K | 3 files | Archive (temp workspace) | Archive |
| **ClickHouse binary** | 545M | 1 file | Archive (obsolete local DB) | Archive |

**Files to keep (root level):** 16 critical build/config files = 748K
**Estimated space freed:** ~4.8 GB

---

## PART 1: ROOT LEVEL FILES (32 Total)

### CATEGORY A: MUST KEEP (Production/Build Critical) = 15 Files

These files are required for Next.js build, testing, and configuration:

```
✓ package.json              (4.3K)   - Dependencies & scripts
✓ package-lock.json         (613K)   - Dependency lock file (REQUIRED for CI/CD)
✓ pnpm-lock.yaml            (403K)   - Alternative lock (pnpm is package manager)
✓ tsconfig.json             (761B)   - TypeScript configuration
✓ jest.config.ts            (631B)   - Jest test configuration
✓ tailwind.config.ts        (2.2K)   - Tailwind CSS configuration
✓ vercel.json               (470B)   - Vercel deployment configuration
✓ .mcp.json                 (526B)   - MCP server configuration
✓ .gitignore                (1.5K)   - Git ignore rules
✓ .env.local                (8.8K)   - Environment variables (PRODUCTION SECRET)
✓ .nvmrc                    (8B)     - Node version specification
✓ docker-compose.mcp.yml    (1.7K)   - Docker compose for MCP servers
✓ CLAUDE.md                 (8.4K)   - Project documentation
✓ RULES.md                  (43K)    - Workflow rules
✓ next-env.d.ts             (216B)   - Auto-generated Next.js types
```

**Subtotal kept:** 15 files, ~748K

Note: `tsconfig.tsbuildinfo` (748K) is a generated cache - safe to delete (regenerates on next build)

---

### CATEGORY B: DIAGNOSTIC/INVESTIGATIVE - ARCHIVE = 17 Files

These are analysis artifacts from previous investigation phases:

#### SQL Query Files (Analysis Artifacts):
```
✗ coverage_audit_queries.sql         (5.5K)   - ClickHouse coverage audit
✗ dedup-phase1-xcn-hotfix.sql        (3.0K)   - Deduplication test query
✗ dedup-phase2-global-fix.sql        (7.2K)   - Deduplication test query
✗ tmp-rebuild-ctf.sql                (531B)   - Temporary test query
```

#### Node.js Module Scripts (Validation):
```
✗ final-wallet-validation.mjs        (9.7K)   - Wallet validation test
✗ validate-wallets-fixed.mjs         (9.0K)   - Wallet validation test
✗ validate-wallets.mjs               (7.2K)   - Wallet validation test
✗ scale-check.mjs                    (766B)   - Scale verification script
```

#### Miscellaneous Diagnostics:
```
✗ analyze.js                         (475B)   - Analysis utility
✗ final_erc1155_analysis.py          (1.7K)   - Python analysis script
✗ inventory-run.log                  (14K)    - Run output log
✗ worker-failure-counts.txt.bak      (25B)    - Backup metrics
✗ .CLAUDE.md.swo                     (12K)    - Vim swap file
✗ Screenshot*.png                    (309K)   - Screenshots from meetings/analysis
```

**Subtotal to archive:** 17 files, ~78K

**Root level total after cleanup:** 15 essential files (748K), all diagnostic files archived

---

## PART 2: LARGE SUBDIRECTORIES TO ARCHIVE

### 1. **AGENTS DIRECTORY** - 192K, 27 Files
**Status:** Obsolete investigation framework

Files: 27 TypeScript files for data diagnostics
Examples:
  - analyze-direction-and-view.ts
  - analyze-trade-tables.ts
  - check-erc1155-schema.ts
  - investigate-wallet-distribution.ts

**Classification:** These are investigation agents used for one-off database schema analysis and debugging. Obsolete after data migration phases completed.

**Action:** `Archive to .archive/investigation-agents/`

---

### 2. **EXPORTS DIRECTORY** - 2.2G, 26 Files
**Status:** Old test/validation data

Contains: Timestamped leaderboard exports from test runs
Examples:
  - leaderboard_omega_2025-11-11T03-06-21-333Z.json
  - leaderboard_roi_2025-11-11T03-07-34-832Z.json
  - pnl_v2_view_benchmark.json

**Classification:** Historical leaderboard and PnL validation snapshots from previous test cycles. No longer needed once Goldsky integration is complete.

**Action:** `Archive to .archive/leaderboard-exports/`

**Saves:** 2.2 GB

---

### 3. **RUNTIME DIRECTORY** - 2.2G, 279+ Files
**Status:** Analysis logs and investigation output

Contains: Execution logs, session records, diagnostic output
Examples:
  - agent-*.log (multiple numbered logs)
  - 65k-load.log
  - *.md analysis and report files

**Classification:** Accumulated operational logs, session artifacts, and intermediate analysis files from multiple phases.

**Action:** `Archive to .archive/runtime-logs/`

**Saves:** 2.2 GB

---

### 4. **REPORTS DIRECTORY** - 11M, 26+ Items
**Status:** Investigation and validation reports

Contains: Detailed snapshots and analysis
Examples:
  - PNL_SNAPSHOT_*.md (wallet analysis)
  - TRADE_SOURCES_ANALYSIS_*.json
  - pm_trades_canonical_v*.json (rebuild checkpoints)
  - archive/, coverage-analysis/, investigations/, metadata/ (nested)

**Classification:** Detailed validation reports from data quality audits and trade reconstruction phases.

**Action:** `Archive entire directory to .archive/investigation-reports/`

---

### 5. **LOGS DIRECTORY** - 12M, 34+ Files
**Status:** Build and execution logs

Contains: Dated log files from various pipeline executions
Examples:
  - acceptance_gates_*.log
  - backfill_*.log
  - ingestion_*.log

**Classification:** Temporary execution logs from backfill operations and validation runs.

**Action:** `Archive to .archive/execution-logs/`

---

### 6. **DATA DIRECTORY** - 92M, 44+ Files
**Status:** Sample and reference data

Contains: Mixed analysis data, sample outputs
Examples:
  - *.md analysis files
  - *.log execution records
  - csv exports

**Classification:** Test data, sample datasets, and reference information from development phases.

**Action:** `Archive to .archive/sample-data/`

---

### 7. **SANDBOX DIRECTORY** - 280K, 41+ Files
**Status:** Experimental scripts and analysis

Contains: One-off test scripts and analysis files
Examples:
  - *.ts experimental implementations
  - calculate-pnl-*.ts (multiple variants)
  - debug-*.ts files

**Classification:** Experimental/test implementations superseded by production code.

**Action:** `Archive to .archive/sandbox-experiments/`

---

## PART 3: HIDDEN DIRECTORIES TO ARCHIVE

### 1. **HIDDEN .CLOB_CHECKPOINTS** - 24K, ~30 Files
**Status:** Test checkpoint data

Contains: CLOB fill checkpoint states from testing

**Action:** `Archive to .archive/.clob-checkpoints/`

---

### 2. **HIDDEN .CLEANUP-WORKSPACE** - 60K, 3 Files
**Status:** Temporary cleanup staging area

**Action:** `Archive to .archive/.cleanup-workspace/`

---

### 3. **HIDDEN .CLOB_CHECKPOINTS_V2** - Empty
**Status:** Empty directory

**Action:** `Delete (empty)`

---

### 4. **HIDDEN .CODEX** - Minimal
**Status:** Empty or unused

**Action:** `Delete if empty, or keep if used by IDE`

---

## PART 4: SPECIAL CASE - CLICKHOUSE BINARY

### **CLICKHOUSE BINARY** - 545M, 1 File

**Path:** /Users/scotty/Projects/Cascadian-app/clickhouse
**Type:** Executable (-rwxr-xr-x)

**Classification:** Local ClickHouse binary for local development/testing. No longer needed if migrating to Goldsky managed service.

**Action:** `Archive to .archive/binaries/` OR delete if not needed locally

**Risk Level:** Medium - verify project doesn't rely on local ClickHouse before deletion

---

## PART 5: DIRECTORIES TO KEEP

These are critical for production build and should NOT be archived:

```
✓ /app              - Next.js application code
✓ /lib              - Core libraries and utilities
✓ /scripts          - 2,294 TypeScript scripts (analysis + active data pipeline)
✓ /sql              - DDL schemas (KEEP - essential reference)
✓ /components       - React components (production code)
✓ /hooks            - React custom hooks
✓ /public           - Static assets
✓ /__tests__        - Test files
✓ /styles           - Global styles
✓ /types            - TypeScript type definitions
✓ /migrations       - Database migrations
✓ /supabase         - Supabase configuration
✓ /docs             - Documentation
✓ /examples         - Code examples
✓ /.claude          - Claude Code configuration (ACTIVE - KEEP)
✓ /.git             - Git repository
✓ /.next            - Next.js build cache
✓ /.vercel          - Vercel deployment config
✓ /node_modules     - Dependency packages
```

---

## SUMMARY TABLE

| Category | Qty | Size | Type | Priority | Archive Dir |
|----------|-----|------|------|----------|-------------|
| Root diagnostics | 17 | 78K | Mixed | High | `diagnostics/` |
| Agents | 27 | 192K | TS | High | `investigation-agents/` |
| Exports | 26 | 2.2G | JSON | High | `leaderboard-exports/` |
| Runtime | 279 | 2.2G | Logs | Medium | `runtime-logs/` |
| Reports | 26 | 11M | MD/JSON | Medium | `investigation-reports/` |
| Logs | 34 | 12M | Logs | Medium | `execution-logs/` |
| Data | 44 | 92M | Mixed | Medium | `sample-data/` |
| Sandbox | 41 | 280K | TS | Medium | `sandbox-experiments/` |
| Checkpoints | 30 | 24K | Data | High | `.clob-checkpoints/` |
| Cleanup WS | 3 | 60K | Data | High | `.cleanup-workspace/` |
| ClickHouse | 1 | 545M | Binary | High | `binaries/` |
| **TOTALS** | **528** | **~4.8GB** | Various | - | - |

---

## CRITICAL CHECKLIST BEFORE ARCHIVING

- [ ] Goldsky migration timeline confirmed complete
- [ ] No active backfill jobs depend on local ClickHouse
- [ ] Team doesn't need reference reports from `/reports`
- [ ] No CI/CD pipelines read from `/logs` or `/runtime`
- [ ] Backup created of entire `.archive/` structure post-move
- [ ] git status clean before cleanup
- [ ] .env.local credentials are backed up separately
- [ ] SQL DDL files in `/sql` are exported to version control or documented

---

**Claude 1** - Explorer Agent  
*Cascadian App Cleanup Audit - Comprehensive Scan Complete*  
*PST Time: 2025-11-18*

Recommend multi-worker archive operation with crash protection enabled per CLAUDE.md standards.

