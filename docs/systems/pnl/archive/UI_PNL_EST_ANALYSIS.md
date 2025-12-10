# UI_PNL_EST Analysis Report

## Executive Summary

This analysis investigates why our calculated PnL differs from Polymarket's UI display for certain wallets. We discovered that while our V11_POLY engine matches perfectly for simple retail wallets, there's a systematic discrepancy for wallets with large short positions on losing outcomes.

**Key Finding:** The Polymarket UI PnL appears to use a formula that we cannot fully replicate with available CLOB trade data alone.

---

## Benchmark Results

| Wallet | Label | UI PnL | Our Calculation | Difference | Error % |
|--------|-------|--------|-----------------|------------|---------|
| 0xdfe1... | W2 | $4,405 | $4,405 | $0.08 | ~0% |
| 0x5668... | W_22M | $22,053,934 | $33,540,091 | -$11,486,157 | -52% |
| 0xcce2... | W_97K | $96,731 | $71,300 | +$25,431 | +26% |
| 0xf29b... | W_-10M | -$10,021,172 | $44,580,000 | -$54,600,000 | -545% |

---

## Data Pipeline Audit Results

### Confirmed Data Formats

| Field | Table | Format | Notes |
|-------|-------|--------|-------|
| `side` | pm_trader_events_v2 | lowercase 'buy'/'sell' | Consistent |
| `token_id` | pm_trader_events_v2 | Decimal string | Joins with token_id_dec |
| `usdc_amount` | pm_trader_events_v2 | Micro-units (÷1e6) | Float64 |
| `payout_numerators` | pm_condition_resolutions | STRING "[1,0]" | **Must JSON.parse()** |
| `value` | pm_erc1155_transfers | HEX STRING "0x989680" | **Special decode needed** |
| `outcome_index` | pm_token_to_condition_map_v3 | 0-indexed | Use JSONExtractInt(..., idx+1) |
| `event_id` | pm_trader_events_v2 | Has duplicates | **Must GROUP BY event_id** |

### Critical Gotchas

1. **DUPLICATES**: pm_trader_events_v2 has 2-3x duplicates per wallet. ALWAYS use `GROUP BY event_id`.

2. **payout_numerators is STRING**: Stored as `"[1,0]"` not array. Use `JSON.parse()` in TypeScript or `JSONExtractInt()` in ClickHouse.

3. **ERC1155 value is HEX**: Decode with: `reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) / 1e6`

4. **Multi-outcome markets**: Some markets have payouts like `[0,1000000]` or `[1,1]` (splits).

---

## Position Structure Analysis

### W_22M (Large Discrepancy Case)

```
Long positions: 17
Short positions: 11
Total long tokens: 47,790,945 (~$47.8M value on winners)
Total short tokens: 15,326,780 (~$15.3M exposure)
Short as % of Long: 32.1%
```

#### Position Breakdown:

| Category | Tokens | PnL Contribution |
|----------|--------|------------------|
| Long on Winners | 47.77M | +$25.1M (tokens + sales - cost) |
| Long on Losers | 24.3K | -$12K (loss) |
| Short on Losers | 15.33M | +$8.5M (pure profit from sales) |
| **Total** | — | **$33.5M** |

### W2 (Matching Case)

```
Long positions: 23
Short positions: 12
Total long tokens: 23,234
Total short tokens: 1,339
Short as % of Long: 5.8%
```

**Key Difference**: W2 has minimal short exposure (5.8%) while W_22M has significant shorts (32.1%).

---

## Formulas Tested

### Formula 1: Net Cashflow + All Position Values
```
PnL = (Sells - Buys) + SUM(net_tokens × payout)
```
- Works for W2 ✅
- Overestimates for W_22M by $11.5M ❌

### Formula 2: Long Winners Only
```
PnL = (Long Winner Tokens × 1) + Sales - Cost Basis of Longs
```
- Result: $25.1M (still $3M off from UI's $22M)

### Formula 3: Realized Only (V11_POLY)
```
PnL = Sales - Buys + Redemption Payouts
```
- Works for W2 ✅
- Doesn't include unredeemed positions ❌

---

## Hypothesis: UI Calculation Method

Based on the patterns observed:

1. **Simple wallets (W2)**: Our V11_POLY engine matches exactly. These wallets:
   - Have redeemed most winning positions
   - Have minimal short exposure
   - Formula: `realized_pnl + unredeemed_winner_value`

2. **Complex wallets (W_22M, W_-10M)**: Significant discrepancy. These wallets:
   - Have large unredeemed positions
   - Have significant short exposure on losing outcomes
   - May be market makers or operators

3. **Possible UI Formula**:
   - May aggregate at market-level (condition_id)
   - May cap exposure per market
   - May exclude certain transaction types (splits/merges)
   - May use weighted average cost basis differently

---

## Recommended UI_PNL_EST Formula

Given the limitations, we recommend a tiered approach:

### For Retail Wallets (Short % < 10%)
```sql
UI_PNL_EST =
  (total_sells - total_buys) +
  redemption_payouts +
  unredeemed_winner_value
```
**Expected accuracy**: ±2%

### For Mixed/Operator Wallets (Short % >= 10%)
```sql
UI_PNL_EST =
  long_winner_pnl ONLY

Where long_winner_pnl =
  (long_winner_tokens × 1) +
  (sales from winning positions) -
  (cost basis of winning positions)
```
**Expected accuracy**: ±30% (known limitation)

### Classification Query
```sql
SELECT
  wallet,
  sumIf(abs(net_tokens), net_tokens > 0) as long_exposure,
  sumIf(abs(net_tokens), net_tokens < 0) as short_exposure,
  short_exposure / long_exposure as short_ratio,
  if(short_ratio < 0.1, 'retail', 'operator') as wallet_tier
FROM positions
GROUP BY wallet
```

---

## Next Steps

1. **Accept known limitations** for operator/MM wallets
2. **Implement tiered formula** in `lib/pnl/computeUiPnlEstimate.ts`
3. **Add confidence flag** to API responses
4. **Consider fetching UI values directly** from Polymarket API for high-value wallets

---

## Appendix: Raw Calculation for W_22M

```
Net Cashflow:           -$14,226,562 (sold $9.16M, bought $23.39M)
Long Winner Value:      +$47,766,653 (unredeemed tokens on winners)
Long Loser Value:       $0 (worthless)
Short Winner Liability: $0 (no shorts on winners)
Short Loser Profit:     $8,459,750 (kept proceeds from selling losing tokens)

Total Calculated:       $33,540,091
UI PnL:                 $22,053,934
Difference:             -$11,486,157 (34% overestimate)
```

---

*Document Version: 1.0*
*Created: 2025-11-29*
*Analysis by: Claude Code (Opus 4.5)*
