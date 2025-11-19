# Polymarket CTF Exchange - Quick Reference Guide

**Last Updated:** 2025-11-12  
**For:** Cascadian P&L Calculation & Token ID Mapping  
**Status:** CRITICAL GAPS IDENTIFIED & SOLUTIONS PROVIDED

---

## CRITICAL FINDINGS AT A GLANCE

| What | Where | Impact on P&L |
|------|-------|---------------|
| **Token ID Encoding** | 3-step: condition → collection → position | Cannot match trades to outcomes without this |
| **Payout Vectors** | UMA Optimistic Oracle on-chain | Determines realized P&L for resolved markets |
| **Fee Formula** | Symmetric: `baseRate × min(price, 1-price) × amount` | Can be 0.5-10% of trade value |
| **Market Mapping** | Gamma API `/markets` endpoint | MUST sync daily for token ID lookup |
| **Position Valuation** | Current price (open) or payout value (resolved) | Foundation of all P&L calculations |

---

## THE THREE-LAYER ENCODING SYSTEM

### Layer 1: Condition ID
```
Input:   oracle + questionId + outcomeCount
Method:  keccak256(abi.encodePacked(...))
Output:  bytes32 (unique market identifier)
```

### Layer 2: Collection IDs (one per outcome)
```
Input:   parentCollectionId=0 + conditionId + indexSet
Method:  Elliptic curve (alt_bn128) - NOT invertible
Output:  Two bytes32 values (YES=indexSet 1, NO=indexSet 2)
```

### Layer 3: Position IDs (ERC-1155 Token IDs)
```
Input:   collateralToken (USDC) + collectionId
Method:  keccak256(abi.encode(...))
Output:  bytes32 (actual ERC-1155 token ID)
```

**Key Constraint:** Layer 3 is a one-way hash. You CANNOT reverse-engineer from position ID back to condition ID without the Gamma API.

---

## YOUR CURRENT GAPS & SOLUTIONS

### Gap 1: Token ID → Market Mapping
**Problem:** Raw token IDs from on-chain with no market context  
**Solution:**  
```sql
-- Sync from Gamma API daily
SELECT 
  market_id,
  condition_id,
  clob_token_ids[0] as yes_token,
  clob_token_ids[1] as no_token
FROM gamma_markets
WHERE active = true
```

### Gap 2: Position Value Calculation
**Problem:** Using only current price, ignoring resolved markets  
**Solution:**
```sql
-- Check if market is resolved
SELECT 
  condition_id,
  CASE 
    WHEN payout_denominator > 0 
    THEN position_balance * (payout_numerator / payout_denominator)
    ELSE position_balance * current_market_price
  END as position_value
```

### Gap 3: Fee Calculation
**Problem:** Applying flat fees without symmetry  
**Solution:**
```
actualFee = 0.005 × min(price, 1-price) × amount

Example: Selling 100 at $0.80
  Fee = 0.005 × min(0.80, 0.20) × 100 = $0.10
  NOT 0.005 × $80 = $0.40 (wrong)
```

### Gap 4: Realized vs. Unrealized
**Problem:** Conflating the two categories  
**Solution:**
```
Unrealized = (balance × current_price) - cost_basis
Realized = SUM(sale_proceeds - allocated_cost)
Total = Realized + Unrealized - Fees

When market resolves:
Unrealized = (balance × (payout/denominator)) - cost_basis
```

---

## INSTANT ACTION ITEMS

### Step 1: Get Gamma API Data (NOW)
```bash
# Get all active markets with token IDs
curl -s https://gamma-api.polymarket.com/markets | jq '.[] | {
  id, 
  conditionId, 
  clobTokenIds, 
  outcomePrices, 
  endDate
}'
```

### Step 2: Validate Your Token IDs (TODAY)
```sql
-- Check if your stored token IDs match Gamma API
SELECT 
  token_id,
  COUNT(*) as usage_count
FROM trades_raw
GROUP BY token_id
HAVING COUNT(*) > 10  -- Major tokens only
LIMIT 20
-- Cross-reference these against Gamma API
```

### Step 3: Query for Resolved Markets (THIS WEEK)
```sql
-- Get payout data from UMA Oracle
SELECT 
  condition_id,
  payout_denominator,
  payout_numerators[1] as outcome_1_payout,
  payout_numerators[2] as outcome_2_payout,
  resolved_at
FROM market_resolutions
WHERE payout_denominator > 0
```

### Step 4: Compare Against Official API (THIS WEEK)
```bash
# Pick 10 wallets and compare
curl -s "https://data-api.polymarket.com/positions?user=0x..." | 
  jq '.[] | {
    token_id,
    balance,
    entry_price,
    current_price,
    pnl
  }'
# Compare against your calculations
```

---

## API ENDPOINTS YOU NEED

### Gamma Markets API (For Token ID Mapping)
```
Base: https://gamma-api.polymarket.com

GET /markets
  Returns: market_id, condition_id, clob_token_ids[], prices
  Frequency: Sync daily (changes slowly)
  Rate limit: ~100 req/sec
```

### Data API (For P&L Validation)
```
Base: https://data-api.polymarket.com

GET /positions?user=0x...
  Returns: current holdings with entry_price, current_value, pnl
  Usage: Compare your calculations against this

GET /trades?user=0x...
  Returns: trade history with prices and amounts
  Usage: Rebuild cost basis from official data

GET /holders?conditionId=0x...&limit=100
  Returns: top holders for a market
  Usage: Whale tracking for smart money
```

### CLOB API (For Historical Prices)
```
Base: https://clob.polymarket.com

GET /historical/prices?token=0x...&limit=1000&start_time=1634000000
  Returns: historical prices with timestamps
  Usage: Backtest and validate position values
```

