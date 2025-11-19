import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const query = `
    WITH aggregated AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares,
        SUM(round((cf.price * cf.size) * if(cf.side = 'BUY', -1, 1), 8)) AS cashflow_micro
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      sum(net_shares) AS total_net_shares,
      sum(cashflow_micro) AS total_cashflow_micro,
      sum(abs(cashflow_micro)) AS gross_volume_micro,
      max(abs(net_shares)) AS max_position_size
    FROM aggregated
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
