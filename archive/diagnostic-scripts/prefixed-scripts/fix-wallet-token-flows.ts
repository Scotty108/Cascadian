import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Fixing wallet_token_flows with correct scale...\n');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_token_flows AS
      SELECT
        lower(cf.user_eoa) AS wallet,
        lower(hex(bitShiftRight(toUInt256(cf.asset_id), 8))) AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256(cf.asset_id), 255))        AS index_set_mask,
        (sumIf(toFloat64(cf.size), cf.side = 'BUY')
          - sumIf(toFloat64(cf.size), cf.side = 'SELL')) / 1000000.0 AS net_shares,
        (sumIf(-toFloat64(cf.size * cf.price), cf.side = 'BUY')
          + sumIf(toFloat64(cf.size * cf.price), cf.side = 'SELL')) / 1000000.0 AS gross_cf,
        sum(toFloat64(cf.size * cf.price * coalesce(cf.fee_rate_bps, 0) / 10000.0)) / 1000000.0 AS fees
      FROM clob_fills cf
      WHERE cf.asset_id != 'asset'
        AND cf.asset_id IS NOT NULL
        AND cf.user_eoa IS NOT NULL
      GROUP BY wallet, condition_id_ctf, index_set_mask
    `
  });

  console.log('✅ wallet_token_flows fixed with /1000000.0 scale\n');

  // Re-test sample data
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
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
  
  console.log('Sample wallet_token_flows (corrected):');
  flows.forEach((f: any) => console.log(`   net_shares=${f.net_shares}, gross_cf=${f.gross_cf}, fees=${f.fees}`));

  // Quick P&L check
  const pnlQuery = await clickhouse.query({
    query: `
      SELECT pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const pnl = await pnlQuery.json();
  
  console.log(`\nWallet P&L: $${Number(pnl[0].pnl_net).toLocaleString()}`);
  console.log('Expected: ~$87,030.51\n');
}

main().catch(console.error);
