# Claude 1 – Infrastructure Guardrails

**Role**: Infrastructure & Data Quality
**Updated**: November 10, 2025
**Status**: Active

---

## Guardrail 1: Daily Table Monitoring

**Frequency**: Once per day (Week of Nov 10-17, 2025)

**Command**:
```bash
./run-daily-monitor.sh
```

**Action on exit code 0 (Stable)**:
✅ No action needed - table is healthy

**Action on exit code 1 (Drift detected)**:
❌ **Immediate response required**:

1. **Grab mutations file**: `table-swap-mutations-YYYY-MM-DD.json` (auto-created)

2. **Flag any ALTER/merge operations**:
   - Look for commands starting with `ALTER TABLE`
   - Check for `MERGE` operations
   - Review `is_done` status (0 = running, 1 = complete)
   - Check `latest_fail_reason` for errors

3. **Investigate**:
   - Was this intentional (ETL run, migration)?
   - Is data corrupted?
   - Are background mutations still running?

4. **Document**:
   - Add findings to session notes
   - If intentional: Note the change and continue monitoring
   - If unexpected: Halt changes and investigate root cause

**Files**:
- Monitor script: `run-daily-monitor.sh`
- Log history: `table-swap-monitor-log.json` (30-day rolling)
- Mutations output: `table-swap-mutations-YYYY-MM-DD.json` (created on drift)
- Guide: `DAILY_MONITORING_GUIDE.md`

---

## Guardrail 2: Token Filter Audit

**Status**: 3/3 production files patched ✅

**Critical Reminder**: **493 legacy diagnostic scripts NOT patched**

**Before running ANY old script**:

1. **Check for token filter**:
   ```bash
   grep -n "length(replaceAll(condition_id" <script-name>.ts
   ```

2. **If missing, add filter**:
   ```sql
   WHERE length(replaceAll(condition_id, '0x', '')) = 64
   ```

3. **Why this matters**:
   - 244,260 trades (0.3%) use `token_*` format (ERC1155 token IDs)
   - Without filter: Scripts accidentally count invalid placeholders
   - With filter: Only valid 64-char hex condition IDs included

**Reference Documents**:
- Status: `TOKEN_FILTER_PATCH_STATUS.md`
- Pattern guide: `docs/reference/query-filters-token-exclusion.md`
- Full audit: `token-filter-audit-results.json`

**Whenever reviving old scripts**:
- Search for `FROM trades_raw` or `FROM trades_with_direction`
- Verify filter exists
- Add if missing
- Update `TOKEN_FILTER_PATCH_STATUS.md` with patched count

---

## Guardrail 3: Schema Reference Maintenance

**Authoritative Source**: `docs/reference/market-metadata-schema.md`

**When to update**:
- ✅ New columns added to dim_markets, gamma_markets, or api_markets_staging
- ✅ Column types changed
- ✅ Data quality metrics shift (e.g., coverage improves after backfill)
- ✅ New metadata tables created

**How to detect schema drift**:

```sql
-- Check current schema
DESCRIBE TABLE default.dim_markets;
DESCRIBE TABLE default.gamma_markets;
DESCRIBE TABLE default.api_markets_staging;

-- Compare to documented schema in market-metadata-schema.md
```

**Update process**:
1. Run `get-metadata-schemas.ts` to regenerate current state
2. Compare output to existing `docs/reference/market-metadata-schema.md`
3. If differences found:
   - Update schema tables
   - Update quality metrics (% coverage)
   - Update recommendations if coverage changed
   - Note changes in git commit message

**Why this matters**:
- Analytics queries depend on documented schema
- Quality metrics guide backfill priorities
- Join patterns rely on accurate column info

**Schedule**:
- Check monthly or after major data migrations
- Update immediately if schema changes detected

---

## Daily Checklist (Infrastructure Role)

**Morning** (Once per day):
- [ ] Run `./run-daily-monitor.sh`
- [ ] Check exit code (0 = stable, 1 = drift)
- [ ] If drift: Review mutations file and flag ALTER/merge ops

**When reviving old scripts**:
- [ ] Verify token filter exists in query
- [ ] Add filter if missing: `WHERE length(replaceAll(condition_id, '0x', '')) = 64`
- [ ] Update TOKEN_FILTER_PATCH_STATUS.md

**Monthly** (or after migrations):
- [ ] Run `get-metadata-schemas.ts`
- [ ] Compare to `docs/reference/market-metadata-schema.md`
- [ ] Update doc if schema drift detected

---

## Quick Reference

| Guardrail | Frequency | Action |
|-----------|-----------|--------|
| **Table monitoring** | Daily (this week) | Run monitor, grab mutations on drift |
| **Token filter** | Before running old scripts | Check filter exists, add if missing |
| **Schema reference** | Monthly or on migration | Verify schema, update docs if drift |

---

## Files Reference

| File | Purpose |
|------|---------|
| `run-daily-monitor.sh` | Daily table health check |
| `table-swap-monitor-log.json` | Historical snapshots |
| `table-swap-mutations-*.json` | Drift diagnostics (auto-created) |
| `TOKEN_FILTER_PATCH_STATUS.md` | Filter audit status |
| `docs/reference/query-filters-token-exclusion.md` | Filter pattern guide |
| `docs/reference/market-metadata-schema.md` | Authoritative schema reference |
| `get-metadata-schemas.ts` | Schema extraction tool |
| `DAILY_MONITORING_GUIDE.md` | Monitoring detailed guide |

---

## Hand-off Notes for Next Infrastructure Session

**Current state** (as of Nov 10, 2025):
- ✅ Table swap stable (95.4M rows, 100% valid)
- ✅ Production lib/ files patched (3/3)
- ✅ Daily monitor baseline established
- ⚠️ 493 legacy scripts NOT patched (deferred)

**What to expect**:
- Monitor will run daily and alert on drift >0.1%
- Token filter audit can continue with active production scripts (Phase 2)
- Schema reference is current as of Nov 10, 2025

**Known gaps**:
- dim_markets: 56% missing questions, 52% missing market_ids (needs backfill)
- Legacy diagnostics lack token filter (apply on revival)

---

**Created**: November 10, 2025
**Owner**: Claude 1 (Infrastructure)
**Status**: Active guardrails in place
