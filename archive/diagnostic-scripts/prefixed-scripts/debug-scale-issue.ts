import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Debugging scale issue...\n');

  // Check raw clob_fills data
  console.log('1. Sample raw clob_fills data:');
  const rawQuery = await clickhouse.query({
    query: `
      SELECT size, price, side, size * price AS notional
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const raw = await rawQuery.json();
  raw.forEach((r: any) => console.log(`   size=${r.size}, price=${r.price}, side=${r.side}, notional=${r.notional}`));

  // Check wallet_token_flows (after our transformation)
  console.log('\n2. Sample wallet_token_flows (our transformation):');
  const flowsQuery = await clickhouse.query({
    query: `
      SELECT net_shares, gross_cf, fees
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const flows = await flowsQuery.json();
  flows.forEach((f: any) => console.log(`   net_shares=${f.net_shares}, gross_cf=${f.gross_cf}, fees=${f.fees}`));

  // Check a specific market payout calculation
  console.log('\n3. Sample payout calculation:');
  const payoutQuery = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        t.pps,
        t.winning_index
      FROM wallet_token_flows f
      JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${wallet}')
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  const payout = await payoutQuery.json();
  payout.forEach((p: any) => {
    console.log(`   condition: ${p.condition_id_ctf.substring(0, 12)}...`);
    console.log(`   net_shares: ${p.net_shares}`);
    console.log(`   pps array: [${p.pps.join(', ')}]`);
    console.log(`   index_set_mask: ${p.index_set_mask} (binary: ${p.index_set_mask.toString(2)})`);
    console.log(`   winning_index: ${p.winning_index}`);
    console.log();
  });
}

main().catch(console.error);
