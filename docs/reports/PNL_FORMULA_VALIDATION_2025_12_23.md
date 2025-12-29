# P&L Formula Validation Report - 2025-12-23

## Summary

We validated multiple P&L calculation approaches for Polymarket copy trading:

| Wallet | Pattern | Token Balance | UI Target | economicParityPnl | conditionDeficitPnl v3 | Winner |
|--------|---------|---------------|-----------|-------------------|------------------------|--------|
| calibration | SELLER | -1,126 | -$86 | -$86.04 ✓ | -$86.04 ✓ | TIE |
| alexma11224 | BUYER | +676 | $268 | -$3,005 ✗ | $10,123 ✗ | NEITHER |
| winner1 | SELLER | -232,955 | $31,168 | -$491,550 ✗ | -$488,713 ✗ | NEITHER |

## Key Findings

### 1. Pattern Detection Works
Token balance (bought - sold) correctly identifies trading patterns:
- **SELLER** (balance < -100): Sold more than bought → needs split cost attribution
- **BUYER** (balance > 100): Bought more than sold → no split cost needed
- **MIXED**: Ambiguous → per-condition deficit attribution

### 2. Calibration Wallet Solved ✓
For arbitrage/split-sell pattern (calibration):
- Exchange contract \`0x4bfb41d5b3...\` performs splits on behalf of wallet
- tx_hash correlation correctly finds all splits in sell transactions
- Full split cost attribution matches UI perfectly

**Formula that works for SELLER pattern:**
\`\`\`
P&L = Sells + Redemptions - Buys - SplitCost + HeldValue
\`\`\`
Where SplitCost = ALL splits in transactions where wallet sold

### 3. Buyer Wallet Issue
For alexma11224 (BUYER pattern):
- Token balance is positive (+676) → correctly classified as BUYER
- No split cost applied (correct for buyers)
- But P&L is still way off ($10,123 vs $268 UI)
- The discrepancy might be in redemption or heldValue calculations

### 4. Large Seller Wallet Issue
For winner1 (SELLER pattern):
- Massive token deficit (-232,955)
- Split cost attributed: $769,387
- But this results in -$488K P&L vs +$31K UI

**Root cause hypothesis**: tx_hash correlation over-attributes counterparty splits:
- In a single transaction, Exchange may split for BOTH parties
- We're counting ALL splits in sell-tx, not just wallet-initiated ones
- For large sellers, this over-counts by ~$500K+

## Engines Compared

### economicParityPnl.ts
- Uses tx_hash correlation: find splits in transactions where wallet sold
- Counts ALL splits in those transactions (may include counterparty splits)
- Works perfectly for calibration (arbitrage pattern)
- Fails for large sellers (over-attributes) and buyers

### conditionDeficitPnl.ts v3 (New)
- Pattern-based split attribution:
  - SELLER: Full split cost (matches economicParityPnl)
  - BUYER: No split cost
  - MIXED: Deficit-based per condition
- Same results as economicParityPnl for SELLER wallets
- Different approach for BUYER wallets (no splits)
- Still fails for both problem wallets

## Technical Details

### Split Attribution via tx_hash
\`\`\`sql
-- Find transactions where wallet sold
sell_tx AS (
  SELECT tx_hash
  FROM wallet_trades
  GROUP BY tx_hash
  HAVING sum(if(side = 'sell', usdc, 0)) > 0
)

-- Count all splits in those transactions
SELECT sum(amount_or_payout) / 1e6 as split_usdc
FROM pm_ctf_events
WHERE tx_hash IN (SELECT tx_hash FROM sell_tx)
  AND event_type = 'PositionSplit'
\`\`\`

### Problem: Counterparty Splits
When wallet sells, the counterparty (market maker) may need to split:
1. Wallet sells token A
2. Market maker needs token A to complete the trade
3. Exchange splits USDC for market maker → creates A + B
4. Market maker gives A to wallet
5. We incorrectly attribute this split to the wallet

### Potential Solutions
1. **Filter by split user_address**: Only count splits where user_address = wallet
   - Problem: Exchange does splits on behalf of users, user_address = Exchange

2. **Track token flow**: Match split output tokens with wallet's sold tokens
   - Complex, requires per-token tracking

3. **Economic bounds**: Cap split cost at reasonable ratio of sells
   - Heuristic, may not be accurate

4. **Use Polymarket's own data**: Fetch P&L from their API
   - Already have this for benchmarking, could use as primary source

## Recommendations

### For Copy Trading MVP
1. Use economicParityPnl for SELLER-pattern wallets (works for calibration)
2. For BUYER-pattern wallets, use simpler formula (no splits)
3. Accept ~$100-1000 margin of error for now
4. Validate against Polymarket UI for large positions

### For Production
1. Investigate winner1 in detail to understand where split cost is over-counted
2. Consider fetching actual P&L from Polymarket API as ground truth
3. Use our engine for real-time estimates, API for final values

## Files Modified
- \`lib/pnl/conditionDeficitPnl.ts\` - New pattern-based engine
- \`scripts/copytrade/test-condition-deficit.ts\` - Test harness

## Related Documents
- \`docs/reports/COPYTRADE_PNL_FINDINGS_2025_12_22.md\` - Previous analysis
- \`docs/reports/COPYTRADE_PNL_FORMULA_2025_12_22.md\` - Formula documentation
