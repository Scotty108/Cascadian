import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("DEBUGGING: Comparison Results");
  console.log("═".repeat(80));
  console.log();

  // Query 1: Current view
  const viewQuery = `
    SELECT
      condition_id_norm,
      sum(realized_pnl_usd) as pnl
    FROM realized_pnl_by_market_final
    WHERE wallet = lower('${wallet}')
    GROUP BY condition_id_norm
    ORDER BY pnl DESC
  `;

  // Query 2: Validator
  const validatorQuery = `
    WITH positions AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
      HAVING abs(net_shares) > 0.0001
    ),
    cashflows AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(round(cf.price * cf.size * if(cf.side = 'BUY', -1, 1), 8)) AS total_cashflow
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      p.condition_id_norm,
      sum(
        CASE
          WHEN wi.win_idx IS NOT NULL AND p.outcome_idx = wi.win_idx THEN
            (p.net_shares + COALESCE(cf.total_cashflow, 0.0)) / 1000000.0
          WHEN wi.win_idx IS NOT NULL THEN
            COALESCE(cf.total_cashflow, 0.0) / 1000000.0
          ELSE
            0.0
        END
      ) AS pnl
    FROM positions p
    LEFT JOIN cashflows cf USING (wallet, condition_id_norm, outcome_idx)
    LEFT JOIN winning_index wi ON wi.condition_id_norm = p.condition_id_norm
    WHERE wi.win_idx IS NOT NULL
    GROUP BY p.condition_id_norm
    ORDER BY pnl DESC
  `;

  const viewRes = await clickhouse.query({
    query: viewQuery,
    format: 'JSONEachRow'
  });
  const viewRows = await viewRes.json();

  const validatorRes = await clickhouse.query({
    query: validatorQuery,
    format: 'JSONEachRow'
  });
  const validatorRows = await validatorRes.json();

  console.log(`View markets: ${viewRows.length}`);
  console.log(`Validator markets: ${validatorRows.length}`);
  console.log();

  const viewSet = new Set(viewRows.map(r => r.condition_id_norm));
  const validatorSet = new Set(validatorRows.map(r => r.condition_id_norm));

  const onlyInView = [...viewSet].filter(id => !validatorSet.has(id));
  const onlyInValidator = [...validatorSet].filter(id => !viewSet.has(id));
  const inBoth = [...viewSet].filter(id => validatorSet.has(id));

  console.log(`Markets only in VIEW: ${onlyInView.length}`);
  console.log(`Markets only in VALIDATOR: ${onlyInValidator.length}`);
  console.log(`Markets in BOTH: ${inBoth.length}`);
  console.log();

  if (onlyInView.length > 0) {
    console.log("Sample markets ONLY in view (first 5):");
    console.table(onlyInView.slice(0, 5).map(id => {
      const viewRow = viewRows.find(r => r.condition_id_norm === id);
      return {
        condition_id: id.substring(0, 12) + '...',
        view_pnl: `$${Number(viewRow?.pnl || 0).toFixed(2)}`
      };
    }));
    console.log();
  }

  if (onlyInValidator.length > 0) {
    console.log("Sample markets ONLY in validator (first 5):");
    console.table(onlyInValidator.slice(0, 5).map(id => {
      const validatorRow = validatorRows.find(r => r.condition_id_norm === id);
      return {
        condition_id: id.substring(0, 12) + '...',
        validator_pnl: `$${Number(validatorRow?.pnl || 0).toFixed(2)}`
      };
    }));
  }
}

main().catch(console.error);
