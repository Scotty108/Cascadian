/**
 * Get 25 wallets for Playwright validation
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const client = getClickHouseClient();

async function main() {
  console.log('Getting 25 wallets for validation...\n');

  // Get top 25 by realized_pnl
  const result = await client.query({
    query: `
      SELECT
        c.wallet,
        c.realized_pnl,
        c.unrealized_pnl,
        c.engine_pnl,
        c.profit_factor,
        s.taker_ratio,
        abs(c.unrealized_pnl) / greatest(abs(c.engine_pnl), 1) as unrealized_share
      FROM pm_wallet_engine_pnl_cache c FINAL
      INNER JOIN pm_wallet_trade_stats s FINAL ON c.wallet = s.wallet
      WHERE s.last_trade_time >= now() - INTERVAL 30 DAY
        AND s.total_count >= 20
        AND c.realized_pnl >= 500
        AND c.profit_factor >= 1
      ORDER BY c.realized_pnl DESC
      LIMIT 25
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as Array<{
    wallet: string;
    realized_pnl: number;
    unrealized_pnl: number;
    engine_pnl: number;
    profit_factor: number;
    taker_ratio: number;
    unrealized_share: number;
  }>;

  console.log(`Got ${rows.length} wallets\n`);

  // Print for quick reference
  console.log('Wallet | Realized | Unrealized | Taker% | Unrealized%');
  console.log('-'.repeat(70));
  for (const row of rows) {
    console.log(
      `${row.wallet.slice(0, 10)}...${row.wallet.slice(-4)} | $${Math.round(row.realized_pnl).toLocaleString()} | $${Math.round(row.unrealized_pnl).toLocaleString()} | ${(row.taker_ratio * 100).toFixed(1)}% | ${(row.unrealized_share * 100).toFixed(0)}%`
    );
  }

  // Save to JSON for Playwright script
  fs.writeFileSync('/tmp/validation_sample_25.json', JSON.stringify(rows, null, 2));
  console.log('\nSaved to /tmp/validation_sample_25.json');
}

main().catch(console.error);
