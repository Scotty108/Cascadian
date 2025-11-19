import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const market = 'a7cc227d75f966bbc3f45d065f43f855fbdb545b3854eb36910d4b06295edb86';
  
  // Check all outcomes for this market
  const res = await clickhouse.query({
    query: `
      SELECT p.outcome_idx, p.net_shares, c.cashflow_usdc, wi.win_idx
      FROM outcome_positions_v2 p
      LEFT JOIN trade_cashflows_v3 c
        ON c.wallet = p.wallet
        AND c.condition_id_norm = p.condition_id_norm
        AND c.outcome_idx = p.outcome_idx
      LEFT JOIN winning_index wi
        ON wi.condition_id_norm = p.condition_id_norm
      WHERE p.wallet = lower('${wallet}')
        AND p.condition_id_norm = '${market}'
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  
  console.log(`Market ${market}:`);
  console.table(rows);
  
  console.log("\nManual P&L calculation:");
  let total = 0;
  for (const row of rows) {
    if (row.outcome_idx === row.win_idx) {
      const pnl = (row.cashflow_usdc || 0) + row.net_shares;
      console.log(`Outcome ${row.outcome_idx} (WIN): cashflow ${row.cashflow_usdc} + shares ${row.net_shares} = ${pnl}`);
      total += pnl;
    }
  }
  console.log(`\nExpected total: ${total}`);
}

main().catch(console.error);
