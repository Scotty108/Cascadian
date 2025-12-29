/**
 * Verify known loser wallet has negative t-stat
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xdc2bf28f275c1fdeb6c134109f90cbc2db50eaf7';
  
  console.log('=== LOSER WALLET VERIFICATION ===');
  console.log('Wallet:', wallet);
  console.log('Expected: NEGATIVE weighted_mean_bps and t_stat (Polymarket shows -$45.90 PnL)\n');

  const result = await clickhouse.query({
    query: `
      WITH agg AS (
        SELECT
          wallet,
          sum(fills) as total_fills,
          sum(sum_w) as sum_w,
          sum(sum_wx) as sum_wx,
          sum(sum_wx2) as sum_wx2
        FROM wallet_daily_stats_v2
        WHERE wallet = '${wallet}'
        GROUP BY wallet
      )
      SELECT
        wallet,
        total_fills,
        round(sum_wx / sum_w, 2) as weighted_mean_bps,
        round(
          (sum_wx / sum_w) /
          (sqrt(greatest((sum_wx2 / sum_w) - pow(sum_wx / sum_w, 2), 0)) + 1) *
          sqrt(total_fills),
          2
        ) as t_stat
      FROM agg
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  
  if (rows.length === 0) {
    console.log('No data found for wallet!');
    return;
  }
  
  const w = rows[0];
  console.log('Results:');
  console.log('  Total fills:', w.total_fills);
  console.log('  Weighted mean (bps):', w.weighted_mean_bps);
  console.log('  T-stat:', w.t_stat);
  console.log('');
  
  if (Number(w.weighted_mean_bps) < 0) {
    console.log('✅ CORRECT: Negative weighted mean - loser correctly identified');
  } else {
    console.log('❌ WRONG: Positive weighted mean - formula still has a bug');
  }
}

main().catch(console.error);
