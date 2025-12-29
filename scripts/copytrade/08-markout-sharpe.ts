/**
 * Phase 8: 7-Day Markout Sharpe Ranking
 *
 * GPT's recommendation: Instead of realized P&L, measure TIMING EDGE.
 * "After this wallet trades, does the market move in their favor?"
 *
 * MARKOUT DEFINITION:
 * - For each trade, look at price 7 days later
 * - If BUY: favorable = price went UP
 * - If SELL: favorable = price went DOWN
 * - markout = (price_7d - entry_price) * direction_sign
 *
 * SHARPE = mean(markout) / stddev(markout), size-weighted
 *
 * This measures "were they early?" not just "did they profit?"
 * Better for copy-trading because:
 * 1. Faster feedback (7 days vs weeks for resolution)
 * 2. Measures timing edge, which is what copiers replicate
 * 3. Taker-only focus matches copy execution
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import * as fs from 'fs';
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000, // 2 minute timeout
  clickhouse_settings: {
    max_execution_time: 120,
  },
});

interface Phase7Wallet {
  wallet: string;
  shadow_omega: number;
  shadow_pnl: number;
  total_notional: number;
  n_events: number;
  n_positions: number;
  n_trades: number;
  win_pct: number;
  volume_percentile: number;
  crowding_risk: string;
}

interface MarkoutResult {
  wallet: string;
  // Markout metrics
  n_trades_with_markout: number;
  n_trades_total: number;
  coverage_pct: number;
  avg_markout: number;           // Mean favorable price movement
  markout_stddev: number;        // Volatility of markout
  markout_sharpe: number;        // avg / stddev (risk-adjusted timing edge)
  weighted_markout_sharpe: number; // Size-weighted version
  // Direction breakdown
  n_favorable: number;           // Trades where price moved in their favor
  n_unfavorable: number;
  favorable_pct: number;
  // From phase 7
  shadow_omega: number;
  shadow_pnl: number;
  crowding_risk: string;
}

async function computeMarkoutForWallet(wallet: string): Promise<{
  n_trades_with_markout: number;
  n_trades_total: number;
  avg_markout: number;
  markout_stddev: number;
  markout_sharpe: number;
  weighted_markout_sharpe: number;
  n_favorable: number;
  n_unfavorable: number;
} | null> {
  // Two-step approach - query pm_trader_events_v2 directly (faster than view)
  // GPT recommends TAKER-only for copy-trading (role = 'taker')
  // Use token_id as market identifier (simpler than condition_id)
  // Price from price column (already in the table)

  // Step 1: Get wallet TAKER trades (deduplicated)
  // Price = usdc_amount / token_amount (both in raw units, divide by 1e6 for human readable)
  const tradesQuery = `
    SELECT
      any(token_id) AS token_id,
      toDate(any(trade_time)) AS trade_date,
      (any(usdc_amount) / 1000000.0) / nullIf(any(token_amount) / 1000000.0, 0) AS entry_price,
      any(side) AS side,
      any(usdc_amount) / 1000000.0 AS usdc_size
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND role = 'taker'
      AND trade_time >= now() - INTERVAL 90 DAY
      AND trade_time <= now() - INTERVAL 7 DAY
      AND token_amount > 0
    GROUP BY event_id
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = await tradesResult.json() as any[];

  if (trades.length < 10) {
    return null; // Not enough trades
  }

  // Step 2: Get daily prices for the token_ids in our trades
  const tokenIds = [...new Set(trades.map(t => t.token_id).filter(Boolean))];
  if (tokenIds.length === 0) return null;

  const pricesQuery = `
    SELECT
      token_id,
      toDate(trade_time) AS price_date,
      avg((usdc_amount / 1000000.0) / nullIf(token_amount / 1000000.0, 0)) AS avg_price
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= now() - INTERVAL 97 DAY
      AND token_amount > 0
      AND token_id IN (${tokenIds.map(t => `'${t}'`).join(',')})
    GROUP BY token_id, toDate(trade_time)
  `;

  const pricesResult = await clickhouse.query({ query: pricesQuery, format: 'JSONEachRow' });
  const prices = await pricesResult.json() as any[];

  // Build price lookup map: token_id|date -> price
  const priceMap = new Map<string, number>();
  for (const p of prices) {
    priceMap.set(`${p.token_id}|${p.price_date}`, Number(p.avg_price));
  }

  // Step 3: Compute markout for each trade
  const markouts: { markout: number; size: number }[] = [];

  for (const t of trades) {
    const futureDate = new Date(t.trade_date);
    futureDate.setDate(futureDate.getDate() + 7);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    const key = `${t.token_id}|${futureDateStr}`;
    const price7d = priceMap.get(key);

    if (price7d === undefined || price7d <= 0 || t.entry_price <= 0) {
      continue;
    }

    // Markout = price movement in favorable direction
    // buy: favorable if price went UP
    // sell: favorable if price went DOWN
    const markout = t.side.toLowerCase() === 'buy'
      ? price7d - t.entry_price
      : t.entry_price - price7d;

    markouts.push({ markout, size: t.usdc_size });
  }

  if (markouts.length < 10) {
    return null; // Not enough markout data
  }

  // Step 4: Aggregate stats
  const n_favorable = markouts.filter(m => m.markout > 0).length;
  const n_unfavorable = markouts.filter(m => m.markout <= 0).length;

  // Simple average
  const avg_markout = markouts.reduce((s, m) => s + m.markout, 0) / markouts.length;
  const variance = markouts.reduce((s, m) => s + Math.pow(m.markout - avg_markout, 2), 0) / markouts.length;
  const markout_stddev = Math.sqrt(variance);

  // Size-weighted average
  const totalSize = markouts.reduce((s, m) => s + m.size, 0);
  const weighted_avg = totalSize > 0
    ? markouts.reduce((s, m) => s + m.markout * m.size, 0) / totalSize
    : 0;
  const weighted_var = totalSize > 0
    ? markouts.reduce((s, m) => s + Math.pow(m.markout - weighted_avg, 2) * m.size, 0) / totalSize
    : 0;
  const weighted_stddev = Math.sqrt(weighted_var);

  // Sharpe ratios
  const markout_sharpe = markout_stddev > 0.001 ? avg_markout / markout_stddev : 0;
  const weighted_markout_sharpe = weighted_stddev > 0.001 ? weighted_avg / weighted_stddev : 0;

  return {
    n_trades_with_markout: markouts.length,
    n_trades_total: trades.length,
    avg_markout: Math.round(avg_markout * 10000) / 10000,
    markout_stddev: Math.round(markout_stddev * 10000) / 10000,
    markout_sharpe: Math.round(markout_sharpe * 100) / 100,
    weighted_markout_sharpe: Math.round(weighted_markout_sharpe * 100) / 100,
    n_favorable,
    n_unfavorable,
  };
}

async function computeMarkoutSharpe(): Promise<void> {
  console.log('=== Phase 8: 7-Day Markout Sharpe Ranking ===\n');
  console.log('Methodology: GPT recommendation for copy-trading');
  console.log('  - Markout = price movement 7 days after trade');
  console.log('  - BUY: favorable if price went UP');
  console.log('  - SELL: favorable if price went DOWN');
  console.log('  - Sharpe = mean(markout) / stddev(markout)\n');

  // Load Phase 7 wallets
  const phase7Path = 'exports/copytrade/phase7_crowding.json';
  if (!fs.existsSync(phase7Path)) {
    throw new Error('Phase 7 output not found. Run 07-crowding-metrics.ts first.');
  }
  const phase7 = JSON.parse(fs.readFileSync(phase7Path, 'utf-8'));
  const wallets: Phase7Wallet[] = phase7.wallets;

  console.log(`Loaded ${wallets.length} wallets from Phase 7\n`);
  console.log('Computing 7-day markout for each wallet...\n');

  const results: MarkoutResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    process.stdout.write(`[${i + 1}/${wallets.length}] ${w.wallet.slice(0, 10)}... `);

    const markout = await computeMarkoutForWallet(w.wallet);

    if (markout) {
      const coverage_pct = markout.n_trades_total > 0
        ? Math.round((markout.n_trades_with_markout / markout.n_trades_total) * 100)
        : 0;
      const favorable_pct = (markout.n_favorable + markout.n_unfavorable) > 0
        ? Math.round((markout.n_favorable / (markout.n_favorable + markout.n_unfavorable)) * 100)
        : 0;

      results.push({
        wallet: w.wallet,
        n_trades_with_markout: markout.n_trades_with_markout,
        n_trades_total: markout.n_trades_total,
        coverage_pct,
        avg_markout: markout.avg_markout,
        markout_stddev: markout.markout_stddev,
        markout_sharpe: markout.markout_sharpe,
        weighted_markout_sharpe: markout.weighted_markout_sharpe,
        n_favorable: markout.n_favorable,
        n_unfavorable: markout.n_unfavorable,
        favorable_pct,
        shadow_omega: w.shadow_omega,
        shadow_pnl: w.shadow_pnl,
        crowding_risk: w.crowding_risk,
      });

      console.log(`sharpe=${markout.markout_sharpe.toFixed(2)}, favorable=${favorable_pct}%`);
    } else {
      console.log('insufficient data');
    }
  }

  // Sort by weighted markout sharpe (primary) then by favorable_pct (secondary)
  results.sort((a, b) => {
    if (Math.abs(b.weighted_markout_sharpe - a.weighted_markout_sharpe) > 0.01) {
      return b.weighted_markout_sharpe - a.weighted_markout_sharpe;
    }
    return b.favorable_pct - a.favorable_pct;
  });

  // Display results
  console.log('\n=== MARKOUT SHARPE RANKING ===');
  console.log('Wallet                                     | Sharpe | W-Sharpe | Fav%  | Trades | Avg MO   | Shadow Ω | Crowd');
  console.log('-------------------------------------------|--------|----------|-------|--------|----------|----------|------');

  for (const r of results) {
    const sharpeStr = r.markout_sharpe >= 0
      ? `+${r.markout_sharpe.toFixed(2)}`
      : r.markout_sharpe.toFixed(2);
    const wSharpeStr = r.weighted_markout_sharpe >= 0
      ? `+${r.weighted_markout_sharpe.toFixed(2)}`
      : r.weighted_markout_sharpe.toFixed(2);
    const avgMoStr = r.avg_markout >= 0
      ? `+${r.avg_markout.toFixed(4)}`
      : r.avg_markout.toFixed(4);
    const riskEmoji = r.crowding_risk === 'high' ? '🔴' : r.crowding_risk === 'medium' ? '🟡' : '🟢';

    console.log(
      `${r.wallet} | ${sharpeStr.padStart(6)} | ${wSharpeStr.padStart(8)} | ${String(r.favorable_pct).padStart(4)}% | ${String(r.n_trades_with_markout).padStart(6)} | ${avgMoStr.padStart(8)} | ${String(r.shadow_omega).padStart(8)}x | ${riskEmoji}`
    );
  }

  // Summary stats
  const positiveSharpe = results.filter(r => r.markout_sharpe > 0);
  const highSharpe = results.filter(r => r.markout_sharpe > 0.5);

  console.log('\n=== SUMMARY ===');
  console.log(`Total wallets with markout data: ${results.length}`);
  console.log(`Positive sharpe (timing edge): ${positiveSharpe.length}`);
  console.log(`High sharpe (> 0.5): ${highSharpe.length}`);
  console.log(`\nTop 5 by Markout Sharpe:`);
  for (const r of results.slice(0, 5)) {
    console.log(`  ${r.wallet.slice(0, 10)}... sharpe=${r.weighted_markout_sharpe.toFixed(2)}, fav=${r.favorable_pct}%, omega=${r.shadow_omega}x`);
  }

  // Save output
  const outputPath = 'exports/copytrade/phase8_markout_sharpe.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    phase: '8',
    description: '7-day markout sharpe ranking (GPT methodology)',
    methodology: {
      markout_window: '6-8 days after trade',
      markout_definition: 'price_7d - entry_price (adjusted for direction)',
      sharpe_definition: 'mean(markout) / stddev(markout)',
      weighted_sharpe: 'size-weighted by USDC trade amount',
      min_trades: 10,
    },
    summary: {
      total_with_data: results.length,
      positive_sharpe: positiveSharpe.length,
      high_sharpe: highSharpe.length,
    },
    wallets: results,
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  // Export CSV
  const csvPath = 'exports/copytrade/phase8_markout_ranking.csv';
  const csvHeader = 'wallet,markout_sharpe,weighted_sharpe,favorable_pct,n_trades,avg_markout,shadow_omega,shadow_pnl,crowding_risk';
  const csvRows = results.map(r =>
    `${r.wallet},${r.markout_sharpe},${r.weighted_markout_sharpe},${r.favorable_pct},${r.n_trades_with_markout},${r.avg_markout},${r.shadow_omega},${r.shadow_pnl},${r.crowding_risk}`
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`Saved CSV to: ${csvPath}`);

  await clickhouse.close();
}

if (require.main === module) {
  computeMarkoutSharpe().catch(console.error);
}
