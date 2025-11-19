import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const query = `
    SELECT
      uniq(asset_id) AS total_token_ids,
      uniqIf(asset_id, ctm.token_id IS NOT NULL) AS mapped_token_ids,
      round(mapped_token_ids / total_token_ids * 100, 2) AS coverage_pct
    FROM clob_fills cf
    LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    WHERE lower(cf.proxy_wallet) = lower('${wallet}')
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
