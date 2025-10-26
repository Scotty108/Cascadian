# Smart Money Flow & Market SII System

**Version:** 2.0
**Last Updated:** 2025-10-24
**Status:** Updated Architecture

## Overview

The Smart Money Flow system analyzes prediction market liquidity **by wallet intelligence**, showing not just how much money is on each side, but **whose** money it is. The core metric is **SII (Signal Intelligence Index)** - a market-level score that measures the quality and directional imbalance of participants.

### The Problem It Solves

Traditional prediction markets show:
```
YES: $5M (60%)
NO: $5M (40%)
```

But this doesn't tell you WHO is betting. With Market SII:
```
YES: $5M total
  → Top 20 wallets: $4M (avg smart score: 82.3)
  → Remaining: $1M (avg smart score: 45.2)

NO: $5M total
  → Top 20 wallets: $1M (avg smart score: 51.7)
  → Remaining: $4M (avg smart score: 38.9)

💡 Market SII Signal: +30.6 (Smart money strongly favors YES!)
💡 SII Confidence: 83% (Top wallets control 83% of liquidity)
```

---

## Key Definitions (v2.0 Architecture)

### Smart Score (Wallet-Level)

**Individual wallet performance score (0-100)** based on:
- Omega ratio (probability-weighted gains vs losses)
- Omega momentum (is their edge improving?)
- Sharpe ratio (risk-adjusted returns)
- Win rate, EV/hour, trade count

**Calculated from**: Historical trade data via ClickHouse database

**See**: `/supabase/docs/wallet-analytics-architecture.md` for full details

### Market SII (Market-Level)

**Signal Intelligence Index** - measures quality and imbalance of participants in a specific market:

**SII Signal** (-100 to +100):
- Positive = Smart money favors YES
- Negative = Smart money favors NO
- Formula: `(yes_avg_score - no_avg_score)`

**SII Confidence** (0-100%):
- How much of liquidity is from top wallets?
- Formula: `(top_N_liquidity / total_liquidity) × 100`

**Calculated from**: Top N wallet positions per market (configurable N: 20, 50, 100)

---

## Architecture

### Power Law Optimization (New in v2.0)

Instead of scoring all wallets globally, we:
1. Identify top N wallets per market by position size
2. Only calculate scores for those wallets (~5,000 globally)
3. Calculate market SII based on their directional bias

**Benefits**:
- 10x less data to process
- Real-time calculations feasible
- Configurable N per signal/strategy

### 5-Tier Wallet Classification (Deprecated)

| Tier | Score Range | Color | Label |
|------|------------|-------|-------|
| **Elite** | 85-100 | Purple | Elite Traders |
| **Smart** | 70-84 | Green | Smart Money |
| **Average** | 50-69 | Gray | Average |
| **Poor** | 0-49 | Red | Poor Performers |
| **Unknown** | No data | Dark Gray | Unscored |

### Three Key Metrics

**1. Smart Money Sentiment** (-100 to +100)
- Positive = Smart money favors YES
- Negative = Smart money favors NO
- Formula: `(SmartYES - SmartNO) / TotalSmart × 100`

**2. Confidence** (0-100%)
- How much smart money is involved?
- Formula: `SmartMoney / TotalLiquidity × 100`
- High confidence (60%+) = trustworthy signal
- Low confidence (<30%) = not enough smart money

**3. Divergence** (0-100%)
- How much smart money disagrees with market price?
- Formula: `abs(SmartMoneyYES% - MarketYES%)`
- High divergence (>25%) = opportunity
- Low divergence (<10%) = market is efficient

---

## How It Works

### Step 1: Fetch Market Positions

```typescript
// Get all positions for a market
GET /api/polymarket/market/[conditionId]/positions

Response:
[
  {
    walletAddress: "0x123...",
    side: "YES",
    shares: 1000,
    avgPrice: 0.60,
    currentValue: 600
  },
  // ... more positions
]
```

### Step 2: Score Each Wallet

```typescript
// For each unique wallet:
1. Check cache first (scores are expensive to calculate)
2. If not cached:
   - Fetch wallet's closed positions
   - Calculate category scores
   - Calculate overall score (0-100)
   - Cache for 1 hour

Result:
{
  "0x123...": 85 (Elite),
  "0x456...": 45 (Poor),
  "0x789...": null (Unknown)
}
```

### Step 3: Calculate Smart Money Flow

```typescript
calculateSmartMoneyFlow(positions, scores):
1. Group positions by side (YES/NO)
2. Classify each wallet by tier
3. Sum liquidity per tier per side
4. Calculate:
   - Smart Money Sentiment
   - Confidence
   - Divergence
5. Generate recommendation
```

