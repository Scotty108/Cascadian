import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const conditionId = process.argv[3];

async function main() {
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/query-condition-breakdown.ts <wallet> <condition_id_norm>');
    process.exit(1);
  }
  const query = `
    WITH positions AS (
      SELECT
        lower(proxy_wallet) AS wallet,
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(side = 'BUY', 1., -1.) * size) AS net_shares,
        sum(round((price * size) * if(side = 'BUY', -1, 1), 8)) AS cashflow_micro
      FROM clob_fills
      INNER JOIN ctf_token_map ctm ON clob_fills.asset_id = ctm.token_id
      WHERE lower(proxy_wallet) = lower('${wallet}')
        AND lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT * FROM positions
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
