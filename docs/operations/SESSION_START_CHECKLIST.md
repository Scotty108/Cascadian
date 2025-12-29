# Session Start Checklist

**CRITICAL: Run this checklist at the start of EVERY session before making any changes.**

## 1. Check for Running Background Processes

```bash
# Check all background shells
ps aux | grep -E "ingest-market-metadata|re-enrich" | grep -v grep

# If any found, kill them immediately
pkill -f "ingest-market-metadata"
pkill -f "re-enrich"
```

**Why**: Background processes from previous sessions can continue running and perform destructive operations (DROP TABLE, API calls) that violate explicit user instructions.

**What went wrong**: Background ingestion processes (748b63, 657b82) from a previous session continued running and dropped/recreated the table, violating the "never call API again" instruction.

## 2. Verify Freeze Guards

```bash
# Check freeze guard status
grep FREEZE_GAMMA_INGESTION .env.local

# Should show: FREEZE_GAMMA_INGESTION=1 (when API calls are frozen)
```

## 3. Check Table State

```bash
npx tsx scripts/check-table-status.ts
```

Expected output:
- Total markets: ~179k
- Enrichment versions present
- Sample data with populated fields

## 4. Review Recent Background Processes

```bash
# List all background process logs
ls -lht /tmp/*-ingestion*.log /tmp/*-enrich*.log | head -10

# Check if any are recent (< 1 hour old)
```

## 5. Document Current State

Before making ANY schema or data changes:
1. Note current row count
2. Sample 5 random markets
3. Check enrichment version distribution
4. Save state to `/tmp/pre-change-state-$(date +%s).log`

---

## Lessons Learned

### 2025-11-21: Background Process Disaster

**What happened**:
- Background processes from previous session (748b63, 657b82) continued running
- One completed and ran `DROP TABLE` + re-ingestion from Gamma API
- Violated explicit user instruction: "never call API again"
- Data became incomplete/corrupted

**Root cause**:
- Did not check for or kill background processes at session start
- Freeze guard was added AFTER processes were already running
- No systematic session start checklist

**Prevention**:
1. ✅ Always check for background processes first
2. ✅ Kill any long-running data operations immediately
3. ✅ Verify freeze guards before any work
4. ✅ Use this checklist at EVERY session start

**New rule**: BEFORE making any schema/data changes, ALWAYS:
1. Check for running background processes
2. Kill any destructive operations
3. Verify no API calls are in progress
4. Document current state
