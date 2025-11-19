/**
 * 03: FIND CONTROL WALLET (NORMALIZED)
 *
 * Use normalized views to find wallet with 20-100 assets and 15+ resolved
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('03: FIND CONTROL WALLET (NORMALIZED)');
  console.log('Target: 20-100 assets, 15+ resolved');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Finding wallets with normalized joins...\n');

  // Use the exact query from the fix kit with recent date filter to reduce scan
  const query = await clickhouse.query({
    query: `
      WITH w AS (
        SELECT
          cf.proxy_wallet,
          countDistinct(cf.asset_id) AS assets_total,
          countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_resolved,
          countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS assets_won,
          countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS assets_lost,
          countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS assets_open
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cf.asset_id = cm.asset_id
        LEFT JOIN market_resolutions_norm r ON cm.condition_id_norm = r.condition_id_norm
        WHERE cf.timestamp >= '2024-09-01' AND cf.timestamp < '2025-01-01'
        GROUP BY cf.proxy_wallet
      )
      SELECT *
      FROM w
      WHERE assets_total BETWEEN 20 AND 100
        AND assets_resolved >= 15
      ORDER BY assets_resolved DESC, assets_total ASC
      LIMIT 25
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await query.json();

  if (wallets.length === 0) {
    console.log('❌ NO WALLETS FOUND with 20-100 assets and 15+ resolved\n');
    console.log('Trying with lower threshold (10+)...\n');

    const query2 = await clickhouse.query({
      query: `
        WITH w AS (
          SELECT
            cf.proxy_wallet,
            countDistinct(cf.asset_id) AS assets_total,
            countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_resolved,
            countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS assets_won,
            countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS assets_lost,
            countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS assets_open
          FROM clob_fills cf
          INNER JOIN ctf_token_map_norm cm ON cf.asset_id = cm.asset_id
          LEFT JOIN market_resolutions_norm r ON cm.condition_id_norm = r.condition_id_norm
          WHERE cf.timestamp >= '2024-09-01' AND cf.timestamp < '2025-01-01'
          GROUP BY cf.proxy_wallet
        )
        SELECT *
        FROM w
        WHERE assets_total BETWEEN 20 AND 100
          AND assets_resolved >= 10
        ORDER BY assets_resolved DESC, assets_total ASC
        LIMIT 25
      `,
      format: 'JSONEachRow'
    });

    const wallets2: any[] = await query2.json();

    if (wallets2.length === 0) {
      console.log('❌ Still no wallets found\n');
      return;
    }

    console.log(`✅ Found ${wallets2.length} wallets with 10+ resolved:\n`);
    console.table(wallets2.slice(0, 10));

    const best = wallets2[0];

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('CONTROL WALLET SELECTED');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Wallet: ${best.proxy_wallet}`);
    console.log(`Total assets: ${best.assets_total}`);
    console.log(`Resolved: ${best.assets_resolved}`);
    console.log(`Winners: ${best.assets_won}`);
    console.log(`Losers: ${best.assets_lost}`);
    console.log(`Open: ${best.assets_open}\n`);

    // Save
    fs.writeFileSync('CONTROL_WALLET.txt', best.proxy_wallet);
    fs.writeFileSync('control_wallet_summary.json', JSON.stringify(best, null, 2));

    console.log('💾 Saved to CONTROL_WALLET.txt\n');
    console.log('✅ Next: Run 04-build-fixture-normalized.ts\n');
    return;
  }

  console.log(`✅ Found ${wallets.length} wallets with 15+ resolved:\n`);
  console.table(wallets.slice(0, 10));

  const best = wallets[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CONTROL WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${best.proxy_wallet}`);
  console.log(`Total assets: ${best.assets_total}`);
  console.log(`Resolved: ${best.assets_resolved}`);
  console.log(`Winners: ${best.assets_won}`);
  console.log(`Losers: ${best.assets_lost}`);
  console.log(`Open: ${best.assets_open}\n`);

  // Check if we can build proper fixture
  if (best.assets_won >= 5 && best.assets_lost >= 5 && best.assets_open >= 5) {
    console.log('✅ Fixture requirements MET: 5+ winners, 5+ losers, 5+ open\n');
  } else {
    console.log(`⚠️  Fixture partial: ${best.assets_won}W / ${best.assets_lost}L / ${best.assets_open}O\n`);
    console.log('   Will build best available fixture\n');
  }

  // Save
  fs.writeFileSync('CONTROL_WALLET.txt', best.proxy_wallet);
  fs.writeFileSync('control_wallet_summary.json', JSON.stringify(best, null, 2));

  console.log('💾 Saved to CONTROL_WALLET.txt\n');
  console.log('✅ Next: Run 04-build-fixture-normalized.ts\n');
}

main().catch(console.error);