---

## SMART CONTRACTS TO MONITOR

### Gnosis ConditionalTokens
**Address:** 0x4D97DCd97eC945f40cF65F87097ACE5EA0476045 (Polygon)  
**Key Functions:**
- `payoutDenominator(bytes32 conditionId)` → Get denominator for payout vector
- `payoutNumerators(bytes32 conditionId, uint index)` → Get numerator for each outcome
- `balanceOf(address, uint tokenId)` → Current position balance

### CTF Exchange (Polymarket)
**Address:** 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E (Polygon)  
**Key Functions:**
- `registerToken(uint tokenId, uint complementId, bytes32 conditionId)` → Token metadata
- Token transfer events → Trade execution (MINT, MERGE, NORMAL)

---

## FORMULAS YOU NEED (COPY-PASTE)

### Position Value (Open Market)
```sql
position_value_usd = position_balance * current_market_price
```

### Position Value (Resolved Market)
```sql
-- First, get payout vector from ConditionalTokens
SELECT payout_numerator, payout_denominator FROM conditions WHERE id = condition_id

-- Then calculate
position_value_usd = position_balance * (payout_numerator / payout_denominator)
```

### Realized P&L
```sql
realized_pnl = COALESCE(sale_proceeds, 0) + COALESCE(redemption_value, 0) - cost_basis
-- Where:
-- sale_proceeds = SUM(sale_amount × sale_price) for each SELL trade
-- redemption_value = position_balance × (payout_numerator / payout_denominator)
-- cost_basis = SUM(buy_amount × buy_price) for each BUY trade
```

### Unrealized P&L
```sql
unrealized_pnl = position_value - (position_balance * average_entry_price)
-- Where position_value comes from the two formulas above
```

### Total P&L
```sql
total_pnl = realized_pnl + unrealized_pnl - total_fees
```

### Fee Calculation (CTF Exchange)
```sql
-- For selling outcome tokens at price P
fee_usd = base_rate_bps / 10000 * MIN(price, 1-price) * token_amount

Example: base_rate = 50 bps (0.5%), selling 100 tokens at $0.75
  fee = (50/10000) * MIN(0.75, 0.25) * 100 = 0.005 * 0.25 * 100 = $0.125
```

---

## DATA QUALITY CHECKS

### Before Using Any P&L Number

1. **Token ID Validation**
   ```sql
   -- Verify token ID matches Gamma API
   SELECT COUNT(DISTINCT condition_id) FROM trades WHERE token_id = '0x...'
   -- Should match exactly one condition_id
   ```

2. **Payout Vector Check**
   ```sql
   -- Verify denominator is set (market resolved)
   SELECT payout_denominator FROM conditions WHERE id = condition_id
   -- Should be > 0 for resolved markets
   ```

3. **Balance Continuity**
   ```sql
   -- Verify balance calculations are correct
   SELECT 
     SUM(CASE WHEN side='BUY' THEN amount ELSE -amount END) as calculated_balance,
     actual_balance
   FROM trades
   GROUP BY wallet, token_id
   -- Should match
   ```

4. **Realized P&L Validation**
   ```sql
   -- For resolved markets, realized P&L should equal final position value minus cost
   SELECT 
     realized_pnl,
     (final_balance * (payout_num / payout_denom)) - cost_basis as expected_pnl
   FROM positions
   WHERE market_is_resolved = true
   -- Should match (within rounding)
   ```

---

## COMMON MISTAKES TO AVOID

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Using token ID as market ID | Non-invertible hash, not unique to market | Use Gamma API to map token → market |
| Flat 0.5% fees | Breaks at extremes (at $0.01, wrong by 2x) | Use symmetric formula with min(P, 1-P) |
| Same P&L for resolved/unresolved | Unresolved uses market price, resolved uses payout | Check payout_denominator > 0 |
| Ignoring fees in P&L | Fees can be 1-10% of trade | Subtract from proceeds/balance |
| Not tracking cost basis | Can't calculate realized P&L | Store weighted average entry price |
| Summing realized + unrealized wrong | Double-counts SOLD positions | Use SELL trades for realized, HOLD for unrealized |

---

## INSTANT VALIDATION QUERY

```sql
-- Compare your P&L against Polymarket's official Data API
WITH your_pnl AS (
  SELECT 
    wallet,
    condition_id,
    token_id,
    SUM(CASE WHEN side='BUY' THEN amount ELSE -amount END) as balance,
    SUM(CASE WHEN side='BUY' THEN amount*price ELSE -amount*price END) as cost_basis,
    (
      balance * current_price - cost_basis
    ) as calculated_pnl
  FROM trades
  GROUP BY wallet, condition_id, token_id
)
SELECT 
  y.wallet,
  y.token_id,
  y.calculated_pnl as cascadian_pnl,
  p.pnl as polymarket_pnl,
  ABS(y.calculated_pnl - p.pnl) as difference
FROM your_pnl y
JOIN polymarket_api_positions p ON y.wallet = p.user AND y.token_id = p.tokenId
WHERE ABS(y.calculated_pnl - p.pnl) > 0.01  -- Flag differences > 1 cent
ORDER BY difference DESC
```

---

## REFERENCES

- **Full Research Report:** See `POLYMARKET_CTF_RESEARCH_COMPREHENSIVE.md`
- **Gamma API Docs:** https://docs.polymarket.com/developers/gamma-markets-api/overview
- **CTF Overview:** https://docs.polymarket.com/developers/CTF/overview
- **Gnosis Guide:** https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html

---

**Status:** RESEARCH COMPLETE - READY FOR IMPLEMENTATION  
**Confidence:** HIGH - All data from official sources  
**Next:** Use this to rebuild your P&L system

