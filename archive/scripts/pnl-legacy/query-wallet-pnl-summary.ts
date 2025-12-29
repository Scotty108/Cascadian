import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const res = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_pnl_summary_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
