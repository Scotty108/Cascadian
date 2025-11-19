# P&L Feature - Path Forward

**Status:** 🔴 BLOCKED on resolution coverage
**Time to Ship:** 6-10 hours (with backfill)

---

## Current Situation

### What Works ✅
- P&L formula is mathematically correct
- Trade data is accurate (97% volume match)
- Position counts match Polymarket (104%)
- Database schema is solid

### What's Broken ❌
- **Resolution coverage varies 0-55% across wallets**
- Wallet 3: $332k actual P&L → Shows $0 (0% coverage)
- Wallet 4: $114k actual P&L → Shows $55k (45% coverage)
- burrito338: $137k actual P&L → Shows $1.5M (55% coverage but 10x calculation error)

---

## The Problem

**We have resolution data for only ~144k markets out of ~581k traded markets (24.8%)**

This means:
- 75% of markets have NO resolution data
- P&L calculations are incomplete or missing
- Different wallets have wildly different coverage (0% to 55%)

**Result:** Cannot ship P&L feature in current state.

---

## Three Options

### Option 1: Blockchain Resolution Backfill (RECOMMENDED) ✅

**What:** Query Polygon blockchain for all CTF contract resolution events

**How:**
1. Fetch `ConditionResolution` events from CTF contract
2. Parse payout vectors from event logs
3. Insert into `market_resolutions_final`
4. Rebuild `vw_resolutions_unified`

**Time:**
- Implementation: 4-6 hours
- Runtime: 2-4 hours (depends on RPC rate limits)
- Total: 6-10 hours

**Coverage gain:** +300k-400k markets (estimated 80%+ total coverage)

**Pros:**
- Blockchain is source of truth (most reliable)
- Gets us to production-ready coverage (80%+)
- One-time effort, then keep up with new resolutions

**Cons:**
- Requires Polygon RPC access (we have this)
- Takes several hours to backfill
- Some markets may not have on-chain resolution events

**Implementation sketch:**
```typescript
// 1. Fetch ConditionResolution events from CTF contract
const events = await provider.getLogs({
  address: CTF_CONTRACT,
  topics: [ethers.utils.id("ConditionResolution(bytes32,uint256,uint256[])")],
  fromBlock: EARLIEST_BLOCK,
  toBlock: 'latest'
});

// 2. Parse and insert
for (const event of events) {
  const { conditionId, payoutDenominator, payoutNumerators } = parseEvent(event);
  await insertResolution(conditionId, payoutNumerators, payoutDenominator);
}
```

---

### Option 2: Polymarket API Backfill (FASTER, LESS RELIABLE) ⚠️

**What:** Fetch missing markets from Polymarket Gamma API

**How:**
1. Get list of missing condition_ids (~171k)
2. Query Gamma API for each market
3. Parse winning outcome and payout vectors
4. Insert into resolution table

**Time:**
- Implementation: 2-3 hours
- Runtime: ~2 hours (171k markets @ ~100 req/sec)
- Total: 4-5 hours

**Coverage gain:** Unknown (API may not have all historical markets)

**Pros:**
- Faster to implement
- API provides structured data
- May include metadata (question, description)

**Cons:**
- API may be incomplete (missing old/archived markets)
- Rate limits may slow backfill
- Not the source of truth

**Note:** One of your background processes appears to be running this already.

---

### Option 3: Ship with Coverage Warning (NOT RECOMMENDED) ❌

**What:** Ship current P&L feature with UI disclaimer

**Disclaimer text:**
> "P&L calculations may be incomplete. Only resolved markets with available data are included. Coverage varies by wallet."

**Time:** 1-2 hours (UI changes only)

**Pros:**
- Can ship immediately
- Users get some P&L data

**Cons:**
- Poor user experience
- Inaccurate for most users (0-55% coverage)
- Reputation risk
- Technical debt (will need to fix eventually)

**Verdict:** Don't do this. The coverage is too poor (0% for some wallets).

---

## Recommended Approach

### Hybrid Strategy (Best of Both Worlds)

**Phase 1: API Backfill (Quick Win)** - 4-5 hours
- Run Polymarket API backfill for 171k missing markets
- Test coverage improvement
- If coverage reaches 80%+, ship immediately

