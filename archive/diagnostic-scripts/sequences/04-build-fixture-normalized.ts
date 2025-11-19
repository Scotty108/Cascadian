/**
 * 04: BUILD FIXTURE (NORMALIZED)
 *
 * Build test fixture from control wallet using normalized views
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('04: BUILD FIXTURE (NORMALIZED)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load control wallet
  const controlWallet = fs.readFileSync('CONTROL_WALLET.txt', 'utf-8').trim();
  console.log(`Control Wallet: ${controlWallet}\n`);

  console.log('📊 Building fixture with full position data...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        cf.asset_id AS asset_id,
        cm.condition_id_norm AS condition_id_norm,
        cm.outcome_index AS outcome_index,
        cm.market_id AS market_id,
        CASE
          WHEN r.winning_index IS NULL THEN 'OPEN'
          WHEN r.winning_index = cm.outcome_index THEN 'WON'
          ELSE 'LOST'
        END AS status,
        r.winning_index AS winning_index,
        r.payout_numerators AS payout_numerators,
        r.payout_denominator AS payout_denominator,
        r.resolved_at AS resolved_at,
        -- Get total fills for this asset
        sum(cf.size) AS total_shares,
        sum(cf.size * cf.price) AS total_cost_basis,
        avg(cf.price) AS avg_entry_price,
        min(cf.timestamp) AS first_fill_ts,
        max(cf.timestamp) AS last_fill_ts,
        -- Calculate P&L for resolved positions
        CASE
          WHEN r.winning_index IS NULL THEN 0
          WHEN r.winning_index = cm.outcome_index THEN
            (r.payout_numerators[cm.outcome_index + 1] / r.payout_denominator) * sum(cf.size) - sum(cf.size * cf.price)
          ELSE
            -1 * sum(cf.size * cf.price)
        END AS realized_pnl
      FROM clob_fills cf
      INNER JOIN ctf_token_map_norm cm ON cf.asset_id = cm.asset_id
      LEFT JOIN market_resolutions_norm r ON cm.condition_id_norm = r.condition_id_norm
      WHERE cf.proxy_wallet = '${controlWallet}'
        AND cf.timestamp >= '2024-09-01'
        AND cf.timestamp < '2025-01-01'
      GROUP BY
        cf.asset_id,
        cm.condition_id_norm,
        cm.outcome_index,
        cm.market_id,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator,
        r.resolved_at
      ORDER BY
        status ASC,  -- LOST first, then OPEN, then WON
        cf.asset_id ASC
    `,
    format: 'JSONEachRow'
  });

  const positions: any[] = await query.json();

  console.log(`✅ Found ${positions.length} total positions\n`);

  // Separate by status
  const winners = positions.filter(p => p.status === 'WON');
  const losers = positions.filter(p => p.status === 'LOST');
  const open = positions.filter(p => p.status === 'OPEN');

  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers: ${losers.length}`);
  console.log(`  Open: ${open.length}\n`);

  // Build fixture with all winners + sample of losers
  const fixture = [
    ...winners,
    ...losers.slice(0, 15)  // Take 15 losers for testing
  ];

  console.log(`📝 Fixture built: ${fixture.length} positions\n`);

  // Calculate summary stats
  const totalPnL = fixture.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0);
  const totalCost = fixture.reduce((sum, p) => sum + parseFloat(p.total_cost_basis), 0);

  console.log('Summary:\n');
  console.log(`  Total positions: ${fixture.length}`);
  console.log(`  Winners: ${winners.length}`);
  console.log(`  Losers (sample): ${Math.min(15, losers.length)}`);
  console.log(`  Total cost basis: $${totalCost.toLocaleString()}`);
  console.log(`  Realized P&L: $${totalPnL.toLocaleString()}\n`);

  // Save fixture
  fs.writeFileSync('fixture.json', JSON.stringify(fixture, null, 2));
  fs.writeFileSync('fixture_summary.json', JSON.stringify({
    control_wallet: controlWallet,
    total_positions: fixture.length,
    winners: winners.length,
    losers: Math.min(15, losers.length),
    open: 0,
    total_cost_basis: totalCost,
    realized_pnl: totalPnL,
    avg_pnl_per_position: totalPnL / fixture.length
  }, null, 2));

  console.log('💾 Saved fixture.json and fixture_summary.json\n');

  // Show sample positions
  console.log('Sample Positions:\n');
  console.table(fixture.slice(0, 5).map(p => ({
    asset_id: p.asset_id.substring(0, 20) + '...',
    status: p.status,
    shares: parseFloat(p.total_shares).toLocaleString(),
    cost: '$' + parseFloat(p.total_cost_basis).toFixed(2),
    pnl: '$' + parseFloat(p.realized_pnl).toFixed(2)
  })));

  console.log('\n✅ FIXTURE READY\n');
  console.log('Next: Run Checkpoint A to validate token decode\n');
}

main().catch(console.error);
