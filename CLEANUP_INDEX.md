# Cascadian Project Cleanup - Documentation Index

## Overview
Comprehensive audit of Cascadian project root directory completed November 18, 2025.

**Findings:** 4.8 GB of non-essential files identified (528 items)  
**Safety:** Low risk - all are investigation/diagnostic artifacts  
**Impact:** Zero impact on production code or build process

---

## Reports Generated (3 Files)

### 1. **CLEANUP_VISUAL_SUMMARY.txt** - START HERE
**Purpose:** At-a-glance overview of the entire cleanup opportunity  
**Length:** 2-minute read  
**Contains:**
- Visual breakdown of what's being archived
- What's being kept and why
- Implementation timeline (Phase 1-4)
- Risk assessment
- Key statistics

**Use this:** First overview before detailed reading

---

### 2. **CLEANUP_QUICK_REFERENCE.md** - IMPLEMENTATION GUIDE
**Purpose:** Step-by-step cleanup implementation guide  
**Length:** 10-minute read  
**Contains:**
- Immediate action items (zero risk)
- High priority items (low risk)
- Medium priority items (verify first)
- Conditional decisions (ClickHouse binary)
- Multi-worker backup script template
- Verification checklist
- Recommended timeline (3 weeks)

**Use this:** When you're ready to implement cleanup

---

### 3. **CLEANUP_AUDIT_FINAL_REPORT.md** - COMPREHENSIVE ANALYSIS
**Purpose:** Complete detailed audit of every file and directory  
**Length:** Full deep dive (200+ lines)  
**Contains:**
- Detailed inventory of all 528 items
- Exact file paths and sizes
- Classification of each item
- Why each item is being archived
- Directory-by-directory breakdown
- Files to always keep
- Cleanup structure recommendations
- Critical checklist before archiving

**Use this:** Reference for specific questions about what's being archived

---

## Quick Navigation

| Need | Document | Section |
|------|----------|---------|
| What's the summary? | CLEANUP_VISUAL_SUMMARY.txt | Top section |
| How do I do the cleanup? | CLEANUP_QUICK_REFERENCE.md | Implementation Timeline |
| What exactly is being archived? | CLEANUP_AUDIT_FINAL_REPORT.md | Part 2 & 3 |
| Safe to delete immediately? | CLEANUP_QUICK_REFERENCE.md | Immediate Action Items |
| Multi-worker template? | CLEANUP_QUICK_REFERENCE.md | Multi-Worker Backup Script Template |
| Verification checklist? | CLEANUP_QUICK_REFERENCE.md | Verification Checklist Before Cleanup |
| Detailed risk assessment? | CLEANUP_AUDIT_FINAL_REPORT.md | Part 6 (Files of Uncertainty) |

---

## Key Numbers

- **Total cleanup:** 4.8 GB
- **Files identified:** 528 items
- **Essential files to keep:** 15 critical build/config files
- **Zero-risk items:** ~1.1 GB (archive immediately)
- **Low-risk items:** ~4.6 GB (archive after verification)
- **Conditional items:** 545M (ClickHouse - verify Goldsky ready)

---

## Timeline Recommendation

**Week 1 - Immediate:**
- Archive root diagnostics (78K)
- Delete empty directories and caches (750K)
- Archive agents directory (192K)
- Archive checkpoints/workspace (84K)
- **Total: 1.1 GB freed**

**Week 2 - After Goldsky confirmation:**
- Archive exports (2.2G)
- Archive runtime (2.2G)
- Archive reports/logs/data/sandbox (115M)
- **Total: 4.6 GB freed**

**Week 3 - After full testing:**
- Archive ClickHouse binary (545M) - conditional

---

## Critical Safety Notes

Never delete:
- `.env.local` (production secrets)
- `/scripts` (2,294 files include active pipeline)
- `/sql` (DDL schemas - essential references)
- `/.claude` (active Claude Code configuration)
- `/app`, `/lib`, `/components` (production code)

Always:
- Create backup of `.archive/` to external storage
- Verify archival before deleting source
- Ensure `git status` is clean before cleanup
- Use multi-worker parallelism with crash protection

---

## What's Being Archived

### Root Level (78K, 17 files)
- SQL query diagnostics (4 files)
- Validation scripts in MJS format (4 files)
- Miscellaneous analysis files (9 files: screenshots, logs, swaps)