**Phase 2: Blockchain Backfill (Completeness)** - 6-10 hours
- Implement blockchain resolution fetcher
- Backfill any remaining missing markets
- Ongoing: Keep resolution data updated

**Total time to ship:** 4-5 hours (after Phase 1 if successful)
**Total time to 90%+ coverage:** 10-15 hours (both phases)

---

## Next Immediate Actions

### 1. Check API Backfill Progress (5 minutes)

You have background processes running. Check if `backfill-polymarket-api.ts` is working:

```bash
# Check process status
ps aux | grep backfill

# Check progress (if running)
tail -f backfill-api.log  # or wherever output is going
```

### 2. Test API Backfill Results (10 minutes)

Once API backfill completes:

```bash
# Re-run wallet coverage test
npx tsx check-missing-wallet-data.ts

# Re-run P&L comparison
npx tsx test-pnl-calculations-vs-polymarket.ts
```

**Success criteria:**
- Wallet 3 coverage: 0% → 70%+ ✅
- Wallet 4 coverage: 45% → 80%+ ✅
- burrito338 coverage: 55% → 85%+ ✅

### 3. If Coverage Still Low: Implement Blockchain Backfill (6-10 hours)

If API backfill doesn't get us to 80%+, proceed with blockchain approach.

---

## Definition of "Production Ready"

### Minimum Requirements for P&L Feature

1. **Coverage:** 80%+ of markets for wallets with >$10k P&L
2. **Accuracy:** P&L calculations within 10% of Polymarket for test wallets
3. **Completeness:** All major markets (>$100k volume) have resolution data
4. **Performance:** P&L queries complete in <3 seconds

### Current Status

| Requirement | Status | Gap |
|------------|--------|-----|
| Coverage | 24.8% global, 0-55% per wallet | ❌ Need 80%+ |
| Accuracy | Formula correct, data incomplete | ⚠️ Blocked by coverage |
| Completeness | Unknown | ⚠️ Need to check |
| Performance | <3s | ✅ Passing |

**Blocker:** Coverage must reach 80%+ before other criteria can be validated.

---

## Timeline Estimate

### Fast Track (API Backfill Only)
- **Now:** Check if API backfill is running
- **+0h:** Wait for completion (~2h remaining if started)
- **+2h:** Test coverage improvement
- **+2.5h:** If 80%+, ship P&L feature ✅
- **Total:** 2.5 hours

### Standard Track (API + Blockchain)
- **+0h:** Wait for API backfill completion
- **+2h:** Test results, likely 50-60% coverage
- **+2h:** Implement blockchain backfill (4-6h)
- **+8h:** Run blockchain backfill (2-4h)
- **+12h:** Test coverage, likely 85%+
- **+12.5h:** Ship P&L feature ✅
- **Total:** 12.5 hours

---

## Risk Assessment

### High Risk (Don't Do This)
- ❌ Ship without backfill (Option 3)
- ❌ Assume 24.8% coverage is "good enough"

### Low Risk (Safe Paths)
- ✅ API backfill → test → decide
- ✅ Blockchain backfill → guaranteed 80%+
- ✅ Hybrid approach (API first, blockchain fallback)

---

## Files to Monitor

**Current Investigation:**
- `PNL_CRITICAL_FINDING.md` - Analysis of coverage issue
- `test-pnl-calculations-vs-polymarket.ts` - Wallet testing script
- `check-missing-wallet-data.ts` - Coverage diagnostic

**Backfill Scripts:**
- `backfill-polymarket-api.ts` - API approach (may be running)
- `backfill-market-resolutions-*.ts` - Various resolution backfill attempts

**Database:**
- `cascadian_clean.vw_resolutions_unified` - Current source (144k markets)
- `default.market_resolutions_final` - Resolution storage table

---

## Decision Point

**Right now, you need to decide:**

1. **Check API backfill status** - Is it running? How far along?
2. **If running:** Wait for completion, test coverage
3. **If not running:** Start it now (2-3 hour runtime)
4. **If coverage <80% after API:** Implement blockchain backfill

**Recommended immediate action:**
```bash
# Check what's running
ps aux | grep backfill

# Check recent background process output
# (see system reminders for background process IDs)
```

---

**Bottom Line:** Don't ship P&L feature until resolution coverage reaches 80%+ for active wallets. The fastest path is to check if API backfill is running, let it complete, then test coverage.
