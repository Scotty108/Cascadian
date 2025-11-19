/**
 * 03B: FIND BALANCED WALLET
 *
 * Find wallet with balanced distribution: at least 5 winners, 5 losers, 5 open
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('03B: FIND BALANCED WALLET');
  console.log('Target: 5+ winners, 5+ losers, 5+ open');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Searching for balanced wallet...\n');

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
        WHERE cf.timestamp >= '2024-01-01'
        GROUP BY cf.proxy_wallet
      )
      SELECT *
      FROM w
      WHERE assets_won >= 5
        AND assets_lost >= 5
        AND assets_open >= 5
        AND assets_total <= 200
      ORDER BY
        least(assets_won, assets_lost, assets_open) DESC,
        assets_total ASC
      LIMIT 25
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await query.json();

  if (wallets.length === 0) {
    console.log('❌ NO balanced wallets found with 5W/5L/5O\n');
    console.log('Trying with lower threshold (3+ each)...\n');

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
          WHERE cf.timestamp >= '2024-01-01'
          GROUP BY cf.proxy_wallet
        )
        SELECT *
        FROM w
        WHERE assets_won >= 3
          AND assets_lost >= 3
          AND assets_open >= 3
          AND assets_total <= 200
        ORDER BY
          least(assets_won, assets_lost, assets_open) DESC,
          assets_total ASC
        LIMIT 25
      `,
      format: 'JSONEachRow'
    });

    const wallets2: any[] = await query2.json();

    if (wallets2.length === 0) {
      console.log('❌ Still no balanced wallets found\n');
      return;
    }

    console.log(`✅ Found ${wallets2.length} wallets with 3W/3L/3O:\n`);
    console.table(wallets2.slice(0, 10));

    const best = wallets2[0];

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('BALANCED CONTROL WALLET SELECTED');
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
    console.log('✅ Ready to build fixture\n');
    return;
  }

  console.log(`✅ Found ${wallets.length} balanced wallets:\n`);
  console.table(wallets.slice(0, 10));

  const best = wallets[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('BALANCED CONTROL WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${best.proxy_wallet}`);
  console.log(`Total assets: ${best.assets_total}`);
  console.log(`Resolved: ${best.assets_resolved}`);
  console.log(`Winners: ${best.assets_won}`);
  console.log(`Losers: ${best.assets_lost}`);
  console.log(`Open: ${best.assets_open}\n`);

  console.log('✅ Perfect balance - meets 5W/5L/5O requirement!\n');

  // Save
  fs.writeFileSync('CONTROL_WALLET.txt', best.proxy_wallet);
  fs.writeFileSync('control_wallet_summary.json', JSON.stringify(best, null, 2));

  console.log('💾 Saved to CONTROL_WALLET.txt\n');
  console.log('✅ Ready to build fixture\n');
}

main().catch(console.error);
