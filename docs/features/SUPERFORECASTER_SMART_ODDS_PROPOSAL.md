# Superforecaster Detection & Smart Odds System

> **Context Document for New Assistants**
>
> This document provides complete context for understanding the proposed Superforecaster
> Detection and Smart Odds system for the Cascadian platform. It assumes no prior knowledge
> of Polymarket, the database schema, or the project.
>
> **Last Updated:** January 11, 2026
> **Status:** Proposal with revised scoring model (v2) + validation learnings (v3)

---

## Table of Contents

1. [Background: What is Polymarket?](#background-what-is-polymarket)
2. [Background: What is Cascadian?](#background-what-is-cascadian)
3. [The Problem: Finding Alpha in Prediction Markets](#the-problem-finding-alpha-in-prediction-markets)
4. [The Proposed Solution: Superforecaster Detection](#the-proposed-solution-superforecaster-detection)
5. [Scoring Model (Revised)](#scoring-model-revised)
6. [Bot Filtering Requirements](#bot-filtering-requirements)
7. [Compute Architecture](#compute-architecture)
8. [Technical Implementation](#technical-implementation)
9. [Data Quality Assessment](#data-quality-assessment)
10. [API Endpoints & UI Concepts](#api-endpoints--ui-concepts)
11. [Connection to PnL Engine & Trader Stats](#connection-to-pnl-engine--trader-stats)
12. [Open Questions & Decisions](#open-questions--decisions)
13. [Validation Learnings (v3)](#validation-learnings-v3)

---

## Background: What is Polymarket?

**Polymarket** is a decentralized prediction market platform built on the Polygon blockchain. Users trade on the outcomes of real-world events using USDC (a stablecoin pegged to the US dollar).

### How It Works

1. **Markets** are created for real-world questions like "Will the Fed raise interest rates in March 2026?"
2. Each market has **outcomes** (typically YES and NO for binary markets, or multiple options)
3. Users buy **tokens** representing their predicted outcome
4. Tokens are priced between $0.01 and $0.99, representing the market's implied probability
5. When the event resolves, winning tokens pay out $1.00, losing tokens become worthless

### Example

```
Market: "Will the Fed raise rates in March 2026?"
- YES tokens trading at $0.35 (35% implied probability)
- NO tokens trading at $0.65 (65% implied probability)

If you buy 100 YES tokens at $0.35 = $35 cost
If YES wins: You get 100 × $1 = $100 (profit: $65)
If NO wins: Tokens worth $0 (loss: $35)
```

### Key Concepts

| Term | Definition |
|------|------------|
| **CLOB** | Central Limit Order Book - Polymarket's order matching system |
| **Condition ID** | Unique 64-character hex identifier for each market |
| **Token ID** | Unique identifier for each outcome's tradeable token |
| **Maker** | User who places a limit order (provides liquidity) |
| **Taker** | User who fills an existing order (takes liquidity) |
| **Resolution** | When a market is settled and winners are paid |
| **ERC1155** | Ethereum token standard used for outcome tokens |
| **NegRisk** | Multi-outcome markets where outcomes are mutually exclusive |

---

## Background: What is Cascadian?

**Cascadian** is a trading analytics and strategy platform built on top of Polymarket data. It provides:

1. **Wallet Analytics** - Track any wallet's trading history, PnL, and patterns
2. **Smart Money Detection** - Identify consistently profitable traders
3. **Strategy Builder** - Visual tool for creating trading strategies
4. **Copy Trading** - Follow successful traders' positions

### Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **Database:** ClickHouse (OLAP database for analytics)
- **Auth/Storage:** Supabase
- **Deployment:** Vercel

### Data Scale

| Table | Rows | Description |
|-------|------|-------------|
| `pm_trader_events_v3` | 687M | CLOB trade events |
| `pm_ctf_events` | 195M | Conditional token operations |
| `pm_market_metadata` | 442K | Market information, tags, categories |
| `pm_condition_resolutions` | 317K | Market resolution data |
| `pm_erc1155_transfers` | 48M | Token transfer events |
| `pm_wallet_condition_outcome_flow_v1` | 39M | Current positions (precomputed) |

---

## The Problem: Finding Alpha in Prediction Markets

### The Core Insight

Not all traders are equal. Some traders consistently:
- Enter positions **early** (before the crowd moves the price)
- Pick the **correct outcome** more often than chance
- Show **conviction** (meaningful position sizes)
- Demonstrate **domain expertise** (consistently right on specific topics)

### Current "Smart Money" Limitations

Global smart money tracking (finding overall profitable wallets) has limitations:
1. A wallet profitable on crypto might be terrible at politics
2. High-frequency bots inflate metrics with small gains
3. Lucky gamblers can look skilled in small samples
4. No way to weight "domain expertise"
5. Some edges are **not copyable** (latency-dependent, HFT patterns)

### The Opportunity

**Per-tag/per-category expert detection** would allow us to:
1. Find wallets that are specifically good at "Fed interest rates" predictions
2. Weight their current positions on new Fed markets
3. Create a "Smart Odds" signal that may differ from market price
4. Provide users with alpha by showing when experts disagree with the crowd
5. Ensure the signal is **copyable** (not dependent on speed)

---

## The Proposed Solution: Superforecaster Detection

### Hierarchical Expertise Model

```
Category: Economics
├── Tag Bundle: fed-monetary-policy
│   ├── Tag: Fed
│   ├── Tag: Interest rates
│   ├── Tag: FOMC
│   └── Tag: rate cuts
├── Tag: inflation-cpi
├── Tag: treasury-yields
└── Tag: gdp-reports

Category: Crypto
├── Tag Bundle: bitcoin-markets
│   ├── Tag: Bitcoin
│   ├── Tag: bitcoin-etf
│   └── Tag: BTC
├── Tag: ethereum-upgrades
└── Tag: sec-crypto

Category: Politics
├── Tag: presidential-election
├── Tag: congressional
├── Tag: supreme-court
└── Tag: cabinet-nominations
```

**Tag Bundles:** Related tags are grouped so that expertise on "Fed" and "Interest rates"
counts together as expertise on "fed-monetary-policy" (the canonical bundle).

A wallet might have:
- 90% Brier improvement on "fed-monetary-policy" (specialist)
- 72% Brier improvement on "economics" overall (generalist)
- Below-baseline on "crypto" (avoid)

---

## Scoring Model (Revised)

> **Note:** This section incorporates feedback on using proper scoring rules instead of
> simple entry alpha, and addresses issues with hold ratio and position size weighting.

### Core Scoring: Brier Score Improvement

Instead of simple "entry alpha," we use a **proper scoring rule** that:
- Rewards being right early at low implied probability
- Harshly penalizes confident wrong predictions
- Naturally destroys lottery bots (they rack up tons of wrong predictions)
- Handles both long and short positions correctly

#### Brier Score Formula

For each resolved position:
```
brier_score = (predicted_probability - outcome)²
```

Where:
- `predicted_probability` = entry price (e.g., 0.35 for 35¢)
- `outcome` = 1 if the position was correct, 0 if wrong

**Lower is better.** A baseline random guesser at market odds scores ~0.25.

#### Brier Score Improvement

```
brier_improvement = baseline_score - actual_score
```

Where `baseline_score` is the Brier score of the market price at time of entry.

- Positive = better than market consensus at entry time
- Negative = worse than just following the crowd
- Zero = same as market (no edge)

### Time Decay Weighting

Recent performance matters more than old performance. Edges decay.

```
time_weight = exp(-λ × days_since_resolution)
```

Where λ = 0.01 gives:
| Days Ago | Weight |
|----------|--------|
| 30 days | 74% |
| 90 days | 41% |
| 180 days | 17% |
| 365 days | 3% |

**Simpler alternative (step function):**
```
0-90 days:    weight = 1.0
90-180 days:  weight = 0.5
180-365 days: weight = 0.25
>365 days:    weight = 0.1 (or exclude)
```

### Size Weighting (Dampened)

Raw position size would create "rich odds" not "smart odds." We dampen whale influence:

```
size_weight = sqrt(stake_usd)
```

This means:
- $1,000 stake → weight 31.6
- $10,000 stake → weight 100
- $100,000 stake → weight 316

A 100x larger position only gets ~10x more influence.

**Plus per-wallet cap:** No single wallet can contribute more than 10% of total weighted mass
for any market's smart odds calculation.

### Composite Score Formula

```
score(wallet, tag) =
    Σ(
        brier_improvement(trade)
        × time_decay(days_since_resolution)
        × sqrt(stake_usd)
    )
    / shrinkage_factor(n)
```

Where `shrinkage_factor(n)` applies Bayesian shrinkage for small sample sizes:
- n < 5 markets: heavily shrink toward baseline (low confidence)
- n = 10 markets: moderate shrinkage
- n > 20 markets: minimal shrinkage (high confidence)

### What We DON'T Score Positively

**Hold Ratio:** Originally proposed as a positive signal ("diamond hands"), but this is a
**style, not skill**. A forecaster who:
1. Buys YES at 30¢
2. Sells at 70¢ for profit
3. YES resolves to $1

...was **right** and captured value. We shouldn't penalize profit-taking.

**Hold time is only used as a bot filter** (too short = bot), not as a positive skill signal.

### Copyability Filter

For copy trading to work, the edge must survive a time delay. We filter for copyable edges:

```sql
WHERE
    median_hold_time_hours > 4        -- Not latency-dependent
    AND trades_per_day < 20           -- Not HFT
    AND maker_ratio < 0.7             -- Not market making
    AND same_block_trade_pct < 0.1    -- Not MEV/front-running
```

---

## Bot Filtering Requirements

### The Problem

Several types of bots would pollute the superforecaster rankings:

#### 1. Market Makers
- High trade frequency (100+ trades/day)
- Both sides of the book
- Profits from spread, not prediction
- **Not copyable** - requires constant presence

#### 2. Arbitrage Bots
- Cross-market or cross-exchange arbitrage
- Very quick flips (minutes)
- **Not copyable** - requires speed

#### 3. Lottery Bots (Key Concern)
- Buy outcomes at < 5¢ hoping for 20x-100x returns
- Lose 95%+ of positions, occasional big win
- **Not forecasting** - just gambling on long odds

#### 4. HFT/Latency Bots
- Sub-second entries around news events
- **Not copyable** - edge evaporates with any delay

### Lottery Bot Statistics (from our data)

| Metric | Value |
|--------|-------|
| All buy trades | 343M |
| Trades at < 5¢ | 57M (16.5%) |
| Trades at < 2¢ | 43M (12.5%) |
| Trades at < 1¢ | 33M (9.6%) |
| Wallets with >80% low-odds trades | 14,933 (3.23%) |

### Why Scoring Rules Handle This Naturally

With Brier scoring, lottery bots get destroyed:
- Buy 100 positions at 2¢ each
- 95 lose → brier_score ≈ 0.98² × 95 = huge penalty
- 5 win → brier_score ≈ 0.02² × 5 = tiny reward
- **Net: massive negative score**

No need for hard filters at specific price thresholds - the scoring rule does the work.

### Explicit Bot Filters

In addition to scoring, we apply hard filters for eligibility:

```sql
-- Exclude wallet from superforecaster rankings if ANY of:
WHERE NOT (
    trades_per_day > 50                    -- Market maker pattern
    OR median_hold_time_hours < 2          -- HFT/scalper pattern
    OR maker_ratio > 0.8                   -- Liquidity provider
    OR same_block_trade_pct > 0.1          -- MEV/front-running
    OR both_sides_same_market_pct > 0.3    -- Hedger, not forecaster
)
```

### Activity Requirements

```sql
-- Must meet ALL to appear on leaderboard:
WHERE
    resolved_markets_on_tag >= 5           -- Minimum sample size
    AND days_since_last_trade <= 90        -- Still active
    AND copyability_score > 0.5            -- Edge survives delay
```

---

## Compute Architecture

### The Challenge

Naive approach (recalculating everything for every market every 30 minutes) would require
billions of operations. We need to **precompute everything slow, query fast**.

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: BATCH SCORING (Hourly or Daily)                        │
│ Heavy compute, runs once, stores results                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Job 1A: Calculate Wallet-Tag Scores                             │
│ INPUT:  pm_trader_events_v3 (687M rows)                         │
│         pm_condition_resolutions (317K rows)                    │
│         pm_market_metadata (tags)                               │
│                                                                 │
│ COMPUTE: For each (wallet, tag):                                │
│          - Brier score on resolved markets                      │
│          - Time decay weighting                                 │
│          - Bot pattern detection                                │
│                                                                 │
│ OUTPUT: pm_wallet_tag_metrics_v1 (~500K rows)                   │
│ RUNTIME: 10-30 min                                              │
│                                                                 │
│ Job 1B: Rank Superforecasters per Tag                           │
│ INPUT:  pm_wallet_tag_metrics_v1                                │
│ OUTPUT: pm_tag_superforecasters_v1 (~10K rows)                  │
│         (Top 100 wallets × ~100 tags)                           │
│ RUNTIME: <1 min                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: POSITION TRACKING (Already Exists!)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ pm_wallet_condition_outcome_flow_v1 (39M rows)                  │
│ ───────────────────────────────────────────────                 │
│ - SummingMergeTree (auto-aggregates incrementally)              │
│ - Schema: (wallet, condition_id, outcome_index) →               │
│           (buy_tokens, sell_tokens, buy_usdc, sell_usdc)        │
│ - Updates: Automatically as new trades arrive                   │
│                                                                 │
│ This gives us current net position for every wallet on          │
│ every market, with zero additional compute!                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: SMART ODDS CALCULATION (Every 30 min)                  │
│ Fast - just indexed lookups + simple math                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ For each active market (~10K markets):                          │
│                                                                 │
│ 1. Get tag from pm_market_metadata              [O(1) lookup]   │
│                                                                 │
│ 2. Get superforecasters for tag                 [~100 rows]     │
│    FROM pm_tag_superforecasters_v1                              │
│    WHERE tag = 'fed-interest-rates'                             │
│                                                                 │
│ 3. Get their positions on this market           [~100 rows]     │
│    FROM pm_wallet_condition_outcome_flow_v1                     │
│    WHERE wallet IN (superforecaster_list)                       │
│      AND condition_id = this_market                             │
│                                                                 │
│ 4. Calculate weighted odds                      [Simple math]   │
│    FOR each wallet with position:                               │
│      net_position = buy_tokens - sell_tokens                    │
│      IF net_position > 0:  -- Long YES                          │
│        YES_mass += score × sqrt(abs(net_position))              │
│      ELSE:  -- Long NO                                          │
│        NO_mass += score × sqrt(abs(net_position))               │
│                                                                 │
│    smart_yes = YES_mass / (YES_mass + NO_mass)                  │
│                                                                 │
│ 5. Store in pm_market_smart_odds_v1                             │
│                                                                 │
│ TOTAL: 10K markets × 200 lookups = 2M indexed reads             │
│ RUNTIME: 30-60 seconds                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Smart Odds Formula (Corrected)

The original formula `Σ(score × direction × size) / Σ(score × size)` was not well-grounded
probabilistically. The corrected formula:

```
YES_mass = Σ(score × sqrt(net_yes_exposure))  -- wallets net long
NO_mass = Σ(score × sqrt(net_no_exposure))    -- wallets net short

smart_yes = YES_mass / (YES_mass + NO_mass)
```

This:
- Always produces a valid probability in [0, 1]
- Separates YES and NO positions cleanly
- Applies sqrt() dampening to prevent whale dominance
- Per-wallet cap (max 10% of total mass) prevents single-wallet manipulation

### Why This Is Fast Enough

| Operation | Count | Time |
|-----------|-------|------|
| Get tag for market | 10K | <1s (indexed) |
| Get superforecasters per tag | 10K × 100 | <1s (small table) |
| Get positions | 10K × 100 | ~30s (indexed by wallet+condition) |
| Calculate + store | 10K | <1s (math) |
| **Total** | | **~30-60 seconds** |

The heavy lift (Brier scoring on 687M trades) runs hourly in batch, not per-request.

---

## Technical Implementation

### Required Tables

#### 1. `pm_wallet_tag_metrics_v1`

Stores per-wallet, per-tag performance metrics (precomputed hourly):

```sql
CREATE TABLE pm_wallet_tag_metrics_v1 (
    wallet LowCardinality(String),
    tag String,

    -- Scoring
    brier_improvement Float64,           -- Core skill metric
    market_count UInt32,                  -- Sample size

    -- Auxiliary metrics (for display/filtering)
    avg_entry_price Float64,
    avg_time_alpha Float64,
    total_stake_usd Float64,

    -- Bot detection signals
    trades_per_day Float64,
    median_hold_time_hours Float64,
    maker_ratio Float64,

    -- Activity
    last_trade_time DateTime,
    days_since_last_trade UInt32,

    -- Final output
    composite_score Float64,
    is_eligible UInt8,                   -- Passes all filters

    _version UInt64
) ENGINE = SharedReplacingMergeTree(_version)
ORDER BY (tag, composite_score, wallet)  -- Optimized for "top N per tag" queries
```

#### 2. `pm_tag_superforecasters_v1`

Top N forecasters per tag (for fast lookups):

```sql
CREATE TABLE pm_tag_superforecasters_v1 (
    tag String,
    rank UInt16,
    wallet String,
    composite_score Float64,
    brier_improvement Float64,
    market_count UInt32,
    _version UInt64
) ENGINE = SharedReplacingMergeTree(_version)
ORDER BY (tag, rank)
```

#### 3. `pm_market_smart_odds_v1`

Time-series of smart odds for graphing:

```sql
CREATE TABLE pm_market_smart_odds_v1 (
    condition_id String,
    timestamp DateTime,

    -- Odds
    smart_odds_yes Float64,
    market_odds_yes Float64,
    delta Float64,

    -- Metadata
    forecaster_count UInt16,
    yes_forecaster_count UInt16,
    no_forecaster_count UInt16,
    total_weighted_mass Float64,

    -- Breakdown (for UI)
    tag_specialist_yes Float64,
    category_generalist_yes Float64,

    _version UInt64
) ENGINE = SharedReplacingMergeTree(_version)
ORDER BY (condition_id, timestamp)
```

#### 4. `pm_tag_bundles_v1`

Tag canonicalization for related tags:

```sql
CREATE TABLE pm_tag_bundles_v1 (
    raw_tag String,
    canonical_bundle String,
    category String
) ENGINE = SharedReplacingMergeTree
ORDER BY raw_tag
```

Example data:
```
('Fed', 'fed-monetary-policy', 'Economy')
('Interest rates', 'fed-monetary-policy', 'Economy')
('FOMC', 'fed-monetary-policy', 'Economy')
('rate cuts', 'fed-monetary-policy', 'Economy')
('Bitcoin', 'bitcoin-markets', 'Crypto')
('BTC', 'bitcoin-markets', 'Crypto')
```

---

## Data Quality Assessment

### Market Metadata Coverage

| Metric | Value | Assessment |
|--------|-------|------------|
| Total markets | 441,895 | Large dataset |
| Markets with tags | 73.2% (323,571) | Good coverage |
| Markets with category | 100% (441,895) | Complete |
| Markets with event_id | 99.99% | Excellent grouping |
| Unique tags | 100+ | Granular |
| Unique events | 138,914 | Good grouping |

### Categories Available

| Category | Markets | Volume ($M) |
|----------|---------|-------------|
| Crypto | 160,985 | $9,089 |
| Other | 124,412 | $18,350 |
| Sports | 100,007 | $18,069 |
| Politics | 26,597 | $23,766 |
| Tech | 14,531 | $2,901 |
| Finance | 8,417 | $774 |
| World | 3,268 | $1,238 |
| Culture | 2,332 | $479 |
| Economy | 1,346 | $4,328 |

### Top Specific Tags

| Tag | Markets | Volume ($M) |
|-----|---------|-------------|
| Bitcoin | 47,476 | $5,243 |
| Ethereum | 45,580 | $2,229 |
| NBA | 44,395 | $8,292 |
| US Politics | 22,892 | $20,860 |
| NFL | 20,704 | $5,879 |
| Trump | 14,226 | $6,773 |
| AI | 14,132 | $3,419 |
| Elections | 7,221 | $15,159 |
| Fed | 784 | High volume |
| Interest rates | 784 | High volume |

### Fed/Interest Rate Markets

- 784 markets tagged with `["Economy", "Fed", "Interest rates"]`
- Volume: $100M+ per market
- Well-grouped by event_id (e.g., 48 markets for "Fed chair nomination")
- Tags are clean and consistent

---

## API Endpoints & UI Concepts

### Proposed API Endpoints

#### 1. Tag Leaderboard
```
GET /api/superforecasters/:tag

Response:
{
  "tag": "fed-monetary-policy",
  "canonical_bundle": true,
  "includes_tags": ["Fed", "Interest rates", "FOMC", "rate cuts"],
  "category": "Economy",
  "total_markets": 784,
  "resolved_markets": 623,
  "forecasters": [
    {
      "rank": 1,
      "wallet": "0x4a2b...",
      "brier_improvement": 0.12,
      "market_count": 12,
      "composite_score": 0.92,
      "last_active": "2026-01-10T14:30:00Z"
    },
    ...
  ]
}
```

#### 2. Market Smart Odds
```
GET /api/smart-odds/:conditionId

Response:
{
  "condition_id": "abc123...",
  "market_odds": { "yes": 0.65, "no": 0.35 },
  "smart_odds": { "yes": 0.74, "no": 0.26 },
  "delta": 0.09,
  "signal": "BULLISH",
  "confidence": "HIGH",  // Based on forecaster count + sample sizes
  "forecaster_breakdown": {
    "tag_specialists": { "count": 8, "weighted_yes": 0.78 },
    "category_generalists": { "count": 14, "weighted_yes": 0.71 },
    "global_top": { "count": 5, "weighted_yes": 0.69 }
  },
  "top_forecasters_positioned": [
    { "wallet": "0x4a2b...", "score": 0.92, "direction": "YES", "net_tokens": 5000 },
    { "wallet": "0x7f3c...", "score": 0.84, "direction": "NO", "net_tokens": 2000 },
    ...
  ]
}
```

#### 3. Smart Odds History (for graphing)
```
GET /api/smart-odds-history/:conditionId?interval=1h

Response:
{
  "condition_id": "abc123...",
  "data_points": [
    { "timestamp": "2026-01-10T10:00:00Z", "market_odds": 0.55, "smart_odds": 0.62 },
    { "timestamp": "2026-01-10T11:00:00Z", "market_odds": 0.58, "smart_odds": 0.65 },
    { "timestamp": "2026-01-10T12:00:00Z", "market_odds": 0.63, "smart_odds": 0.68 },
    ...
  ]
}
```

### UI Concept

```
┌─────────────────────────────────────────────────────────────────┐
│  Market: Will the Fed raise rates in March 2026?                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Market Odds: 65% YES                                       ││
│  │  Smart Odds:  74% YES  (+9% delta)                          ││
│  │  Confidence:  HIGH (12 specialists, 847 resolved markets)   ││
│  │                                                             ││
│  │  [=============================|=========] ← Smart          ││
│  │  [=========================|=============] ← Market         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Signal Breakdown:                                              │
│  ├── Fed Specialists (8 wallets): 78% YES                       │
│  ├── Economics Generalists (14): 71% YES                        │
│  └── Top Global Performers (5): 69% YES                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [Graph: Smart Odds vs Market Odds over time]               ││
│  │                                                             ││
│  │  75% │                                    ___Smart          ││
│  │      │                               ____/                  ││
│  │  65% │                          ____/                       ││
│  │      │                     ____/___Market                   ││
│  │  55% │                ____/___/                             ││
│  │      │           ____/___/                                  ││
│  │  45% │______/___/                                           ││
│  │      +--------------------------------------------------→   ││
│  │        Jan 1       Jan 5        Jan 10       Now            ││
│  │                                                             ││
│  │  ↑ Smart odds led market by 4 hours on Jan 5 move           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Top Forecasters (Fed Monetary Policy):                         │
│  ┌──────┬────────────┬─────────┬─────────┬──────────┬─────────┐│
│  │ Rank │ Wallet     │ Brier↑  │ Markets │ Position │ Active  ││
│  ├──────┼────────────┼─────────┼─────────┼──────────┼─────────┤│
│  │ 1    │ 0x4a2b...  │ +0.15   │ 12      │ 5K YES   │ 2d ago  ││
│  │ 2    │ 0x7f3c...  │ +0.12   │ 9       │ 2K NO    │ 5d ago  ││
│  │ 3    │ 0x1d8e...  │ +0.11   │ 15      │ 3K YES   │ 1d ago  ││
│  └──────┴────────────┴─────────┴─────────┴──────────┴─────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Connection to PnL Engine & Trader Stats

### Dependency Chain

```
PnL Engine (current work - 96.7% accuracy)
    ↓ enables
Accurate Position Tracking
    ↓ enables
Trader Stats (win rate, ROI, hold time, conviction)
    ↓ enables
Superforecaster Detection
    ↓ enables
Smart Odds Signal
```

### What Can We Build Now vs Later

| Component | Requires PnL Engine? | Status |
|-----------|---------------------|--------|
| Brier scores | No - just needs entry price + resolution | Can build now |
| Time decay | No | Can build now |
| Bot filtering | Partially - hold time needs position tracking | Mostly now |
| Conviction weighting | Yes - needs accurate stake sizes | After PnL |
| Smart odds | Needs accurate current positions | After PnL |

**Strategy:** Start with Brier scoring (core skill metric) now, add conviction weighting
once PnL engine is stable.

### Shared Infrastructure

The same position tracking infrastructure (`pm_wallet_condition_outcome_flow_v1`) that
powers PnL also powers smart odds. Fixing PnL = fixing smart odds input.

---

## Open Questions & Decisions

### Resolved

| Question | Decision |
|----------|----------|
| Entry alpha vs Brier score? | **Brier score** - proper scoring rule, naturally handles lottery bots |
| Hold ratio as positive signal? | **No** - only use as bot filter. Profit-taking is valid |
| Raw position size weighting? | **No** - use sqrt(size) + per-wallet cap to prevent whale dominance |
| Time decay? | **Yes** - 90-day exponential decay (λ=0.01) |
| Activity requirement? | **Yes** - must trade in last 90 days to appear on leaderboard |

### Open

| Question | Options | Recommendation |
|----------|---------|----------------|
| Tag bundles? | Build vs infer | Build manually for top 20 domains, infer for rest |
| Shrinkage prior for small n? | 5, 10, or 20 minimum markets | Start with 5, increase if too noisy |
| Multi-tag markets? | Weight both tags equally? Prefer most specific? | Use most specific tag, fall back to category |
| Per-wallet cap? | 5%, 10%, or 15% of mass | 10% seems reasonable |
| Update frequency for smart odds? | 5m, 15m, or 30m | 30m for MVP, can optimize later |
| Sybil resistance? | Address clustering? Stake minimums? | Stake minimum ($500+) for now |

---

## Validation Learnings (v3)

> **Added:** January 11, 2026 after attempting to build an MVP leaderboard for egg market forecasters

We attempted to validate the superforecaster concept by building a quick MVP query to identify
top performers on egg-related markets. This revealed several critical issues that must be
addressed before implementation.

### Bug #1: Market Matching Pattern Incomplete

**Problem:** Our query used `LIKE '%egg price%'` to find egg markets, but many markets use
different phrasing.

| Pattern | Markets Found |
|---------|---------------|
| "egg price" | 58 |
| "a dozen eggs" | **112** (missed!) |

**Impact:** Query missed 66% of egg markets, including major positions.

**Fix Required:**
```sql
-- Wrong (original)
WHERE lower(question) LIKE '%egg price%'

-- Correct (expanded)
WHERE lower(question) LIKE '%egg%'
  AND (lower(question) LIKE '%price%'
    OR lower(question) LIKE '%dozen%')
```

### Bug #2: Entry Price Filter Excluded Losses

**Problem:** Our query filtered to entry prices 0.10-0.70 to exclude "lottery bots" and
"certainty buyers." This accidentally excluded losing high-confidence bets.

**Example:** @Vorian's $20K loss on "Will a dozen eggs be below $4.50 in May?" was at 77¢
entry - just outside the 70¢ filter cutoff.

**Impact:** Artificially inflated win rates by excluding bets that lost at high entry prices.

**Fix Required:** Remove hard entry price filter, let Brier scoring naturally penalize
bad high-confidence bets.

### Bug #3: Resolution Attribution Requires NET Position

**Problem:** Looking at individual BUY trades and checking if that outcome won does NOT
tell you if the trader actually profited. Traders:

1. **Flip positions** - Buy YES, then sell YES and buy NO before resolution
2. **Hedge** - Hold both sides in varying amounts
3. **Average in/out** - Multiple entries and exits at different prices

**Real Example from @Vorian on "Will egg prices be more than $6.00 in March?":**

```
March 13: BUY NO at 64¢ ($2,528)
March 13: SELL NO, BUY YES (position flip to YES)
March 14-28: Accumulate YES position
March 29: SELL YES ($15,853), BUY NO ($62,786)  ← Position flip back to NO!
Resolution: YES = 1 (won), NO = 0 (lost)
```

Polymarket UI shows +$8,406 profit on this market, but our CLOB-based query saw:
- Individual YES buys that won ✓
- Individual NO buys that lost ✗
- No way to determine NET position at resolution time

**Impact:** Cannot accurately attribute win/loss from CLOB trades alone. Need position
tracking at resolution time.

**Fix Required:** Use `pm_wallet_condition_outcome_flow_v1` (SummingMergeTree) to get
net position at resolution, not individual trade analysis.

### Bug #4: CLOB Duplicates

**Problem:** `pm_trader_events_v3` contains duplicate trade records from historical backfills.

**Fix Required:** Always dedupe with `GROUP BY event_id` pattern:
```sql
SELECT ... FROM (
    SELECT event_id, any(side) as side, any(usdc_amount) as usdc, ...
    FROM pm_trader_events_v3
    GROUP BY event_id
) ...
```

### Validation Results Summary

| Wallet | Claimed (Query) | Actual (Browser) | Issue |
|--------|-----------------|------------------|-------|
| @Catalyst | 100% egg win rate, +$57 | +$61 on eggs (correct!) | Minor - market count off |
| @Vorian | 86% win rate, +$12K | Has hidden $20K egg loss | Pattern + filter bugs |
| @Beardedf | 100% egg win rate | -$375 overall | Overall P&L differs (expected) |
| @iForgor | 91.7% egg win rate | -$9,946 overall | Overall P&L differs (expected) |

Some wallets had roughly correct egg-specific stats, but several had major discrepancies
due to the bugs above.

### Critical Insight: Position Tracking is a Hard Dependency

**The core problem:** Determining if a wallet WON or LOST on a specific market requires
knowing their NET position at resolution time, not just summing individual trades.

This is **exactly** what the PnL engine work is solving. The same challenges we face
with PnL accuracy (neg-risk conversions, position flipping, split trades) apply to
superforecaster scoring.

**Revised dependency chain:**
```
PnL Engine (accurate position tracking)
    ↓ HARD DEPENDENCY
Accurate Win/Loss Attribution per Market
    ↓ HARD DEPENDENCY
Brier Score Calculation
    ↓ enables
Superforecaster Detection
    ↓ enables
Smart Odds Signal
```

### Updated "What Can We Build Now vs Later"

| Component | Status | Blocker |
|-----------|--------|---------|
| Brier scores from CLOB | ❌ Blocked | Cannot accurately determine win/loss |
| Market matching | ✅ Can fix | Use expanded patterns |
| Bot filtering | ✅ Can build | Based on trade patterns, not outcomes |
| Tag leaderboards | ❌ Blocked | Needs accurate win/loss |
| Smart odds | ❌ Blocked | Needs accurate position data |

### Recommended Path Forward

1. **Complete PnL Engine** - This solves the position tracking problem
2. **Add per-market P&L** - Extend PnL engine to output per-condition realized P&L
3. **Build Brier scoring on top of per-market P&L** - Not CLOB trades
4. **Then build superforecaster leaderboards**

The superforecaster system is NOT an alternative to accurate position tracking - it
REQUIRES it as a foundation.

---

## Summary

This proposal outlines a system to:

1. **Detect domain-specific experts** using Brier score improvement (proper scoring rule)
2. **Apply time decay** (90-day) to keep leaderboards fresh
3. **Filter bots** via scoring (lottery bots destroyed) + explicit patterns (HFT, MM)
4. **Ensure copyability** by requiring edges that survive time delay
5. **Calculate Smart Odds** with sqrt() dampening and per-wallet caps
6. **Visualize** smart odds vs market odds with historical graph

### Key Architectural Decisions

- **Precompute everything slow** (Brier scores, hourly batch)
- **Query fast** (smart odds from precomputed tables, 30-60 seconds for all markets)
- **Leverage existing position table** (`pm_wallet_condition_outcome_flow_v1`)

### Implementation Phases

1. **Phase 1:** Build Brier scoring pipeline (can start now, no PnL dependency)
2. **Phase 2:** Add bot filtering and leaderboard generation
3. **Phase 3:** Integrate accurate positions from PnL engine
4. **Phase 4:** Build smart odds calculation and API
5. **Phase 5:** Build UI components and graphing

---

*Document created: January 11, 2026*
*Last updated: January 11, 2026 (v3 - added validation learnings)*
*Author: Cascadian Development Team*
