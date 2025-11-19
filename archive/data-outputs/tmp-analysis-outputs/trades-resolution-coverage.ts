import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('Starting ALL-TRADES resolution coverage query...');
  const query = `
    WITH trades AS (
      SELECT lower(substring(condition_id, 3)) AS condition_id_norm
      FROM default.trades_raw
      WHERE condition_id != ''
      GROUP BY condition_id_norm
    ), res AS (
      SELECT lower(condition_id_norm) AS condition_id_norm
      FROM default.market_resolutions_final
    )
    SELECT
      countDistinct(trades.condition_id_norm) AS trade_markets,
      countDistinctIf(trades.condition_id_norm, res.condition_id_norm IS NOT NULL) AS resolved_markets,
      countDistinct(trades.condition_id_norm) - countDistinctIf(trades.condition_id_norm, res.condition_id_norm IS NOT NULL) AS unresolved_markets,
      round(100 * resolved_markets / trade_markets, 2) AS pct_resolved
    FROM trades
    LEFT JOIN res USING (condition_id_norm)
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await res.json<any[]>();
  console.log('Coverage stats:', data[0]);
}

main().catch(err => {
  console.error('Error running coverage query:', err);
  process.exit(1);
});
