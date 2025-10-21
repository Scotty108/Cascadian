/**
 * Realistic wallet profile generator with correlated metrics
 */

import {
  normalDistribution,
  randomFloat,
  randomInt,
  weightedRandom,
  pastDate,
  recentDate,
} from './random-utils';
import { generateEthAddress, generateTraderName } from './name-generators';

type Archetype = 'whale' | 'smart-investor' | 'contrarian' | 'momentum' | 'casual' | 'bagholder';

interface WalletProfile {
  wallet_address: string;
  wallet_alias: string;
  wis: number;
  contrarian_pct: number;
  lottery_ticket_count: number;
  bagholder_pct: number;
  whale_splash_count: number;
  reverse_cramer_count: number;
  is_senior: boolean;
  is_millionaire: boolean;
  total_invested: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  total_pnl: number;
  total_pnl_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_trade_size: number;
  largest_win: number;
  largest_loss: number;
  markets_traded: number;
  active_positions: number;
  first_trade_date: string;
  last_trade_date: string;
  days_active: number;
  rank_by_pnl: number;
  rank_by_wis: number;
  rank_by_volume: number;
  risk_metrics: {
    sharpe_ratio_30d: number;
    sharpe_level: string;
    traded_volume_30d_daily: Array<{ date: string; volume_usd: number }>;
    traded_volume_30d_total: number;
  };
  pnl_ranks: {
    d1: { period: string; rank: number; pnl_usd: number };
    d7: { period: string; rank: number; pnl_usd: number };
    d30: { period: string; rank: number; pnl_usd: number };
    all: { period: string; rank: number; pnl_usd: number };
  };
}

export function generateWalletProfile(seed?: number): WalletProfile {
  // 1. Generate core identity
  const wis = Math.round(normalDistribution(65, 15, 40, 95));
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
  const daysActive = randomInt(30, 730);
  const firstTradeDate = pastDate(daysActive, daysActive);
  const lastTradeDate = recentDate(0, 48);

  // 7. Generate risk metrics
  const sharpeRatio = calculateSharpeRatio(totalPnL, totalInvested, winRate, wis);
  const sharpeLevel = getSharpeLevel(sharpeRatio);
  const volume30d = generate30DayVolume(totalInvested);

  // 8. Generate rankings
  const totalTraders = 10000;
  const baseRank = Math.round((100 - wis) / 100 * totalTraders);
  const rankPnL = Math.max(1, baseRank + randomInt(-100, 100));
  const rankWis = Math.max(1, Math.round((95 - wis) / 95 * totalTraders));
  const rankVolume = Math.max(1, baseRank + randomInt(-200, 200));

  // 9. Generate PnL ranks for different periods
  const pnlRanks = generatePnLRanks(rankPnL, totalPnL);

  // 10. Generate largest win/loss
  const largestWin = Math.round(realizedPnL / winningTrades * randomFloat(3, 8));
  const largestLoss = Math.round(Math.abs(realizedPnL) / losingTrades * randomFloat(2, 5)) * -1;

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
    largest_win: largestWin,
    largest_loss: largestLoss,
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
      traded_volume_30d_daily: volume30d,
      traded_volume_30d_total: volume30d.reduce((sum, v) => sum + v.volume_usd, 0),
    },
    pnl_ranks: pnlRanks,
  };
}

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

function calculateSharpeRatio(
  totalPnL: number,
  totalInvested: number,
  winRate: number,
  wis: number
): number {
  const returns = totalPnL / totalInvested;
  const baseVolatility = 0.3 - (winRate - 0.5) * 0.4;
  const wisAdjustment = (wis - 60) / 100;

  const sharpe = returns / (baseVolatility - wisAdjustment * 0.1);
  return Math.max(0.1, Math.min(3.0, sharpe));
}

function getSharpeLevel(sharpe: number): string {
  if (sharpe >= 2.0) return 'Excellent';
  if (sharpe >= 1.5) return 'Good';
  if (sharpe >= 1.0) return 'Fair';
  return 'Poor';
}

function generate30DayVolume(totalInvested: number) {
  const dailyBase = totalInvested * randomFloat(0.01, 0.03);

  return Array.from({ length: 30 }, (_, i) => ({
    date: pastDate(30 - i, 30 - i).toISOString(),
    volume_usd: Math.round(dailyBase * randomFloat(0.5, 1.8)),
  }));
}

function generatePnLRanks(baseRank: number, totalPnL: number) {
  const pnl1d = Math.round(totalPnL * randomFloat(0.01, 0.03));
  const pnl7d = Math.round(totalPnL * randomFloat(0.05, 0.15));
  const pnl30d = Math.round(totalPnL * randomFloat(0.15, 0.35));

  return {
    d1: {
      period: '1D',
      rank: Math.max(1, baseRank + randomInt(-50, 50)),
      pnl_usd: pnl1d,
    },
    d7: {
      period: '7D',
      rank: Math.max(1, baseRank + randomInt(-30, 30)),
      pnl_usd: pnl7d,
    },
    d30: {
      period: '30D',
      rank: Math.max(1, baseRank + randomInt(-20, 20)),
      pnl_usd: pnl30d,
    },
    all: {
      period: 'All',
      rank: baseRank,
      pnl_usd: totalPnL,
    },
  };
}
