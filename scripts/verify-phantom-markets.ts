import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const phantomMarket = 'a7cc227d75f9e5c0e65b5c85ab8dfd9e5e29df1e9c1c8c68fffe2104a77faebe';

  console.log("═".repeat(80));
  console.log(`VERIFYING: Phantom market ${phantomMarket.substring(0, 12)}...`);
  console.log("═".repeat(80));
  console.log();

  // Check if it's in realized_pnl_by_market_final
  const pnlCheck = await clickhouse.query({
    query: `
      SELECT
        wallet,
        condition_id_norm,
        resolved_at,
        realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE wallet = lower('${wallet}')
        AND condition_id_norm = '${phantomMarket}'
    `,
    format: 'JSONEachRow'
  });
  const pnlRows = await pnlCheck.json();

  console.log(`Market in realized_pnl_by_market_final: ${pnlRows.length > 0 ? 'YES' : 'NO'}`);
  if (pnlRows.length > 0) {
    console.table(pnlRows.map(r => ({
      condition_id: (r.condition_id_norm || '').substring(0, 12) + '...',
      resolved_at: r.resolved_at,
      pnl: `$${Number(r.realized_pnl_usd).toFixed(2)}`
    })));
  }
  console.log();

  // Check winning_index
  const wiCheck = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        win_idx,
        resolved_at
      FROM winning_index
      WHERE condition_id_norm = '${phantomMarket}'
    `,
    format: 'JSONEachRow'
  });
  const wiRows = await wiCheck.json();

  console.log(`Market in winning_index: ${wiRows.length > 0 ? 'YES' : 'NO'}`);
  if (wiRows.length > 0) {
    console.table(wiRows);
  }
  console.log();

  // Check trade_cashflows_v3
  const cfCheck = await clickhouse.query({
    query: `
      SELECT
        wallet,
        condition_id_norm,
        outcome_idx,
        cashflow_usdc
      FROM trade_cashflows_v3
      WHERE wallet = lower('${wallet}')
        AND condition_id_norm = '${phantomMarket}'
    `,
    format: 'JSONEachRow'
  });
  const cfRows = await cfCheck.json();

  console.log(`Market in trade_cashflows_v3: ${cfRows.length > 0 ? 'YES' : 'NO'}`);
  if (cfRows.length > 0) {
    console.table(cfRows.map(r => ({
      outcome: r.outcome_idx,
      cashflow: `$${Number(r.cashflow_usdc).toFixed(2)}`
    })));
  }
  console.log();

  // Show the realized_pnl_by_market_final view definition
  console.log("realized_pnl_by_market_final view definition:");
  console.log("─".repeat(80));
  const viewDef = await clickhouse.query({
    query: 'SHOW CREATE VIEW realized_pnl_by_market_final',
    format: 'JSONEachRow'
  });
  const def = await viewDef.json();
  console.log(def[0].statement);
  console.log("═".repeat(80));
}

main().catch(console.error);