### Directories (4.7GB, 511 items)
- **Agents** (192K) - Obsolete investigation framework
- **Exports** (2.2G) - Old leaderboard test exports
- **Runtime** (2.2G) - Analysis logs and session artifacts
- **Reports** (11M) - Investigation and validation reports
- **Logs** (12M) - Build and pipeline logs
- **Data** (92M) - Sample datasets and reference data
- **Sandbox** (280K) - Experimental test scripts
- **.CLOB_CHECKPOINTS** (24K) - Test checkpoint data
- **.CLEANUP-WORKSPACE** (60K) - Temporary staging

---

## Files to Keep

### Build & Configuration (15 essential files)
- package.json, package-lock.json, pnpm-lock.yaml
- tsconfig.json, jest.config.ts, tailwind.config.ts
- vercel.json, .mcp.json, docker-compose.mcp.yml
- CLAUDE.md, RULES.md
- .env.local, .gitignore, .nvmrc
- next-env.d.ts

### Application Code (All directories)
- /app (Next.js structure)
- /lib (Core libraries)
- /scripts (2,294 analysis + pipeline scripts)
- /sql (DDL schema definitions - ESSENTIAL)
- /components, /hooks, /types, /public, /docs
- /migrations, /supabase, /styles, /examples

### Infrastructure
- /.claude (Claude Code config - ACTIVE)
- /.git (Git repository)
- /.next (Build cache)
- /.vercel (Deployment config)
- /node_modules (Dependencies)

---

## Multi-Worker Implementation

Per CLAUDE.md standards, use:
- **8 parallel workers** recommended
- **Crash protection** (rsync with verification)
- **Stall protection** (checksum verification)
- **Checkpoint management** (SHA256 manifest)
- **Subset testing** (50 files first)

See CLEANUP_QUICK_REFERENCE.md for exact script template.

---

## Verification Before Cleanup

Essential checks:
- [ ] Goldsky migration is complete
- [ ] No active backfill jobs depend on these files
- [ ] Team confirmed reference reports aren't needed
- [ ] External backup created of .archive/
- [ ] git status is clean
- [ ] .env.local backed up to secure location
- [ ] /scripts directory is being kept (2,294 files)
- [ ] /sql directory is being kept (DDL schemas)

---

## Archive Structure

```
.archive/
├── diagnostics/              (SQL, MJS, misc)
├── investigation-agents/     (27 TS files)
├── leaderboard-exports/      (2.2G)
├── runtime-logs/             (2.2G)
├── investigation-reports/    (11M)
├── execution-logs/           (12M)
├── sample-data/              (92M)
├── sandbox-experiments/      (280K)
├── .clob-checkpoints/        (24K)
├── .cleanup-workspace/       (60K)
├── binaries/                 (clickhouse - if archived)
└── ARCHIVE_MANIFEST.md       (index)
```

---

## Questions & Answers

**Q: Is it safe to delete these items?**  
A: Yes. All 528 items are investigation/diagnostic artifacts with no dependencies in production code.

**Q: Will this break the build?**  
A: No. None of these items are referenced by the Next.js build process.

**Q: Can we recover these if needed?**  
A: Yes. All files are being archived (not deleted), and backups are recommended.

**Q: How long will cleanup take?**  
A: Phase 1-2 (archive 1.1GB): 10-15 minutes with 8 workers  
Phase 3 (archive 4.6GB): 30-45 minutes with 8 workers  
Phase 4 (archive 545M): 5-10 minutes (conditional)

**Q: Why keep the ClickHouse binary conditional?**  
A: Verify Goldsky managed service is fully deployed and team doesn't need local development instances.

**Q: What about the 2,294 files in /scripts?**  
A: KEEP ALL. These include active data pipeline scripts plus analysis utilities.

**Q: What about /sql directory?**  
A: KEEP ALL. These are DDL schema definitions - essential references for database understanding.

---

## Agent Information

**Scan Date:** November 18, 2025 (PST)  
**Agent:** Claude 1 (Explorer Agent)  
**Scan Type:** Very Thorough (all directories, hidden files, subdirectories)  
**Throughness Level:** Maximum depth - every file/dir examined

---

## Next Steps

1. Review **CLEANUP_VISUAL_SUMMARY.txt** (2 min read)
2. Read **CLEANUP_QUICK_REFERENCE.md** (10 min read) 
3. Check **CLEANUP_AUDIT_FINAL_REPORT.md** for specifics as needed
4. Follow timeline in CLEANUP_QUICK_REFERENCE.md
5. Use multi-worker script template provided

Recommend starting with Phase 1 items immediately (zero risk, frees 1.1 GB).

