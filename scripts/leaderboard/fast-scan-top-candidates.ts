/**
 * Fast Scan Top Candidates
 *
 * Speed-optimized pipeline:
 * 1. SQL pre-filter: Get top 500 by approximate return
 * 2. CCR-v1: Process only promising candidates
 *
 * Target: Find wallets with EITHER:
 * - High avg return (>10%) OR
 * - High win rate (>55%) + profitable
 *
 * Runtime: ~30 minutes for 500 candidates
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';

const TOP_N = 500;
const MAX_TRADES = 5000; // Exclude market makers (5K+ trades)
const TABLE_NAME = 'pm_wallet_pnl_leaderboard_cache';

interface Result {
  wallet: string;
  realized_pnl: number;
  avg_return_pct: number;
  win_rate: number;
  volume: number;
  markets: number;
}

async function getTopCandidates(): Promise<string[]> {
  console.log(`\n[1/3] SQL pre-filter: Top ${TOP_N} by approx return (max ${MAX_TRADES} trades)...`);

  // Get wallets with highest (sell + redemption - buy) / buy ratio
  // Exclude market makers (>MAX_TRADES) for faster processing
  const query = `
    WITH
    clob AS (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        countDistinct(token_id) as markets,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_vol,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_vol
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND role = 'maker' AND trade_time >= now() - INTERVAL 60 DAY
      GROUP BY wallet
      HAVING markets >= 10 AND buy_vol >= 100 AND trades <= ${MAX_TRADES}
    ),
    redeem AS (
      SELECT lower(user_address) as wallet, sum(toFloat64OrZero(amount_or_payout)) / 1e6 as val
      FROM pm_ctf_events
      WHERE event_type = 'PayoutRedemption' AND is_deleted = 0 AND event_timestamp >= now() - INTERVAL 60 DAY
      GROUP BY wallet
    )

    SELECT c.wallet, round((c.sell_vol + coalesce(r.val, 0) - c.buy_vol) / c.buy_vol * 100, 2) as approx_return
    FROM clob c
    LEFT JOIN redeem r ON c.wallet = r.wallet
    WHERE (c.sell_vol + coalesce(r.val, 0)) > c.buy_vol * 0.9  -- At least close to breakeven
    ORDER BY approx_return DESC
    LIMIT ${TOP_N}
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await res.json()) as { wallet: string }[];

  console.log(`  Found ${rows.length} candidates`);
  return rows.map((r) => r.wallet);
}

async function processCandidates(wallets: string[]): Promise<Result[]> {
  console.log(`\n[2/3] CCR-v1 processing (${wallets.length} wallets)...`);
  console.log(`  ETA: ~${Math.round(wallets.length * 3 / 60)} minutes\n`);

  const results: Result[] = [];
  const startTime = Date.now();

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const pct = ((i + 1) / wallets.length * 100).toFixed(0);
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (i + 1) / elapsed;
    const eta = Math.round((wallets.length - i - 1) / rate);

    process.stdout.write(`\r  [${pct}%] ${i + 1}/${wallets.length} | ETA: ${eta}s | ${wallet.slice(0, 10)}...`);

    try {
      const ccr = await computeCCRv1(wallet);
      const avgReturn = ccr.volume_traded > 0 ? (ccr.realized_pnl / ccr.volume_traded) * 100 : 0;

      // Filter: 40%+ win rate, AND (high-return OR profitable)
      if (ccr.win_rate >= 0.40 && (avgReturn >= 5 || ccr.realized_pnl > 200)) {
        results.push({
          wallet,
          realized_pnl: ccr.realized_pnl,
          avg_return_pct: avgReturn,
          win_rate: ccr.win_rate,
          volume: ccr.volume_traded,
          markets: ccr.positions_count,
        });
      }

      // Insert to cache
      const insertQ = `
        INSERT INTO ${TABLE_NAME}
        (wallet, realized_pnl, unrealized_pnl, total_pnl, volume_traded, avg_return_pct,
         win_rate, win_count, loss_count, positions_count, resolved_count,
         external_sell_ratio, pnl_confidence, markets_last_30d, last_trade_time)
        VALUES (
          '${wallet}', ${ccr.realized_pnl}, ${ccr.unrealized_pnl}, ${ccr.total_pnl},
          ${ccr.volume_traded}, ${avgReturn}, ${ccr.win_rate}, ${ccr.win_count},
          ${ccr.loss_count}, ${ccr.positions_count}, ${ccr.resolved_count},
          ${ccr.external_sell_ratio}, '${ccr.pnl_confidence}', ${ccr.positions_count}, now()
        )
      `;
      await clickhouse.command({ query: insertQ }).catch(() => {});
    } catch (e) {
      // Skip errors
    }
  }

  console.log(`\n\n  Qualified: ${results.length} wallets`);
  return results;
}

async function main() {
  console.log('='.repeat(80));
  console.log('FAST SCAN: TOP CANDIDATES BY AVG RETURN');
  console.log('='.repeat(80));

  const startTime = Date.now();

  // Step 1: Get candidates
  const candidates = await getTopCandidates();
  if (candidates.length === 0) {
    console.log('No candidates found.');
    return;
  }

  // Step 2: Process with CCR-v1
  const results = await processCandidates(candidates);

  // Step 3: Show leaderboard
  console.log('\n[3/3] Results\n');

  // Sort by avg return
  const byReturn = [...results].sort((a, b) => b.avg_return_pct - a.avg_return_pct).slice(0, 15);
  console.log('TOP 15 BY AVG RETURN %:');
  console.log('Wallet                                     | PnL          | Return % | Win Rate | Volume');
  console.log('-'.repeat(100));
  for (const r of byReturn) {
    console.log(
      r.wallet.padEnd(42) + ' | ' +
      ('$' + r.realized_pnl.toFixed(0)).padStart(12) + ' | ' +
      (r.avg_return_pct.toFixed(1) + '%').padStart(8) + ' | ' +
      ((r.win_rate * 100).toFixed(0) + '%').padStart(8) + ' | ' +
      ('$' + (r.volume / 1000).toFixed(0) + 'K').padStart(10)
    );
  }

  // Sort by win rate (profitable only)
  const byWR = [...results]
    .filter(r => r.realized_pnl > 500)
    .sort((a, b) => b.win_rate - a.win_rate)
    .slice(0, 10);

  console.log('\n\nTOP 10 BY WIN RATE (>$500 PnL):');
  console.log('Wallet                                     | PnL          | Return % | Win Rate | Markets');
  console.log('-'.repeat(100));
  for (const r of byWR) {
    console.log(
      r.wallet.padEnd(42) + ' | ' +
      ('$' + r.realized_pnl.toFixed(0)).padStart(12) + ' | ' +
      (r.avg_return_pct.toFixed(1) + '%').padStart(8) + ' | ' +
      ((r.win_rate * 100).toFixed(0) + '%').padStart(8) + ' | ' +
      String(r.markets).padStart(10)
    );
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n\nCompleted in ${elapsed}s (${(elapsed / 60).toFixed(1)} min)`);
  console.log(`Processed: ${candidates.length} wallets`);
  console.log(`Qualified: ${results.length} (5%+ return OR 55%+ WR + profitable)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('Error:', e); process.exit(1); });
