import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Debugging payout calculation...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        net_shares,
        gross_cf,
        realized_payout,
        pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY abs(pnl_net) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const results = await query.json();

  console.log('Top 10 markets by |P&L|:\n');

  let totalPnl = 0;
  results.forEach((r: any, i: number) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${r.condition_id_ctf.substring(0, 12)}...`);
    console.log(`    net_shares: ${Number(r.net_shares).toFixed(2)}`);
    console.log(`    gross_cf: $${Number(r.gross_cf).toFixed(2)}`);
    console.log(`    realized_payout: $${Number(r.realized_payout).toFixed(2)}`);
    console.log(`    pnl_net: $${Number(r.pnl_net).toFixed(2)}`);
    console.log(`    Formula check: ${Number(r.gross_cf).toFixed(2)} + ${Number(r.realized_payout).toFixed(2)} = ${(Number(r.gross_cf) + Number(r.realized_payout)).toFixed(2)} (should be pnl_gross)`);
    console.log();
    totalPnl += Number(r.pnl_net);
  });

  console.log(`Total P&L from top 10: $${totalPnl.toFixed(2)}`);
}

main().catch(console.error);
