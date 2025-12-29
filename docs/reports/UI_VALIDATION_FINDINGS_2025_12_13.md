# UI Validation Findings - CRITICAL BUGS DISCOVERED

**Date:** 2025-12-13
**Validation Method:** Playwright MCP scraping of Polymarket UI profiles
**Cohort Table:** `pm_cohort_pnl_active_v1`

---

## Executive Summary

**VALIDATION FAILED** - The cohort PnL calculation has fundamental bugs that make the data unusable.

- **Wallets Validated:** 7
- **Within Tolerance (±15%):** 1 (14%)
- **Major Discrepancies:** 6 (86%)
- **Sign Flips:** 2 (showing profit when UI shows loss, or vice versa)

---

## Validation Results

| # | Wallet | Cohort PnL | UI P/L | Ratio | Status |
|---|--------|-----------|--------|-------|--------|
| 1 | 0xadb7696b | -$1,883.10 | -$1,592.95 | 0.85x | **CLOSE** |
| 2 | 0xf9fc56e1 | -$1,997.95 | +$1,618.24 | SIGN FLIP | **BUG** |
| 3 | 0xf70acdab | +$301.08 | +$40.42 | 7.45x | **BUG** |
| 7 | 0x13cb8354 | +$9,927.14 | +$8.72 | 1139x | **BUG** |
| 10 | 0x46e669b5 | -$483.93 | -$4.77 | 101x | **BUG** |
| 15 | 0x88cee1fe | +$437.67 | -$67.54 | SIGN FLIP | **BUG** |
| 40 | 0x1e8d2119 | +$23,266.39 | +$4,160.93 | 5.59x | **BUG** |

---

## Root Cause Analysis

### Issue 1: No Taker-Only Filtering
The cohort build script at `scripts/build-cohort-pnl-table.ts` does NOT filter to taker-only events (`event_id LIKE '%-t'`). This means:
- Both taker AND maker events are counted
- For market makers, this roughly doubles their volume

### Issue 2: ERC1155 Transfer Blindness
The PnL formula `sum(sells) - sum(buys)` does not account for shares that enter/leave wallets via ERC1155 transfers:
- Shares can be received via transfers (not trades)
- When sold, the full sale price is counted as profit
- Example: Wallet 0x13cb8354 received ~10,620 shares via transfer, sold them for $10,551
  - Our cohort shows: +$9,927 profit
  - UI shows: +$8.72 actual profit

### Issue 3: Double-Counting on Multi-Outcome Markets
For markets with multiple outcomes, the current aggregation may be counting the same USDC flow multiple times.

---

## Detailed Wallet Investigations

### Wallet 0xf70acdab (7.45x discrepancy)
- **Username:** @Patapam222
- **Closed Positions:** 2 total
  1. Cardano ETF - WON: Bet $160.76, Won $324.03 (+$163.27)
  2. ETH hard fork - LOST: Bet $335.20, Got $212.35 (-$122.85)
- **Actual Net:** +$163.27 - $122.85 = **+$40.42** (matches UI exactly)
- **Cohort says:** +$301.08 (7.45x inflated)

### Wallet 0x46e669b5 (101x discrepancy)
- **Username:** @mnfgia
- **Trading Style:** High-confidence "No" bets at 99.9¢
- **Volume:** $7,916.07
- **UI P/L:** Gain +$7.27, Loss -$12.03, Net -$4.77
- **Cohort says:** -$483.93 (100x more negative)

### Wallet 0x13cb8354 (1139x discrepancy)
- **Analysis:** Market maker/wash trader
- **Net share position:** Sold 10,620 more shares than bought via trades
- **Explanation:** Shares received via ERC1155 transfers, then sold
- **Cohort formula:** Counts full sale price as "profit"

---

## Recommendations

### Immediate Actions (Before Continuing Validation)

1. **Fix Taker-Only Filtering**
   ```sql
   WHERE event_id LIKE '%-t'  -- Add this filter
   ```

2. **Account for ERC1155 Transfers**
   - Join with `pm_erc1155_transfers` to get share inflows/outflows
   - Adjust cost basis when shares are received via transfer

3. **Validate Formula Against Known Wallets**
   - Use the 7 wallets above as a regression test
   - Target: 80%+ within ±15% tolerance

### Do NOT Continue Large-Scale Validation
The current cohort data is fundamentally incorrect. Validating more wallets will only confirm more bugs. Fix the calculation first.

---

## Technical Details

### UI Tooltip Fields (Polymarket)
- **Volume traded:** Total USDC flow through positions
- **Gain:** Sum of profits from winning positions
- **Loss:** Sum of losses from losing positions
- **Net total:** Gain - Loss (this is "Realized PnL")

### Cohort Calculation (Current - BROKEN)
```sql
SELECT
  trader_wallet AS wallet,
  SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) -
  SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) AS realized_pnl_usd
FROM deduped_trades
GROUP BY trader_wallet
```

Problems:
1. No taker-only filter
2. No transfer accounting
3. No resolution status tracking

---

## Next Steps

1. [ ] Review `scripts/build-cohort-pnl-table.ts` in detail
2. [ ] Add taker-only filtering
3. [ ] Investigate ERC1155 transfer integration
4. [ ] Rebuild cohort table
5. [ ] Re-validate against these 7 wallets
6. [ ] If >70% pass, continue to full 200-wallet validation

---

**Report Generated:** 2025-12-13
**Validation Terminated:** Root cause bugs discovered
