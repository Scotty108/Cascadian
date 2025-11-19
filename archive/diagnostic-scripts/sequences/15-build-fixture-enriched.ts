/**
 * 15: BUILD FIXTURE WITH ENRICHED TIMESTAMPS
 *
 * Build 15-row fixture: 5 winners + 5 losers + 5 open
 * Using enriched resolved_at timestamps from resolution_timestamps
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('15: BUILD FIXTURE WITH ENRICHED TIMESTAMPS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Use trades from Jan-Oct 2025, snapshot after enrichment timestamp
  const START = '2025-01-01';
  const END = '2025-11-01';
  const SNAPSHOT_TS = '2025-11-11 00:00:00'; // After enrichment date (2025-11-10 03:32:19)

  console.log(`Period: ${START} to ${END}`);
  console.log(`Snapshot: ${SNAPSHOT_TS}`);
  console.log('(All resolutions enriched to 2025-11-10, so snapshot captures them as resolved)\\n');

  console.log('📊 Building fixture with correct status logic...\\n');

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
        LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
        WHERE cf.timestamp >= '${START}' AND cf.timestamp < '${END}'
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

  console.log(`✅ Built fixture with ${fixture.length} positions\\n`);

  // Count by status
  const winners = fixture.filter(p => p.status === 'WON');
  const losers = fixture.filter(p => p.status === 'LOST');
  const opens = fixture.filter(p => p.status === 'OPEN');

  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);
  console.log(`  Open: ${opens.length}\\n`);

  // Save
  fs.writeFileSync('fixture_enriched.json', JSON.stringify(fixture, null, 2));

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

  fs.writeFileSync('fixture_enriched_summary.json', JSON.stringify(summary, null, 2));

  console.log('💾 Saved fixture_enriched.json\\n');

  // Show summary by status
  console.log('Status breakdown:\\n');
  console.table([
    {
      status: 'WON',
      count: winners.length,
      avg_size: winners.length > 0 ? (winners.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / winners.length).toFixed(0) : 0,
      avg_fills: winners.length > 0 ? (winners.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / winners.length).toFixed(1) : 0
    },
    {
      status: 'LOST',
      count: losers.length,
      avg_size: losers.length > 0 ? (losers.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / losers.length).toFixed(0) : 0,
      avg_fills: losers.length > 0 ? (losers.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / losers.length).toFixed(1) : 0
    },
    {
      status: 'OPEN',
      count: opens.length,
      avg_size: opens.length > 0 ? (opens.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / opens.length).toFixed(0) : 0,
      avg_fills: opens.length > 0 ? (opens.reduce((sum, p) => sum + parseInt(p.fill_count), 0) / opens.length).toFixed(1) : 0
    }
  ]);

  // Show sample
  if (fixture.length > 0) {
    console.log('\\nSample positions:\\n');
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
        resolved: p.resolved_at
      })));
    }
  }

  console.log('\\n✅ FIXTURE READY\\n');

  if (winners.length === 5 && losers.length === 5 && opens.length === 5) {
    console.log('🎉 SUCCESS: Got balanced 5W/5L/5O fixture!\\n');
    console.log('Next: Compute correct P&L with ERC1155 quantities and FIFO cost\\n');
  } else {
    console.log('⚠️  Fixture not balanced - may need different time period or cross-wallet approach\\n');
  }
}

main().catch(console.error);
