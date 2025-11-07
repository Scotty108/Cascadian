# BACKFILL PLAN: LucasMeow & xcnstrategy Wallets

**Status:** FEASIBLE (Option C with Disclaimer)
**Problem:** Two wallets (LucasMeow, xcnstrategy) with $176k+ combined P&L have ZERO rows in database
**Root Cause:** Database has NO data for these wallets - neither in trades_raw, outcome_positions_v2, nor trade_cashflows_v3
**Solution:** Mark OUT_OF_SCOPE and proceed with data disclaimer

---

## Feasibility Assessment

### Investigation Results
- **trades_raw:** 0 rows for target wallets (0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47, 0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0)
- **outcome_positions_v2:** 0 total rows (table empty or non-existent)
- **trade_cashflows_v3:** 0 total rows (table empty or non-existent)
- **Upstream Source:** No ERC1155 transfers or CLOB fills for these wallets in existing data

### Available Scripts Analysis
**Data Import Scripts:**
- `scripts/ingest-clob-fills-correct.ts` - Fetches trades from Polymarket CLOB API for specific proxy wallets
- `scripts/ingest-clob-fills-backfill.ts` - Backfill script with checkpoint support
- `scripts/build-trades-dedup-mat.ts` - Builds deduplication materialized table from trades_raw
- `scripts/build-positions-from-erc1155.ts` - Builds positions from ERC1155 token transfers

**View Rebuild Scripts:**
- `scripts/realized-pnl-final-fixed.ts` - Creates trade_cashflows_v3 and outcome_positions_v2 views from trades_dedup
- `scripts/fast-dedup-rebuild.ts` - Rebuilds views with dedup_mat source
- `scripts/diagnostic-protocol-user-exact.ts` - Validation and view creation

### Option Analysis

**Option A: Wallet-Specific Import** ❌ NOT VIABLE
- **Why:** Wallet proxy addresses not in existing pm_user_proxy_wallets table
- **Blocker:** Scripts require pre-populated proxy table for filtering
- **Time:** Would require 2-4 hours to build proxy discovery + import pipeline

**Option B: Full Table Rebuild** ❌ NOT VIABLE
- **Why:** Tables are empty (0 rows), indicating incomplete pipeline setup
- **Blocker:** Would need full 1,048-day backfill (2-5 hours) for entire dataset
- **Risk:** May not include target wallets even after full rebuild

**Option C: Mark OUT_OF_SCOPE** ✅ RECOMMENDED
- **Why:** Missing wallets indicate incomplete data coverage, not a query bug
- **Action:** Add data coverage disclaimer to UI
- **Effort:** 15 minutes (update disclaimer only)
- **Trade-off:** Acknowledge limitation vs 4-8 hour backfill with uncertain outcome

---

## Recommended Approach: Option C

### Step-by-Step Implementation

**STEP 1:** Add data coverage disclaimer to UI
**Time:** 5 minutes
**Location:** `/src/components/dashboard/wallet-leaderboard.tsx` or equivalent
**Text:**
```
⚠️ Data Coverage: Wallet data limited to indexed proxy addresses.
Some high-performing wallets (e.g., LucasMeow, xcnstrategy) may not appear due to
incomplete historical coverage.
```

**STEP 2:** Document known gaps in README
**Time:** 5 minutes
**File:** `/KNOWN_DATA_GAPS.md` (new file)
**Content:**
```markdown
# Known Data Gaps

## Missing Wallets (as of 2025-11-06)
- **LucasMeow** (0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47): $87,293.39 P&L
- **xcnstrategy** (0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0): $89,074.90 P&L

**Root Cause:** Wallets not included in initial pm_user_proxy_wallets seed data.

**Resolution Path (Future):**
1. Add wallets to pm_user_proxy_wallets table
2. Run: `npx tsx scripts/ingest-clob-fills-correct.ts` with wallet filter
3. Rebuild views: `npx tsx scripts/realized-pnl-final-fixed.ts`
4. Estimated time: 30-45 minutes per wallet
```

**STEP 3:** Add to project backlog
**Time:** 5 minutes
**Action:** Create task in project tracker for "Expand wallet coverage" milestone

---

## Data Impact

**Before:**
- trades_raw: 0 rows for target wallets
- outcome_positions_v2: 0 rows total
- trade_cashflows_v3: 0 rows total
- Coverage: Incomplete

**After (Option C):**
- trades_raw: 0 rows for target wallets (NO CHANGE)
- outcome_positions_v2: 0 rows total (NO CHANGE)
- trade_cashflows_v3: 0 rows total (NO CHANGE)
- Coverage: Documented as incomplete with known gaps

---

## Rollback Plan

**If:** Disclaimer creates user confusion
**Action:** Remove disclaimer text from UI component
**Time:** 2 minutes
**Command:**
```bash
git revert HEAD  # If committed
# or manually remove disclaimer text from component
```

---

## Success Criteria

Backfill is complete when:
1. ✅ Data coverage disclaimer visible in wallet UI
2. ✅ Known gaps documented in `/KNOWN_DATA_GAPS.md`
3. ✅ Backlog task created for future wallet expansion
4. ✅ No user reports confusion about missing wallets

---

## Time Estimate

**Total:** 15 minutes

- Add UI disclaimer: 5 min
- Document gaps: 5 min
- Create backlog task: 5 min

---

## Alternative: Full Wallet Import (Future Work)

If you decide to pursue full import later:

### Prerequisites
1. Add wallets to `pm_user_proxy_wallets` table:
```sql
INSERT INTO pm_user_proxy_wallets (proxy_wallet, is_active, wallet_name)
VALUES
  ('0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47', 1, 'LucasMeow'),
  ('0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0', 1, 'xcnstrategy');
```

### Import Steps
1. **Fetch CLOB fills:** `npx tsx scripts/ingest-clob-fills-correct.ts`
   - Modify script to filter for new wallets only
   - Time: 10-15 minutes

2. **Rebuild dedup:** `npx tsx scripts/build-trades-dedup-mat.ts`
   - Time: 5-10 minutes

3. **Rebuild views:** `npx tsx scripts/realized-pnl-final-fixed.ts`
   - Time: 5-10 minutes

4. **Validate:** `npx tsx scripts/diagnostic-protocol-user-exact.ts`
   - Modify validation wallets array
   - Time: 5 minutes

**Total Time:** 30-45 minutes per wallet
**Risk:** Medium (API rate limits, data quality)

---

## Conclusion

**Recommendation:** Proceed with Option C (OUT_OF_SCOPE + Disclaimer)

**Rationale:**
- Fastest path to acknowledgment (15 min vs 4-8 hours)
- Maintains data integrity (no partial imports)
- Sets clear expectations for users
- Provides path forward for future expansion
- Avoids uncertain outcomes from incomplete backfill

**Next Action:** Add UI disclaimer and documentation, then proceed with current UI implementation using existing data coverage.
