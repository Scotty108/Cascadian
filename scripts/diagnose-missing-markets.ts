import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Pick one of the missing markets
  const missingMarket = 'a7cc227d75f9e5c0e65b5c85ab8dfd9e5e29df1e9c1c8c68fffe2104a77faebe';

  console.log("═".repeat(80));
  console.log(`DIAGNOSING: Why validator query misses market ${missingMarket.substring(0, 12)}...`);
  console.log("═".repeat(80));
  console.log();

  // Check if market exists in outcome_positions_v2
  const viewCheck = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet}')
        AND condition_id_norm = '${missingMarket}'
    `,
    format: 'JSONEachRow'
  });
  const viewRows = await viewCheck.json();

  console.log(`Market in outcome_positions_v2: ${viewRows.length > 0 ? 'YES' : 'NO'}`);
  if (viewRows.length > 0) {
    console.table(viewRows.map(r => ({
      outcome: r.outcome_idx,
      net_shares: Number(r.net_shares).toFixed(6)
    })));
  }
  console.log();

  // Check raw clob_fills data
  const fillsCheck = await clickhouse.query({
    query: `
      SELECT
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares_micro,
        sum(if(cf.side = 'BUY', 1., -1.) * (cf.size / 1000000.0)) AS net_shares_scaled
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${wallet}')
        AND lower(replaceAll(cf.condition_id, '0x', '')) = '${missingMarket}'
      GROUP BY outcome_idx
    `,
    format: 'JSONEachRow'
  });
  const fillsRows = await fillsCheck.json();

  console.log(`Market in clob_fills: ${fillsRows.length > 0 ? 'YES' : 'NO'}`);
  if (fillsRows.length > 0) {
    console.table(fillsRows.map(r => ({
      outcome: r.outcome_idx,
      net_shares_micro: Number(r.net_shares_micro).toFixed(2),
      net_shares_scaled: Number(r.net_shares_scaled).toFixed(6)
    })));
  }
  console.log();

  // Check if filtering by HAVING abs(net_shares) > 0.0001 removes it
  console.log("Testing HAVING clause impact:");
  const havingTest = await clickhouse.query({
    query: `
      SELECT
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * (cf.size / 1000000.0)) AS net_shares
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${wallet}')
        AND lower(replaceAll(cf.condition_id, '0x', '')) = '${missingMarket}'
      GROUP BY outcome_idx
      HAVING abs(net_shares) > 0.0001
    `,
    format: 'JSONEachRow'
  });
  const havingRows = await havingTest.json();

  console.log(`  After HAVING abs(net_shares) > 0.0001: ${havingRows.length} positions`);
  if (havingRows.length > 0) {
    console.table(havingRows.map(r => ({
      outcome: r.outcome_idx,
      net_shares: Number(r.net_shares).toFixed(6)
    })));
  } else {
    console.log("  ⚠️  All positions filtered out by HAVING clause!");
  }
  console.log();

  // Check outcome_positions_v2 definition
  console.log("Checking outcome_positions_v2 definition:");
  const viewDef = await clickhouse.query({
    query: 'SHOW CREATE VIEW outcome_positions_v2',
    format: 'JSONEachRow'
  });
  const def = await viewDef.json();
  console.log(def[0].statement);
  console.log();
}

main().catch(console.error);