### Step 4: Visualize

```typescript
<SmartMoneyIndicator
  flow={smartMoneyFlow}
  recommendation={recommendation}
/>
```

---

## API Endpoints

### Get Smart Money Analysis

```typescript
GET /api/polymarket/market/[conditionId]/smart-money

Response:
{
  success: true,
  data: {
    marketId: "0xabc...",
    marketTitle: "Will Bitcoin hit $100K in 2025?",

    yes: {
      side: "YES",
      totalLiquidity: 5000000,
      tiers: [
        {
          tier: { tier: "elite", label: "Elite Traders", color: "#a855f7" },
          liquidity: 3000000,
          walletCount: 15,
          percentage: 60
        },
        {
          tier: { tier: "smart", label: "Smart Money", color: "#00E0AA" },
          liquidity: 1500000,
          walletCount: 45,
          percentage: 30
        },
        {
          tier: { tier: "average", label: "Average", color: "#94a3b8" },
          liquidity: 500000,
          walletCount: 200,
          percentage: 10
        }
      ],
      smartMoneyPercentage: 90, // 90% is Elite+Smart
      averageWalletScore: 78.5
    },

    no: {
      side: "NO",
      totalLiquidity: 3000000,
      tiers: [
        {
          tier: { tier: "smart", label: "Smart Money", color: "#00E0AA" },
          liquidity: 500000,
          walletCount: 10,
          percentage: 16.7
        },
        {
          tier: { tier: "poor", label: "Poor Performers", color: "#ef4444" },
          liquidity: 2500000,
          walletCount: 150,
          percentage: 83.3
        }
      ],
      smartMoneyPercentage: 16.7,
      averageWalletScore: 42.3
    },

    smartMoneySentiment: +65.2, // Strongly favors YES
    confidence: 56.8, // Medium-high confidence
    divergence: 18.3, // Moderate divergence

    recommendation: {
      action: "STRONG_YES",
      reason: "Smart money heavily favors YES (65% sentiment)",
      confidence: "medium"
    }
  }
}
```

---

## UI Components

### Basic Usage

```tsx
import { SmartMoneyIndicator } from '@/components/smart-money-indicator'
import { useSmartMoneyFlow } from '@/hooks/use-smart-money-flow'

function MarketPage({ conditionId }) {
  const { flow, recommendation, isLoading, error } = useSmartMoneyFlow(conditionId)

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  if (!flow) return null

  return (
    <SmartMoneyIndicator
      flow={flow}
      recommendation={recommendation}
    />
  )
}
```

### What Users See

**1. Overall Metrics Card**
- Smart Sentiment: +65% (Favors YES)
- Confidence: 57% (Medium-high)
- Divergence: 18% (Moderate opportunity)

**2. Side-by-Side Breakdown**

YES Side ($5M):
- 🟣 Elite: $3M (60%) | 15 wallets
- 🟢 Smart: $1.5M (30%) | 45 wallets
- ⚪ Average: $500K (10%) | 200 wallets
- Smart Money %: 90%
- Avg Wallet Score: 78.5/100

NO Side ($3M):
- 🟢 Smart: $500K (16.7%) | 10 wallets
- 🔴 Poor: $2.5M (83.3%) | 150 wallets
- Smart Money %: 16.7%
- Avg Wallet Score: 42.3/100

**3. Recommendation Alert**
```
💡 Smart Money Analysis
Smart money heavily favors YES (65% sentiment)
(Confidence: medium)
```

---

## Performance Optimization

### Challenge: Scoring is Expensive

Calculating a wallet score requires:
1. Fetching closed positions (API call)
2. Categorizing markets
3. Calculating metrics (win rate, ROI, Sharpe)
4. Applying scoring algorithm

For a market with 100 unique wallets, that's 100 API calls + calculations!

### Solution: Multi-Layer Caching

**1. In-Memory Cache** (1 hour TTL)
```typescript
import { walletScoreCache } from '@/lib/wallet-score-cache'

// Check cache first
const cached = walletScoreCache.get(walletAddress)
if (cached !== null) {
  return cached // Instant!
}

// Calculate only if needed
const score = await calculateScore(walletAddress)
walletScoreCache.set(walletAddress, score)
```

**2. Batch Processing** (10 at a time)
```typescript
// Instead of 100 sequential calls:
for (let i = 0; i < wallets.length; i += 10) {
  const batch = wallets.slice(i, i + 10)
  await Promise.all(batch.map(calculateScore))
}
```

**3. Pre-calculation for Popular Wallets**

TODO: Background job to pre-calculate scores for:
- Top 1000 wallets by volume
- Wallets that appear in trending markets
- Newly active wallets

