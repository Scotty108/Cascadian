# Third-Party API Investigation: Status & Next Steps

**Date:** 2025-11-09  
**Status:** API Discovery in Progress  
**Goal:** Find how polymarketanalytics.com, hashdive.com, and polysites.xyz get resolution data

---

## What We've Tried

### ✅ Attempt 1: Direct API Testing
**Script:** `test-third-party-apis.ts`

**Tested endpoints:**
```
polymarketanalytics.com:
  - https://api.polymarketanalytics.com/wallet/{address}
  - https://polymarketanalytics.com/api/wallet/{address}
  - https://api.polymarketanalytics.com/v1/wallet/{address}

hashdive.com:
  - https://api.hashdive.com/polymarket/wallet/{address}
  - https://hashdive.com/api/polymarket/wallet/{address}
  - https://api.hashdive.com/v1/polymarket/wallet/{address}

polysites.xyz:
  - https://api.polysites.xyz/wallet/{address}
  - https://polysites.xyz/api/wallet/{address}
  - https://api.polysites.xyz/v1/wallet/{address}
```

**Result:** All 404/no response - these sites don't expose public REST APIs at obvious endpoints

---

### ❌ Attempt 2: Browser Automation
**Script:** `scrape-third-party-sites.ts`

**Approach:** Use Playwright to visit sites and capture network traffic

**Result:** Failed - Playwright not installed, and MCP Playwright tools not available in this environment

---

## Critical Questions to Resolve

### 1. Do these sites actually exist?
- Can you confirm polymarketanalytics.com, hashdive.com, polysites.xyz are real?
- Can you visit them and see the wallet P&L data you mentioned?

### 2. What are they really showing?
**Hypothesis A: Unrealized P&L** (most likely)
- They might be showing UNREALIZED P&L based on current midprices
- This would explain the $332K number (matches "All P&L" not "Settled P&L")
- Our "Settled P&L" of $0 would be correct (no redemptions yet)

**Hypothesis B: They have secret data** (less likely)
- They might have access to Polymarket's internal resolution feed
- Or they're scraping Polymarket's UI in sophisticated ways

**Hypothesis C: They're computing from same sources we have** (possible)
- They use the same 56k on-chain resolutions we have
- But apply different P&L calculation methods

### 3. How can we verify?
**Option A: Manual browser inspection**
- Visit `https://polymarketanalytics.com/wallet/0x4ce73141dbfce41e65db3723e31059a730f0abad`
- Open Chrome DevTools → Network tab
- Capture all API calls the site makes
- Share the URLs and responses

**Option B: Screenshot evidence**
- Take screenshots showing the $332K P&L
- Check if it says "Unrealized" vs "Realized" vs "Settled"
- Check if individual markets show as "Resolved" or "Open"

**Option C: Alternative test wallets**
- Test with wallets where we KNOW markets are resolved (from our 56k set)
- See if third-party sites match our "Settled P&L" for those wallets
- This would prove if they're showing unrealized vs realized

---

## Most Likely Scenario (My Best Guess)

**What's probably happening:**

1. **Polymarket's UI shows $332K** → This is UNREALIZED P&L (based on current midprices)
2. **Third-party sites mirror Polymarket** → They show the same unrealized number
3. **Our system shows $0 settled** → This is CORRECT (no redemption payouts yet)

**Why this makes sense:**
- The audit document confirmed: all sources (Gamma API, subgraphs, Bitquery, Dune) mirror on-chain data
- No public API exposes more than the 56k on-chain resolutions we have
- The $333K gap exists because this wallet's 30 markets are in the 75.17% unresolved
- Third-party sites are likely showing position value (shares × current_price) not redemption value

**How to verify:**
```typescript
// Compare unrealized vs realized
SELECT
  wallet,
  sum(pnl_closed) as trading_pnl,      // Pure trading profit
  sum(pnl_all) as unrealized_pnl,      // Trading + current value
  sum(pnl_settled) as realized_pnl     // Trading + redemptions
FROM cascadian_clean.vw_wallet_pnl_all
WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
```

If `pnl_all ≈ $332K` → Third-party sites are showing unrealized  
If `pnl_settled = $0` → Our system is correctly showing only settled

---

## Next Steps (Ranked by Priority)

