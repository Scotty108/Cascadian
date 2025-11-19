import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const query = `
    WITH fills AS (
      SELECT lower(proxy_wallet) AS wallet,
             lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm
      FROM clob_fills
      WHERE proxy_wallet IS NOT NULL AND proxy_wallet != ''
        AND lower(proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm
    )
    SELECT
      total_conditions,
      resolved_conditions,
      total_conditions - resolved_conditions AS unresolved_conditions,
      round(resolved_conditions / total_conditions * 100, 2) AS resolved_pct
    FROM (
      SELECT
        count() AS total_conditions,
        countIf(gr.cid IS NOT NULL) AS resolved_conditions
      FROM fills f
      LEFT JOIN gamma_resolved gr
        ON f.condition_id_norm = gr.cid
    )
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await res.json();
  console.table(data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
