/**
 * 07: FIND BALANCED WALLET IN OCT 2024
 *
 * Find wallet with 5+ winners, 5+ losers, 5+ open positions
 * Using October 2024 (100% resolution coverage, 3,508 assets traded)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('07: FIND BALANCED WALLET IN OCT 2024');
  console.log('Target: 5+ winners, 5+ losers, 5+ open');
  console.log('═══════════════════════════════════════════════════════════\n');

  const START = '2024-10-01';
  const END = '2024-11-01';

  console.log(`Period: ${START} to ${END}\n`);
  console.log('📊 Searching for balanced wallet...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index FROM ctf_token_map_norm
      ),
      w AS (
        SELECT
          cf.proxy_wallet,
          countDistinct(cf.asset_id) AS total,
          countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS won,
          countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS lost,
          countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS open
        FROM clob_fills cf
        INNER JOIN cm ON cm.asset_id = cf.asset_id
        LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
        WHERE cf.timestamp >= '${START}' AND cf.timestamp < '${END}'
        GROUP BY cf.proxy_wallet
      )
      SELECT * FROM w
      WHERE won >= 5 AND lost >= 5 AND open >= 5
      ORDER BY (won+lost) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await query.json();

  if (wallets.length === 0) {
    console.log('❌ NO wallets found with 5W/5L/5O\n');
    console.log('Trying with lower threshold (3+)...\n');

    const query2 = await clickhouse.query({
      query: `
        WITH cm AS (
          SELECT asset_id, condition_id_norm, outcome_index FROM ctf_token_map_norm
        ),
        w AS (
          SELECT
            cf.proxy_wallet,
            countDistinct(cf.asset_id) AS total,
            countDistinctIf(cf.asset_id, r.winning_index = cm.outcome_index) AS won,
            countDistinctIf(cf.asset_id, r.winning_index != cm.outcome_index AND r.winning_index IS NOT NULL) AS lost,
            countDistinctIf(cf.asset_id, r.winning_index IS NULL) AS open
          FROM clob_fills cf
          INNER JOIN cm ON cm.asset_id = cf.asset_id
          LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
          WHERE cf.timestamp >= '${START}' AND cf.timestamp < '${END}'
          GROUP BY cf.proxy_wallet
        )
        SELECT * FROM w
        WHERE won >= 3 AND lost >= 3 AND open >= 3
        ORDER BY (won+lost) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const wallets2: any[] = await query2.json();

    if (wallets2.length === 0) {
      console.log('❌ Still no balanced wallets\n');
      console.log('📝 Will need cross-wallet fixture\n');
      return;
    }

    console.log(`✅ Found ${wallets2.length} wallets with 3W/3L/3O:\n`);
    console.table(wallets2.slice(0, 10));

    const best = wallets2[0];

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('BALANCED WALLET SELECTED');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Wallet: ${best.proxy_wallet}`);
    console.log(`Total: ${best.total}`);
    console.log(`Winners: ${best.won}`);
    console.log(`Losers: ${best.lost}`);
    console.log(`Open: ${best.open}\n`);

    // Save
    fs.writeFileSync('CONTROL_WALLET_OCT2024.txt', best.proxy_wallet);
    fs.writeFileSync('control_wallet_oct2024.json', JSON.stringify(best, null, 2));

    console.log('💾 Saved to CONTROL_WALLET_OCT2024.txt\n');
    console.log('✅ Ready to build fixture\n');
    return;
  }

  console.log(`✅ Found ${wallets.length} balanced wallets:\n`);
  console.table(wallets.slice(0, 10));

  const best = wallets[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('BALANCED WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${best.proxy_wallet}`);
  console.log(`Total: ${best.total}`);
  console.log(`Winners: ${best.won}`);
  console.log(`Losers: ${best.lost}`);
  console.log(`Open: ${best.open}\n`);

  console.log('✅ Perfect balance!\n');

  // Save
  fs.writeFileSync('CONTROL_WALLET_OCT2024.txt', best.proxy_wallet);
  fs.writeFileSync('control_wallet_oct2024.json', JSON.stringify(best, null, 2));

  console.log('💾 Saved to CONTROL_WALLET_OCT2024.txt\n');
  console.log('✅ Ready to build fixture with correct status logic\n');
}

main().catch(console.error);
