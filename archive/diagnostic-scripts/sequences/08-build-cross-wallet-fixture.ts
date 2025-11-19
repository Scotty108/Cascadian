/**
 * 08: BUILD CROSS-WALLET FIXTURE
 *
 * Build 15-row fixture: 5 winners + 5 losers + 5 open
 * Using October 2024 data with correct status logic
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('08: BUILD CROSS-WALLET FIXTURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const START = '2025-01-01';
  const END = '2025-11-01';
  const SNAPSHOT_TS = '2025-11-05 23:59:59';

  console.log(`Period: ${START} to ${END}`);
  console.log(`Snapshot: ${SNAPSHOT_TS}`);
  console.log('(Using Nov 2025 snapshot to capture resolved positions)\n');

  console.log('📊 Building fixture with correct status logic...\n');

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
          max(cf.timestamp) AS last_fill
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

  console.log(`✅ Built fixture with ${fixture.length} positions\n`);

  // Count by status
  const winners = fixture.filter(p => p.status === 'WON');
  const losers = fixture.filter(p => p.status === 'LOST');
  const opens = fixture.filter(p => p.status === 'OPEN');

  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);
  console.log(`  Open: ${opens.length}\n`);

  // Save
  fs.writeFileSync('fixture_cross_wallet.json', JSON.stringify(fixture, null, 2));
  fs.writeFileSync('fixture_cross_wallet_summary.json', JSON.stringify({
    snapshot_ts: SNAPSHOT_TS,
    period_start: START,
    period_end: END,
    total_positions: fixture.length,
    winners: winners.length,
    losers: losers.length,
    open: opens.length,
    unique_wallets: new Set(fixture.map(p => p.proxy_wallet)).size
  }, null, 2));

  console.log('💾 Saved fixture_cross_wallet.json\n');

  // Show sample
  if (fixture.length > 0) {
    console.log('Sample positions:\n');
    const samplePositions = [
      ...winners.slice(0, Math.min(2, winners.length)),
      ...losers.slice(0, Math.min(2, losers.length)),
      ...opens.slice(0, Math.min(2, opens.length))
    ];

    if (samplePositions.length > 0) {
      console.table(samplePositions.map(p => ({
        wallet: p.proxy_wallet.substring(0, 10) + '...',
        asset: (p.asset_id || p['cf.asset_id']).substring(0, 15) + '...',
        status: p.status,
        size: parseFloat(p.total_size).toLocaleString(),
        cost: '$' + parseFloat(p.total_cost).toFixed(2)
      })));
    }
  }

  console.log('\n✅ FIXTURE READY\n');
  console.log('Next: Compute correct P&L with ERC1155 quantities and FIFO cost\n');
}

main().catch(console.error);
