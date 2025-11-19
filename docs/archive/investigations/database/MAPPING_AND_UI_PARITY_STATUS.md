# Claude 1 - Mapping & UI Parity Mission Status

**Date:** 2025-11-10
**Mission:** Validate mapping integration + Polymarket UI parity

---

## CURRENT STATE

### ✅ Mapping Table
- **Status:** COMPLETE
- **Rows:** 17,136 token→condition mappings
- **Scope:** Pilot wallet 0x9155e8cf81a3fb557639d23d43f1528675bcfcad
- **Quality:** 100% success rate, 0 errors

### ⚠️ P&L View (vw_wallet_pnl_calculated)
- **Status:** EXISTS but mappings NOT APPLIED yet
- **Global coverage:** 11.88% (unchanged from pre-mapping)
- **Pilot wallet coverage:** 0% (should be ~50% after mapping applied)
- **Issue:** View hasn't been rebuilt with mapping layer yet

### ❌ vw_wallet_pnl_closed
- **Status:** DOES NOT EXIST
- **Note:** This is expected - need to create it for realized P&L fallback

---

## ANALYSIS

### The Script Is Correct
I reviewed `update-pnl-views-with-mapping.ts` (lines 128-143) and confirmed:

```sql
positions_with_canonical_ids AS (
  SELECT
    t.wallet,
    t.token_id,
    ...
    -- ✅ CORRECT: Uses COALESCE for fallback
    COALESCE(lower(m.condition_id), t.token_id) as canonical_cid
  FROM trade_positions t
  -- ✅ CORRECT: Uses LEFT JOIN to preserve modern trades
  LEFT JOIN default.legacy_token_condition_map m
    ON t.token_id = lower(m.token_id)
)
```

**This is already correctly implemented** - it will:
1. Try to use the mapping first (for legacy trades)
2. Fall back to the original token_id (for modern trades)
3. Preserve all trades (LEFT JOIN ensures no data loss)

### Why Coverage Is Still 0% for Pilot Wallet

The script hasn't been run yet (or was run before mappings were built). Once we rerun it after Claude 2's resolution backfill completes, we should see:

- Global coverage: 11.88% → 15-20% (modern trades preserved)
- Pilot wallet: 0% → ~50% (legacy trades now mapped)

---

## NEXT STEPS

### Step 1: Wait for Claude 2's Resolution Backfill ⏳

**Status:** IN PROGRESS
**What it does:** Backfills missing resolution data from Polymarket API/blockchain
**Why we need it:** More resolutions = higher P&L coverage

**To check progress:**
```bash
tail -f runtime/resolution-backfill.log  # or whatever log Claude 2 is using
```

### Step 2: Rebuild P&L View with Mapping Layer

**When:** After Claude 2's backfill completes
**Command:**
```bash
npx tsx update-pnl-views-with-mapping.ts
```

**Expected results:**
```
Global coverage: 11.88% → 15-20%
Pilot wallet:    0%     → ~50%
Pilot P&L:       $0     → $110,440.13
```

**Time:** 2-3 minutes

### Step 3: Validate Against Polymarket UI

**Command:**
```bash
npx tsx validate-against-polymarket-ui.ts
```

**What it does:**
1. Pulls our calculated stats for 2 wallets:
   - 0x4ce73141ecd5bba0952dd1f12c9b3e3c5b1a6bb8 (high volume)
   - 0x9155e8cf81a3fb557639d23d43f1528675bcfcad (pilot)

2. Prompts for manual UI verification at:
   - https://polymarket.com/profile/0x4ce73141...
   - https://polymarket.com/profile/0x9155e8cf...

3. Compares:
   - Settled P&L
   - Win count
   - Position count

4. Analyzes gaps:
   - Unresolved markets (expected)
   - Missing fills (data quality issues)

**Expected gaps:**
- 50-60% of positions unresolved (markets still open)
- <5% missing fills (acceptable data quality)

**Time:** 30 minutes (including manual UI checks)

### Step 4: Verify vw_wallet_pnl_closed Parity

