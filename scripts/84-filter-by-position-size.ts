#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Testing different position filters to match Polymarket UI (94)...\n`);

  // Test various filters
  const filters = [
    { name: 'All markets', condition: '1=1' },
    { name: 'Has non-zero position', condition: 'has_position = 1' },
    { name: 'Position > 0.01 shares', condition: 'max_abs_shares > 0.01' },
    { name: 'Position > 1 share', condition: 'max_abs_shares > 1' },
    { name: 'Position > 10 shares', condition: 'max_abs_shares > 10' },
    { name: 'Position > 100 shares', condition: 'max_abs_shares > 100' },
  ];

  for (const filter of filters) {
    const result = await clickhouse.query({
      query: `
        WITH outcome_positions AS (
          SELECT
            condition_id_norm_v3,
            outcome_index_v3,
            sumIf(toFloat64(shares), trade_direction = 'BUY') -
            sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
          FROM pm_trades_canonical_v3
          WHERE lower(wallet_address) = lower('${WALLET}')
            AND condition_id_norm_v3 != ''
          GROUP BY condition_id_norm_v3, outcome_index_v3
        ),
        market_positions AS (
          SELECT
            condition_id_norm_v3,
            max(abs(net_shares)) AS max_abs_shares,
            if(max_abs_shares > 0.001, 1, 0) AS has_position
          FROM outcome_positions
          GROUP BY condition_id_norm_v3
        )
        SELECT count() AS market_count
        FROM market_positions
        WHERE ${filter.condition}
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json<Array<any>>();
    const count = parseInt(data[0].market_count);
    const match = Math.abs(count - 94) < 3 ? '✅' : '';

    console.log(`${filter.name.padEnd(30)}: ${count.toString().padStart(3)} markets ${match}`);
  }

  console.log();
  console.log('💡 If none match 94, Polymarket might be using:');
  console.log('   - Time-based filtering (only recent markets)');
  console.log('   - Market type filtering (excluding certain categories)');
  console.log('   - Custom business logic we don\'t have access to');
}

main().catch(console.error);
