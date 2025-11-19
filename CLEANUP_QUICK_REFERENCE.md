# Cascadian Cleanup Quick Reference

## At-a-Glance Summary

**Space to recover:** 4.8 GB  
**Files to archive:** 528 items  
**Essential files to keep:** 15 (build config + docs)  
**Risk level:** Low (all items are investigation/analysis artifacts)

---

## Immediate Action Items (Zero Risk)

### 1. Root-level diagnostics (17 files, 78K) ⚡ ARCHIVE NOW
Files to move to `.archive/diagnostics/`:
- *.sql files (4 files: coverage_audit_queries.sql, dedup-phase*.sql, tmp-rebuild-ctf.sql)
- *.mjs files (4 files: final-wallet-validation.mjs, validate-wallets*.mjs, scale-check.mjs)
- *.py, *.js, *.png, *.log, *.bak, *.swo files (9 miscellaneous)

**Storage freed:** 78K

### 2. Delete empty/unnecessary (0 risk)
- .clob_checkpoints_v2/ (empty directory)
- .codex/ (if empty)
- tsconfig.tsbuildinfo (748K cached file - regenerates on build)
- .CLAUDE.md.swo (vim swap file)

**Storage freed:** 750K+

---

## High Priority (Low Risk) - Archive This Week

### 3. Agents directory (192K, 27 files) 📊
Move entire `/agents/` to `.archive/investigation-agents/`
- 27 TypeScript investigation scripts (obsolete after migration phases)

**Storage freed:** 192K

### 4. Checkpoints directory (24K, 30 files) 📌
Move entire `.clob_checkpoints/` to `.archive/.clob-checkpoints/`
- Test checkpoint data no longer needed

**Storage freed:** 24K

### 5. Cleanup workspace (60K, 3 files) 🔧
Move entire `.cleanup-workspace/` to `.archive/.cleanup-workspace/`
- Temporary staging files

**Storage freed:** 60K

**Subtotal Phase 1-2:** ~1.1 GB freed (zero-risk items)

---

## Medium Priority (Verify First) - Archive Next

### 6. Exports directory (2.2G, 26 files) 📈 LARGEST SINGLE DIR
Move entire `/exports/` to `.archive/leaderboard-exports/`
- Timestamped leaderboard JSON exports from test cycles
- Check if team needs any recent snapshots for reference first

**Storage freed:** 2.2 GB

**Query before archiving:**
```bash
find /exports -name "*2025-11*" | wc -l
# Check if any recent exports are still being used
```

### 7. Runtime directory (2.2G, 279+ files) 📝 SECOND LARGEST
Move entire `/runtime/` to `.archive/runtime-logs/`
- Execution logs and session artifacts from analysis phases
- Verify no monitoring tools read from these logs

**Storage freed:** 2.2 GB

**Before archiving:**
- Check for any active scheduled jobs that might expect `/runtime` logs
- Verify team doesn't rely on archived session records

### 8. Reports directory (11M, 26+ items) 📋
Move entire `/reports/` to `.archive/investigation-reports/`
- PnL snapshots, trade analysis, token decode tests
- Keep if team needs reference documentation

**Storage freed:** 11M

### 9. Logs directory (12M, 34+ files) 📄
Move entire `/logs/` to `.archive/execution-logs/`
- Build and pipeline execution logs
- Safe if no active CI/CD relies on these

**Storage freed:** 12M

### 10. Data directory (92M, 44+ files) 💾
Move entire `/data/` to `.archive/sample-data/`
- Sample datasets and analysis files
- Review for any currently-needed reference docs

**Storage freed:** 92M

### 11. Sandbox directory (280K, 41+ files) 🧪
Move entire `/sandbox/` to `.archive/sandbox-experiments/`
- Experimental test scripts and analysis code
- Superseded by production implementations

**Storage freed:** 280K

**Subtotal Phase 3:** ~4.6 GB freed (after verification)

---

## High Risk (Research First) - Decision Required

### 12. ClickHouse Binary (545M, 1 file) ⚠️
File: `/clickhouse` executable

**Decision point:**
- Is Goldsky migration complete and tested?
- Does any local development still need ClickHouse locally?
- Are all migrations moved to managed service?

