#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Calculating P&L with fees included...\n`);

  const result = await clickhouse.query({
    query: `
      WITH trades_by_market AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          sum(toFloat64(fee)) AS total_fees,
          proceeds_sell - cost_buy AS gross_trade_pnl,
          proceeds_sell - cost_buy - total_fees AS net_trade_pnl
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      )
      SELECT
        sum(gross_trade_pnl) AS gross_pnl,
        sum(total_fees) AS total_fees,
        sum(net_trade_pnl) AS net_pnl
      FROM trades_by_market
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L WITH FEES:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Gross P&L (before fees):  $${parseFloat(r.gross_pnl).toLocaleString()}`);
  console.log(`  Total Fees:               $${parseFloat(r.total_fees).toLocaleString()}`);
  console.log(`  Net P&L (after fees):     $${parseFloat(r.net_pnl).toLocaleString()}`);
  console.log();

  const netPnL = parseFloat(r.net_pnl);
  const expectedPnL = 185000;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Expected (Polymarket/Dome): $${expectedPnL.toLocaleString()}`);
  console.log(`  Our Net P&L:                $${netPnL.toLocaleString()}`);
  console.log(`  Difference:                 $${(netPnL - expectedPnL).toLocaleString()}`);
  console.log(`  Match:                      ${Math.abs(netPnL - expectedPnL) < 50000 ? '✅' : '❌'}`);

  if (Math.abs(netPnL - expectedPnL) > 50000) {
    console.log();
    console.log('💡 Fees don\'t explain the difference.');
    console.log('   Need to investigate other factors:');
    console.log('   - Market definition differences');
    console.log('   - Time period differences');
    console.log('   - Include/exclude criteria');
  }
}

main().catch(console.error);
