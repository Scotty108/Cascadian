# Equal-Weight Copy Trading Analysis
**Period:** Last 30 Days
**Generated:** 2026-01-26
**Data Source:** `pm_wallet_copy_trading_metrics_v1`
**Query:** `/scripts/analysis/equal-weight-copy-trade.ts`

---

## Executive Summary

This analysis identifies the most profitable wallets for **equal-weight copy trading** over the last 30 days. Equal-weight means investing the same amount in every trade, regardless of the wallet's actual position size. This isolates trading skill (ROI per trade) from capital allocation strategy.

### Top 3 Wallets for $1000/Trade Strategy

| Rank | Wallet | Simulated Profit | Trades | Win Rate | Avg ROI/Trade | Actual PnL |
|------|--------|------------------|--------|----------|---------------|------------|
| 1 | `0x08730443345e11c078c5b2597ce3c0f06af609e8` | $7,671,461 | 11,178 | 73.0% | 68.63% | $1,170 |
| 2 | `0x372e593fa57bed5525c41692d616be5555b54453` | $6,515,705 | 195,081 | 52.4% | 3.34% | $36,146 |
| 3 | `0x330efa1eaebfc30b51686879a846885ed546bf6c` | $6,146,790 | 394,025 | 59.1% | 1.56% | $30,153 |

---

## Key Findings

### 1. Volume vs. Skill Trade-off

