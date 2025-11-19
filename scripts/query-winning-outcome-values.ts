import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const query = `
    WITH positions AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      lower(gr.winning_outcome) AS winning_outcome,
      count() AS cnt,
      sum(op.net_shares) AS total_net_shares
    FROM positions op
    LEFT JOIN gamma_resolved gr ON op.condition_id_norm = gr.cid
    WHERE gr.cid IS NOT NULL
    GROUP BY winning_outcome
    ORDER BY cnt DESC
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.table(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
