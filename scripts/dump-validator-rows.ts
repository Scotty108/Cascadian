import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const wallet = process.argv[2]?.toLowerCase() || '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const query = `
    WITH positions_with_outcome AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL AND cf.condition_id != ''
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    ),
    cashflows_with_outcome AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        SUM(round((cf.price * cf.size) * if(cf.side = 'BUY', -1, 1), 8)) AS total_cashflow_usd
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL AND cf.condition_id != ''
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      op.condition_id_norm AS condition_id_norm,
      op.outcome_idx AS outcome_idx,
      lower(gr.winning_outcome) AS winning_outcome,
      op.net_shares,
      cf_agg.total_cashflow_usd,
      CASE
        WHEN (op.outcome_idx = 0 AND lower(gr.winning_outcome) = 'yes') OR (op.outcome_idx = 1 AND lower(gr.winning_outcome) = 'no') THEN
          (op.net_shares + COALESCE(cf_agg.total_cashflow_usd, 0.0)) / 1000000.0
        ELSE
          COALESCE(cf_agg.total_cashflow_usd, 0.0) / 1000000.0
      END AS validator_realized_pnl
    FROM positions_with_outcome op
    LEFT JOIN gamma_resolved gr ON op.condition_id_norm = gr.cid
    LEFT JOIN cashflows_with_outcome cf_agg
      ON op.wallet = cf_agg.wallet
     AND op.condition_id_norm = cf_agg.condition_id_norm
     AND op.outcome_idx = cf_agg.outcome_idx
    WHERE gr.cid IS NOT NULL
  `;

  const res = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await res.json();
  console.log('Sample row:', rows[0]);
  const grouped = new Map();
  for (const row of rows) {
    const key = row.condition_id_norm;
    const pnl = Number(row.validator_realized_pnl);
    grouped.set(key, (grouped.get(key) || 0) + pnl);
  }
  const total = Array.from(grouped.values()).reduce((sum, v) => sum + v, 0);
  console.log('Validator total (aggregated per market):', total);
  console.log('Rows:', rows.length, 'Markets:', grouped.size);

  const realizedRes = await clickhouse.query({
    query: `
      SELECT condition_id_norm, realized_pnl_usd / 1000000.0 AS realized_pnl
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const realizedRows = await realizedRes.json();
  const realizedMap = new Map();
  for (const row of realizedRows) {
    realizedMap.set(row.condition_id_norm, Number(row.realized_pnl));
  }
  const realizedTotal = Array.from(realizedMap.values()).reduce((sum, v) => sum + v, 0);

  let mismatched = 0;
  for (const [cid, pnl] of grouped.entries()) {
    const realized = realizedMap.get(cid) || 0;
    if (Math.abs(pnl - realized) > 1) {
      mismatched++;
      console.log('Mismatch', cid, 'validator', pnl, 'realized', realized);
    }
  }
  console.log('Realized total:', realizedTotal);
  console.log('Mismatched markets (> $1 delta):', mismatched);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