### Priority 1: Verify What Third-Party Sites Actually Show
**Action:** Manually visit these sites:
1. polymarketanalytics.com/wallet/0x4ce73141dbfce41e65db3723e31059a730f0abad
2. hashdive.com/wallet/0x4ce73141dbfce41e65db3723e31059a730f0abad
3. polysites.xyz/wallet/0x4ce73141dbfce41e65db3723e31059a730f0abad

**Capture:**
- Screenshots of P&L display
- Whether it says "Unrealized" vs "Realized" vs "Settled"
- Chrome DevTools → Network tab → Share API call URLs
- Whether individual markets show as "Open" or "Resolved"

**Time:** 10-15 minutes

### Priority 2: Compare Our Unrealized vs Settled
**Action:** Run this query to compare:
```sql
SELECT
  lower(wallet) as wallet,
  sum(pnl_closed) as trading_only,
  sum(pnl_all) as trading_plus_unrealized,
  sum(pnl_settled) as trading_plus_realized,
  count(*) as num_positions
FROM cascadian_clean.vw_wallet_pnl_all
WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
GROUP BY wallet;
```

**Expected result:**
- `trading_plus_unrealized` ≈ $332K → Matches Polymarket
- `trading_plus_realized` = $0 → Matches our "Settled" view

**Time:** 2 minutes

### Priority 3: Test with Known-Resolved Wallet
**Action:** Pick a wallet where we KNOW markets are resolved:
```sql
-- Find wallets with resolved markets
SELECT
  lower(wallet) as wallet,
  count(*) as resolved_positions,
  sum(pnl_settled) as settled_pnl
FROM cascadian_clean.vw_wallet_pnl_settled
WHERE pnl_settled != 0
GROUP BY wallet
ORDER BY resolved_positions DESC
LIMIT 10;
```

Then check if third-party sites show the same `settled_pnl` for those wallets.

**Time:** 15 minutes

### Priority 4: If All Else Fails - Manual Scraping
**Action:** Use browser extension or manual network capture:
1. Install Chrome extension like "JSON Viewer" or "HTTP Request Monitor"
2. Visit the third-party sites
3. Export captured API calls
4. Manually replicate those calls with curl/fetch

**Time:** 30-60 minutes

---

## Tools Created (Ready to Use)

1. **`test-third-party-apis.ts`** - Tests REST API endpoints (already run - all failed)
2. **`scrape-third-party-sites.ts`** - Browser automation (blocked by missing Playwright)
3. **`backfill-condition-payouts.ts`** - On-chain backfill (working, but markets unresolved)

---

## Key Insight

**We're probably not screwed.** The most likely explanation is that third-party sites are showing **unrealized P&L** (current position value) while our "Settled P&L" correctly shows **realized redemptions** ($0 because markets haven't resolved yet).

**To confirm:** Just need to verify what those sites are actually displaying and compare with our `vw_wallet_pnl_all` view which includes unrealized gains.

---

## Immediate Action Items

**✅ COMPLETED - API Investigation Successful**

### What We Found

**Working APIs:**
1. ✅ **Polymarket Data API** - Wallet positions with P&L
2. ✅ **Goldsky Subgraph** - Payout vectors
3. ✅ **Gamma API** - Market metadata

**Database Scan Results:**
- ✅ Scanned 148 tables across both schemas
- ✅ Found wallet in 38 tables
- ✅ Have 218K+ payout vectors
- ✅ Have complete position tracking (30 positions vs API's 10)
- ❌ **P&L values don't match** - ~$5K discrepancy

### Critical Finding

**Database P&L:** $-500 to $-2,000 realized
**Polymarket API:** $320.47 cash P&L, $-6,117.18 realized
**Gap:** ~$5,000 difference

### Next Steps (UPDATED)

**Priority 1: P&L Reconciliation**
1. Integrate Polymarket Data API as source of truth
2. Create reconciliation view (database vs API)
3. Investigate root cause of $5K discrepancy
4. Fix our P&L calculation bugs

**See:**
- `DATABASE_VS_API_COMPARISON.md` - Full 7-section analysis
- `API_INTEGRATION_QUICK_SUMMARY.md` - TL;DR version
- `test-data-api-integration.ts` - Working API test script