**If YES to all above:** Move to `.archive/binaries/`
**If UNSURE:** Keep for now, revisit in 2 weeks

**Storage freed (if deleted):** 545M

---

## Files to ALWAYS Keep

- ✅ package.json / package-lock.json / pnpm-lock.yaml
- ✅ tsconfig.json / jest.config.ts / tailwind.config.ts
- ✅ vercel.json / .mcp.json / docker-compose.mcp.yml
- ✅ CLAUDE.md / RULES.md
- ✅ .env.local (PRODUCTION SECRETS)
- ✅ .claude/ directory (Claude Code configuration - ACTIVE)
- ✅ /app, /lib, /scripts, /sql, /components, /docs (all production code)

---

## Archive Directory Structure

```
.archive/
├── diagnostics/
│   ├── *.sql files
│   ├── *.mjs files
│   ├── screenshots.png
│   └── misc-logs/
├── investigation-agents/
│   └── (27 .ts files)
├── leaderboard-exports/
│   └── (26 .json files)
├── runtime-logs/
│   └── (279+ .log and .md files)
├── investigation-reports/
│   └── (26+ items)
├── execution-logs/
│   └── (34+ .log files)
├── sample-data/
│   └── (44+ files)
├── sandbox-experiments/
│   └── (41+ .ts files)
├── .clob-checkpoints/
│   └── (30 test files)
├── .cleanup-workspace/
│   └── (3 files)
├── binaries/
│   └── clickhouse (if deleted from root)
└── ARCHIVE_MANIFEST.md (index of what's archived)
```

---

## Recommended Timeline

**Week 1 (Now):**
- [ ] Archive root diagnostics (78K) ✅ Zero risk
- [ ] Delete empty dirs and cached files (750K) ✅ Zero risk
- [ ] Archive agents directory (192K) ✅ Zero risk
- [ ] Archive checkpoints/cleanup-workspace (84K) ✅ Zero risk
**Subtotal: ~1.1 GB freed**

**Week 2 (After Goldsky confirmation):**
- [ ] Archive exports (2.2G) ✅ Low risk
- [ ] Archive runtime (2.2G) ✅ Low risk
- [ ] Archive reports/logs/data/sandbox (115M) ✅ Low risk
**Subtotal: ~4.6 GB freed**

**Week 3 (After full testing):**
- [ ] Archive ClickHouse binary (545M) ✅ Conditional (verify Goldsky ready)

---

## Multi-Worker Backup Script Template

Per CLAUDE.md, backup with multi-worker parallelism and crash protection:

```bash
# Create .archive structure with parallel workers
mkdir -p /Users/scotty/Projects/Cascadian-app/.archive/{diagnostics,investigation-agents,...}

# Parallel move with error handling (8 workers recommended)
find /path/to/source -maxdepth 1 -type f | \
  xargs -P 8 -I {} \
  rsync -av {} /Users/scotty/Projects/Cascadian-app/.archive/target/

# Verify integrity before deletion
du -sh /Users/scotty/Projects/Cascadian-app/.archive/target/
# Compare with source size

# Create checksum manifest
find /Users/scotty/Projects/Cascadian-app/.archive/ -type f \
  -exec sha256sum {} \; > /Users/scotty/Projects/Cascadian-app/.archive/MANIFEST.sha256

# Stall protection: verify copy completed
sleep 5 && find /Users/scotty/Projects/Cascadian-app/.archive/ | wc -l
# Should show all files present
```

---

## Verification Checklist Before Cleanup

- [ ] Goldsky migration timeline confirmed (for ClickHouse decision)
- [ ] No active backfill jobs depending on these files
- [ ] Team reviewed which reports/logs might be needed for reference
- [ ] Created backup of .archive/ to external storage
- [ ] git status is clean before any moves
- [ ] .env.local backed up to secure location (contains secrets)
- [ ] Verified /scripts/*.ts is being kept (2,294 active files)
- [ ] Verified /sql/*.sql is being kept (DDL schemas)

---

**Report Generated:** November 18, 2025 (PST)  
**Total Cleanup:** 4.8 GB across 528 items  
**Risk Level:** Low (all investigative artifacts, no production code)  
**Implementation:** Multi-phase approach with verification between phases

See `CLEANUP_AUDIT_FINAL_REPORT.md` for complete detailed analysis.

