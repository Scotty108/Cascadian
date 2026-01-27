import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x7ed62b230d860eb69bf076450026ac382dc5eb26';

  console.log(`Debugging PnL discrepancy for ${wallet}\n`);
  console.log('Polymarket shows: -$568.83');
  console.log('Our FIFO shows: -$2,247.13');
  console.log('Difference: $1,678.30\n');

  // Check positions by time period
  const timeResult = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(resolved_at) as month,
        count() as position_count,
        round(sum(pnl_usd), 2) as total_pnl,
        round(sum(cost_usd), 2) as total_cost
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
      GROUP BY toYYYYMM(resolved_at)
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const timeRows = await timeResult.json();
  console.log('PnL by Month:');
  console.log(JSON.stringify(timeRows, null, 2));

  // Check for any weird outliers
  const outlierResult = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        is_short,
        tokens,
        cost_usd,
        exit_value,
        pnl_usd,
        roi,
        resolved_at
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
        AND (abs(pnl_usd) > 500 OR abs(roi) > 5)
      ORDER BY abs(pnl_usd) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const outlierRows = await outlierResult.json();
  console.log('\nLarge wins/losses (>$500 or >500% ROI):');
  console.log(JSON.stringify(outlierRows, null, 2));

  // Check if there are duplicate positions
  const dupResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        count() as dup_count,
        sum(pnl_usd) as total_pnl
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
      GROUP BY condition_id, outcome_index
      HAVING count() > 1
      ORDER BY dup_count DESC
    `,
    format: 'JSONEachRow'
  });

  const dupRows = await dupResult.json();
  if (dupRows.length > 0) {
    console.log('\nDuplicate positions (same condition_id + outcome_index):');
    console.log(JSON.stringify(dupRows, null, 2));
  } else {
    console.log('\nNo duplicate positions found (good!)');
  }

  // Check oldest positions
  const oldResult = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        condition_id,
        pnl_usd,
        cost_usd,
        resolved_at,
        entry_time
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
      ORDER BY resolved_at ASC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const oldRows = await oldResult.json();
  console.log('\nOldest 10 positions:');
  console.log(JSON.stringify(oldRows, null, 2));
}

main().catch(console.error);
