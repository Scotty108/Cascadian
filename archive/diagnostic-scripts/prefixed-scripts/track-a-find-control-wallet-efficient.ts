/**
 * TRACK A1: Find Control Wallet (Efficient)
 *
 * Sample active wallets first, then check their resolved asset counts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TRACK A1: FIND CONTROL WALLET (EFFICIENT)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Sample active wallets from 2024
  console.log('📊 Step 1: Sampling active wallets from 2024...\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        proxy_wallet,
        count() as fill_count,
        count(DISTINCT asset_id) as asset_count
      FROM clob_fills
      WHERE timestamp >= '2024-01-01'
        AND timestamp <= '2024-12-31'
      GROUP BY proxy_wallet
      HAVING asset_count >= 20  -- Filter to active traders
      ORDER BY asset_count DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const candidates: any[] = await sampleQuery.json();

  console.log(`✅ Found ${candidates.length} candidate wallets with 20+ assets\n`);

  if (candidates.length === 0) {
    console.log('❌ No candidate wallets found\n');
    return;
  }

  // Step 2: For each candidate, count resolved assets
  console.log('📊 Step 2: Checking resolved assets for each candidate...\n');

  const results: any[] = [];

  for (let i = 0; i < Math.min(candidates.length, 20); i++) {
    const wallet = candidates[i].proxy_wallet;

    // Count resolved assets for this wallet
    const resolvedQuery = await clickhouse.query({
      query: `
        WITH wallet_assets AS (
          SELECT DISTINCT
            asset_id,
            lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
            toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
          FROM clob_fills
          WHERE proxy_wallet = '${wallet}'
        )
        SELECT
          '${wallet}' as wallet,
          count() as total_assets,
          countIf(r.winning_index IS NOT NULL) as resolved_count,
          countIf(r.winning_index = wa.outcome_index) as winners,
          countIf(r.winning_index != wa.outcome_index AND r.winning_index IS NOT NULL) as losers,
          countIf(r.winning_index IS NULL) as open
        FROM wallet_assets wa
        LEFT JOIN market_resolutions_final r
          ON wa.condition_id_norm = r.condition_id_norm
      `,
      format: 'JSONEachRow'
    });

    const res: any = (await resolvedQuery.json())[0];

    if (res.resolved_count >= 10) {
      results.push(res);
      console.log(`  ✅ ${wallet.substring(0, 12)}... → ${res.resolved_count} resolved (${res.winners}W/${res.losers}L/${res.open}O)`);
    }

    // Stop if we found one with 15+
    if (res.resolved_count >= 15) {
      console.log(`\n✅ Found wallet with 15+ resolved assets!\n`);
      break;
    }
  }

  if (results.length === 0) {
    console.log('\n❌ No wallets found with 10+ resolved assets\n');
    return;
  }

  // Sort by resolved count and select best
  results.sort((a, b) => b.resolved_count - a.resolved_count);

  const controlWallet = results[0].wallet;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CONTROL WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${controlWallet}`);
  console.log(`Total assets: ${results[0].total_assets}`);
  console.log(`Winners: ${results[0].winners}`);
  console.log(`Losers: ${results[0].losers}`);
  console.log(`Open: ${results[0].open}`);
  console.log(`Resolved: ${results[0].resolved_count}\n`);

  // Verify we can build a fixture
  if (results[0].winners >= 5 && results[0].losers >= 5 && results[0].open >= 5) {
    console.log('✅ Fixture requirements met: 5+ winners, 5+ losers, 5+ open\n');
  } else {
    console.log(`⚠️  Fixture partial: ${results[0].winners}W/${results[0].losers}L/${results[0].open}O`);
    console.log('   Will build fixture with available positions\n');
  }

  // Save to file
  fs.writeFileSync('CONTROL_WALLET.txt', controlWallet);
  console.log('💾 Saved to CONTROL_WALLET.txt\n');

  // Also save full results
  const summary = {
    wallet: controlWallet,
    total_assets: results[0].total_assets,
    winners: results[0].winners,
    losers: results[0].losers,
    open: results[0].open,
    resolved: results[0].resolved_count
  };

  fs.writeFileSync('control_wallet_summary.json', JSON.stringify(summary, null, 2));
  console.log('💾 Saved to control_wallet_summary.json\n');

  console.log('✅ Next: Run track-a-build-fixture.ts\n');
}

main().catch(console.error);
