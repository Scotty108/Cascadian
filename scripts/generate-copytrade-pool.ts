/**
 * Generate Copy Trade Candidate Pool
 *
 * Zero Tolerance Filters:
 * - 14+ day wallet age
 * - 10+ trades
 * - Active in last 7 days
 * - 0 trades at 97-100% (high arb)
 * - 0 trades at 0-3% (low arb)
 * - 0 trades at 49-51% (market makers)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Generating Copy Trade Candidate Pool ===\n');
  console.log('Zero Tolerance Filters:');
  console.log('  - Wallet age: 14+ days');
  console.log('  - Total trades: 10+');
  console.log('  - Active in last 7 days');
  console.log('  - Zero trades at 97-100% (high arb)');
  console.log('  - Zero trades at 0-3% (low arb)');
  console.log('  - Zero trades at 49-51% (market makers)\n');

  const query = `
    WITH wallet_stats AS (
      SELECT
        lower(trader_wallet) as wallet,
        count() as total_trades,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        -- Arb detection: count trades at extreme prices
        countIf(usdc_amount / token_amount >= 0.97) as high_arb_trades,
        countIf(usdc_amount / token_amount <= 0.03) as low_arb_trades,
        countIf(usdc_amount / token_amount >= 0.49 AND usdc_amount / token_amount <= 0.51) as mm_trades
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND side = 'buy'
        AND token_amount > 0
      GROUP BY lower(trader_wallet)
    )
    SELECT wallet
    FROM wallet_stats
    WHERE total_trades >= 10
      AND first_trade <= now() - INTERVAL 14 DAY
      AND last_trade >= now() - INTERVAL 7 DAY
      AND high_arb_trades = 0
      AND low_arb_trades = 0
      AND mm_trades = 0
    ORDER BY total_trades DESC
  `;

  console.log('Running query...');
  const startTime = Date.now();

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as { wallet: string }[];

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Query took ${elapsed}s\n`);
  console.log(`Found ${rows.length.toLocaleString()} candidate wallets\n`);

  // Save to file
  const outputFile = '/tmp/copytrade_candidates.json';
  const output = {
    generated_at: new Date().toISOString(),
    filters: {
      min_wallet_age_days: 14,
      min_trades: 10,
      max_inactive_days: 7,
      zero_tolerance_high_arb: '97-100%',
      zero_tolerance_low_arb: '0-3%',
      zero_tolerance_mm: '49-51%'
    },
    count: rows.length,
    wallets: rows.map(r => r.wallet)
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Saved to ${outputFile}`);

  // Estimate compute time
  const estTimeMin = (rows.length * 1.0) / 60; // ~1 sec per wallet
  console.log(`\nEstimated compute time for per-trade metrics: ${estTimeMin.toFixed(0)} minutes`);
}

main().catch(console.error);
