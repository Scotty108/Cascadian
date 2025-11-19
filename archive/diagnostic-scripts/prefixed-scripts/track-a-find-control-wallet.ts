/**
 * TRACK A1: Find Control Wallet
 *
 * Find a wallet with at least 15 resolved assets to validate P&L engine
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TRACK A1: FIND CONTROL WALLET');
  console.log('Target: Wallet with 15+ resolved assets');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Finding wallets with resolved positions...\n');

  // Find wallets with resolved assets
  // Decode asset_id directly (not using ctf_token_map due to format issues)
  // Note: asset_id is stored as String in database
  const query = await clickhouse.query({
    query: `
      WITH wallet_assets AS (
        SELECT DISTINCT
          proxy_wallet,
          asset_id,
          lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
          toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
        FROM clob_fills
        WHERE timestamp >= '2024-01-01'
      ),
      resolved_assets AS (
        SELECT
          wa.proxy_wallet,
          wa.asset_id,
          wa.condition_id_norm,
          wa.outcome_index,
          r.winning_index,
          r.outcome_count,
          CASE
            WHEN r.winning_index IS NULL THEN 'open'
            WHEN r.winning_index = wa.outcome_index THEN 'winner'
            ELSE 'loser'
          END as status
        FROM wallet_assets wa
        LEFT JOIN market_resolutions_final r
          ON wa.condition_id_norm = r.condition_id_norm
      )
      SELECT
        proxy_wallet,
        count() as total_assets,
        countIf(status = 'winner') as winners,
        countIf(status = 'loser') as losers,
        countIf(status = 'open') as open,
        countIf(winning_index IS NOT NULL) as resolved_count
      FROM resolved_assets
      GROUP BY proxy_wallet
      HAVING resolved_count >= 15
      ORDER BY resolved_count DESC, winners DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await query.json();

  if (wallets.length === 0) {
    console.log('❌ NO WALLETS FOUND with 15+ resolved assets\n');
    console.log('Trying with lower threshold (10+)...\n');

    // Try again with lower threshold
    const query2 = await clickhouse.query({
      query: `
        WITH wallet_assets AS (
          SELECT DISTINCT
            proxy_wallet,
            asset_id,
            lpad(lower(hex(bitShiftRight(CAST(asset_id AS UInt256), 8))), 64, '0') as condition_id_norm,
            toUInt8(bitAnd(CAST(asset_id AS UInt256), 255)) as outcome_index
          FROM clob_fills
          WHERE timestamp >= '2023-01-01'
        ),
        resolved_assets AS (
          SELECT
            wa.proxy_wallet,
            wa.asset_id,
            wa.condition_id_norm,
            wa.outcome_index,
            r.winning_index,
            r.outcome_count,
            CASE
              WHEN r.winning_index IS NULL THEN 'open'
              WHEN r.winning_index = wa.outcome_index THEN 'winner'
              ELSE 'loser'
            END as status
          FROM wallet_assets wa
          LEFT JOIN market_resolutions_final r
            ON wa.condition_id_norm = r.condition_id_norm
        )
        SELECT
          proxy_wallet,
          count() as total_assets,
          countIf(status = 'winner') as winners,
          countIf(status = 'loser') as losers,
          countIf(status = 'open') as open,
          countIf(winning_index IS NOT NULL) as resolved_count
        FROM resolved_assets
        GROUP BY proxy_wallet
        HAVING resolved_count >= 10
        ORDER BY resolved_count DESC, winners DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const wallets2: any[] = await query2.json();

    if (wallets2.length === 0) {
      console.log('❌ Still no wallets found with 10+ resolved assets\n');
      return;
    }

    console.log('✅ Found wallets with 10+ resolved assets:\n');
    console.table(wallets2);

    const controlWallet = wallets2[0].proxy_wallet;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('CONTROL WALLET SELECTED');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Wallet: ${controlWallet}`);
    console.log(`Total assets: ${wallets2[0].total_assets}`);
    console.log(`Winners: ${wallets2[0].winners}`);
    console.log(`Losers: ${wallets2[0].losers}`);
    console.log(`Open: ${wallets2[0].open}`);
    console.log(`Resolved: ${wallets2[0].resolved_count}\n`);

    // Save to file
    fs.writeFileSync('CONTROL_WALLET.txt', controlWallet);
    console.log('💾 Saved to CONTROL_WALLET.txt\n');

    console.log('✅ Next: Run track-a-build-fixture.ts\n');
    return;
  }

  console.log('✅ Found wallets with 15+ resolved assets:\n');
  console.table(wallets);

  const controlWallet = wallets[0].proxy_wallet;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CONTROL WALLET SELECTED');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${controlWallet}`);
  console.log(`Total assets: ${wallets[0].total_assets}`);
  console.log(`Winners: ${wallets[0].winners}`);
  console.log(`Losers: ${wallets[0].losers}`);
  console.log(`Open: ${wallets[0].open}`);
  console.log(`Resolved: ${wallets[0].resolved_count}\n`);

  // Save to file
  fs.writeFileSync('CONTROL_WALLET.txt', controlWallet);
  console.log('💾 Saved to CONTROL_WALLET.txt\n');

  console.log('✅ Next: Run track-a-build-fixture.ts\n');
}

main().catch(console.error);
