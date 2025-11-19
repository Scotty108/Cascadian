/**
 * 19: BUILD VALID FIXTURE
 *
 * Build fixture with ONLY positions that have valid resolution data
 * Filter for non-null winning_index, valid timestamps, and non-empty payouts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('19: BUILD VALID FIXTURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const START = '2024-01-01';
  const END = '2025-11-01';
  const SNAPSHOT_TS = '2025-11-11 00:00:00';

  console.log(`Period: ${START} to ${END}`);
  console.log(`Snapshot: ${SNAPSHOT_TS}`);
  console.log('Filtering for positions WITH valid resolution data\n');

  console.log('📊 Building fixture with valid resolution data only...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index FROM ctf_token_map_norm
      ),
      positions AS (
        SELECT
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          r.resolved_at,
          -- Correct status logic at snapshot
          CASE
            WHEN r.winning_index = cm.outcome_index AND r.resolved_at <= '${SNAPSHOT_TS}' THEN 'WON'
            WHEN r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL AND r.resolved_at <= '${SNAPSHOT_TS}' THEN 'LOST'
            ELSE 'OPEN'
          END AS status,
          -- Aggregate fills
          sum(cf.size) AS total_size,
          sum(cf.size * cf.price) AS total_cost,
          avg(cf.price) AS avg_price,
          min(cf.timestamp) AS first_fill,
          max(cf.timestamp) AS last_fill,
          count() AS fill_count
        FROM clob_fills cf
        INNER JOIN cm ON cm.asset_id = cf.asset_id
        INNER JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
        WHERE cf.timestamp >= '${START}' AND cf.timestamp < '${END}'
          -- CRITICAL: Only positions with valid resolution data
          AND r.winning_index IS NOT NULL
          AND r.resolved_at IS NOT NULL
          AND r.resolved_at != '1970-01-01 00:00:00'
          AND length(r.payout_numerators) > 0
        GROUP BY
          cf.proxy_wallet,
          cf.asset_id,
          cm.condition_id_norm,
          cm.outcome_index,
          r.winning_index,
          r.payout_numerators,
          r.payout_denominator,
          r.resolved_at
      ),
      winners AS (
        SELECT * FROM positions WHERE status = 'WON' ORDER BY total_size DESC LIMIT 5
      ),
      losers AS (
        SELECT * FROM positions WHERE status = 'LOST' ORDER BY total_size DESC LIMIT 5
      ),
      opens AS (
        SELECT * FROM positions WHERE status = 'OPEN' ORDER BY total_size DESC LIMIT 5
      )
      SELECT * FROM winners
      UNION ALL
      SELECT * FROM losers
      UNION ALL
      SELECT * FROM opens
    `,
    format: 'JSONEachRow'
  });

  const fixture: any[] = await query.json();

  console.log(`✅ Built fixture with ${fixture.length} positions\n`);

  // Count by status
  const winners = fixture.filter(p => p.status === 'WON');
  const losers = fixture.filter(p => p.status === 'LOST');
  const opens = fixture.filter(p => p.status === 'OPEN');

  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);
  console.log(`  Open: ${opens.length}\n`);

  // Save
  fs.writeFileSync('fixture_valid.json', JSON.stringify(fixture, null, 2));

  const summary = {
    snapshot_ts: SNAPSHOT_TS,
    period_start: START,
    period_end: END,
    total_positions: fixture.length,
    winners: winners.length,
    losers: losers.length,
    open: opens.length,
    unique_wallets: new Set(fixture.map(p => p.proxy_wallet)).size,
    unique_conditions: new Set(fixture.map(p => p.condition_id_norm)).size
  };

  fs.writeFileSync('fixture_valid_summary.json', JSON.stringify(summary, null, 2));

  console.log('💾 Saved fixture_valid.json\n');

  // Show summary by status
  console.log('Status breakdown:\n');
  const breakdowns = [];
  if (winners.length > 0) {
    breakdowns.push({
      status: 'WON',
      count: winners.length,
      avg_size: (winners.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / winners.length).toFixed(0),
      avg_fills: (winners.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / winners.length).toFixed(1),
      avg_cost: '$' + (winners.reduce((sum, p) => sum + parseFloat(p.total_cost), 0) / winners.length).toFixed(2)
    });
  }
  if (losers.length > 0) {
    breakdowns.push({
      status: 'LOST',
      count: losers.length,
      avg_size: (losers.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / losers.length).toFixed(0),
      avg_fills: (losers.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / losers.length).toFixed(1),
      avg_cost: '$' + (losers.reduce((sum, p) => sum + parseFloat(p.total_cost), 0) / losers.length).toFixed(2)
    });
  }
  if (opens.length > 0) {
    breakdowns.push({
      status: 'OPEN',
      count: opens.length,
      avg_size: (opens.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / opens.length).toFixed(0),
      avg_fills: (opens.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / opens.length).toFixed(1),
      avg_cost: '$' + (opens.reduce((sum, p) => sum + parseFloat(p.total_cost), 0) / opens.length).toFixed(2)
    });
  }
  console.table(breakdowns);

  // Show sample with resolution data
  if (fixture.length > 0) {
    console.log('\nSample positions with resolution data:\n');
    const samplePositions = [
      ...winners.slice(0, Math.min(2, winners.length)),
      ...losers.slice(0, Math.min(2, losers.length)),
      ...opens.slice(0, Math.min(2, opens.length))
    ];

    if (samplePositions.length > 0) {
      console.table(samplePositions.map(p => ({
        wallet: p.proxy_wallet.substring(0, 10) + '...',
        condition: p.condition_id_norm.substring(0, 15) + '...',
        outcome: p.outcome_index,
        winning: p.winning_index,
        status: p.status,
        size: parseFloat(p.total_size).toLocaleString(),
        fills: p.fill_count,
        payout_len: p.payout_numerators.length,
        resolved: p.resolved_at
      })));
    }
  }

  console.log('\n✅ FIXTURE READY\n');

  if (winners.length === 5 && losers.length === 5 && opens.length === 5) {
    console.log('🎉 SUCCESS: Got balanced 5W/5L/5O fixture with valid resolution data!\n');
    console.log('Next: Compute correct P&L with ERC1155 quantities and FIFO cost\n');
  } else if (winners.length > 0 && losers.length > 0) {
    console.log(`✅ PARTIAL: Got ${winners.length}W/${losers.length}L/${opens.length}O with valid resolution data\n`);
    console.log('Next: Either find OPEN positions or proceed with W/L validation\n');
  } else {
    console.log('⚠️  Need to investigate further - insufficient positions with valid data\n');
  }
}

main().catch(console.error);