**Status:** PENDING - view doesn't exist yet
**Need to:** Create `vw_wallet_pnl_closed` as a fallback for realized P&L

**Query to create:**
```sql
CREATE VIEW cascadian_clean.vw_wallet_pnl_closed AS
SELECT
  wallet,
  COUNT(*) as closed_positions,
  SUM(realized_pnl_usd) as total_realized_pnl,
  COUNT(IF(realized_pnl_usd > 0, 1, NULL)) as wins,
  COUNT(IF(realized_pnl_usd < 0, 1, NULL)) as losses,
  ROUND(100.0 * COUNT(IF(realized_pnl_usd > 0, 1, NULL)) / COUNT(*), 2) as win_rate
FROM default.vw_wallet_pnl_calculated
WHERE realized_pnl_usd IS NOT NULL  -- Only resolved positions
GROUP BY wallet
```

**Validation:**
- Check that row counts match between:
  - `vw_wallet_pnl_calculated` (filtered to resolved)
  - `vw_wallet_pnl_closed`
- Verify P&L totals are identical

**Time:** 15 minutes

---

## SUCCESS CRITERIA

### Mapping Integration ✅
- [x] 17,136 mappings built
- [ ] View rebuilt with LEFT JOIN + COALESCE
- [ ] Pilot wallet coverage: 0% → 50%+
- [ ] Global coverage preserved: ~11.88% baseline

### UI Parity
- [ ] Settled P&L within 10% of Polymarket UI (for 2 test wallets)
- [ ] Win count within 5% of Polymarket UI
- [ ] Position count within 10% of Polymarket UI
- [ ] Gaps documented:
  - [ ] % unresolved markets (expected)
  - [ ] % missing fills (data quality)

### Fallback View
- [ ] vw_wallet_pnl_closed created
- [ ] Parity with vw_wallet_pnl_calculated (for resolved positions)
- [ ] Ready to ship as realized leaderboard

---

## FILES CREATED

1. **verify-view-state.ts** - Check current P&L view status
2. **validate-against-polymarket-ui.ts** - UI parity validation script
3. **MAPPING_AND_UI_PARITY_STATUS.md** - This status report

## FILES TO RUN (In Order)

1. Wait for Claude 2's resolution backfill
2. `npx tsx update-pnl-views-with-mapping.ts`
3. `npx tsx verify-view-state.ts` (confirm coverage improved)
4. `npx tsx validate-against-polymarket-ui.ts`
5. Create vw_wallet_pnl_closed view (SQL above)
6. Verify parity between views

---

## RISKS & MITIGATION

### Risk 1: Mapping Only Covers One Wallet
**Issue:** 17,136 mappings are only for pilot wallet 0x9155e8cf
**Impact:** Other wallets won't benefit from mapping layer
**Mitigation:** This is expected for pilot phase. If successful, expand mapping to top 100 wallets

### Risk 2: Resolution Backfill Takes Too Long
**Issue:** Claude 2's backfill might take hours/days
**Impact:** Delays view rebuild and validation
**Mitigation:** Can run Step 2 without waiting if we accept current resolution coverage

### Risk 3: Polymarket UI Shows Different Numbers
**Issue:** Our P&L might not match Polymarket's
**Impact:** Loss of user trust
**Mitigation:** Document gaps (unresolved vs missing fills) and iterate on formula if needed

---

## BLOCKERS

**Current Blocker:** Waiting for Claude 2's resolution backfill to complete

**Once unblocked:** Can proceed with Steps 2-6 in ~1 hour total

---

## NOTES FOR NEXT CLAUDE

- The `update-pnl-views-with-mapping.ts` script is already correct (LEFT JOIN + COALESCE)
- Don't rebuild the script - just run it after resolution backfill completes
- Focus on UI parity validation and gap analysis
- vw_wallet_pnl_closed needs to be created for fallback leaderboard
- Pilot wallet expected P&L: $110,440.13 (from Polymarket UI manual check)

---

**Last Updated:** 2025-11-10 @ 23:34 PST
**Next Review:** After Claude 2's resolution backfill completes
