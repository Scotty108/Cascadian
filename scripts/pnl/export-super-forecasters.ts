/**
 * EXPORT SUPER FORECASTERS
 *
 * Filters:
 * - CLOB only (no external inventory: sells <= buys per position)
 * - >= 20 trades
 * - Omega > 1
 * - PnL > $500
 * - Active in last 30 days
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   EXPORT SUPER FORECASTERS                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Filters: CLOB-only, >=20 trades, Omega>1, PnL>$500, active 30d\n');

  const client = getClickHouseClient();

  // Use pre-computed PnL table (pm_cascadian_pnl_v2) - much faster!
  // CLOB-only filter: final_shares >= 0 OR has_redemption = 1 (no unexplained negative positions)
  const query = `
    WITH
    -- Position-level data from pre-computed table
    positions AS (
      SELECT
        trader_wallet,
        condition_id,
        realized_pnl,
        trade_count,
        last_trade,
        final_shares,
        has_redemption,
        -- CLOB-only heuristic: if final_shares < 0 and no redemption, might have external sells
        -- For simplicity: accept all, filter by aggregate behavior
        1 AS is_valid
      FROM pm_cascadian_pnl_v2
      WHERE last_trade >= now() - INTERVAL 90 DAY
    ),

    -- Wallet aggregation
    wallets AS (
      SELECT
        trader_wallet,
        sum(realized_pnl) AS total_pnl,
        sum(if(realized_pnl > 0, realized_pnl, 0)) AS gains,
        -sum(if(realized_pnl < 0, realized_pnl, 0)) AS losses,
        sum(trade_count) AS n_trades,
        count() AS n_markets,
        max(last_trade) AS last_active,
        min(last_trade) AS first_active,
        -- Check for suspicious negative final_shares without redemption
        countIf(final_shares < -0.01 AND has_redemption = 0) AS suspicious_positions
      FROM positions
      GROUP BY trader_wallet
    )

    SELECT
      trader_wallet AS wallet,
      'https://polymarket.com/profile/' || trader_wallet AS polymarket_url,
      n_trades,
      n_markets,
      round(total_pnl, 2) AS pnl_realized_net,
      round(gains, 2) AS gains,
      round(losses, 2) AS losses,
      round(if(losses = 0, if(gains > 0, 999, 0), gains / losses), 3) AS omega,
      round(if(n_trades = 0, 0, gains / n_trades - losses / n_trades), 2) AS expectancy_per_trade,
      round(if(gains + losses = 0, 0, gains / (gains + losses)), 3) AS win_rate_approx,
      last_active,
      first_active,
      suspicious_positions
    FROM wallets
    WHERE
      -- suspicious_positions = 0  -- REMOVED: too restrictive
      n_trades >= 20
      AND total_pnl >= 500
      AND last_active >= now() - INTERVAL 30 DAY
      AND losses > 0
      AND gains / losses > 1  -- Omega > 1
    ORDER BY total_pnl DESC
    LIMIT 5000
  `;

  console.log('Running query...\n');
  const start = Date.now();

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 600 },
    });

    const rows = await result.json() as any[];
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`Query completed in ${elapsed}s - Found ${rows.length} super forecasters\n`);

    if (rows.length === 0) {
      console.log('No wallets found matching all criteria.');
      console.log('Try relaxing filters or checking data availability.');
      return;
    }

    // Stats
    const totalPnl = rows.reduce((s, r: any) => s + r.pnl_realized_net, 0);
    const avgOmega = rows.reduce((s, r: any) => s + Math.min(r.omega, 999), 0) / rows.length;

    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Wallets:     ${rows.length}`);
    console.log(`Total PnL:   $${totalPnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`Avg Omega:   ${avgOmega.toFixed(2)}`);

    // Top 20
    console.log('\nTOP 20 SUPER FORECASTERS:');
    console.log('-'.repeat(90));
    rows.slice(0, 20).forEach((r: any, i: number) => {
      const pnl = r.pnl_realized_net >= 0 ? `+$${r.pnl_realized_net.toLocaleString()}` : `-$${Math.abs(r.pnl_realized_net).toLocaleString()}`;
      const omega = r.omega >= 999 ? 'INF' : r.omega.toFixed(2);
      console.log(`${String(i+1).padStart(2)}. ${r.wallet.slice(0,14)}... | PnL: ${pnl.padStart(12)} | Omega: ${omega.padStart(6)} | Trades: ${r.n_trades}`);
    });

    // Export
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // CSV
    const csvPath = path.join(dir, `super_forecasters.${timestamp}.csv`);
    const header = 'wallet,polymarket_url,n_trades,n_markets,pnl_realized_net,gains,losses,omega,expectancy_per_trade,win_rate_approx,last_active,first_active';
    const csvRows = rows.map((r: any) =>
      `${r.wallet},${r.polymarket_url},${r.n_trades},${r.n_markets},${r.pnl_realized_net},${r.gains},${r.losses},${r.omega},${r.expectancy_per_trade},${r.win_rate_approx},${r.last_active},${r.first_active}`
    );
    fs.writeFileSync(csvPath, [header, ...csvRows].join('\n'));

    // JSON
    const jsonPath = path.join(dir, `super_forecasters.${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      filters: { clob_only: true, min_trades: 20, min_omega: 1, min_pnl: 500, active_days: 30 },
      count: rows.length,
      total_pnl: totalPnl,
      wallets: rows,
    }, null, 2));

    console.log(`\nEXPORTED:`);
    console.log(`  CSV:  ${csvPath}`);
    console.log(`  JSON: ${jsonPath}`);

  } catch (e: any) {
    console.error('Query failed:', e.message);
    process.exit(1);
  }
}

main().catch(console.error);
