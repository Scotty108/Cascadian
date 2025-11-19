# ctf_token_map Backfill - Safety Protocol

**Task:** Decode token_id → condition_id for 38,849 empty rows in ctf_token_map
**Date:** 2025-11-11
**Agent:** Claude 1 (Autonomous Execution)
**User Request:** "Don't do anything stupid, make backups, stop if stuck"

---

## Safety Rules (MANDATORY)

### 🛑 STOP CONDITIONS
If ANY of these occur, STOP immediately and report:

1. **Test validation < 95% match rate**
2. **Any DROP, TRUNCATE, or DELETE operations required**
3. **Backup creation fails**
4. **Unexpected data format in token_id column**
5. **ClickHouse connection errors**
6. **Match rate against market_outcomes_expanded < 90%**

### ✅ SAFE OPERATIONS ONLY
- ✅ CREATE TABLE backup_* (copying data)
- ✅ UPDATE ctf_token_map SET condition_id_norm = ... (modifying existing column)
- ✅ SELECT queries (read-only analysis)
- ❌ DROP TABLE (FORBIDDEN)
- ❌ TRUNCATE TABLE (FORBIDDEN)
- ❌ DELETE FROM (FORBIDDEN)

### 📦 BACKUP STRATEGY
**Before ANY modification:**
```sql
CREATE TABLE ctf_token_map_backup_20251111 AS
SELECT * FROM ctf_token_map;
```

**Rollback procedure (if needed):**
```sql
-- Restore from backup
ALTER TABLE ctf_token_map RENAME TO ctf_token_map_broken;
ALTER TABLE ctf_token_map_backup_20251111 RENAME TO ctf_token_map;
```

---

## Execution Workflow

### Phase 1: Safety Backup (REQUIRED FIRST STEP)
- [x] Create `ctf_token_map_backup_20251111`
- [x] Verify row count matches original (41,130 rows)
- [x] Document backup location

**Stop if:** Backup creation fails or row counts don't match

---

### Phase 2: Analysis (Read-Only)
- [x] Analyze token_id formats (hex vs decimal distribution)
- [x] Sample 10 rows with filled condition_id_norm (understand pattern)
- [x] Sample 10 rows with empty condition_id_norm (what we're fixing)

**Stop if:** Token_id format is inconsistent or unexpected

---

### Phase 3: Decoder Development
- [x] Write SQL decoder function
- [x] Handle 3 cases:
  1. token_id with "0x" prefix → strip and lowercase
  2. token_id as decimal string → convert to hex
  3. token_id already hex without 0x → lowercase

**Decoder Logic:**
```sql
CASE
  WHEN token_id LIKE '0x%' THEN lower(substring(token_id, 3))
  WHEN token_id REGEXP '^[0-9]+$' THEN lower(hex(toUInt256(token_id)))
  ELSE lower(token_id)
END
```

---

### Phase 4: Small Test (100 Rows)
- [x] Run decoder on 100 empty rows
- [x] Check how many match market_outcomes_expanded
- [x] Calculate match rate

**Success Criteria:** ≥95% match rate

**Stop if:** Match rate < 95%

---

### Phase 5: Validation Review
**Before proceeding to full backfill, verify:**
- [x] Test match rate ≥ 95%
- [x] No data corruption in test rows
- [x] Decoded condition_ids are 64-char hex
- [x] Backup exists and is valid

**Stop if:** ANY validation fails

---

### Phase 6: Full Backfill (38,849 Rows)
- [x] Run UPDATE on all empty condition_id_norm rows
- [x] Monitor query execution (should complete in <5 min)
- [x] Verify row counts before/after

**Stop if:** Query takes >10 minutes or fails

---

### Phase 7: Post-Backfill Validation
- [x] Check overall match rate against market_outcomes_expanded
- [x] Verify high-volume markets now mapped (top 5 condition_ids)
- [x] Calculate new trade coverage (should be 99%+)

**Stop if:** Coverage < 90% or high-volume markets still missing

---

### Phase 8: Coverage Calculation
```sql
-- Before backfill (baseline)
SELECT count(*) FROM clob_fills cf
INNER JOIN ctf_token_map c ON cf.asset_id = c.token_id
WHERE c.condition_id_norm != '';

-- After backfill (target)
-- Should increase from 905K → ~5.99M (85% → 99%+)
```

---

## Rollback Plan

**If anything goes wrong:**

### Step 1: Stop Immediately
Don't attempt to fix in-place. Report status.

### Step 2: Assess Damage
```sql
-- Compare current vs backup
SELECT
  current.condition_id_norm as current_value,
  backup.condition_id_norm as backup_value
FROM ctf_token_map current
INNER JOIN ctf_token_map_backup_20251111 backup
  ON current.token_id = backup.token_id
WHERE current.condition_id_norm != backup.condition_id_norm
LIMIT 100;
```

### Step 3: Restore if Needed
```sql
-- Only if data is corrupted
ALTER TABLE ctf_token_map RENAME TO ctf_token_map_failed;
ALTER TABLE ctf_token_map_backup_20251111 RENAME TO ctf_token_map;
```

---

## Success Metrics

**Task is complete when:**
- ✅ Backup created successfully
- ✅ Decoder tested on 100 rows with ≥95% match
- ✅ Full backfill completed on 38,849 rows
- ✅ Final coverage ≥99% (5.5M+ trades mappable)
- ✅ Top 5 high-volume markets now mapped
- ✅ No data corruption or unexpected errors
- ✅ Documentation created with results

---

## Deliverables

**Files to Create:**
1. `/docs/operations/BACKFILL_EXECUTION_REPORT.md` (results summary)
2. Backup table: `ctf_token_map_backup_20251111` (in ClickHouse)
3. Test results log (match rates, coverage stats)

---

## Communication Protocol

**If I need to STOP:**
- Document exact stopping point in todo list
- Create STOP_REPORT.md with:
  - What was attempted
  - What failed
  - Current state of data
  - Recommended next steps
  - Backup status

**If SUCCESS:**
- Mark all todos complete
- Document final coverage metrics
- Report readiness for P&L validation

---

## Autonomous Execution Guardrails

**I will:**
- ✅ Create backups before ANY modification
- ✅ Test on small sample (100 rows) before full run
- ✅ Validate at each step
- ✅ Stop immediately if success rate < 95%
- ✅ Document everything
- ✅ Use safe UPDATE operations only

**I will NOT:**
- ❌ Drop or truncate tables
- ❌ Delete data
- ❌ Proceed if test fails
- ❌ Modify data without backup
- ❌ Continue if stuck/confused

---

**Status:** READY TO EXECUTE
**Estimated Time:** 4-5 hours
**Risk Level:** LOW (with proper backups and validation)

**Signed:** Claude 1 (Main Terminal)
