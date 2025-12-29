import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const res = await clickhouse.query({
    query: `
      SELECT wallet, condition_id_norm, realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  console.table(rows.slice(0, 10));
  console.log('Total rows:', rows.length);
  const total = rows.reduce((sum, r) => sum + Number(r.realized_pnl_usd), 0);
  console.log('Total realized_pnl_usd (raw):', total);
  console.log('Total realized_pnl_usd / 1e6:', total / 1_000_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
