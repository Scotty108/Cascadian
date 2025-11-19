# Next Step: Find Missing Payout Data for Wallet 0x4ce7

**Goal:** Understand why Polymarket shows $332K but we show -$546

**Root Cause:** The wallet's 30 positions have ZERO overlap with our 176 resolved markets

**Action Plan:** Find the missing payout data and ingest it

---

## Step 1: Identify the Wallet's Markets (5 min)

**What to do:** Get the exact condition_ids and market names for this wallet's positions.

```typescript
// File: investigate-missing-payouts.ts
SELECT 
  p.condition_id_32b,
  m.market_id_cid,
  p.shares_net,
  p.shares_net * (-p.cash_net / p.shares_net) as position_value_usd,
  r.payout_denominator as has_payout
FROM (
  SELECT
    lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b,
    toInt32(outcome_index) AS outcome,
    sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_net,
    sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
  FROM default.vw_trades_canonical
  WHERE lower(wallet_address_norm) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    AND condition_id_norm != ''
  GROUP BY condition_id_32b, outcome
  HAVING abs(shares_net) >= 0.01
) p
LEFT JOIN cascadian_clean.token_condition_market_map m ON p.condition_id_32b = m.condition_id_32b
LEFT JOIN cascadian_clean.vw_resolutions_truth r ON p.condition_id_32b = r.condition_id_32b
ORDER BY position_value_usd DESC;
```

**Expected output:**
- 30 positions
- All with `has_payout = NULL` (0 overlap)
- Sorted by position value (largest first)

---

## Step 2: Check if Markets Are Actually Resolved (10 min)

**Question:** Are these markets actually resolved, or still open?

**Check Polymarket API:**

```bash
# For each condition_id from Step 1, check Polymarket
curl "https://gamma-api.polymarket.com/events?slug=<market-slug>" | jq '.closed'

# Or check the condition directly
curl "https://clob.polymarket.com/markets/<condition_id>" | jq '.closed, .resolved'
```

**What to look for:**
- `closed: true` + `resolved: true` = We need to get this payout!
- `closed: false` = Market still open (explains gap)

---

## Step 3: Fetch Missing Payout Data (30-60 min)

**For each RESOLVED market missing from vw_resolutions_truth:**

### Option A: Polymarket Gamma API

```bash
curl "https://gamma-api.polymarket.com/events/<event-id>" | jq '{
  condition_id: .condition_id,
  outcome: .outcome,
  payout_numerators: .payout_numerators,
  payout_denominator: .payout_denominator,
  resolved_at: .resolved_at
}'
```

### Option B: On-Chain (CTF Contract)

```typescript
// Query the CTFExchange contract on Polygon
// getPayoutNumerators(bytes32 conditionId) returns (uint[] memory)
// getPayoutDenominator(bytes32 conditionId) returns (uint)

const web3 = new Web3('https://polygon-rpc.com');
const ctfContract = new web3.eth.Contract(CTF_ABI, CTF_ADDRESS);

const numerators = await ctfContract.methods.getPayoutNumerators(conditionId).call();
const denominator = await ctfContract.methods.getPayoutDenominator(conditionId).call();
```

### Option C: Check Other Tables

```sql
-- Maybe the data exists in tables we're not using?
SELECT * FROM cascadian_clean.resolutions_src_api 
WHERE lower(replaceAll(condition_id, '0x', '')) = '<condition_id>';

SELECT * FROM default.market_resolutions_final
WHERE lower(replaceAll(condition_id, '0x', '')) = '<condition_id>';
```

---

## Step 4: Ingest Missing Payouts (15 min)

**Create staging table:**

```sql
CREATE TABLE IF NOT EXISTS cascadian_clean.resolutions_manual_ingest (
  condition_id_32b String,
  winning_index UInt16,
  payout_numerators Array(UInt8),
  payout_denominator UInt8,
  resolved_at Nullable(DateTime),
  source String,
  ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id_32b);
```

**Insert fetched payouts:**

```sql
INSERT INTO cascadian_clean.resolutions_manual_ingest VALUES
  ('00bbbbe23c0fc0ff0d30809419c4eeecc14df9b4d789e92d9782a14ec0a3fd76', 0, [1, 0], 1, '2024-11-06 00:00:00', 'polymarket_api', now()),
  -- ... more rows
```