**High-Volume/Low-ROI Strategy (Wallet #2, #3)**
- Trade count: 195k - 394k trades
- Avg ROI per trade: 1.56% - 3.34%
- Win rate: 52% - 59%
- Simulated profit: $6.5M - $6.1M per $1k/trade
- **Profile:** Extreme volume, tiny edges, mostly maker trades (93-97%)

**Moderate-Volume/High-ROI Strategy (Wallet #1)**
- Trade count: 11,178 trades
- Avg ROI per trade: 68.63%
- Win rate: 73%
- Simulated profit: $7.7M per $1k/trade
- **Profile:** Balanced approach with much higher per-trade edge

### 2. Actual PnL vs. Equal-Weight Simulation

There's a **massive discrepancy** between actual PnL and equal-weight simulation:

| Wallet | Equal-Weight Profit | Actual PnL | Avg Position Size |
|--------|---------------------|------------|-------------------|
| #1 | $7.7M (simulated) | $1,170 | $7 |
| #2 | $6.5M (simulated) | $36,146 | $5 |
| #13 | $960k (simulated) | **-$82,426** | $333 |
| #15 | $813k (simulated) | **-$395,508** | $457 |

**Interpretation:**
- These wallets make MANY small profitable trades but occasionally lose BIG on large positions
- Equal-weight eliminates the capital allocation risk
- Wallets #13 and #15 are **profitable traders** (59% win rate, positive ROI) but **terrible capital allocators**
- This suggests copy trading should use FIXED position sizes, NOT proportional sizing

### 3. Trading Patterns

**High Maker % = Market Making Strategy**
- Top 3 wallets: 93-99% maker trades
- These are likely market-making bots or arbitrageurs
- "Sold early" rates: 74-94% (taking quick profits)

**Red Flags:**
- Wallet #9: 390 trades, 88.7% win rate, but actual PnL = **-$1,883**
  - Avg loss ROI: -99.76% (total blowouts)
  - Win rate is misleading when losses wipe out all gains
- Wallet #13, #15: Positive expectancy per trade, but negative actual PnL
  - Position sizing discipline is critical

### 4. Risk Metrics Worth Watching

**Best Profit Factor (Wins/Losses):**
- Wallet #1: 11.01 (excellent)
- Wallet #12: 10.87 (865 wins, 135 losses)
- Wallet #17: 3.33 (solid)

**Worst Loss Percentages:**
- Most wallets have 90%+ of losses being >50% ROI loss
- Wallets #13, #15: 99-100% of losses are >90% (full liquidations)
- This is the NegRisk adapter problem manifesting in copy-trade metrics

### 5. Market Diversification

- Wallet #1: 773 unique markets (high diversification)
- Wallet #2: 2,221 markets (extreme diversification)
- Wallet #3: 2,681 markets (highest diversification)

High diversification + high volume = likely market-making strategy across many markets.

---

## Strategy Recommendations

### For Copy Trading Implementation:

1. **Use Fixed Position Sizes**
   - Do NOT copy proportional position sizes
   - Equal-weight strategy eliminates catastrophic loss risk
   - Target: $100-$1000 per trade depending on capital

2. **Filter by Profit Factor**
   - Minimum profit factor: 2.0+
   - This ensures wins significantly outweigh losses
   - Wallets #1, #12, #17, #14 meet this criteria

3. **Watch for Blowout Risk**
   - Avoid wallets with >95% losses being >90% (Wallets #9, #13, #15)
   - These wallets go to zero on losing trades
   - Even with high win rates, recovery is impossible

4. **Consider Trade Frequency**
   - Wallet #1: 372 trades/day (very high frequency)
   - Wallet #12: 50 trades/day (more manageable)
   - High frequency requires automated execution

5. **Validate Recency**
   - Top wallets last traded 10-11 days ago (as of Jan 26)
   - Check if they're still active before deploying capital

---

## Technical Notes

### Query Methodology

- **Table:** `pm_wallet_copy_trading_metrics_v1`
- **Timeframe:** Last 30 days (based on `last_trade_time`)
- **Filters:**
  - Minimum 5 trades
  - Minimum $5 avg trade size
  - Last trade within 30 days

### Equal-Weight Calculation

```
Profit per $X/trade = Avg ROI per trade × Total trades × $X
```

Example: Wallet #1
- Avg ROI: 68.63%
- Total trades: 11,178
- Profit per $1k/trade = 0.6863 × 11,178 × $1,000 = $7,671,461

### Limitations

1. **Historical Performance ≠ Future Results**
   - Market conditions change
   - Strategies may stop working
   - Wallets may stop trading

2. **Execution Slippage Not Modeled**
   - Copy trading introduces latency
   - Taker fees apply if copying maker trades
   - Market impact for large copy trades

3. **NegRisk Adapter Issues**
   - Some wallets show phantom losses from internal bookkeeping
   - Trust "Avg ROI" more than "Actual PnL" for these cases

4. **Survivorship Bias**
   - Only analyzing wallets still active in last 30 days
   - Dead/inactive wallets excluded

---

## Conclusion

**Winner: Wallet `0x08730443345e11c078c5b2597ce3c0f06af609e8`**

- **$7.7M simulated profit** at $1k/trade
- **68.63% avg ROI** per trade
- **73% win rate**
- **11.01 profit factor** (wins 11x larger than losses)
- **773 unique markets** (well diversified)
- **99% maker trades** (market-making strategy)

**Caveat:** This wallet trades 372 times per day. Copying requires:
- Automated execution system
- Low-latency infrastructure
- Sufficient capital to handle high frequency

**Runner-up: Wallet `0x110fbd0fe39eb16204e7f90e956cc995a64f8f39`** (Rank #12)
- **$1.1M simulated profit** at $1k/trade
- **111% avg ROI** per trade
- **86.5% win rate**
- **50 trades/day** (more manageable frequency)
- **10.87 profit factor**

This wallet offers similar profit factor with lower frequency, making it more practical for manual or semi-automated copy trading.

---

## Next Steps

1. **Validate Wallet Activity**
   - Check if top wallets are still trading
   - Most last traded 10+ days ago (stale data concern)

2. **Implement Real-Time Monitoring**
   - Track these wallets' ongoing performance
   - Set up alerts for when they place trades

3. **Build Copy Trading Infrastructure**
   - Automated trade execution
   - Fixed position sizing logic
   - Risk limits (max daily loss, max concurrent trades)

4. **Backtest with Slippage**
   - Model realistic execution delays
   - Factor in taker fees
   - Validate profitability after costs

---

**Full Analysis Output:** `/tmp/equal-weight-analysis-results.txt`
**Query Script:** `/Users/scotty/Projects/Cascadian-app/scripts/analysis/equal-weight-copy-trade.ts`
