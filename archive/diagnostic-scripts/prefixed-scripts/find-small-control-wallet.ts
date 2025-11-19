/**
 * Find Small Control Wallet
 *
 * Find wallet with 20-100 assets and 15+ resolved
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIND SMALL CONTROL WALLET');
  console.log('Target: 20-100 assets, 15+ resolved');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Sample wallets with 20-100 assets
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        proxy_wallet,
        count(DISTINCT asset_id) as asset_count
      FROM clob_fills
      WHERE timestamp >= '2024-01-01'
      GROUP BY proxy_wallet
      HAVING asset_count >= 20 AND asset_count <= 100
      ORDER BY asset_count DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const candidates: any[] = await sampleQuery.json();

  console.log(`✅ Found ${candidates.length} candidates (20-100 assets)\n`);

  // Check resolved counts
  console.log('📊 Checking resolved assets...\n');

  const results: any[] = [];

  for (const wallet of candidates) {
    const resolvedQuery = await clickhouse.query({
      query: `
        WITH wallet_assets AS (
          SELECT DISTINCT
            asset_id,
            lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
            toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
          FROM clob_fills
          WHERE proxy_wallet = '${wallet.proxy_wallet}'
        )
        SELECT
          '${wallet.proxy_wallet}' as wallet,
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

    if (res.resolved_count >= 15) {
      results.push(res);
      console.log(`  ✅ ${wallet.proxy_wallet.substring(0, 12)}... → ${res.total_assets} assets, ${res.resolved_count} resolved (${res.winners}W/${res.losers}L/${res.open}O)`);
    }

    if (results.length >= 10) break; // Found enough
  }

  if (results.length === 0) {
    console.log('\n❌ No wallets found with 20-100 assets and 15+ resolved\n');
    return;
  }

  // Pick best one
  results.sort((a, b) => {
    // Prefer more even distribution of winners/losers
    const aBalance = Math.min(a.winners, a.losers);
    const bBalance = Math.min(b.winners, b.losers);
    return bBalance - aBalance;
  });

  const controlWallet = results[0].wallet;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SMALL CONTROL WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${controlWallet}`);
  console.log(`Total assets: ${results[0].total_assets}`);
  console.log(`Winners: ${results[0].winners}`);
  console.log(`Losers: ${results[0].losers}`);
  console.log(`Open: ${results[0].open}`);
  console.log(`Resolved: ${results[0].resolved_count}\n`);

  // Save
  fs.writeFileSync('CONTROL_WALLET.txt', controlWallet);
  console.log('💾 Saved to CONTROL_WALLET.txt\n');

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
