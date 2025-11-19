/**
 * 20: BUILD VALID FIXTURE (OPTIMIZED)
 *
 * Optimized query that limits dataset size earlier
 * Sample from smaller time window first
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('20: BUILD VALID FIXTURE (OPTIMIZED)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Use smaller, more recent time window
  const START = '2025-08-01';  // Recent 3 months instead of full 2024-2025
  const END = '2025-11-01';
  const SNAPSHOT_TS = '2025-11-11 00:00:00';

  console.log(`Period: ${START} to ${END} (3 months for performance)`);
  console.log(`Snapshot: ${SNAPSHOT_TS}\n`);

  console.log('📊 Step 1: Find valid condition_ids with resolution data...\n');

  // First, get a sample of valid condition_ids
  const condQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id_norm
      FROM market_resolutions_norm
      WHERE winning_index IS NOT NULL
        AND resolved_at IS NOT NULL
        AND resolved_at != '1970-01-01 00:00:00'
        AND length(payout_numerators) > 0
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });

  const validConditions: any[] = await condQuery.json();
  const conditionList = validConditions.map(c => `'${c.condition_id_norm}'`).join(',');

  console.log(`  Found ${validConditions.length} valid conditions\n`);

  console.log('📊 Step 2: Build fixture from positions with these conditions...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index
        FROM ctf_token_map_norm
        WHERE condition_id_norm IN (${conditionList})
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
          -- Correct status logic
          CASE
            WHEN r.winning_index = cm.outcome_index AND r.resolved_at <= '${SNAPSHOT_TS}' THEN 'WON'
            WHEN r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL AND r.resolved_at <= '${SNAPSHOT_TS}' THEN 'LOST'
            ELSE 'OPEN'
          END AS status,
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

  // Show breakdown
  if (winners.length > 0 || losers.length > 0 || opens.length > 0) {
    console.log('Status breakdown:\n');
    const breakdowns = [];
    if (winners.length > 0) {
      breakdowns.push({
        status: 'WON',
        count: winners.length,
        avg_size: (winners.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / winners.length).toFixed(0)
      });
    }
    if (losers.length > 0) {
      breakdowns.push({
        status: 'LOST',
        count: losers.length,
        avg_size: (losers.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / losers.length).toFixed(0)
      });
    }
    if (opens.length > 0) {
      breakdowns.push({
        status: 'OPEN',
        count: opens.length,
        avg_size: (opens.reduce((sum, p) => sum + parseFloat(p.total_size), 0) / opens.length).toFixed(0)
      });
    }
    console.table(breakdowns);
  }

  // Show sample
  if (fixture.length > 0) {
    console.log('\nSample positions:\n');
    const samples = fixture.slice(0, Math.min(4, fixture.length));
    console.table(samples.map(p => ({
      status: p.status,
      outcome: p.outcome_index,
      winning: p.winning_index,
      payout_len: p.payout_numerators.length,
      resolved: p.resolved_at ? p.resolved_at.substring(0, 10) : 'null'
    })));
  }

  console.log('\n✅ FIXTURE READY\n');

  if (winners.length > 0 && losers.length > 0) {
    console.log(`✅ SUCCESS: Got ${winners.length}W/${losers.length}L/${opens.length}O with valid resolution data!\n`);
    console.log('Next: Verify fixture data and compute P&L\n');
  } else {
    console.log('⚠️  Need to investigate further\n');
  }
}

main().catch(console.error);
