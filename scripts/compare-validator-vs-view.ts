import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("COMPARING: Validator Formula vs Current View Formula");
  console.log("═".repeat(80));
  console.log();

  // Query 1: Current view approach (assumes data is pre-scaled)
  const viewQuery = `
    SELECT
      condition_id_norm,
      sum(realized_pnl_usd) as pnl
    FROM realized_pnl_by_market_final
    WHERE wallet = lower('${wallet}')
    GROUP BY condition_id_norm
    ORDER BY pnl DESC
  `;

  // Query 2: Validator approach (divides by 1e6 after summing)
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
      p.condition_id_norm AS condition_id_norm,
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

  console.log("Running current view query...");
  const viewRes = await clickhouse.query({
    query: viewQuery,
    format: 'JSONEachRow'
  });
  const viewRows = await viewRes.json();
  const viewTotal = viewRows.reduce((sum, r) => sum + Number(r.pnl), 0);

  console.log("Running validator formula query...");
  const validatorRes = await clickhouse.query({
    query: validatorQuery,
    format: 'JSONEachRow'
  });
  const validatorRows = await validatorRes.json();
  const validatorTotal = validatorRows.reduce((sum, r) => sum + Number(r.pnl), 0);

  console.log();
  console.log("═".repeat(80));
  console.log("TOTALS:");
  console.log(`  Current view:        $${viewTotal.toLocaleString()} (${viewRows.length} markets)`);
  console.log(`  Validator formula:   $${validatorTotal.toLocaleString()} (${validatorRows.length} markets)`);
  console.log(`  Difference:          $${(validatorTotal - viewTotal).toLocaleString()}`);
  console.log(`  Expected (Dome):     $87,030.51`);
  console.log();
  console.log(`  View variance:       ${((viewTotal - 87030.51) / 87030.51 * 100).toFixed(2)}%`);
  console.log(`  Validator variance:  ${((validatorTotal - 87030.51) / 87030.51 * 100).toFixed(2)}%`);
  console.log("═".repeat(80));
  console.log();

  // Show sample markets from each
  console.log(`View sample markets (first 5):`);
  viewRows.slice(0, 5).forEach(r => {
    console.log(`  ${r.condition_id_norm.substring(0, 16)}... = $${Number(r.pnl).toFixed(2)}`);
  });
  console.log();
  console.log(`Validator sample markets (first 5):`);
  console.log('Validator row structure:', JSON.stringify(validatorRows[0], null, 2));
  validatorRows.slice(0, 5).forEach(r => {
    console.log(`  ${(r.condition_id_norm || 'NULL').substring(0, 16)}... = $${Number(r.pnl).toFixed(2)}`);
  });
  console.log();

  // Create a map for comparison
  const viewMap = new Map(viewRows.map(r => [r.condition_id_norm, Number(r.pnl)]));
  const validatorMap = new Map(validatorRows.map(r => [r.condition_id_norm, Number(r.pnl)]));

  // Find markets with differences
  const allConditionIds = new Set([...viewMap.keys(), ...validatorMap.keys()]);
  const differences = [];

  for (const conditionId of allConditionIds) {
    const viewPnl = viewMap.get(conditionId) || 0;
    const validatorPnl = validatorMap.get(conditionId) || 0;
    const diff = validatorPnl - viewPnl;

    if (Math.abs(diff) > 0.01) {
      differences.push({
        condition_id: conditionId,
        view_pnl: viewPnl,
        validator_pnl: validatorPnl,
        difference: diff
      });
    }
  }

  differences.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  console.log(`Markets with formula differences: ${differences.length}`);
  if (differences.length > 0) {
    console.log();
    console.log("Top 10 markets with biggest differences:");
    console.table(differences.slice(0, 10).map(d => ({
      condition_id: d.condition_id.substring(0, 12) + '...',
      view: `$${d.view_pnl.toFixed(2)}`,
      validator: `$${d.validator_pnl.toFixed(2)}`,
      diff: `$${d.difference.toFixed(2)}`
    })));
  }
}

main().catch(console.error);
