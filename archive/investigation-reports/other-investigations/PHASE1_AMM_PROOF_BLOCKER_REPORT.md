# Phase 1 AMM Proof: Blocker Report
**Date:** 2025-11-15
**Status:** ⚠️ BLOCKED on API access

---

## Goal

Prove AMM hypothesis by fetching trades from Polymarket API for 6 "ghost" markets and validating P&L impact.

---

## Blockers Encountered

### 1. Condition ID Mismatch

**Problem:** All 6 condition_ids from Dome return the SAME market in Gamma API:
- "Will Joe Biden get Coronavirus before the election?"
- Slug: `will-joe-biden-get-coronavirus-before-the-election`
- `clob_token_ids`: N/A (confirms AMM-only)

**Test Results:**
```
0x293fb49f... (Dome: "Satoshi Bitcoin 2025")        → Biden Coronavirus
0xf2ce8d38... (Dome: "Xi Jinping 2025")             → Biden Coronavirus
0xbff3fad6... (Dome: "Trump Gold Cards")            → Biden Coronavirus
0xe9c127a8... (Dome: "Elon Budget Cut")             → Biden Coronavirus
0xce733629... (Dome: "US Ally Nuke 2025")           → Biden Coronavirus
0xfc4453f8... (Dome: "China Bitcoin Unban")         → Biden Coronavirus
```

**Implication:** Condition IDs from Dome don't directly correspond to Gamma API's condition_ids, OR Gamma API is returning stale/cached data.

### 2. API Authentication Required

**CLOB API `/trades` endpoint:** Requires authentication (401 Unauthorized)
**CLOB API `/events` endpoint:** Requires authentication (401 Unauthorized)
**Gamma API `/markets` endpoint:** Returns metadata but not trade history

**Without authentication, we cannot fetch:**
- Historical trades
- Order fills
- AMM swap events via API

---

## Alternative Approaches

Since direct API access is blocked, here are three viable alternatives:

### Option A: Use Dune Analytics (Recommended)

**Why:** User has already researched Dune Spellbook for Polymarket
**Pros:**
- Dune has pre-indexed Polymarket CLOB + AMM data
- No authentication barriers
- SQL-queryable interface
- Can export results to CSV for import

**Implementation:**
```sql
-- Dune query example
SELECT
  trader,
  market_id,
  outcome,
  size,
  price,
  timestamp
FROM polymarket.trades
WHERE trader IN (
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723'
)
  AND market_id IN (
    -- list the 6 condition_ids
  )
  AND source = 'amm'  -- if Dune distinguishes CLOB vs AMM
ORDER BY timestamp
```

**Next Steps:**
1. Access Dune Analytics
2. Write query for xcnstrategy AMM trades
3. Export to CSV
4. Import to `pm_trades_amm_temp` table
5. Test P&L impact

**Estimated Time:** 2-4 hours

---

### Option B: Direct Blockchain Event Indexing

**Why:** We have 61M rows in `erc1155_transfers` already
**Pros:**
- No API dependency
- Source of truth from blockchain
- Scalable to all wallets

**Challenges:**
- Need to identify AMM contract addresses
- Need to decode AMM swap events
- Need to map token_ids to condition_ids

**Implementation Path:**

**Step 1:** Research Polymarket AMM contracts
- CTF Exchange contract address
- AMM Router contract
- Event signatures for swaps/trades

**Step 2:** Check if we already have AMM events in `erc1155_transfers`
```sql
-- Check for AMM contract activity
SELECT
  contract,
  COUNT(*) as transfers
FROM erc1155_transfers
WHERE (from_address = '0xcce2...' OR to_address = '0xcce2...')
   OR (from_address = '0xd59...' OR to_address = '0xd59...')
GROUP BY contract
ORDER BY transfers DESC
LIMIT 20
```

**Step 3:** Decode transfers as trades
- From address = trader selling
- To address = trader buying
- Value = shares exchanged
- Derive price from corresponding USDC transfers

**Estimated Time:** 1-2 days (contract research + pipeline build)

---

### Option C: Contact Dome for Data Access

**Why:** Dome clearly has this data and may offer API access
**Pros:**
- Direct source of truth
- Already normalized and validated
- May include proprietary data cleaning

**Cons:**
- Dependency on third party
- May have costs/licensing
- Not a long-term scalable solution

**Next Steps:**
1. Reach out to Dome support
2. Request API access or data export
3. Negotiate terms if needed

**Estimated Time:** Unknown (depends on Dome response)

---

## Recommended Path Forward

**Immediate (Hours):** Option A - Dune Analytics
- Fast validation of AMM hypothesis
- No engineering blockers
- Proves gap is AMM-related

**Short-term (Days):** Option B - Blockchain Indexing
- Build sustainable AMM ingestion
- Scale to all wallets
- No external dependencies

**Why this sequence:**
1. Dune proves the hypothesis quickly (answers "is this AMM?")
2. Blockchain indexing builds the long-term solution (answers "how do we scale?")
3. Avoid over-engineering before validating the approach

---

## Condition ID Mystery

**Critical Question:** Why do all 6 Dome condition_ids map to "Biden Coronavirus" in Gamma API?

**Hypotheses:**
1. **Dome uses different ID format:** Dome may hash/encode condition_ids differently than Gamma
2. **Market grouping:** Dome may aggregate multiple sub-markets under one parent condition_id
3. **Gamma API caching:** API may be returning stale/default data for unrecognized IDs
4. **Different market versions:** Markets may have been recreated/relaunched with new IDs

**To Investigate:**
- Compare Dome's condition_id format vs Gamma's
- Check if Dome's market names match any Gamma markets when searched by slug
- Review ERC1155 token_ids for these markets on blockchain

---

## Decision Point

**User input needed:**

**Question 1:** Do you have access to Dune Analytics?
- **If YES:** Proceed with Option A (Dune query)
- **If NO:** Proceed with Option B (blockchain events)

**Question 2:** Do you want to pursue Dome API access?
- Could provide fastest path to parity
- But creates external dependency

**Question 3:** Should we investigate the condition_id mismatch first?
- May reveal systematic ID encoding issue
- Could affect both CLOB and AMM data

---

## Impact on Mission

**Phase 1 Goal:** Prove AMM hypothesis using APIs
**Status:** ⚠️ Blocked on API authentication

**Pivot Required:** Use alternative data source (Dune or blockchain events)

**Expected Outcome (unchanged):**
- Fetch AMM trades for 6 ghost markets
- Insert into temporary table
- Recompute P&L
- Validate if gap closes toward $87K

**Timeline:**
- **Option A (Dune):** 2-4 hours
- **Option B (Blockchain):** 1-2 days
- **Option C (Dome):** Unknown

---

## Next Steps (Awaiting User Decision)

1. ✅ **Document blocker** (this report)
2. ⏭️ **User decides:** Dune vs Blockchain vs Dome API
3. ⏭️ **Execute chosen path**
4. ⏭️ **Validate P&L impact**
5. ⏭️ **Proceed to Phase 2 if successful**

---

**Reporter:** Claude 1
**Status:** Awaiting user input on preferred data source
