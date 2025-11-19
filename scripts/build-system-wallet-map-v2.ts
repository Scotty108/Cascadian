#!/usr/bin/env npx tsx
/**
 * BUILD SYSTEM WALLET MAP V2
 *
 * Improved version using paired trades in same transaction
 * Much better coverage than ERC1155-only approach
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('BUILD SYSTEM WALLET MAP V2 (Paired Trades)');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Step 1: Identify system wallets
// ============================================================================

console.log('Step 1: Identifying system wallets...');
console.log('─'.repeat(80));

const systemWalletList = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0x2d613c30614b68eada0a37d65bddf3778d981fa7',
  '0xcf3b13042cb6ceb928722b2aa5d458323b6c5107',
  '0x23786fdad0073692157c6d7dc81f281843a35fcb',
  '0xb733d4d4821c709c977adeb66b0fa8f9e41ec872',
  '0xe2025e6ad2abe425f3caa231ca72913ab97b3f01',
  '0x988e68717111080ff101b5242d491f393732e358',
  '0x1e8a3aec2e12020f06d0788cefd357c21aa29f8f',
  '0xa65e13aa5967c719418ce29a2fc9162084d59642',
];

console.log(`Using ${systemWalletList.length} known system wallets`);
console.log();

// ============================================================================
// Step 2: Drop and recreate system_wallet_map
// ============================================================================

console.log('Step 2: Recreating system_wallet_map table...');
console.log('─'.repeat(80));

try {
  await client.query({
    query: 'DROP TABLE IF EXISTS cascadian_clean.system_wallet_map',
  });

  await client.query({
    query: `
      CREATE TABLE cascadian_clean.system_wallet_map (
        tx_hash String,
        system_wallet String,
        user_wallet String,
        cid_hex String,
        direction Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3),
        shares Decimal(18, 8),
        price Decimal(18, 8),
        usdc_amount Decimal(18, 2),
        confidence Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3),
        mapping_method String
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (tx_hash, system_wallet, user_wallet, cid_hex)
    `,
  });
  console.log('✅ Table created');
} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
  await client.close();
  process.exit(1);
}

console.log();

// ============================================================================
// Step 3: Populate using paired-trade logic
// ============================================================================

console.log('Step 3: Populating mapping from paired trades...');
console.log('─'.repeat(80));

const systemWalletArray = systemWalletList.map(w => `'${w}'`).join(',');

try {
  await client.query({
    query: `
      INSERT INTO cascadian_clean.system_wallet_map
      WITH
      -- Get all wallets per transaction
      tx_wallets AS (
        SELECT
          tx_hash,
          groupArray(DISTINCT wallet_address) AS all_wallets,
          length(all_wallets) AS wallet_count
        FROM cascadian_clean.fact_trades_clean
        GROUP BY tx_hash
      )
      SELECT
        f.tx_hash,
        f.wallet_address AS system_wallet,
        -- Get the other wallet from the transaction (exclude system wallet)
        arrayElement(
          arrayFilter(w -> w != f.wallet_address, tw.all_wallets),
          1
        ) AS user_wallet,
        f.cid_hex,
        f.direction,
        f.shares,
        f.price,
        f.usdc_amount,
        -- Confidence: HIGH if exactly 2 wallets (system + user), MEDIUM if more
        multiIf(
          tw.wallet_count = 2, 'HIGH',
          tw.wallet_count > 2, 'MEDIUM',
          'LOW'
        ) AS confidence,
        multiIf(
          tw.wallet_count = 2, 'paired_trade_2wallets',
          tw.wallet_count > 2, 'paired_trade_multi',
          'single_wallet'
        ) AS mapping_method
      FROM cascadian_clean.fact_trades_clean f
      INNER JOIN tx_wallets tw
        ON tw.tx_hash = f.tx_hash
      WHERE f.wallet_address IN (${systemWalletArray})
        AND tw.wallet_count >= 2  -- Only transactions with at least 2 wallets
        AND user_wallet != ''  -- Exclude cases where we couldn't extract user wallet
    `,
  });

  console.log('✅ Mapping populated from paired trades');
} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
  await client.close();
  process.exit(1);
}

console.log();

// ============================================================================
// Step 4: Verify mapping quality
// ============================================================================

console.log('Step 4: Verifying mapping quality...');
console.log('─'.repeat(80));

try {
  const stats = await client.query({
    query: `
      SELECT
        count() AS total_mappings,
        uniqExact(tx_hash) AS unique_txs,
        uniqExact(system_wallet) AS system_wallets,
        uniqExact(user_wallet) AS unique_users,
        countIf(confidence = 'HIGH') AS high_confidence,
        countIf(confidence = 'MEDIUM') AS medium_confidence,
        countIf(confidence = 'LOW') AS low_confidence,
        round(100.0 * high_confidence / total_mappings, 2) AS high_conf_pct,
        countIf(mapping_method = 'paired_trade_2wallets') AS two_wallet_trades,
        countIf(mapping_method = 'paired_trade_multi') AS multi_wallet_trades
      FROM cascadian_clean.system_wallet_map
    `,
    format: 'JSONEachRow',
  });

  const statsData = await stats.json<Array<{
    total_mappings: number;
    unique_txs: number;
    system_wallets: number;
    unique_users: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    high_conf_pct: number;
    two_wallet_trades: number;
    multi_wallet_trades: number;
  }>>();

  const s = statsData[0];

  console.log();
  console.log('Mapping statistics:');
  console.log(`  Total mappings:          ${s.total_mappings.toLocaleString()}`);
  console.log(`  Unique transactions:     ${s.unique_txs.toLocaleString()}`);
  console.log(`  System wallets:          ${s.system_wallets.toLocaleString()}`);
  console.log(`  Unique users:            ${s.unique_users.toLocaleString()}`);
  console.log();
  console.log('Confidence distribution:');
  console.log(`  HIGH:                    ${s.high_confidence.toLocaleString()} (${s.high_conf_pct}%)`);
  console.log(`  MEDIUM:                  ${s.medium_confidence.toLocaleString()}`);
  console.log(`  LOW:                     ${s.low_confidence.toLocaleString()}`);
  console.log();
  console.log('Mapping methods:');
  console.log(`  2-wallet trades:         ${s.two_wallet_trades.toLocaleString()}`);
  console.log(`  Multi-wallet trades:     ${s.multi_wallet_trades.toLocaleString()}`);
  console.log();

  // Coverage check
  const coverage = await client.query({
    query: `
      WITH system_trades AS (
        SELECT count() AS total
        FROM cascadian_clean.fact_trades_clean
        WHERE wallet_address IN (${systemWalletArray})
      )
      SELECT
        (SELECT total FROM system_trades) AS total_system_trades,
        (SELECT count() FROM cascadian_clean.system_wallet_map) AS mapped_trades,
        round(100.0 * mapped_trades / total_system_trades, 2) AS coverage_pct
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json<Array<{
    total_system_trades: number;
    mapped_trades: number;
    coverage_pct: number;
  }>>();

  const c = coverageData[0];

  console.log('Coverage:');
  console.log(`  Total system trades:     ${c.total_system_trades.toLocaleString()}`);
  console.log(`  Mapped trades:           ${c.mapped_trades.toLocaleString()}`);
  console.log(`  Coverage:                ${c.coverage_pct}%`);
  console.log();

} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
}

// ============================================================================
// Step 5: Sample mappings
// ============================================================================

console.log('Step 5: Sample mappings for 0x4bfb...');
console.log('─'.repeat(80));

try {
  const sample = await client.query({
    query: `
      SELECT
        tx_hash,
        system_wallet,
        user_wallet,
        cid_hex,
        direction,
        toFloat64(shares) AS shares,
        toFloat64(price) AS price,
        confidence,
        mapping_method
      FROM cascadian_clean.system_wallet_map
      WHERE system_wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await sample.json<Array<{
    tx_hash: string;
    system_wallet: string;
    user_wallet: string;
    cid_hex: string;
    direction: string;
    shares: number;
    price: number;
    confidence: string;
    mapping_method: string;
  }>>();

  console.log();
  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. TX: ${row.tx_hash.substring(0, 16)}...`);
    console.log(`   User:       ${row.user_wallet.substring(0, 12)}...`);
    console.log(`   Direction:  ${row.direction} | ${row.shares.toFixed(2)} shares @ $${row.price.toFixed(4)}`);
    console.log(`   Confidence: ${row.confidence} (${row.mapping_method})`);
    console.log();
  });

} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
}

console.log('═'.repeat(80));
console.log('SYSTEM WALLET MAP V2 READY');
console.log('═'.repeat(80));
console.log();
console.log('Next steps:');
console.log('  1. Update PnL views to use new mapping');
console.log('  2. Test wallet PnL against Polymarket UI');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