**4. Database Caching** (Future)

```sql
CREATE TABLE wallet_scores (
  wallet_address VARCHAR(42) PRIMARY KEY,
  overall_score INTEGER,
  grade VARCHAR(3),
  calculated_at TIMESTAMP,
  expires_at TIMESTAMP
);
```

---

## Recommendations Engine

The system generates actionable recommendations:

### Strong Signals (High Confidence)

```typescript
SmartMoneySentiment > 50 && Confidence > 60:
  → STRONG_YES
  → "Smart money heavily favors YES"

SmartMoneySentiment < -50 && Confidence > 60:
  → STRONG_NO
  → "Smart money heavily favors NO"
```

### Weak Signals (Medium Confidence)

```typescript
SmartMoneySentiment > 20 && Confidence > 30:
  → LEAN_YES
  → "Smart money leans toward YES"

SmartMoneySentiment < -20 && Confidence > 30:
  → LEAN_NO
  → "Smart money leans toward NO"
```

### Neutral / Opportunity

```typescript
abs(SmartMoneySentiment) < 20 && Divergence > 25:
  → NEUTRAL
  → "Smart money is split, but diverges 30% from market price"
```

---

## Use Cases

### 1. Market Entry Signals

**Scenario**: Bitcoin at $98K, market says 45% chance of $100K by end of year

Smart Money Flow shows:
- Elite/Smart wallets: 80% YES
- Poor performers: 75% NO
- Divergence: 35%

**Interpretation**: The smart money disagrees with market consensus. This is a **buying opportunity** for YES shares.

### 2. Exit Signals

**Scenario**: You hold YES shares, market is 70% YES

Smart Money Flow shows:
- Smart money shifting to NO (sentiment -40)
- Confidence: 65%
- Divergence: 10%

**Interpretation**: Smart money is exiting. Consider taking profits.

### 3. Contrarian Opportunities

**Scenario**: Market is 85% YES

Smart Money Flow shows:
- Sentiment: Neutral (5%)
- Confidence: Low (25%)
- Many unknown/unscored wallets

**Interpretation**: Retail FOMO. Smart money isn't convinced. Risky trade.

---

## Future Enhancements

### 1. Historical Smart Money Tracking

```typescript
interface SmartMoneyHistory {
  timestamp: Date
  sentiment: number
  confidence: number
  yesLiquidity: number
  noLiquidity: number
}

// Track how smart money moves over time
// Did they buy early or late?
// Are they accumulating or distributing?
```

### 2. Whale Tracking

```typescript
// Identify top 10 wallets by:
// - Volume traded
// - Intelligence score
// - Historical accuracy

// Show when they enter/exit positions
// "XCN Strategy just bought $50K YES"
```

### 3. Copy Trading Signals

```typescript
// Allow users to set alerts:
"Notify me when Elite traders buy >$10K on either side"
"Notify me when Smart Money Sentiment crosses 50%"
"Notify me when Divergence >30%"
```

### 4. Market Efficiency Score

```typescript
// How well does the market price reflect smart money?
efficiencyScore = 100 - divergence

// Low efficiency = opportunity
// High efficiency = market is "smart"
```

### 5. Category-Specific Smart Money

```typescript
// Instead of overall score, use category score
// For a Politics market, only consider wallets with
// high Politics scores (80+)

// This gives more accurate signals
```

---

## Implementation Notes

### Current Limitations

**1. Positions Data**
- The API endpoint currently returns empty positions
- Need to implement:
  - Polymarket subgraph query OR
  - Internal positions database OR
  - Polymarket internal API access

**2. Score Calculation Load**
- Currently calculates scores on-demand
- Works for small markets (<50 wallets)
- Need background jobs for large markets

**3. Cache Persistence**
- In-memory cache lost on server restart
- Need Redis or database for production

### Production Checklist

- [ ] Implement positions data source
- [ ] Set up Redis for score caching
- [ ] Background job for pre-calculation
- [ ] Rate limiting on API endpoint
- [ ] Database table for historical tracking
- [ ] Monitoring and alerts
- [ ] Load testing (1000+ wallet markets)

---

## File Structure

```
lib/
├── smart-money-flow.ts         # Core logic
├── wallet-score-cache.ts       # Caching layer
└── SMART_MONEY_FLOW.md        # This file

app/api/polymarket/market/[conditionId]/
└── smart-money/
    └── route.ts               # API endpoint

components/
└── smart-money-indicator.tsx  # UI component

hooks/
└── use-smart-money-flow.ts    # React hook
```

---

## Questions?

This is a sophisticated system that provides unique edge in prediction markets. The key insight: **Follow the smart money, not the crowd.**
