# Winner Baseline Analysis - Executive Summary

**Purpose:** Plain-English explanation of what we're measuring and why it matters for copy-trading strategy.

**Last Updated:** 2025-11-11

---

## The Big Questions

Once wallet P&L is calculated, we need to answer these fundamental questions before building our copy-trading system:

### 1. **What Does "Winning" Actually Look Like?**

**Questions:**
- What's the average Omega ratio of the top 50 wallets?
- What's the average Omega of the top 100 whales (by total P&L)?
- What's the win rate of the #1 ranked wallet?

**Why It Matters:**
- Tells us if elite performance is Omega 2.0 or Omega 10.0
- Reveals whether "winners" are winning through:
  - **High win rate** (60-70%+ correct) → Consistent, predictable
  - **Big payoffs** (Omega 5+, win rate 55%) → Asymmetric bets
- Determines copy strategy (match high-frequency traders vs rare big bets)

**Example Outcome:**
> "Top 50 wallets average Omega 3.8, with median win rate 65%. This means elite traders win ~2/3 of the time, and their wins are 3.8× larger than their losses. If we copy them, expect similar ratios."

---

### 2. **How Rare is "Elite" Performance?**

**Questions:**
- How many wallets have Omega > 2.0?
- What percentile is Omega > 2.0? (Top 5%? Top 20%?)
- How does this change with minimum trade count?

**Why It Matters:**
- Tells us the size of our copy-tradeable population
- Reveals if our filters are too strict (< 10 wallets) or too loose (> 500)
- Shows if Omega > 2.0 is "superhuman" or "achievable"

**Example Outcome:**
> "87 wallets (3.2% of active traders) have Omega > 2.0 with 20+ trades. This is our target population. If we require 50+ trades, that drops to 34 wallets (1.2%)."

---

### 3. **Are Winners Actually Making Money?**

**Questions:**
- What's the total P&L of top 100 wallets?
- What's the average P&L per wallet in the elite cohort?
- How much capital did they deploy?

**Why It Matters:**
- Tells us the **market size** for copy trading
- Reveals if we can scale (deploy $1M? $100M?)
- Shows ROI potential (if top 100 made $5M total, copying them = share of that)

**Example Outcome:**
> "Top 100 wallets generated $4.3M in total P&L. Average per wallet: $43K. If we copy all of them with $1M, expected monthly return: 12-18%."

---

### 4. **What Thresholds Should We Use for Filtering?**

**Questions:**
- What Omega defines "top 10%"? Top 5%? Top 1%?
- What's the minimum win rate for top 10%?
- What ROI % separates elite from average?

**Why It Matters:**
- **Percentile-based filtering > absolute thresholds**
- In unpredictable markets (sports), best wallet might be 58% win rate
- Dynamic thresholds adapt as market changes

**Example Outcome:**
> "Top 10% threshold: Omega 1.85, Win Rate 62%, ROI 45%. Top 5%: Omega 2.4, Win Rate 68%, ROI 78%. We should filter by percentile, not fixed numbers."

---

### 5. **Can We Actually Copy Them?**

**Questions:**
- How often do elite wallets trade? (Daily? Weekly?)
- Are they still active? (Last trade date?)
- What's their position size? (Can we match it?)

**Why It Matters:**
- Some wallets trade 10×/day (hard to copy manually)
- Some trade 1×/month (not enough deal flow)
- If they trade $100K positions in illiquid markets, we can't scale

**Example Outcome:**
> "Elite wallets trade 2.3× per week on average. 78% traded in the last 7 days. Average position size: $8K. This is copy-tradeable at scale up to ~$20M AUM."

---

### 6. **What's the Risk Profile?**

**Questions:**
- What's the median max drawdown for top performers?
- Do high-Omega wallets have low drawdowns? (Safe?)
- What's the worst-case loss?

**Why It Matters:**
- Tells us **downside risk** if we copy them
- High Omega + low drawdown = skilled + safe
- High Omega + high drawdown = lucky or aggressive

**Example Outcome:**
> "Top 50 wallets: median max drawdown 18%, worst case 32%. If we copy them, expect to lose up to 20-30% during worst periods. This is tolerable for 3.8× Omega."

---

### 7. **Do More Trades = Better Performance?**

**Questions:**
- Do wallets with 100+ trades have higher Omega than 10-20 trade wallets?
- Is elite status persistent with more data?

**Why It Matters:**
- Separates **skill from luck**
- Wallets with 5 trades and Omega 10 = probably lucky
- Wallets with 100 trades and Omega 2.5 = proven edge

**Example Outcome:**
> "Wallets with 100+ trades: median Omega 1.9. Wallets with 10-19 trades: median Omega 1.6. Sample size matters, but not as much as selection. Use minimum 20 trades."

---

### 8. **Where Should We Focus?**

**Questions:**
- Which categories have the most elite wallets? (Politics? Crypto?)
- Which tags have >85% correctness? (Specialists/insiders?)
- Where is the most P&L being generated?

**Why It Matters:**
- **Resource allocation:** Deploy capital where edges exist
- **Tag specialists:** 85%+ correctness on "OpenAI releases" = insider
- **Category focus:** If Politics has 40 elite wallets and Sports has 3, prioritize Politics

