# Realistic Dummy Data Generation Guide

**Purpose:** Generate realistic mock data for Wallet Detail and Market Detail pages that reflects actual prediction market dynamics

**Last Updated:** 2025-10-21

---

## Table of Contents

1. [Data Realism Principles](#data-realism-principles)
2. [Wallet Profile Generation](#wallet-profile-generation)
3. [Market Data Generation](#market-data-generation)
4. [Statistical Distributions](#statistical-distributions)
5. [Correlation Rules](#correlation-rules)
6. [Code Implementation](#code-implementation)
7. [Data Validation](#data-validation)

---

## Data Realism Principles

### Why Realistic Data Matters

1. **Design Testing:** Reveals layout issues with real data patterns (long market titles, extreme PnL values)
2. **UX Validation:** Ensures designs work with realistic data distributions
3. **Performance Testing:** Simulates real data volumes for optimization
4. **Stakeholder Demos:** Realistic data is more convincing than obviously fake data

### Realism Requirements

✅ **Do:**
- Use realistic distributions (normal, power law, exponential)
- Correlate related metrics (WIS ↔ PnL, entry price ↔ current price)
- Follow market dynamics (70/30 bias, not 50/50)
- Generate temporal patterns (clustering, trends)
- Use realistic names and titles

❌ **Don't:**
- Use unrealistic perfect values (exactly 50.0%, 100% win rate)
- Generate independent random values for correlated metrics
- Use placeholder text like "Test Market #1"
- Create uniform distributions where power law expected
- Ignore category-specific patterns

---

## Wallet Profile Generation

### Core Profile Metrics

```typescript
interface WalletProfile {
  // Identity
  wallet_address: string;      // Ethereum address format
  wallet_alias: string;        // Memorable trader name
  wis: number;                // 40-95, weighted toward 60-80

  // Trading Style Flags
  contrarian_pct: number;      // 0-100, % entries below 0.5
  lottery_ticket_count: number; // 0-10, positions with <0.1 entry
  bagholder_pct: number;       // 0-100, % positions below entry
  whale_splash_count: number;  // 0-500, positions > $20k
  reverse_cramer_count: number; // 0-5, opposite of crowd
  is_senior: boolean;          // 1000+ total positions
  is_millionaire: boolean;     // 1M+ total invested

  // Performance Metrics
  total_invested: number;      // 10k - 1M
  realized_pnl: number;        // Correlated with WIS
  realized_pnl_pct: number;    // % return
  unrealized_pnl: number;      // Can be negative
  unrealized_pnl_pct: number;
  total_pnl: number;           // realized + unrealized
  total_pnl_pct: number;

  // Activity Metrics
  total_trades: number;        // 50-500
  winning_trades: number;      // Correlated with WIS
  losing_trades: number;
  win_rate: number;            // 0.4 - 0.9
  avg_trade_size: number;      // total_invested / total_trades
  largest_win: number;         // 2k - 50k
  largest_loss: number;        // -1k to -20k
  markets_traded: number;      // total_trades / 3-8
  active_positions: number;    // 3-20
  first_trade_date: string;    // ISO timestamp
  last_trade_date: string;
  days_active: number;         // 30-365+

  // Rankings
  rank_by_pnl: number;         // 1-10,000
  rank_by_wis: number;
  rank_by_volume: number;

  // Risk Metrics
  risk_metrics: {
    sharpe_ratio_30d: number;  // 0.5 - 2.5
    sharpe_level: string;      // 'Excellent' | 'Good' | 'Fair' | 'Poor'
    traded_volume_30d_daily: VolumePoint[];
    traded_volume_30d_total: number;
  };

  // PnL Rankings
  pnl_ranks: {
    d1: RankPeriod;
    d7: RankPeriod;
    d30: RankPeriod;
    all: RankPeriod;
  };
}
```

### Generation Algorithm

```typescript
// lib/generate-wallet-profile.ts
import { randomInt, randomFloat, weightedRandom, normalDistribution } from './random-utils';

export function generateWalletProfile(seed?: number): WalletProfile {
  // 1. Generate core identity
  const wis = Math.round(normalDistribution(65, 15, 40, 95)); // Mean 65, std 15
  const walletAddress = generateEthAddress(seed);
  const walletAlias = generateTraderName(seed);

  // 2. Determine trading style archetype
  const archetype = determineArchetype(wis);
  const styleFlags = generateStyleFlags(archetype);

  // 3. Generate performance correlated with WIS
  const totalInvested = Math.round(randomFloat(10000, 1000000));
  const wisMultiplier = (wis - 50) / 50; // -0.2 to 0.9 for WIS 40-95

  const baseReturn = 0.05 + wisMultiplier * 0.15; // 5% to 20% based on WIS
  const noise = randomFloat(-0.05, 0.10); // Add randomness
  const realizedReturn = Math.max(-0.30, baseReturn + noise); // Cap losses at -30%

  const realizedPnL = Math.round(totalInvested * realizedReturn);
  const unrealizedPnL = Math.round(totalInvested * randomFloat(-0.10, 0.15));
  const totalPnL = realizedPnL + unrealizedPnL;

  // 4. Generate activity metrics
  const totalTrades = randomInt(50, 500);
  const winRateBase = 0.50 + (wis - 60) * 0.005; // 0.40 to 0.75
  const winRate = Math.max(0.40, Math.min(0.90, winRateBase + randomFloat(-0.05, 0.05)));
  const winningTrades = Math.round(totalTrades * winRate);
  const losingTrades = totalTrades - winningTrades;

  // 5. Calculate derived metrics
  const avgTradeSize = Math.round(totalInvested / totalTrades);
  const marketsTrad = Math.round(totalTrades / randomFloat(3, 8));
  const activePositions = randomInt(3, Math.min(20, marketsTrad));

  // 6. Generate time metrics
  const daysActive = randomInt(30, 730); // 1 month to 2 years
  const firstTradeDate = new Date(Date.now() - daysActive * 86400000);
  const lastTradeDate = new Date(Date.now() - randomInt(0, 48) * 3600000); // 0-48 hours ago

  // 7. Generate risk metrics
  const sharpeRatio = calculateSharpeRatio(totalPnL, totalInvested, winRate, wis);
  const sharpeLevel = getSharpeLevel(sharpeRatio);

  // 8. Generate rankings (inverse of WIS with some noise)
  const totalTraders = 10000;
  const baseRank = Math.round((100 - wis) / 100 * totalTraders);
  const rankPnL = Math.max(1, baseRank + randomInt(-100, 100));
  const rankWis = Math.max(1, Math.round((95 - wis) / 95 * totalTraders));
  const rankVolume = Math.max(1, baseRank + randomInt(-200, 200));

  // 9. Generate PnL ranks for different periods
  const pnlRanks = generatePnLRanks(rankPnL, totalPnL);

  return {
    wallet_address: walletAddress,
    wallet_alias: walletAlias,
    wis: wis,
    ...styleFlags,
    total_invested: totalInvested,
    realized_pnl: realizedPnL,
    realized_pnl_pct: (realizedPnL / totalInvested) * 100,
    unrealized_pnl: unrealizedPnL,
    unrealized_pnl_pct: (unrealizedPnL / totalInvested) * 100,
    total_pnl: totalPnL,
    total_pnl_pct: (totalPnL / totalInvested) * 100,
    total_trades: totalTrades,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    win_rate: winRate,
    avg_trade_size: avgTradeSize,
    largest_win: generateLargestWin(realizedPnL, winningTrades),
    largest_loss: generateLargestLoss(realizedPnL, losingTrades),
    markets_traded: marketsTrad,
    active_positions: activePositions,
    first_trade_date: firstTradeDate.toISOString(),
    last_trade_date: lastTradeDate.toISOString(),
    days_active: daysActive,
    rank_by_pnl: rankPnL,
    rank_by_wis: rankWis,
    rank_by_volume: rankVolume,
    risk_metrics: {
      sharpe_ratio_30d: sharpeRatio,
      sharpe_level: sharpeLevel,
      traded_volume_30d_daily: generate30DayVolume(totalInvested),
      traded_volume_30d_total: Math.round(totalInvested * randomFloat(0.3, 0.8)),
    },
    pnl_ranks: pnlRanks,
  };
}
```

### Trading Style Archetypes

```typescript
type Archetype =
  | 'whale'           // High WIS (85+), large positions
  | 'smart-investor'  // High WIS (75-85), balanced
  | 'contrarian'      // Medium WIS (60-75), early entries
  | 'momentum'        // Medium WIS (55-70), follows trends
  | 'casual'          // Low WIS (40-60), small trades
  | 'bagholder';      // Low WIS (<55), holds losers

function determineArchetype(wis: number): Archetype {
  const random = Math.random();

  if (wis >= 85) {
    return random < 0.7 ? 'whale' : 'smart-investor';
  } else if (wis >= 75) {
    return random < 0.5 ? 'smart-investor' : 'contrarian';
  } else if (wis >= 60) {
    return random < 0.4 ? 'contrarian' : 'momentum';
  } else if (wis >= 50) {
    return random < 0.6 ? 'momentum' : 'casual';
  } else {
    return random < 0.7 ? 'bagholder' : 'casual';
  }
}

function generateStyleFlags(archetype: Archetype) {
  switch (archetype) {
    case 'whale':
      return {
        contrarian_pct: randomFloat(40, 65),
        lottery_ticket_count: randomInt(0, 2),
        bagholder_pct: randomFloat(20, 40),
        whale_splash_count: randomInt(100, 500),
        reverse_cramer_count: randomInt(1, 3),
        is_senior: Math.random() < 0.7,
        is_millionaire: Math.random() < 0.8,
      };

    case 'smart-investor':
      return {
        contrarian_pct: randomFloat(50, 70),
        lottery_ticket_count: randomInt(0, 3),
        bagholder_pct: randomFloat(30, 50),
        whale_splash_count: randomInt(50, 200),
        reverse_cramer_count: randomInt(1, 4),
        is_senior: Math.random() < 0.5,
        is_millionaire: Math.random() < 0.4,
      };

    case 'contrarian':
      return {
        contrarian_pct: randomFloat(65, 85),
        lottery_ticket_count: randomInt(2, 6),
        bagholder_pct: randomFloat(60, 80),
        whale_splash_count: randomInt(10, 100),
        reverse_cramer_count: randomInt(3, 5),
        is_senior: Math.random() < 0.3,
        is_millionaire: Math.random() < 0.2,
      };

    case 'momentum':
      return {
        contrarian_pct: randomFloat(20, 40),
        lottery_ticket_count: randomInt(0, 2),
        bagholder_pct: randomFloat(40, 60),
        whale_splash_count: randomInt(5, 50),
        reverse_cramer_count: randomInt(0, 1),
        is_senior: Math.random() < 0.2,
        is_millionaire: Math.random() < 0.1,
      };

    case 'casual':
      return {
        contrarian_pct: randomFloat(30, 60),
        lottery_ticket_count: randomInt(1, 5),
        bagholder_pct: randomFloat(50, 70),
        whale_splash_count: randomInt(0, 10),
        reverse_cramer_count: randomInt(0, 2),
        is_senior: false,
        is_millionaire: false,
      };

    case 'bagholder':
      return {
        contrarian_pct: randomFloat(40, 70),
        lottery_ticket_count: randomInt(3, 10),
        bagholder_pct: randomFloat(70, 90),
        whale_splash_count: randomInt(0, 20),
        reverse_cramer_count: randomInt(1, 3),
        is_senior: false,
        is_millionaire: false,
      };
  }
}
```

---

## Market Data Generation

### Market Profile

```typescript
interface MarketDetail {
  // Identity
  market_id: string;
  title: string;
  description: string;
  category: string;

  // Current State
  outcome: 'YES' | 'NO';
  current_price: number;       // 0.3 - 0.8 (weighted)
  bid: number;
  ask: number;
  spread_bps: number;          // 5-20

  // Volume & Liquidity
  volume_24h: number;          // 100k - 5M
  volume_total: number;        // 15x - 60x of 24h
  liquidity_usd: number;       // 0.2 - 0.6x of 24h volume

  // Timing
  end_date: string;            // ISO timestamp
  hours_to_close: number;      // 24 - 4,320 (180 days)
  active: boolean;

  // Signals
  sii: number;                 // 40-90
  momentum: number;            // 30-95
  signal_confidence: number;   // 0.75 - 0.95
  signal_recommendation: 'BUY_YES' | 'BUY_NO' | 'SELL' | 'HOLD';
  edge_bp: number;             // 50-200
}
```

### Generation Algorithm

```typescript
export function generateMarketDetail(category: string, seed?: number): MarketDetail {
  const marketId = generateMarketId(category, seed);
  const title = generateMarketTitle(category);
  const description = generateMarketDescription(category, title);

  // Price generation (weighted toward 0.5-0.7 for active markets)
  const priceDistribution = betaDistribution(2, 2); // Bell curve around 0.5
  const basePrice = 0.3 + priceDistribution * 0.5; // 0.3 to 0.8
  const currentPrice = roundToTick(basePrice, 0.01);

  // Bid/ask spread (tighter for high liquidity)
  const spreadBps = randomInt(5, 20);
  const spreadAmount = currentPrice * (spreadBps / 10000);
  const bid = roundToTick(currentPrice - spreadAmount, 0.0001);
  const ask = roundToTick(currentPrice + spreadAmount, 0.0001);

  // Volume (power law distribution - few huge markets, many small)
  const volumeScale = powerLawRandom(1, 50); // 1x to 50x multiplier
  const volume24h = Math.round(100000 * volumeScale);
  const volumeTotal = Math.round(volume24h * randomFloat(15, 60));
  const liquidityUsd = Math.round(volume24h * randomFloat(0.2, 0.6));

  // Timing
  const hoursToClose = randomInt(24, 4320); // 1 day to 180 days
  const endDate = new Date(Date.now() + hoursToClose * 3600000);

  // Signals (correlated)
  const sii = Math.round(normalDistribution(65, 15, 40, 90));
  const momentum = Math.round(normalDistribution(70, 12, 30, 95));
  const confidence = 0.75 + randomFloat(0, 0.20);
  const recommendation = determineRecommendation(sii, momentum, currentPrice);
  const edge = Math.round(50 + (sii - 50) * 3); // Higher SII = higher edge

  return {
    market_id: marketId,
    title: title,
    description: description,
    category: category,
    outcome: 'YES', // Placeholder
    current_price: currentPrice,
    bid: bid,
    ask: ask,
    spread_bps: spreadBps,
    volume_24h: volume24h,
    volume_total: volumeTotal,
    liquidity_usd: liquidityUsd,
    end_date: endDate.toISOString(),
    hours_to_close: hoursToClose,
    active: true,
    sii: sii,
    momentum: momentum,
    signal_confidence: confidence,
    signal_recommendation: recommendation,
    edge_bp: edge,
  };
}
```

### Market Titles by Category

```typescript
const MARKET_TEMPLATES = {
  Politics: [
    'Will {candidate} win the {year} {office}?',
    'Will {party} control the {chamber} after {election}?',
    'Will {politician} resign by {date}?',
    'Will {bill} pass by {deadline}?',
    'Will {country} hold elections in {year}?',
  ],

  Crypto: [
    'Will {coin} reach ${price} by {date}?',
    'Will {coin} outperform {coin2} in {year}?',
    'Will {exchange} launch {feature} by {quarter}?',
    'Will {network} have outage in {period}?',
    'Will {coin} flip {coin2} by market cap in {year}?',
  ],

  Tech: [
    'Will {company} release {product} in {year}?',
    'Will {company} reach {valuation} valuation by {date}?',
    'Will {product} sell {quantity} units in {period}?',
    'Will {company} acquire {company2} in {year}?',
    'Will {technology} achieve {milestone} by {date}?',
  ],

  Finance: [
    'Will the Fed cut rates in {month} {year}?',
    'Will {index} hit {level} by {date}?',
    'Will the US enter recession in {year}?',
    'Will {commodity} reach ${price} in {year}?',
    'Will unemployment drop below {rate}% by {date}?',
  ],

  'Pop Culture': [
    'Will {movie} gross over ${amount} worldwide?',
    'Will {artist} win {award} at the {ceremony}?',
    'Will {show} be renewed for season {number}?',
    'Will {celebrity} and {celebrity2} still be together by {date}?',
    'Will {album} top the Billboard 200?',
  ],
};

function generateMarketTitle(category: string): string {
  const templates = MARKET_TEMPLATES[category] || MARKET_TEMPLATES.Politics;
  const template = weightedRandom(templates, templates.map(() => 1));

  // Replace placeholders with realistic values
  return template
    .replace('{candidate}', randomFromList(CANDIDATES))
    .replace('{year}', randomFromList(['2024', '2025', '2026']))
    .replace('{office}', randomFromList(['Presidential Election', 'Senate', 'Governorship']))
    .replace('{coin}', randomFromList(['BTC', 'ETH', 'SOL', 'DOGE', 'ADA']))
    .replace('{price}', randomFromList(['100k', '10k', '5k', '$1', '$2500']))
    .replace('{company}', randomFromList(['Apple', 'Tesla', 'OpenAI', 'Meta', 'Google']))
    .replace('{product}', randomFromList(['Vision Pro 2', 'GPT-5', 'Cybertruck', 'Quest 4']))
    .replace('{movie}', randomFromList(['Barbie 2', 'Oppenheimer', 'Dune 3', 'Avatar 4']))
    .replace('{artist}', randomFromList(['Taylor Swift', 'Beyoncé', 'Drake', 'Bad Bunny']))
    .replace('{award}', randomFromList(['Album of the Year', 'Best Picture', 'MVP']))
    // ... more replacements
    ;
}
```

### Holder Generation

```typescript
function generateHolder(
  side: 'YES' | 'NO',
  marketPrice: number,
  totalSupply: number
): HolderPosition {
  // Generate WIS (smart money has higher WIS)
  const isSmartMoney = Math.random() < 0.3; // 30% smart money
  const wis = isSmartMoney
    ? Math.round(normalDistribution(80, 10, 70, 95))
    : Math.round(normalDistribution(60, 15, 40, 85));

  // Entry price correlated with side and WIS
  let entryPrice: number;
  if (side === 'YES') {
    // Smart money enters lower
    const entryBase = isSmartMoney
      ? marketPrice - randomFloat(0.05, 0.15)
      : marketPrice - randomFloat(-0.05, 0.10);
    entryPrice = Math.max(0.10, Math.min(0.90, entryBase));
  } else {
    const entryBase = isSmartMoney
      ? marketPrice + randomFloat(0.05, 0.15)
      : marketPrice + randomFloat(-0.10, 0.05);
    entryPrice = Math.max(0.10, Math.min(0.90, entryBase));
  }

  // Position size (power law - few whales, many small)
  const sizeScale = powerLawRandom(0.1, 100);
  const supplybps = Math.min(20, sizeScale); // Cap at 20%
  const shares = Math.round((totalSupply * supplybps) / 100);
  const invested = shares * entryPrice;

  // Current value and PnL
  const currentValue = shares * (side === 'YES' ? marketPrice : (1 - marketPrice));
  const unrealizedPnL = currentValue - invested;
  const realizedPnL = Math.round(invested * randomFloat(-0.1, 0.3));
  const totalPnL = unrealizedPnL + realizedPnL;

  return {
    wallet_address: generateEthAddress(),
    wallet_alias: generateTraderName(),
    position_usd: invested,
    pnl_total: totalPnL,
    supply_pct: supply_pct,
    avg_entry: entryPrice,
    realized_pnl: realizedPnL,
    unrealized_pnl: unrealizedPnL,
    smart_score: wis,
    last_action_time: recentDate(0, 168), // Last week
  };
}

// Generate holders with realistic distribution
function generateHolders(side: 'YES' | 'NO', marketPrice: number, count: number) {
  const totalSupply = randomInt(500000, 5000000);
  const holders: HolderPosition[] = [];

  for (let i = 0; i < count; i++) {
    holders.push(generateHolder(side, marketPrice, totalSupply));
  }

  // Sort by position size descending
  holders.sort((a, b) => b.position_usd - a.position_usd);

  // Adjust supply % to sum to ~100%
  const totalSupplyPct = holders.reduce((sum, h) => sum + h.supply_pct, 0);
  holders.forEach(h => {
    h.supply_pct = (h.supply_pct / totalSupplyPct) * 100;
  });

  return holders;
}
```

---

## Statistical Distributions

### Normal Distribution (Bell Curve)

```typescript
// Use for: WIS, SII, most human metrics
function normalDistribution(
  mean: number,
  stdDev: number,
  min: number,
  max: number
): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
  while (v === 0) v = Math.random();

  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const value = num * stdDev + mean;

  // Clamp to min/max
  return Math.max(min, Math.min(max, value));
}
```

### Power Law Distribution (Long Tail)

```typescript
// Use for: Position sizes, trade volumes, market popularity
function powerLawRandom(min: number, max: number, alpha: number = 1.5): number {
  const u = Math.random();
  const range = max - min;

  // Inverse transform sampling for power law
  const value = min * Math.pow(1 - u * (1 - Math.pow(min / max, alpha)), -1 / alpha);

  return Math.min(max, value);
}
```

### Beta Distribution (Bounded Bell Curve)

```typescript
// Use for: Prices (0-1 bounded), percentages
function betaDistribution(alpha: number, beta: number): number {
  // Using gamma distribution to generate beta
  const gamma1 = gammaRandom(alpha);
  const gamma2 = gammaRandom(beta);

  return gamma1 / (gamma1 + gamma2);
}

function gammaRandom(shape: number): number {
  // Marsaglia and Tsang method
  if (shape < 1) {
    return gammaRandom(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = normalDistribution(0, 1, -10, 10);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}
```

---

## Correlation Rules

### WIS ↔ PnL Correlation

```typescript
// Higher WIS should lead to better PnL (r ≈ 0.5-0.7)
function generateCorrelatedPnL(wis: number, invested: number): number {
  const wisNormalized = (wis - 50) / 50; // -0.2 to 0.9
  const baseReturn = 0.05 + wisNormalized * 0.15; // 5% to 20%
  const noise = randomFloat(-0.08, 0.12); // Add variance

  return Math.round(invested * (baseReturn + noise));
}
```

### Entry Price ↔ Current Price

```typescript
// Smart money enters earlier (lower price for YES, higher for NO)
function generateEntryPrice(
  side: 'YES' | 'NO',
  currentPrice: number,
  wis: number
): number {
  const smartnessDiscount = (wis - 60) / 200; // 0-0.175 for WIS 60-95

  if (side === 'YES') {
    // Smart buyers enter lower
    const entryBase = currentPrice - smartnessDiscount;
    return Math.max(0.05, Math.min(currentPrice + 0.05, entryBase + randomFloat(-0.05, 0.05)));
  } else {
    // Smart NO buyers enter higher
    const entryBase = currentPrice + smartnessDiscount;
    return Math.max(currentPrice - 0.05, Math.min(0.95, entryBase + randomFloat(-0.05, 0.05)));
  }
}
```

### Volume ↔ Liquidity

```typescript
// Higher volume markets have higher liquidity (r ≈ 0.6-0.8)
function generateLiquidity(volume24h: number): number {
  const baseRatio = 0.35; // 35% of daily volume
  const variance = randomFloat(-0.15, 0.15);

  return Math.round(volume24h * (baseRatio + variance));
}
```

### Category ↔ Behavior Patterns

```typescript
const CATEGORY_PATTERNS = {
  Politics: {
    avgWinRate: 0.62,        // Politics traders slightly better
    contraranPct: 0.65,      // More contrarian
    avgPosition: 2500,       // Medium positions
    volatility: 0.08,        // Moderate volatility
  },

  Crypto: {
    avgWinRate: 0.58,
    contrarian_pct: 0.45,
    avgPosition: 3500,       // Larger positions
    volatility: 0.15,        // High volatility
  },

  Tech: {
    avgWinRate: 0.61,
    contrarian_pct: 0.55,
    avgPosition: 2000,
    volatility: 0.10,
  },

  Finance: {
    avgWinRate: 0.59,
    contrarian_pct: 0.50,
    avgPosition: 4000,       // Largest positions
    volatility: 0.07,        // Lowest volatility
  },

  'Pop Culture': {
    avgWinRate: 0.52,        // Hardest to predict
    contrarian_pct: 0.40,    // Less contrarian
    avgPosition: 1200,       // Smallest positions
    volatility: 0.12,
  },
};
```

---

## Code Implementation

### Complete Data Generator Module

```typescript
// lib/realistic-data-generator.ts

import {
  normalDistribution,
  powerLawRandom,
  betaDistribution,
  randomFloat,
  randomInt,
  weightedRandom,
} from './random-utils';

import {
  generateEthAddress,
  generateTraderName,
  generateMarketId,
  generateMarketTitle,
  generateMarketDescription,
} from './name-generators';

export class RealisticDataGenerator {
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed || Date.now();
  }

  // Wallet Profile
  generateWalletProfile(): WalletProfile {
    // Implementation from above
  }

  generateActivePositions(count: number, categories: string[]): ActiveBet[] {
    return Array.from({ length: count }, (_, i) => {
      const category = weightedRandom(categories, [1, 1, 1, 1, 1]);
      return this.generateActivePosition(category);
    });
  }

  generateFinishedPositions(count: number, winRate: number): FinishedBet[] {
    const categories = ['Politics', 'Crypto', 'Tech', 'Finance', 'Pop Culture'];
    return Array.from({ length: count }, () => {
      const category = weightedRandom(categories, [1, 1, 1, 1, 1]);
      const won = Math.random() < winRate;
      return this.generateFinishedPosition(category, won);
    });
  }

  // Market Detail
  generateMarketDetail(category: string): MarketDetail {
    // Implementation from above
  }

  generatePriceHistory(currentPrice: number, hours: number): PriceHistoryPoint[] {
    const points: PriceHistoryPoint[] = [];
    let price = currentPrice - randomFloat(0.05, 0.15);

    for (let i = 0; i < hours; i++) {
      const trend = 0.0002; // Slight upward trend
      const noise = randomFloat(-0.01, 0.01);
      price = Math.max(0.1, Math.min(0.9, price + trend + noise));

      points.push({
        timestamp: new Date(Date.now() - (hours - i) * 3600000).toISOString(),
        price: roundToTick(price, 0.01),
        volume: Math.round(5000 + powerLawRandom(1, 10) * 5000),
      });
    }

    return points;
  }

  generateHolders(side: 'YES' | 'NO', count: number, marketPrice: number): HolderPosition[] {
    // Implementation from above
  }

  generateWhaleTrades(count: number, marketPrice: number): WhaleTradeForMarket[] {
    return Array.from({ length: count }, () => {
      const side = weightedRandom(['YES', 'NO'], [0.70, 0.30]);
      const action = weightedRandom(['BUY', 'SELL'], [0.85, 0.15]);
      const shares = randomInt(20000, 100000);
      const price = marketPrice + randomFloat(-0.02, 0.02);

      return {
        trade_id: generateId(),
        timestamp: recentDate(0, 72).toISOString(),
        wallet_address: generateEthAddress(),
        wallet_alias: generateTraderName(),
        wis: randomInt(65, 95),
        side: side,
        action: action,
        shares: shares,
        amount_usd: Math.round(shares * price),
        price: roundToTick(price, 0.01),
      };
    });
  }
}

// Usage
const generator = new RealisticDataGenerator();

const wallet = generator.generateWalletProfile();
const market = generator.generateMarketDetail('Politics');
const priceHistory = generator.generatePriceHistory(market.current_price, 168);
const yesHolders = generator.generateHolders('YES', 156, market.current_price);
const whaleTrades = generator.generateWhaleTrades(20, market.current_price);
```

---

## Data Validation

### Validation Checklist

```typescript
function validateWalletProfile(wallet: WalletProfile): string[] {
  const errors: string[] = [];

  // Range checks
  if (wallet.wis < 40 || wallet.wis > 95) {
    errors.push(`WIS ${wallet.wis} outside realistic range [40-95]`);
  }

  if (wallet.win_rate < 0.35 || wallet.win_rate > 0.95) {
    errors.push(`Win rate ${wallet.win_rate} unrealistic [0.35-0.95]`);
  }

  // Consistency checks
  const calculatedWinRate = wallet.winning_trades / wallet.total_trades;
  if (Math.abs(calculatedWinRate - wallet.win_rate) > 0.01) {
    errors.push(`Win rate inconsistent: stated ${wallet.win_rate}, calculated ${calculatedWinRate}`);
  }

  const calculatedTotal = wallet.realized_pnl + wallet.unrealized_pnl;
  if (Math.abs(calculatedTotal - wallet.total_pnl) > 1) {
    errors.push(`Total PnL inconsistent: stated ${wallet.total_pnl}, calculated ${calculatedTotal}`);
  }

  // Correlation checks
  const wisMultiplier = (wallet.wis - 50) / 50;
  const expectedReturn = 0.05 + wisMultiplier * 0.15;
  const actualReturn = wallet.total_pnl / wallet.total_invested;
  if (Math.abs(actualReturn - expectedReturn) > 0.30) {
    errors.push(`PnL doesn't correlate with WIS (expected ~${expectedReturn}, got ${actualReturn})`);
  }

  // Realism checks
  if (wallet.total_pnl_pct > 200) {
    errors.push(`PnL return ${wallet.total_pnl_pct}% unrealistically high`);
  }

  if (wallet.bagholder_pct > 95 && wallet.total_pnl > 0) {
    errors.push(`Bagholder (${wallet.bagholder_pct}%) shouldn't be profitable`);
  }

  return errors;
}

function validateMarketDetail(market: MarketDetail): string[] {
  const errors: string[] = [];

  // Price bounds
  if (market.current_price < 0.05 || market.current_price > 0.95) {
    errors.push(`Price ${market.current_price} outside realistic range [0.05-0.95]`);
  }

  // Bid/ask consistency
  if (market.bid >= market.ask) {
    errors.push(`Bid ${market.bid} >= ask ${market.ask} (invalid order book)`);
  }

  if (market.current_price < market.bid || market.current_price > market.ask) {
    errors.push(`Current price ${market.current_price} outside bid-ask spread`);
  }

  // Volume consistency
  if (market.volume_total < market.volume_24h) {
    errors.push(`Total volume less than 24h volume`);
  }

  // Liquidity correlation
  const liquidityRatio = market.liquidity_usd / market.volume_24h;
  if (liquidityRatio < 0.1 || liquidityRatio > 1.0) {
    errors.push(`Liquidity ratio ${liquidityRatio} unrealistic [0.1-1.0]`);
  }

  return errors;
}
```

### Example Validation Output

```typescript
const wallet = generator.generateWalletProfile();
const errors = validateWalletProfile(wallet);

if (errors.length > 0) {
  console.error('Validation failed:');
  errors.forEach(err => console.error(`  - ${err}`));
} else {
  console.log('✓ Wallet profile passed all validation checks');
}
```

---

## Summary

This guide provides comprehensive algorithms for generating realistic dummy data that:

1. **Follows statistical distributions** (normal, power law, beta)
2. **Maintains correlations** between related metrics
3. **Reflects category patterns** (Politics ≠ Crypto ≠ Pop Culture)
4. **Validates consistency** (calculated values match stated values)
5. **Passes realism checks** (no perfect 100% win rates, no $1B positions)

Use the `RealisticDataGenerator` class to generate all mock data for development and testing. The generated data will stress-test layouts with realistic edge cases (very long market titles, extreme PnL values, many holders, etc.).
