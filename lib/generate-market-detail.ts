/**
 * Realistic market detail generator with correlated metrics
 */

import {
  normalDistribution,
  betaDistribution,
  powerLawRandom,
  randomFloat,
  randomInt,
  weightedRandom,
  roundToTick,
  futureDate,
  recentDate,
  calculateHoursToClose,
} from './random-utils';
import {
  generateMarketId,
  generateMarketTitle,
  generateMarketDescription,
  generateEthAddress,
  generateTraderName,
  generateId,
} from './name-generators';

export function generateMarketDetail(category: string, seed?: number) {
  const marketId = generateMarketId(category, seed);
  const title = generateMarketTitle(category);
  const description = generateMarketDescription(category, title);

  // Price generation (weighted toward 0.5-0.7 for active markets)
  const priceDistribution = betaDistribution(2, 2);
  const basePrice = 0.3 + priceDistribution * 0.5;
  const currentPrice = roundToTick(basePrice, 0.01);

  // Bid/ask spread
  const spreadBps = randomInt(5, 20);
  const spreadAmount = currentPrice * (spreadBps / 10000);
  const bid = roundToTick(currentPrice - spreadAmount, 0.0001);
  const ask = roundToTick(currentPrice + spreadAmount, 0.0001);

  // Volume (power law - few huge markets, many small)
  const volumeScale = powerLawRandom(1, 50);
  const volume24h = Math.round(100000 * volumeScale);
  const volumeTotal = Math.round(volume24h * randomFloat(15, 60));
  const liquidityUsd = Math.round(volume24h * randomFloat(0.2, 0.6));

  // Timing
  const hoursToClose = randomInt(24, 4320);
  const endDate = futureDate(Math.floor(hoursToClose / 24), Math.floor(hoursToClose / 24));

  // Signals
  const sii = Math.round(normalDistribution(65, 15, 40, 90));
  const momentum = Math.round(normalDistribution(70, 12, 30, 95));
  const confidence = 0.75 + randomFloat(0, 0.20);
  const recommendation = determineRecommendation(sii, momentum, currentPrice);
  const edge = Math.round(50 + (sii - 50) * 3);

  return {
    market_id: marketId,
    title: title,
    description: description,
    category: category,
    outcome: 'YES' as const,
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

export function generatePriceHistory(currentPrice: number, hours: number) {
  const points: Array<{
    timestamp: string;
    price: number;
    volume: number;
  }> = [];

  let price = currentPrice - randomFloat(0.05, 0.15);

  for (let i = 0; i < hours; i++) {
    const trend = 0.0002;
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

export function generateHolders(side: 'YES' | 'NO', count: number, marketPrice: number) {
  const totalSupply = randomInt(500000, 5000000);
  const holders: Array<{
    wallet_address: string;
    wallet_alias: string;
    position_usd: number;
    pnl_total: number;
    supply_pct: number;
    avg_entry: number;
    realized_pnl: number;
    unrealized_pnl: number;
    smart_score: number;
    last_action_time: string;
  }> = [];

  for (let i = 0; i < count; i++) {
    const isSmartMoney = Math.random() < 0.3;
    const wis = isSmartMoney
      ? Math.round(normalDistribution(80, 10, 70, 95))
      : Math.round(normalDistribution(60, 15, 40, 85));

    // Entry price correlated with side and WIS
    let entryPrice: number;
    if (side === 'YES') {
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

    // Position size (power law)
    const sizeScale = powerLawRandom(0.1, 100);
    const supplyPct = Math.min(20, sizeScale);
    const shares = Math.round((totalSupply * supplyPct) / 100);
    const invested = shares * entryPrice;

    // Current value and PnL
    const currentValue = shares * (side === 'YES' ? marketPrice : (1 - marketPrice));
    const unrealizedPnL = currentValue - invested;
    const realizedPnL = Math.round(invested * randomFloat(-0.1, 0.3));
    const totalPnL = unrealizedPnL + realizedPnL;

    holders.push({
      wallet_address: generateEthAddress(),
      wallet_alias: generateTraderName(),
      position_usd: invested,
      pnl_total: totalPnL,
      supply_pct: supplyPct,
      avg_entry: entryPrice,
      realized_pnl: realizedPnL,
      unrealized_pnl: unrealizedPnL,
      smart_score: wis,
      last_action_time: recentDate(0, 168).toISOString(),
    });
  }

  // Sort by position size
  holders.sort((a, b) => b.position_usd - a.position_usd);

  // Normalize supply %
  const totalSupplyPct = holders.reduce((sum, h) => sum + h.supply_pct, 0);
  holders.forEach(h => {
    h.supply_pct = (h.supply_pct / totalSupplyPct) * 100;
  });

  return holders;
}

export function generateWhaleTrades(count: number, marketPrice: number) {
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
      side: side as 'YES' | 'NO',
      action: action as 'BUY' | 'SELL',
      shares: shares,
      amount_usd: Math.round(shares * price),
      price: roundToTick(price, 0.01),
    };
  });
}

export function generateSIIHistory(currentSII: number, hours: number) {
  const points: Array<{
    timestamp: string;
    sii: number;
    confidence: number;
  }> = [];

  let sii = currentSII - randomFloat(10, 20);

  for (let i = 0; i < hours; i++) {
    const trend = 0.2;
    const noise = randomFloat(-2, 2);
    sii = Math.max(40, Math.min(90, sii + trend + noise));

    points.push({
      timestamp: new Date(Date.now() - (hours - i) * 3600000).toISOString(),
      sii: Math.round(sii),
      confidence: 0.75 + randomFloat(0, 0.20),
    });
  }

  return points;
}

export function generateSignalBreakdown() {
  return {
    psp_weight: 0.40,
    psp_contribution: randomFloat(0.60, 0.85),
    psp_confidence: randomFloat(0.80, 0.95),
    crowd_weight: 0.30,
    crowd_contribution: randomFloat(0.65, 0.80),
    crowd_confidence: randomFloat(0.75, 0.90),
    momentum_weight: 0.20,
    momentum_contribution: randomFloat(0.55, 0.75),
    momentum_confidence: randomFloat(0.70, 0.85),
    microstructure_weight: 0.10,
    microstructure_contribution: randomFloat(0.60, 0.80),
    microstructure_confidence: randomFloat(0.65, 0.85),
  };
}

export function generateRelatedMarkets(category: string, count: number = 3) {
  return Array.from({ length: count }, () => {
    const marketPrice = randomFloat(0.3, 0.8);

    return {
      market_id: generateMarketId(category),
      title: generateMarketTitle(category),
      outcome_chips: [
        { side: 'YES' as const, price: roundToTick(marketPrice, 0.01) },
        { side: 'NO' as const, price: roundToTick(1 - marketPrice, 0.01) },
      ],
      volume_24h: Math.round(randomFloat(100000, 3000000)),
      liquidity: Math.round(randomFloat(50000, 1000000)),
    };
  });
}

function determineRecommendation(sii: number, momentum: number, price: number): string {
  const score = (sii * 0.6 + momentum * 0.4);

  if (score >= 70 && price < 0.7) return 'BUY_YES';
  if (score >= 70 && price >= 0.7) return 'HOLD';
  if (score <= 40 && price > 0.3) return 'BUY_NO';
  if (score <= 40 && price <= 0.3) return 'HOLD';

  return Math.random() < 0.5 ? 'BUY_YES' : 'BUY_NO';
}
