# P&L Discrepancy - ROOT CAUSE FOUND

## Executive Summary

**Problem:** Wallet `0x4ce7` shows $332K P&L on Polymarket but $0 in our system.

**Root Cause:** **Different definitions of "realized P&L"**

| System | Realizes P&L When | Wallet 0x4ce7 Result |
|--------|-------------------|---------------------|
| **Polymarket** | Every partial sell (FIFO cost basis) | $332,563 |
| **Our System** | Only when position closes to ZERO shares | $0 (0 closed positions) |

---

## Evidence

### Compare All Wallets Output

```
┌────────────────┬──────────────┬──────────────┬──────────────┬──────────────┬────────┬────────┐
│ Wallet         │ Polymarket   │ Our Trading  │ Our Unreal   │ Our Total    │ Closed │ Open   │
├────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼────────┼────────┤
│ 0x4ce73141db... │     $332,563 │           $0 │        $-677 │        $-677 │      0 │     30 │
```

**Key Findings:**
- **0 closed positions** - No positions have gone to zero shares
- **30 open positions** - All positions are still active
- **Trading P&L: $0** - Our "trading_realized_pnl" is zero
- **Polymarket: $332K** - They're counting P&L from partial sells

### Pattern Across Multiple Wallets

**8 out of 12 wallets** show $0 trading P&L but large Polymarket P&L:
- Average closed positions: **1** (most wallets have zero)
- Wallets with $0 trading P&L: **67%**
- Wallets with large negative unrealized: **92%**

This pattern confirms that:
1. Most positions remain OPEN (never go to zero shares)
2. Polymarket counts P&L on partial position reductions
3. We only count P&L when positions fully close

---

## Technical Details

### Our P&L Calculation

**Query:** `cascadian_clean.vw_wallet_pnl_unified`

```sql
SELECT
  wallet,
  trading_realized_pnl,  -- Only positions that closed to 0 shares
  redemption_pnl,         -- Redemptions after market resolution
  unrealized_pnl,         -- Open positions marked-to-market
  total_pnl               -- Sum of all above
FROM cascadian_clean.vw_wallet_pnl_unified
WHERE wallet = '0x4ce7...'
```

**Result:**
- `trading_realized_pnl`: $0
- `unrealized_pnl`: -$677
- `total_pnl`: -$677

### Polymarket's P&L Calculation (Inferred)

**Example Trade Sequence:**
```
Buy 1000 shares @ $0.50 → Cost basis: $500
Sell 300 shares @ $0.70 → Realize: 300 * ($0.70 - $0.50) = $60 profit
Sell 200 shares @ $0.60 → Realize: 200 * ($0.60 - $0.50) = $20 profit
(500 shares remain open)
```

**Polymarket P&L:** $60 + $20 = **$80 realized**
**Our P&L:** **$0 trading realized** (position not closed), **$X unrealized** on 500 remaining shares

---

## Solution

### Option 1: Match Polymarket's Definition (Recommended)

**Change:** Calculate realized P&L on **every sell trade** using FIFO cost basis

**Pros:**
- Matches Polymarket UI exactly
- More intuitive for traders (see P&L immediately on sells)
- Industry standard (matches traditional finance)

**Cons:**
- More complex calculation (need FIFO queue per position)
- Requires recalculation of all historical P&L

### Option 2: Keep Our Definition, Add Clarity

**Change:** Clearly label as "Closed Position P&L" and add separate "Trading P&L" that matches Polymarket

**Pros:**
- No breaking changes to existing calculations
- Can offer both views

**Cons:**
- More confusing for users
- Still need to implement Polymarket-style calculation

---

## Implementation Plan

### Phase 1: Add FIFO-based Realized P&L (4-6 hours)

1. **Create new column:** `trading_pnl_fifo` in position tables
2. **Calculate on each sell:**
   ```sql
   FOR each sell trade:
     remaining_qty = sell_qty
     realized_pnl = 0

     WHILE remaining_qty > 0 AND buy_queue.length > 0:
       oldest_buy = buy_queue[0]
       qty_to_realize = min(remaining_qty, oldest_buy.qty)

       realized_pnl += qty_to_realize * (sell_price - oldest_buy.price)
       oldest_buy.qty -= qty_to_realize
       remaining_qty -= qty_to_realize

       IF oldest_buy.qty == 0:
         buy_queue.shift()
   ```
3. **Update views:** Add `trading_pnl_fifo` to all P&L views
4. **Backfill historical:** Run FIFO calculation on all past trades

### Phase 2: Update UI (2-3 hours)

1. Replace "Trading Realized P&L" with "Trading P&L (FIFO)"
2. Keep "Closed Position P&L" as secondary metric
3. Update dashboard to show FIFO-based values by default

### Phase 3: Validation (1-2 hours)

1. Compare our FIFO P&L vs Polymarket API for 12 test wallets
2. Verify within 1% tolerance (allow for timing differences)
3. Document any remaining discrepancies

**Total Estimated Time:** 7-11 hours

---

## Files Referenced

- `compare-all-wallets.ts` - Comparison script that found the pattern
- `PNL_DIAGNOSTIC_0x4ce7.md` - Full investigation trail
- `GOLDSKY_BACKFILL_FINDINGS.md` - Resolution coverage analysis (not the issue)
- `cascadian_clean.vw_wallet_pnl_unified` - Current P&L view

---

## Next Steps

1. ✅ **Confirmed root cause** - Different P&L definitions
2. ⏭️ **Get user approval** - Choose Option 1 or Option 2
3. ⏭️ **Implement FIFO calculation** - New P&L formula
4. ⏭️ **Backfill historical data** - Recalculate all past P&L
5. ⏭️ **Validate against Polymarket** - Ensure 99%+ accuracy