**Update truth view to include manual ingest:**

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
SELECT
  condition_id_32b,
  winning_index,
  payout_numerators,
  payout_denominator,
  resolved_at,
  source
FROM (
  -- Original blockchain source
  SELECT
    lower(replaceAll(cid_hex, '0x', '')) as condition_id_32b,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    'blockchain' as source
  FROM cascadian_clean.resolutions_by_cid
  WHERE payout_denominator > 0
    AND length(payout_numerators) > 0
    AND arraySum(payout_numerators) = payout_denominator
  
  UNION ALL
  
  -- Manual ingests from Polymarket API
  SELECT
    condition_id_32b,
    winning_index,
    payout_numerators,
    payout_denominator,
    resolved_at,
    source
  FROM cascadian_clean.resolutions_manual_ingest
  WHERE payout_denominator > 0
    AND length(payout_numerators) > 0
    AND arraySum(payout_numerators) = payout_denominator
);
```

---

## Step 5: Verify P&L Updates (5 min)

**Re-run the audit wallet:**

```sql
SELECT * FROM cascadian_clean.vw_wallet_pnl_settled 
WHERE wallet = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad');
```

**Expected result:**
- `positions_settled` should increase from 0 to X (number of markets we ingested)
- `redemption_pnl` should show positive number (approaching $332K)

**If still $0:** Check the joins are working:

```sql
WITH wallet_positions AS (
  SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
  FROM default.vw_trades_canonical
  WHERE lower(wallet_address_norm) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
)
SELECT 
  count(*) as total_positions,
  countIf(r.condition_id_32b IS NOT NULL) as found_in_truth,
  countIf(r.payout_denominator > 0) as with_valid_payouts
FROM wallet_positions p
LEFT JOIN cascadian_clean.vw_resolutions_truth r ON p.cid = r.condition_id_32b;
```

---

## Expected Outcome

**If markets ARE resolved and we ingest the data:**
```
BEFORE:
  Trading: -$494.52
  Settled: $0.00 (0/30 positions)
  Total: $0.00

AFTER:
  Trading: -$494.52
  Settled: ~$332,557 (X/30 positions)
  Total: ~$332,063 ✅ MATCHES POLYMARKET
```

**If markets are NOT resolved (still open):**
```
Status: Markets still open
Coverage: 0% settled (expected)
Action: Wait for markets to resolve, then ingest payouts
Note: Polymarket may be showing unrealized P&L (midprices), not settled
```

---

## Key Questions to Answer

1. **Are the wallet's 30 markets actually resolved?**
   - If YES → We need to fetch and ingest the payout data
   - If NO → The $332K is unrealized P&L (midprices), not settled

2. **Does the payout data exist anywhere?**
   - Check: resolutions_src_api, market_resolutions_final, Polymarket API, on-chain
   - If found → Ingest it
   - If not found → Need to backfill from source

3. **After ingesting, does Settled P&L match Polymarket?**
   - If YES → Problem solved! ✅
   - If NO → Debug the join/calculation logic

---

## Files to Create

1. `investigate-missing-payouts.ts` - Identify wallet's markets and check for payouts
2. `fetch-polymarket-payouts.ts` - Fetch missing payout data from Polymarket API
3. `ingest-manual-payouts.ts` - Insert fetched payouts into staging table
4. `verify-pnl-after-ingest.ts` - Confirm P&L now matches Polymarket

---

## Timeline

- Step 1 (Identify markets): 5 min
- Step 2 (Check if resolved): 10 min
- Step 3 (Fetch payouts): 30-60 min
- Step 4 (Ingest data): 15 min
- Step 5 (Verify): 5 min

**Total: 1-2 hours** to either solve the problem or confirm it's unsolvable (markets not resolved yet)

---

## Success Criteria

✅ Identified all 30 markets for wallet 0x4ce7
✅ Confirmed which markets are resolved vs open
✅ Fetched payout data for resolved markets
✅ Ingested payouts into vw_resolutions_truth
✅ Verified Settled P&L now matches Polymarket ($332K)

**OR**

✅ Confirmed markets are NOT resolved (still open)
✅ Documented that $332K is unrealized P&L (midprices), not settled
✅ Added note that we need midprice backfill, not payout data
