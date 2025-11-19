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
    r.resolved_at,
    r.payout_numerators,
    r.payout_denominator,
    -- FIX: Guard against NaN by checking denominator first
    if(r.payout_denominator = 0,
       0,
       toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
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
  count() AS total_rows,
  sum(settlement_value) AS total_settlement,
  sum(proceeds_sell - cost_buy + settlement_value) AS total_realized_pnl,
  sum(proceeds_sell - cost_buy) AS total_trade_pnl
FROM resolved_only
`;

async function main() {
  console.log(`Testing NaN fix for wallet ${WALLET.substring(0, 10)}...\n`);

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const row = data[0];

  console.log('Results with NaN guard:');
  console.log(`  Total Rows:         ${parseInt(row.total_rows || 0).toLocaleString()}`);
  console.log(`  Total Settlement:   $${parseFloat(row.total_settlement || 0).toLocaleString()}`);
  console.log(`  Total Realized P&L: $${parseFloat(row.total_realized_pnl || 0).toLocaleString()}`);
  console.log(`  Total Trade P&L:    $${parseFloat(row.total_trade_pnl || 0).toLocaleString()}`);

  if (parseFloat(row.total_settlement || 0) === 0) {
    console.log('\n⚠️  Settlement is STILL $0 - NaN guard didn\'t fix it!');
  } else {
    console.log('\n✅ Settlement is NON-ZERO - NaN guard worked!');
    console.log(`   Settlement impact: $${parseFloat(row.total_settlement || 0).toLocaleString()}`);
  }
}

main().catch(console.error);
