#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

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
    sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
    count() AS trades
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
    r.resolved_at,
    r.payout_numerators,
    r.payout_denominator,
    r.payout_numerators[t.outcome_idx + 1] AS payout_num,
    COALESCE(
      toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator),
      0
    ) AS payout_per_share,
    t.net_shares * payout_per_share AS settlement_value
  FROM trades_by_market t
  LEFT JOIN market_resolutions_final r
    ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
),
resolved_only AS (
  SELECT * FROM with_resolutions WHERE winning_outcome IS NOT NULL
)
SELECT
  cid,
  outcome_idx,
  net_shares,
  winning_index,
  payout_numerators,
  payout_denominator,
  payout_num,
  payout_per_share,
  settlement_value
FROM resolved_only
ORDER BY ABS(net_shares) DESC
LIMIT 10
`;

async function main() {
  console.log(`Sampling CTE rows for wallet ${WALLET.substring(0, 10)}...\n`);

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json<Array<any>>();

  console.log('Sample Rows from resolved_only CTE:');
  console.log('═══════════════════════════════════════════════════════════════\n');

  rows.forEach((row, i) => {
    console.log(`Row ${i + 1}:`);
    console.log(`  CID: ${row.cid.substring(0, 16)}...`);
    console.log(`  Outcome Index: ${row.outcome_idx}`);
    console.log(`  Net Shares: ${parseFloat(row.net_shares).toFixed(2)}`);
    console.log(`  Winning Index: ${row.winning_index}`);
    console.log(`  Payout Array: [${row.payout_numerators.join(', ')}]`);
    console.log(`  Payout Denom: ${row.payout_denominator}`);
    console.log(`  Payout Num (idx+1): ${row.payout_num}`);
    console.log(`  Payout Per Share: ${parseFloat(row.payout_per_share).toFixed(4)}`);
    console.log(`  Settlement Value: $${parseFloat(row.settlement_value).toFixed(2)}`);
    console.log();
  });
}

main().catch(console.error);
