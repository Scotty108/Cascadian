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
),
unresolved AS (
  SELECT * FROM with_resolutions WHERE winning_outcome IS NULL
)
SELECT
  (SELECT COALESCE(sum(proceeds_sell - cost_buy + settlement_value), 0) FROM resolved_only) AS realized_pnl,
  (SELECT COALESCE(sum(proceeds_sell - cost_buy), 0) FROM unresolved) AS unrealized_pnl,
  (SELECT COALESCE(sum(cost_buy + proceeds_sell), 0) FROM with_resolutions) AS total_volume,
  (SELECT COALESCE(sum(trades), 0) FROM with_resolutions) AS total_trades,
  (SELECT count(DISTINCT cid) FROM with_resolutions) AS total_markets,
  (SELECT COALESCE(sum(settlement_value), 0) FROM resolved_only) AS settlement_value,
  (SELECT count() FROM resolved_only) AS resolved_positions,
  (SELECT count() FROM unresolved) AS open_positions
`;

async function main() {
  console.log(`Testing exact comparison script logic for wallet ${WALLET.substring(0, 10)}...\n`);

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const row = data[0];

  console.log('Results:');
  console.log(`  Realized P&L:       $${parseFloat(row.realized_pnl || 0).toLocaleString()}`);
  console.log(`  Unrealized P&L:     $${parseFloat(row.unrealized_pnl || 0).toLocaleString()}`);
  console.log(`  Net P&L:            $${(parseFloat(row.realized_pnl || 0) + parseFloat(row.unrealized_pnl || 0)).toLocaleString()}`);
  console.log(`  Total Volume:       $${parseFloat(row.total_volume || 0).toLocaleString()}`);
  console.log(`  Total Trades:       ${parseInt(row.total_trades || 0).toLocaleString()}`);
  console.log(`  Unique Markets:     ${parseInt(row.total_markets || 0).toLocaleString()}`);
  console.log(`  Settlement Value:   $${parseFloat(row.settlement_value || 0).toLocaleString()}`);
  console.log(`  Resolved Positions: ${parseInt(row.resolved_positions || 0).toLocaleString()}`);
  console.log(`  Open Positions:     ${parseInt(row.open_positions || 0).toLocaleString()}`);

  if (parseFloat(row.realized_pnl || 0) === 0) {
    console.log('\n⚠️  Realized P&L is $0 - this matches the comparison script bug!');
  } else {
    console.log('\n✅ Realized P&L is NON-ZERO - payout calculation working!');
  }
}

main().catch(console.error);
