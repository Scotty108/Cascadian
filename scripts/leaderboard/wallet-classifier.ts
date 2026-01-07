/**
 * Wallet Classifier for Copy-Safe Leaderboard
 *
 * Filters out wallets with high short/arb patterns that CCR-v1 cannot accurately track.
 *
 * Metrics calculated:
 * - short_sell_ratio: sell_tokens_without_buy / total_sell_tokens
 * - paired_outcome_ratio: paired_trades / total_trades
 * - token_deficit_ratio: abs(negative_net_tokens) / total_tokens_traded
 *
 * Wallets exceeding thresholds are flagged as "not copy-safe"
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

interface WalletMetrics {
  wallet: string;
  total_trades: number;
  buy_trades: number;
  sell_trades: number;
  total_buy_usdc: number;
  total_sell_usdc: number;
  total_buy_tokens: number;
  total_sell_tokens: number;
  unique_tokens: number;
  tokens_with_deficit: number;
  total_deficit_amount: number;
  paired_trades: number;
  short_sell_ratio: number;
  token_deficit_ratio: number;
  paired_outcome_ratio: number;
  is_copy_safe: boolean;
}

// Thresholds for filtering (tunable)
const THRESHOLDS = {
  MAX_SHORT_SELL_RATIO: 0.3, // Max 30% of sells without prior buy
  MAX_TOKEN_DEFICIT_RATIO: 0.2, // Max 20% negative net tokens
  MAX_PAIRED_OUTCOME_RATIO: 0.4, // Max 40% paired trades
  MIN_TRADES: 20, // Minimum trades to evaluate
};

async function classifyWallet(wallet: string): Promise<WalletMetrics> {
  // Get basic trade stats
  const statsQ = `
    SELECT
      side,
      count() as trades,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens
    FROM (
      SELECT
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY side
  `;

  const statsR = await clickhouse.query({ query: statsQ, format: 'JSONEachRow' });
  const stats = (await statsR.json()) as any[];

  let buyTrades = 0,
    sellTrades = 0;
  let totalBuyUsdc = 0,
    totalSellUsdc = 0;
  let totalBuyTokens = 0,
    totalSellTokens = 0;

  for (const s of stats) {
    if (s.side === 'buy') {
      buyTrades = Number(s.trades);
      totalBuyUsdc = Number(s.total_usdc);
      totalBuyTokens = Number(s.total_tokens);
    } else {
      sellTrades = Number(s.trades);
      totalSellUsdc = Number(s.total_usdc);
      totalSellTokens = Number(s.total_tokens);
    }
  }

  const totalTrades = buyTrades + sellTrades;

  // Get token-level deficit analysis
  const deficitQ = `
    SELECT
      count() as unique_tokens,
      countIf(net_tokens < -10) as tokens_with_deficit,
      sumIf(abs(net_tokens), net_tokens < -10) as total_deficit
    FROM (
      SELECT
        token_id,
        sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
      FROM (
        SELECT
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY token_id
    )
  `;

  const deficitR = await clickhouse.query({ query: deficitQ, format: 'JSONEachRow' });
  const deficit = (await deficitR.json()) as any[];

  const uniqueTokens = Number(deficit[0]?.unique_tokens || 0);
  const tokensWithDeficit = Number(deficit[0]?.tokens_with_deficit || 0);
  const totalDeficitAmount = Number(deficit[0]?.total_deficit || 0);

  // Get paired outcome trades (buy O0 + sell O1 in same tx, or vice versa)
  const pairedQ = `
    SELECT count() as paired_count
    FROM (
      SELECT
        transaction_hash,
        condition_id,
        groupArray(side) as sides,
        groupArray(outcome_index) as outcomes
      FROM (
        SELECT
          any(f.transaction_hash) as transaction_hash,
          any(f.side) as side,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index
        FROM pm_trader_events_v2 f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        WHERE lower(f.trader_wallet) = lower('${wallet}') AND f.is_deleted = 0
        GROUP BY f.event_id
      )
      GROUP BY transaction_hash, condition_id
      HAVING length(sides) >= 2
        AND has(outcomes, 0)
        AND has(outcomes, 1)
        AND (has(sides, 'buy') AND has(sides, 'sell'))
    )
  `;

  const pairedR = await clickhouse.query({ query: pairedQ, format: 'JSONEachRow' });
  const paired = (await pairedR.json()) as any[];
  const pairedTrades = Number(paired[0]?.paired_count || 0) * 2; // Each pair = 2 trades

  // Calculate ratios
  const shortSellRatio = totalSellTokens > 0 ? totalDeficitAmount / totalSellTokens : 0;
  const tokenDeficitRatio = totalBuyTokens + totalSellTokens > 0 ? totalDeficitAmount / (totalBuyTokens + totalSellTokens) : 0;
  const pairedOutcomeRatio = totalTrades > 0 ? pairedTrades / totalTrades : 0;

  // Determine if copy-safe
  const isCopySafe =
    totalTrades >= THRESHOLDS.MIN_TRADES &&
    shortSellRatio <= THRESHOLDS.MAX_SHORT_SELL_RATIO &&
    tokenDeficitRatio <= THRESHOLDS.MAX_TOKEN_DEFICIT_RATIO &&
    pairedOutcomeRatio <= THRESHOLDS.MAX_PAIRED_OUTCOME_RATIO;

  return {
    wallet,
    total_trades: totalTrades,
    buy_trades: buyTrades,
    sell_trades: sellTrades,
    total_buy_usdc: totalBuyUsdc,
    total_sell_usdc: totalSellUsdc,
    total_buy_tokens: totalBuyTokens,
    total_sell_tokens: totalSellTokens,
    unique_tokens: uniqueTokens,
    tokens_with_deficit: tokensWithDeficit,
    total_deficit_amount: totalDeficitAmount,
    paired_trades: pairedTrades,
    short_sell_ratio: shortSellRatio,
    token_deficit_ratio: tokenDeficitRatio,
    paired_outcome_ratio: pairedOutcomeRatio,
    is_copy_safe: isCopySafe,
  };
}

// Test wallets
const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(100));
  console.log('WALLET CLASSIFIER: Identifying Copy-Safe Wallets');
  console.log('='.repeat(100));
  console.log('');
  console.log('Thresholds:');
  console.log(`  Max Short Sell Ratio: ${(THRESHOLDS.MAX_SHORT_SELL_RATIO * 100).toFixed(0)}%`);
  console.log(`  Max Token Deficit Ratio: ${(THRESHOLDS.MAX_TOKEN_DEFICIT_RATIO * 100).toFixed(0)}%`);
  console.log(`  Max Paired Outcome Ratio: ${(THRESHOLDS.MAX_PAIRED_OUTCOME_RATIO * 100).toFixed(0)}%`);
  console.log(`  Min Trades: ${THRESHOLDS.MIN_TRADES}`);
  console.log('');
  console.log('Wallet           | Trades | Short% | Deficit% | Paired% | Safe?');
  console.log('-'.repeat(100));

  for (const w of testWallets) {
    const metrics = await classifyWallet(w.addr);

    const shortPct = (metrics.short_sell_ratio * 100).toFixed(1) + '%';
    const deficitPct = (metrics.token_deficit_ratio * 100).toFixed(1) + '%';
    const pairedPct = (metrics.paired_outcome_ratio * 100).toFixed(1) + '%';
    const safeStr = metrics.is_copy_safe ? '✓ YES' : '✗ NO';

    console.log(
      `${w.name.padEnd(16)} | ${String(metrics.total_trades).padStart(6)} | ${shortPct.padStart(6)} | ${deficitPct.padStart(8)} | ${pairedPct.padStart(7)} | ${safeStr}`
    );

    if (!metrics.is_copy_safe) {
      const reasons: string[] = [];
      if (metrics.short_sell_ratio > THRESHOLDS.MAX_SHORT_SELL_RATIO) reasons.push('high short');
      if (metrics.token_deficit_ratio > THRESHOLDS.MAX_TOKEN_DEFICIT_RATIO) reasons.push('high deficit');
      if (metrics.paired_outcome_ratio > THRESHOLDS.MAX_PAIRED_OUTCOME_RATIO) reasons.push('high paired');
      if (metrics.total_trades < THRESHOLDS.MIN_TRADES) reasons.push('low trades');
      console.log(`                 | Flagged: ${reasons.join(', ')}`);
    }
  }

  console.log('-'.repeat(100));
}

main().catch(console.error);
