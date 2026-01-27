import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x7ed62b230d860eb69bf076450026ac382dc5eb26';

  console.log('Testing deduplication queries:\n');

  // Test 1: Current approach (with duplicates)
  const dupResult = await clickhouse.query({
    query: `
      SELECT round(sum(pnl_usd), 2) as total_pnl
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const dupRows = await dupResult.json();
  console.log('1. With duplicates (current):', dupRows[0]);

  // Test 2: My attempted fix
  const myFixResult = await clickhouse.query({
    query: `
      SELECT round((
        SELECT sum(any(pnl_usd))
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
        GROUP BY condition_id, outcome_index
      ), 2) as total_pnl
    `,
    format: 'JSONEachRow'
  });
  const myFixRows = await myFixResult.json();
  console.log('2. My fix attempt:', myFixRows[0]);

  // Test 3: Correct deduplication
  const correctResult = await clickhouse.query({
    query: `
      SELECT round(sum(pnl_per_position), 2) as total_pnl
      FROM (
        SELECT
          condition_id,
          outcome_index,
          any(pnl_usd) as pnl_per_position
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
        GROUP BY condition_id, outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const correctRows = await correctResult.json();
  console.log('3. Correct deduplication:', correctRows[0]);

  // Test 4: Show how many unique vs total
  const countResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT concat(condition_id, '_', toString(outcome_index))) as unique_positions
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const countRows = await countResult.json();
  console.log('4. Row counts:', countRows[0]);
}

main().catch(console.error);
