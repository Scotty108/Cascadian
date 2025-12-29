import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  // Total in cache
  const r1 = await client.query({
    query: 'SELECT count() as cnt FROM pm_wallet_engine_pnl_cache FINAL',
    format: 'JSONEachRow',
  });
  const total = (await r1.json() as any[])[0].cnt;

  // Export A (user's criteria)
  const r2 = await client.query({
    query: `
      SELECT count() as cnt
      FROM pm_wallet_engine_pnl_cache c FINAL
      INNER JOIN pm_wallet_trade_stats s FINAL ON c.wallet = s.wallet
      WHERE s.last_trade_time >= now() - INTERVAL 30 DAY
        AND s.total_count >= 20
        AND c.engine_pnl >= 500
        AND c.profit_factor >= 1
    `,
    format: 'JSONEachRow',
  });
  const exportA = (await r2.json() as any[])[0].cnt;

  // Export B (strict replicability)
  const r3 = await client.query({
    query: `
      SELECT count() as cnt
      FROM pm_wallet_engine_pnl_cache FINAL
      WHERE external_sells_ratio <= 0.05
        AND open_exposure_ratio <= 0.25
        AND taker_ratio <= 0.15
        AND trade_count >= 50
        AND realized_pnl > 0
    `,
    format: 'JSONEachRow',
  });
  const exportB = (await r3.json() as any[])[0].cnt;

  console.log('=== EXPORT COUNTS (from ClickHouse) ===');
  console.log('Total wallets with PnL computed:', total);
  console.log('Export A (≥20 trades, active 30d, PnL≥$500, profit_factor≥1):', exportA);
  console.log('Export B (strict replicability):', exportB);
}

main().catch(console.error);
