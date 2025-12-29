/**
 * Find verifiable wallets for GoldSky report
 *
 * Goal: Find wallets with significant activity that can be verified on Polymarket UI
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import { createV8Engine } from '@/lib/pnl/uiActivityEngineV8';

async function main() {
  console.log('Finding wallets for GoldSky report verification...\n');

  // Get wallets with substantial volume that are likely to be visible on Polymarket
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        countDistinct(event_id) as unique_trades,
        sum(usdc_amount) / 1000000.0 as volume,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY trader_wallet
      HAVING volume > 50000 AND unique_trades > 200
      ORDER BY volume DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const wallets = (await result.json()) as any[];
  console.log(`Found ${wallets.length} high-volume wallets\n`);

  // Initialize V8 engine
  const engine = await createV8Engine();

  console.log('Wallet | Trades | Volume | Our PnL | First Trade | Last Trade');
  console.log('-'.repeat(90));

  for (const w of wallets.slice(0, 10)) {
    try {
      const metrics = await engine.compute(w.wallet, { mode: 'asymmetric' });
      console.log(
        `${w.wallet} | ${w.unique_trades} | $${Math.round(w.volume).toLocaleString().padStart(10)} | $${Math.round(metrics.pnl_total).toLocaleString().padStart(10)} | ${w.first_trade.slice(0, 10)} | ${w.last_trade.slice(0, 10)}`
      );
    } catch (err) {
      console.log(`${w.wallet} | ERROR: ${err}`);
    }
  }

  console.log('\n\nThese wallets should be visible on: https://polymarket.com/profile/{wallet}');
  console.log('Replace {wallet} with the wallet address to verify on Polymarket UI\n');
}

main().catch(console.error);
