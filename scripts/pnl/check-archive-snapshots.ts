/**
 * Check if pm_archive.pm_user_positions has block-level snapshots
 * This is crucial for the hybrid approach: using archive data + our sell PnL calculation
 *
 * ACTUAL SCHEMA:
 * - position_id, proxy_wallet, condition_id, realized_pnl, unrealized_pnl
 * - total_bought, total_sold, updated_at, block_number, insert_time
 * - is_deleted, token_id
 *
 * NOTE: NO avg_price column - we'd need to calculate from total_bought
 */

import { clickhouse } from '../../lib/clickhouse/client';

const TEST_WALLET = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function main() {
  // Check if there are multiple records per position (block snapshots)
  console.log('=== Sample: Multiple blocks per position? ===');
  const multiBlock = await clickhouse.query({
    query: `
      SELECT
        token_id,
        count() as num_snapshots,
        min(block_number) as first_block,
        max(block_number) as last_block
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = lower('${TEST_WALLET}')
      GROUP BY token_id
      HAVING count() > 1
      ORDER BY num_snapshots DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const multiBlockRows = (await multiBlock.json()) as any[];
  console.log(`Positions with multiple snapshots: ${multiBlockRows.length}`);
  for (const r of multiBlockRows) {
    console.log(
      `  token_id: ${String(r.token_id).substring(0, 20)}... snapshots: ${r.num_snapshots}, blocks: ${r.first_block}-${r.last_block}`
    );
  }

  // Check total records for this wallet
  console.log('\n=== Total records for wallet ===');
  const total = await clickhouse.query({
    query: `
      SELECT count() as cnt, count(DISTINCT token_id) as unique_tokens
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = lower('${TEST_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const totalRows = (await total.json()) as any[];
  console.log(`Total records: ${totalRows[0].cnt}, Unique tokens: ${totalRows[0].unique_tokens}`);

  // Check detailed data including realized_pnl
  console.log('\n=== Sample position data ===');
  const detail = await clickhouse.query({
    query: `
      SELECT
        token_id,
        block_number,
        realized_pnl,
        unrealized_pnl,
        total_bought,
        total_sold,
        updated_at
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = lower('${TEST_WALLET}')
        AND is_deleted = 0
      ORDER BY block_number DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const detailRows = (await detail.json()) as any[];
  console.log('Latest 20 records:');
  for (const r of detailRows) {
    const impliedAvgPrice = Number(r.total_sold) > 0 ? Number(r.total_bought) / Number(r.total_sold) : 0;
    console.log(
      `  block: ${r.block_number}, realized: $${Number(r.realized_pnl).toFixed(2)}, unrealized: $${Number(r.unrealized_pnl).toFixed(2)}, bought: ${Number(r.total_bought).toFixed(2)}, sold: ${Number(r.total_sold).toFixed(2)}`
    );
  }

  // Sum up all realized_pnl for this wallet
  console.log('\n=== Total realized_pnl from archive ===');
  const sumPnl = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl) as total_realized,
        sum(unrealized_pnl) as total_unrealized,
        count(DISTINCT token_id) as num_positions
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = lower('${TEST_WALLET}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const sumRows = (await sumPnl.json()) as any[];
  console.log(`Total realized_pnl: $${Number(sumRows[0].total_realized).toFixed(2)}`);
  console.log(`Total unrealized_pnl: $${Number(sumRows[0].total_unrealized).toFixed(2)}`);
  console.log(`Number of positions: ${sumRows[0].num_positions}`);
}

main().catch(console.error);
