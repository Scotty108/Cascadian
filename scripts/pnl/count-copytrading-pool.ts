/**
 * Count Copy-Trading Pool Size
 *
 * Estimates how many wallets pass our copy-trading quality filters:
 * - 30d active (at least 1 trade in last 30 days)
 * - >20 trades total
 * - omega > 1 (more profitable than losing trades)
 * - profit > $500
 *
 * Also computes confidence tier based on:
 * - External sells ratio (lower = higher confidence)
 * - Redemption count (lower relative to trades = higher confidence)
 *
 * Run with: npx tsx scripts/pnl/count-copytrading-pool.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

interface WalletStats {
  wallet: string;
  tradeCount: number;
  tradeDays30d: number;
  buyCount: number;
  sellCount: number;
  totalBuysUsdc: number;
  totalSellsUsdc: number;
  pnlEstimate: number;
}

async function main() {
  const client = getClickHouseClient();

  console.log('=== COPY-TRADING POOL SIZE ESTIMATION ===\n');

  // Step 1: Quick counts at different filter levels
  console.log('Step 1: Quick counts at various filter levels...\n');

  // Count all wallets with any maker trades
  const totalWalletsResult = await client.query({
    query: `
      SELECT uniq(trader_wallet) as count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker'
    `,
    format: 'JSONEachRow',
  });
  const totalWallets = Number(((await totalWalletsResult.json()) as any[])[0]?.count || 0);
  console.log(`Total wallets with maker trades: ${totalWallets.toLocaleString()}`);

  // Count wallets with >20 trades
  const over20TradesResult = await client.query({
    query: `
      SELECT count() as count FROM (
        SELECT trader_wallet, count() as trades
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND role = 'maker'
        GROUP BY trader_wallet
        HAVING trades > 20
      )
    `,
    format: 'JSONEachRow',
  });
  const over20Trades = Number(((await over20TradesResult.json()) as any[])[0]?.count || 0);
  console.log(`Wallets with >20 maker trades: ${over20Trades.toLocaleString()}`);

  // Count wallets with >20 trades AND 30d activity
  const with30dResult = await client.query({
    query: `
      SELECT count() as count FROM (
        SELECT trader_wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND role = 'maker'
        GROUP BY trader_wallet
        HAVING count() > 20 AND countIf(trade_time >= now() - INTERVAL 30 DAY) > 0
      )
    `,
    format: 'JSONEachRow',
  });
  const with30d = Number(((await with30dResult.json()) as any[])[0]?.count || 0);
  console.log(`Wallets with >20 trades + 30d active: ${with30d.toLocaleString()}`);

  // Step 2: Get wallet stats for profitable estimation (sampled for speed)
  console.log('\nStep 2: Estimating profitability filters (sample-based)...\n');

  // Use a simpler approach: get PnL stats from aggregated data
  const basicStats = await client.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        countIf(trade_time >= now() - INTERVAL 30 DAY) as trades_30d,
        sumIf(usdc_amount, side = 'buy') / 1000000.0 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1000000.0 as sell_usdc,
        countIf(side = 'buy') as buy_count,
        countIf(side = 'sell') as sell_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker'
      GROUP BY wallet
      HAVING trade_count > 20 AND trades_30d > 0
    `,
    format: 'JSONEachRow',
  });

  const walletRows = (await basicStats.json()) as any[];
  console.log(`  Found ${walletRows.length.toLocaleString()} wallets with >20 trades and 30d activity\n`);

  // Step 2: Compute simple PnL estimate (sell - buy) and omega
  console.log('Step 2: Computing PnL estimates and omega...');

  const passFilters: WalletStats[] = [];
  let withProfit500 = 0;
  let withOmegaGt1 = 0;
  let passBoth = 0;

  for (const row of walletRows) {
    const buyUsdc = Number(row.buy_usdc) || 0;
    const sellUsdc = Number(row.sell_usdc) || 0;
    const simplePnl = sellUsdc - buyUsdc; // Simple cash-flow estimate

    // Omega estimate: profitable trades / losing trades
    // Using sell_count as proxy for profitable exits
    const buyCount = Number(row.buy_count) || 0;
    const sellCount = Number(row.sell_count) || 0;
    const omegaProxy = sellCount > 0 ? sellCount / Math.max(buyCount - sellCount, 1) : 0;

    if (simplePnl > 500) withProfit500++;
    if (omegaProxy > 1) withOmegaGt1++;
    if (simplePnl > 500 && omegaProxy > 1) {
      passBoth++;
      passFilters.push({
        wallet: row.wallet,
        tradeCount: Number(row.trade_count),
        tradeDays30d: Number(row.trades_30d),
        buyCount,
        sellCount,
        totalBuysUsdc: buyUsdc,
        totalSellsUsdc: sellUsdc,
        pnlEstimate: simplePnl,
      });
    }
  }

  console.log(`  Profit > $500: ${withProfit500.toLocaleString()} wallets`);
  console.log(`  Omega proxy > 1: ${withOmegaGt1.toLocaleString()} wallets`);
  console.log(`  Pass BOTH: ${passBoth.toLocaleString()} wallets\n`);

  // Step 3: Get redemption data for the passing wallets
  console.log('Step 3: Loading redemption data for candidates...');

  const candidateWallets = passFilters.map((w) => `'${w.wallet}'`).join(',');

  let redemptionMap = new Map<string, { count: number; usdc: number }>();
  if (passFilters.length > 0) {
    const redemptionResult = await client.query({
      query: `
        SELECT
          lower(user_address) as wallet,
          count() as redemption_count,
          sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemption_usdc
        FROM pm_ctf_events
        WHERE event_type = 'PayoutRedemption'
          AND is_deleted = 0
          AND lower(user_address) IN (${candidateWallets})
        GROUP BY wallet
      `,
      format: 'JSONEachRow',
    });
    const redemptionRows = (await redemptionResult.json()) as any[];
    for (const r of redemptionRows) {
      redemptionMap.set(r.wallet.toLowerCase(), {
        count: Number(r.redemption_count),
        usdc: Number(r.redemption_usdc),
      });
    }
  }

  console.log(`  Loaded redemption data for ${redemptionMap.size} wallets\n`);

  // Step 4: Assign confidence tiers
  console.log('Step 4: Assigning confidence tiers...\n');

  interface CandidateWithConfidence extends WalletStats {
    redemptionCount: number;
    redemptionUsdc: number;
    redemptionRatio: number;
    confidenceTier: 'high' | 'medium' | 'low';
  }

  const candidates: CandidateWithConfidence[] = [];

  for (const w of passFilters) {
    const redemption = redemptionMap.get(w.wallet) || { count: 0, usdc: 0 };
    const redemptionRatio = w.tradeCount > 0 ? redemption.count / w.tradeCount : 0;

    // Confidence tier logic:
    // HIGH: redemption ratio < 0.1 (less than 10% of trades had redemptions)
    // MEDIUM: redemption ratio < 0.3
    // LOW: redemption ratio >= 0.3 OR redemption USDC > 10x PnL estimate
    let tier: 'high' | 'medium' | 'low';
    if (redemptionRatio < 0.1 && redemption.usdc < Math.abs(w.pnlEstimate) * 2) {
      tier = 'high';
    } else if (redemptionRatio < 0.3 && redemption.usdc < Math.abs(w.pnlEstimate) * 5) {
      tier = 'medium';
    } else {
      tier = 'low';
    }

    candidates.push({
      ...w,
      redemptionCount: redemption.count,
      redemptionUsdc: redemption.usdc,
      redemptionRatio,
      confidenceTier: tier,
    });
  }

  // Count by tier
  const highConf = candidates.filter((c) => c.confidenceTier === 'high');
  const medConf = candidates.filter((c) => c.confidenceTier === 'medium');
  const lowConf = candidates.filter((c) => c.confidenceTier === 'low');

  console.log('=== COPY-TRADING POOL BREAKDOWN ===\n');
  console.log('Filters: 30d active, >20 trades, omega>1, profit>$500\n');
  console.log(`Total candidates: ${candidates.length.toLocaleString()}`);
  console.log(`  HIGH confidence: ${highConf.length.toLocaleString()} (${((highConf.length / candidates.length) * 100).toFixed(1)}%)`);
  console.log(`  MEDIUM confidence: ${medConf.length.toLocaleString()} (${((medConf.length / candidates.length) * 100).toFixed(1)}%)`);
  console.log(`  LOW confidence: ${lowConf.length.toLocaleString()} (${((lowConf.length / candidates.length) * 100).toFixed(1)}%)`);

  // PnL distribution
  console.log('\n\n=== PnL DISTRIBUTION ===\n');

  const pnlBuckets = [
    { min: 500, max: 1000, label: '$500-$1k' },
    { min: 1000, max: 5000, label: '$1k-$5k' },
    { min: 5000, max: 10000, label: '$5k-$10k' },
    { min: 10000, max: 50000, label: '$10k-$50k' },
    { min: 50000, max: 100000, label: '$50k-$100k' },
    { min: 100000, max: 500000, label: '$100k-$500k' },
    { min: 500000, max: Infinity, label: '$500k+' },
  ];

  console.log('| PnL Range | Total | High Conf | Med Conf | Low Conf |');
  console.log('|-----------|-------|-----------|----------|----------|');

  for (const bucket of pnlBuckets) {
    const inBucket = candidates.filter((c) => c.pnlEstimate >= bucket.min && c.pnlEstimate < bucket.max);
    const highInBucket = inBucket.filter((c) => c.confidenceTier === 'high');
    const medInBucket = inBucket.filter((c) => c.confidenceTier === 'medium');
    const lowInBucket = inBucket.filter((c) => c.confidenceTier === 'low');

    console.log(
      `| ${bucket.label.padEnd(12)} | ${inBucket.length.toString().padStart(5)} | ${highInBucket.length.toString().padStart(9)} | ${medInBucket.length.toString().padStart(8)} | ${lowInBucket.length.toString().padStart(8)} |`
    );
  }

  // Top 20 by PnL with high confidence
  console.log('\n\n=== TOP 20 HIGH-CONFIDENCE WALLETS ===\n');
  console.log('| Wallet | PnL Est | Trades | 30d | Redemptions | Ratio |');
  console.log('|--------|---------|--------|-----|-------------|-------|');

  const topHigh = highConf.sort((a, b) => b.pnlEstimate - a.pnlEstimate).slice(0, 20);
  for (const c of topHigh) {
    const pnl = c.pnlEstimate >= 1000 ? `$${(c.pnlEstimate / 1000).toFixed(0)}k` : `$${c.pnlEstimate.toFixed(0)}`;
    console.log(
      `| ${c.wallet.slice(0, 10)}.. | ${pnl.padStart(7)} | ${c.tradeCount.toString().padStart(6)} | ${c.tradeDays30d.toString().padStart(3)} | ${c.redemptionCount.toString().padStart(11)} | ${(c.redemptionRatio * 100).toFixed(1).padStart(4)}% |`
    );
  }

  // Summary stats
  console.log('\n\n=== SUMMARY ===\n');
  console.log(`Copy-trading pool size (all confidence): ${candidates.length.toLocaleString()}`);
  console.log(`Copy-trading pool size (HIGH + MEDIUM): ${(highConf.length + medConf.length).toLocaleString()}`);
  console.log(`Copy-trading pool size (HIGH only): ${highConf.length.toLocaleString()}`);

  const totalPnl = candidates.reduce((sum, c) => sum + c.pnlEstimate, 0);
  const avgPnl = totalPnl / candidates.length;
  console.log(`\nTotal pool PnL: $${(totalPnl / 1000000).toFixed(1)}M`);
  console.log(`Average PnL per wallet: $${avgPnl.toFixed(0)}`);

  // Stricter filters
  console.log('\n\n=== ALTERNATIVE FILTER COMBINATIONS ===\n');

  const stricter = [
    { minTrades: 50, minPnl: 1000, label: '>50 trades, >$1k PnL' },
    { minTrades: 100, minPnl: 5000, label: '>100 trades, >$5k PnL' },
    { minTrades: 20, minPnl: 10000, label: '>20 trades, >$10k PnL' },
    { minTrades: 50, minPnl: 10000, label: '>50 trades, >$10k PnL' },
  ];

  for (const filter of stricter) {
    const filtered = candidates.filter(
      (c) => c.tradeCount >= filter.minTrades && c.pnlEstimate >= filter.minPnl
    );
    const filteredHigh = filtered.filter((c) => c.confidenceTier === 'high');
    console.log(`${filter.label}: ${filtered.length} total, ${filteredHigh.length} high-confidence`);
  }
}

main().catch(console.error);
