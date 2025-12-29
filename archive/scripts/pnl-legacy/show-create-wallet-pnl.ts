import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const res = await clickhouse.query({
    query: 'SHOW CREATE TABLE wallet_pnl_summary_final',
    format: 'JSONEachRow'
  });
  const text = await res.text();
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
