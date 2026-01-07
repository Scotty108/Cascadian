/**
 * Rebuild superforecaster pool with correct filter:
 * - No ERC1155 transfers (CTF events are OK)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  const ch = getClickHouseClient();

  console.log('Building pool with correct filter...');
  console.log('  - Active 30d');
  console.log('  - >10 markets');
  console.log('  - >$10k volume');
  console.log('  - No ERC1155 transfers (CTF events OK)');
  console.log('');

  const result = await ch.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          trader_wallet as wallet,
          uniqExact(token_id) as markets,
          sum(usdc_amount) / 1000000.0 as volume,
          count() as trades
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY trader_wallet
        HAVING markets > 10 AND volume > 10000
      ),
      has_erc1155 AS (
        SELECT DISTINCT to_address as wallet
        FROM pm_erc1155_transfers
      )
      SELECT w.*
      FROM wallet_stats w
      LEFT JOIN has_erc1155 e ON w.wallet = e.wallet
      WHERE e.wallet IS NULL
      ORDER BY volume DESC
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 600 }
  });

  const wallets = await result.json() as any[];
  console.log('Total wallets:', wallets.length);

  // Check if our test wallets are included
  const test1 = wallets.find(w => w.wallet === '0xa40d0f1a3937e1f43f0a00e3b95f5dcbb57ee4ea');
  const test2 = wallets.find(w => w.wallet === '0x92d8a88f0a9fef812bdf5628770d6a0ecee39762');
  console.log('');
  console.log('Test wallet 0xa40d... included:', test1 ? 'YES' : 'NO');
  console.log('Test wallet 0x92d8... included:', test2 ? 'YES' : 'NO');

  // Save
  const output = {
    generated: new Date().toISOString(),
    count: wallets.length,
    filters: {
      active_30d: true,
      min_markets: 10,
      min_volume: 10000,
      no_erc1155_transfers: true,
      ctf_events_allowed: true
    },
    wallets: wallets
  };
  fs.writeFileSync('./scripts/leaderboard/superforecaster-pool.json', JSON.stringify(output, null, 2));
  console.log('\nSaved to superforecaster-pool.json');
}

main().catch(console.error);
