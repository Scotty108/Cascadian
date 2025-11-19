#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Pick a wallet with decent volume (Wallet 10)
const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

const query = `
WITH trades_by_market AS (
  SELECT
    condition_id_norm_v3 AS cid,
    outcome_index_v3 AS outcome_idx,
    sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
    sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
    shares_buy - shares_sell AS net_shares,
    sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
    sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) = lower('${WALLET}')
    AND condition_id_norm_v3 != ''
  GROUP BY cid, outcome_idx
),
with_resolutions AS (
  SELECT
    t.*,
    r.winning_outcome,
    r.winning_index,
    r.payout_numerators,
    r.payout_denominator,
    r.payout_numerators[t.outcome_idx + 1] AS payout_num_for_outcome,
    toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator) AS payout_per_share,
    t.net_shares * payout_per_share AS settlement_value
  FROM trades_by_market t
  LEFT JOIN market_resolutions_final r
    ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
)
SELECT
  cid,
  outcome_idx,
  net_shares,
  cost_buy,
  proceeds_sell,
  winning_index,
  payout_numerators,
  payout_denominator,
  payout_num_for_outcome,
  payout_per_share,
  settlement_value,
  proceeds_sell - cost_buy + settlement_value AS realized_pnl
FROM with_resolutions
WHERE winning_outcome IS NOT NULL
ORDER BY ABS(settlement_value) DESC
LIMIT 20
`;

async function main() {
  console.log(`Diagnosing payout calculation for wallet ${WALLET.substring(0, 10)}...\n`);

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json<Array<any>>();

  console.log(`Found ${rows.length} resolved positions\n`);
  console.log('Sample positions (top 20 by settlement value):');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  rows.forEach((row, i) => {
    console.log(`Position ${i + 1}:`);
    console.log(`  Condition ID: ${row.cid.substring(0, 16)}...`);
    console.log(`  Outcome Index: ${row.outcome_idx}`);
    console.log(`  Net Shares: ${parseFloat(row.net_shares).toFixed(2)}`);
    console.log(`  Cost: $${parseFloat(row.cost_buy).toFixed(2)}`);
    console.log(`  Proceeds: $${parseFloat(row.proceeds_sell).toFixed(2)}`);
    console.log(`  Winning Index: ${row.winning_index}`);
    console.log(`  Payout Array: [${row.payout_numerators.join(', ')}]`);
    console.log(`  Payout Denom: ${row.payout_denominator}`);
    console.log(`  Payout for Outcome ${row.outcome_idx}: ${row.payout_num_for_outcome}`);
    console.log(`  Payout Per Share: ${parseFloat(row.payout_per_share).toFixed(4)}`);
    console.log(`  Settlement Value: $${parseFloat(row.settlement_value).toFixed(2)}`);
    console.log(`  Realized P&L: $${parseFloat(row.realized_pnl).toFixed(2)}`);
    console.log();
  });

  // Summary
  const totalSettlement = rows.reduce((sum, row) => sum + parseFloat(row.settlement_value), 0);
  const totalPnL = rows.reduce((sum, row) => sum + parseFloat(row.realized_pnl), 0);
  const nonZeroSettlement = rows.filter(row => parseFloat(row.settlement_value) !== 0).length;

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`\nSummary (top 20):`);
  console.log(`  Total Settlement: $${totalSettlement.toFixed(2)}`);
  console.log(`  Total Realized P&L: $${totalPnL.toFixed(2)}`);
  console.log(`  Non-Zero Settlements: ${nonZeroSettlement} / ${rows.length}`);

  if (totalSettlement === 0) {
    console.log('\n⚠️  ALL settlements are $0 - investigating why...');
    console.log('    Possible causes:');
    console.log('    1. All net_shares are 0 (sold all positions before resolution)');
    console.log('    2. All payout_per_share are 0 (losing outcomes)');
    console.log('    3. Payout array indexing issue');
  }
}

main().catch(console.error);