**Example Outcome:**
> "Politics: 34 elite wallets, avg Omega 2.8. Crypto: 18 elite wallets, avg Omega 3.2. Sports: 7 elite wallets, avg Omega 2.1. Focus 60% capital on Politics, 30% Crypto, 10% Sports."

---

## The Copy-Trading Strategy Decision Tree

Based on these benchmarks, we'll know:

```
IF (top 50 avg Omega > 3.0 AND median win rate > 65%)
  → Strategy: Copy high-frequency, consensus-based
  → Expected: Steady 10-15% monthly returns, low volatility

ELSE IF (top 50 avg Omega > 3.0 BUT median win rate < 60%)
  → Strategy: Copy asymmetric payoff specialists
  → Expected: 20-30% monthly returns, higher volatility

ELSE IF (top 50 avg Omega 2.0-3.0)
  → Strategy: Selective copy (only top 10 wallets)
  → Expected: 8-12% monthly returns, moderate risk

ELSE (top 50 avg Omega < 2.0)
  → Strategy: Market too efficient, reconsider copy trading
  → Expected: <5% returns, not worth operational complexity
```

---

## What We'll Document After Running Queries

### Results File: `/docs/features/winner-baseline-results.md`

**Will contain:**
1. **Actual Benchmarks:**
   - Top 50 avg Omega: `[ACTUAL]`
   - Top 50 median win rate: `[ACTUAL]`
   - Elite wallet count: `[ACTUAL]`

2. **Thresholds Discovered:**
   - Top 10% Omega: `[ACTUAL]`
   - Top 5% Omega: `[ACTUAL]`
   - Top 1% Omega: `[ACTUAL]`

3. **Copy Strategy Recommendation:**
   - Based on actual data, which strategy tier applies
   - Capital allocation by category/tag
   - Expected returns and risk profile

4. **Top 10 Wallet Profiles:**
   - Individual wallet characteristics
   - Specific wallets to analyze deeper
   - Potential insider/specialist identification

---

## How This Feeds Into Product

### Leaderboard Views

**Once we know thresholds:**
- `/api/leaderboard/omega` → Top 50 by Omega (threshold: discovered)
- `/api/leaderboard/whales` → Top 100 by P&L (threshold: discovered)
- `/api/leaderboard/tag-specialists` → >85% correctness per tag
- `/api/leaderboard/category` → Top 10 per category

### Copy Trading Filters

**Dynamic filters based on percentiles:**
```typescript
// Instead of hardcoded:
omega_ratio > 2.0  ❌

// Use discovered thresholds:
omega_ratio > percentile_90th  ✅
// (adjusts as market changes)
```

### Dashboard Metrics

**Real-time tracking:**
- "Elite Population: 87 wallets" (updates daily)
- "Median Elite Omega: 3.2" (trending)
- "Top 100 Total P&L: $4.3M" (market size)
- "Copy Capacity: $18M AUM" (liquidity estimate)

---

## Expected Timeline

1. **Run Queries:** 10 minutes (once data ready)
2. **Document Results:** 30 minutes
3. **Adjust Filters:** 1 hour (update code with discovered thresholds)
4. **Build Leaderboard Views:** 2-3 hours
5. **Create Dashboard:** 4-6 hours
6. **Test Copy Trading:** 1-2 days

**Total:** ~3-4 days from "data ready" to "live copy trading"

---

## Why This Matters

**Without these benchmarks:**
- ❌ Guessing at thresholds ("Omega > 2.0 sounds good?")
- ❌ Don't know market size (can we deploy $1M or $100M?)
- ❌ Don't know risk profile (how bad can it get?)
- ❌ Can't validate strategy assumptions

**With these benchmarks:**
- ✅ Data-driven thresholds (top 10% = Omega 1.85)
- ✅ Know addressable market ($18M copy capacity)
- ✅ Understand risk (median drawdown 18%)
- ✅ Validate ROI expectations (12-18% monthly realistic)

---

## Next Actions

1. ✅ **Benchmark queries documented** → `/docs/features/winner-baseline-benchmark-queries.md`
2. 🔴 **Wait for wallet P&L calculation** → `/scripts/calculate-wallet-pnl.ts` (in progress)
3. 🔴 **Run all benchmark queries** → `npx tsx scripts/run-winner-benchmarks.ts`
4. 🔴 **Document results** → `/docs/features/winner-baseline-results.md`
5. 🔴 **Adjust copy-trading filters** → Update code with discovered thresholds
6. 🔴 **Build leaderboard APIs** → `/app/api/leaderboard/*`

---

**Status:** 🟡 **READY TO EXECUTE** (waiting on P&L data)
**Priority:** HIGH
**Blocking:** Copy-trading strategy finalization
**Owner:** Claude 1

---

**Key Insight:**

> We're not just building leaderboards. We're discovering the **actual characteristics of winners** so we can build a copy-trading system that works in reality, not theory. These benchmarks tell us:
>
> - Who to copy (top 10% = Omega X)
> - How much to expect (ROI Y%)
> - How much risk (drawdown Z%)
> - How much capital (liquidity capacity $M)
>
> Without this data, we're flying blind.

**Last Updated:** 2025-11-11
**Signed:** Claude 1
