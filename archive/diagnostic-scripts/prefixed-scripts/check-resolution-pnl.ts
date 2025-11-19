import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  // Get net positions for each asset and check if they won
  const query = await clickhouse.query({
    query: `
      WITH wallet_fills AS (
        SELECT
          asset_id,
          sum(if(side = 'BUY', 1, -1) * size / 1000000.0) as net_shares,
          sum(if(side = 'BUY', 1, 0) * size / 1000000.0 * price) as cost_basis
        FROM clob_fills
        WHERE proxy_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY asset_id
      ),
      decoded AS (
        SELECT
          wf.asset_id,
          wf.net_shares,
          wf.cost_basis,
          lpad(lower(hex(bitShiftRight(toUInt256(wf.asset_id), 8))), 64, '0') AS condition_id_norm,
          toUInt8(bitAnd(toUInt256(wf.asset_id), 255)) as outcome_index
        FROM wallet_fills wf
      )
      SELECT
        d.asset_id,
        d.net_shares,
        d.cost_basis,
        d.outcome_index,
        r.winning_index,
        r.payout_numerators,
        CASE
          WHEN r.winning_index IS NULL THEN 'UNRESOLVED'
          WHEN r.winning_index = d.outcome_index THEN 'WON'
          ELSE 'LOST'
        END as result
      FROM decoded d
      LEFT JOIN market_resolutions_final r ON d.condition_id_norm = r.condition_id_norm
      WHERE d.net_shares != 0
      ORDER BY d.net_shares DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const result: any[] = await query.json();
  console.log('Net Positions with Resolution Status:\n');

  for (const row of result) {
    console.log(`Asset: ${row.asset_id.substring(0, 20)}...`);
    console.log(`  Net Shares: ${row.net_shares}`);
    console.log(`  Cost Basis: $${row.cost_basis}`);
    console.log(`  Outcome Index: ${row.outcome_index}`);
    console.log(`  Winning Index: ${row.winning_index}`);
    console.log(`  Result: ${row.result}`);
    if (row.result === 'WON' || row.result === 'LOST') {
      const payout = row.payout_numerators ? row.payout_numerators[row.outcome_index] : 0;
      const value = row.net_shares * payout;
      const pnl = value - row.cost_basis;
      console.log(`  Payout: ${payout}`);
      console.log(`  Value: $${value}`);
      console.log(`  P&L: $${pnl}`);
    }
    console.log('');
  }

  // Get summary stats
  const summaryQuery = await clickhouse.query({
    query: `
      WITH wallet_fills AS (
        SELECT
          asset_id,
          sum(if(side = 'BUY', 1, -1) * size / 1000000.0) as net_shares
        FROM clob_fills
        WHERE proxy_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY asset_id
      ),
      decoded AS (
        SELECT
          wf.asset_id,
          wf.net_shares,
          lpad(lower(hex(bitShiftRight(toUInt256(wf.asset_id), 8))), 64, '0') AS condition_id_norm,
          toUInt8(bitAnd(toUInt256(wf.asset_id), 255)) as outcome_index
        FROM wallet_fills wf
        WHERE wf.net_shares != 0
      )
      SELECT
        COUNT(*) as total_open_positions,
        SUM(CASE WHEN r.winning_index IS NULL THEN 1 ELSE 0 END) as unresolved,
        SUM(CASE WHEN r.winning_index = d.outcome_index THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN r.winning_index IS NOT NULL AND r.winning_index != d.outcome_index THEN 1 ELSE 0 END) as lost
      FROM decoded d
      LEFT JOIN market_resolutions_final r ON d.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const summary: any[] = await summaryQuery.json();
  console.log('═══════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`Total Open Positions: ${summary[0].total_open_positions}`);
  console.log(`Unresolved: ${summary[0].unresolved}`);
  console.log(`Won: ${summary[0].won}`);
  console.log(`Lost: ${summary[0].lost}`);
}

main().catch(console.error);
