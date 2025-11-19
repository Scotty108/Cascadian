#!/usr/bin/env npx tsx
/**
 * BUILD SYSTEM WALLET MAP
 *
 * Create mapping table from infrastructure wallets to real user counterparties
 * Uses ERC1155 transfer from/to addresses to identify human traders
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
console.log('BUILD SYSTEM WALLET MAP');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Step 1: Identify system wallets (>1000 trades/market OR >5% total volume)
// ============================================================================

console.log('Step 1: Identifying system wallets...');
console.log('─'.repeat(80));

try {
  const systemWallets = await client.query({
    query: `
      WITH
      total_trades AS (SELECT count() AS total FROM cascadian_clean.fact_trades_clean),
      wallet_stats AS (
        SELECT
          wallet_address,
          count() AS trade_count,
          uniqExact(cid_hex) AS unique_markets,
          round(trade_count / nullIf(unique_markets, 0), 2) AS trades_per_market,
          round(100.0 * trade_count / (SELECT total FROM total_trades), 2) AS pct_of_total
        FROM cascadian_clean.fact_trades_clean
        GROUP BY wallet_address
      )
      SELECT
        wallet_address,
        trade_count,
        unique_markets,
        trades_per_market,
        pct_of_total
      FROM wallet_stats
      WHERE trades_per_market > 1000 OR pct_of_total > 5.0
      ORDER BY pct_of_total DESC
    `,
    format: 'JSONEachRow',
  });

  const systemWalletList = await systemWallets.json<Array<{
    wallet_address: string;
    trade_count: number;
    unique_markets: number;
    trades_per_market: number;
    pct_of_total: number;
  }>>();

  console.log();
  console.log(`Found ${systemWalletList.length} system wallets:`);
  systemWalletList.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_address}`);
    console.log(`     ${w.trade_count.toLocaleString()} trades | ${w.unique_markets.toLocaleString()} markets | ${w.trades_per_market} trades/market | ${w.pct_of_total}% of total`);
  });
  console.log();

  // ============================================================================
  // Step 2: Create system_wallet_map table with counterparty attribution
  // ============================================================================

  console.log('Step 2: Creating system_wallet_map table...');
  console.log('─'.repeat(80));

  const systemWalletArray = systemWalletList.map(w => `'${w.wallet_address}'`).join(',');

  await client.query({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.system_wallet_map (
        tx_hash String,
        system_wallet String,
        user_wallet String,
        cid_hex String,
        direction Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3),
        token_id String,
        transfer_value UInt256,
        confidence Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3),
        mapping_method String
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (tx_hash, system_wallet, user_wallet)
    `,
  });
  console.log('✅ Table created');

  // ============================================================================
  // Step 3: Populate with ERC1155-based mapping
  // ============================================================================

  console.log();
  console.log('Step 3: Populating mapping from ERC1155 transfers...');
  console.log('─'.repeat(80));

  await client.query({
    query: `
      INSERT INTO cascadian_clean.system_wallet_map
      SELECT
        f.tx_hash,
        f.wallet_address AS system_wallet,
        -- For BUY: system wallet received tokens, so counterparty is who sent TO system_wallet
        -- For SELL: system wallet sent tokens, so counterparty is who received FROM system_wallet
        multiIf(
          f.direction = 'BUY' AND e.to_address = f.wallet_address, e.from_address,
          f.direction = 'SELL' AND e.from_address = f.wallet_address, e.to_address,
          '' -- Unknown case
        ) AS user_wallet,
        f.cid_hex,
        f.direction,
        e.token_id,
        e.value AS transfer_value,
        -- Confidence: HIGH if direction matches transfer pattern, MEDIUM otherwise
        multiIf(
          f.direction = 'BUY' AND e.to_address = f.wallet_address AND e.from_address != '', 'HIGH',
          f.direction = 'SELL' AND e.from_address = f.wallet_address AND e.to_address != '', 'HIGH',
          'MEDIUM'
        ) AS confidence,
        'erc1155_transfer' AS mapping_method
      FROM cascadian_clean.fact_trades_clean f
      INNER JOIN default.erc1155_transfers e
        ON e.tx_hash = f.tx_hash
      WHERE f.wallet_address IN (${systemWalletArray})
        AND (
          (f.direction = 'BUY' AND e.to_address = f.wallet_address)
          OR (f.direction = 'SELL' AND e.from_address = f.wallet_address)
        )
        AND e.from_address != e.to_address  -- Exclude self-transfers
        AND e.value > 0
    `,
  });

  console.log('✅ Mapping populated from ERC1155 transfers');

  // ============================================================================
  // Step 4: Verify mapping quality
  // ============================================================================

  console.log();
  console.log('Step 4: Verifying mapping quality...');
  console.log('─'.repeat(80));

  const stats = await client.query({
    query: `
      SELECT
        count() AS total_mappings,
        uniqExact(tx_hash) AS unique_txs,
        uniqExact(system_wallet) AS system_wallets,
        uniqExact(user_wallet) AS unique_users,
        countIf(confidence = 'HIGH') AS high_confidence,
        countIf(confidence = 'MEDIUM') AS medium_confidence,
        round(100.0 * high_confidence / total_mappings, 2) AS high_conf_pct
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
    high_conf_pct: number;
  }>>();

  const s = statsData[0];

  console.log();
  console.log('Mapping statistics:');
  console.log(`  Total mappings:      ${s.total_mappings.toLocaleString()}`);
  console.log(`  Unique transactions: ${s.unique_txs.toLocaleString()}`);
  console.log(`  System wallets:      ${s.system_wallets.toLocaleString()}`);
  console.log(`  Unique users:        ${s.unique_users.toLocaleString()}`);
  console.log(`  HIGH confidence:     ${s.high_confidence.toLocaleString()} (${s.high_conf_pct}%)`);
  console.log(`  MEDIUM confidence:   ${s.medium_confidence.toLocaleString()}`);
  console.log();

  // ============================================================================
  // Step 5: Sample mappings for validation
  // ============================================================================

  console.log('Step 5: Sample mappings for 0x4bfb...');
  console.log('─'.repeat(80));

  const sample = await client.query({
    query: `
      SELECT
        tx_hash,
        system_wallet,
        user_wallet,
        cid_hex,
        direction,
        confidence
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
    confidence: string;
  }>>();

  console.log();
  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. TX: ${row.tx_hash.substring(0, 16)}... | Direction: ${row.direction} | Confidence: ${row.confidence}`);
    console.log(`   System: ${row.system_wallet.substring(0, 12)}...`);
    console.log(`   User:   ${row.user_wallet.substring(0, 12)}...`);
    console.log();
  });

} catch (error: any) {
  console.error(`❌ Failed: ${error?.message || error}`);
  await client.close();
  process.exit(1);
}

console.log('═'.repeat(80));
console.log('SYSTEM WALLET MAP READY');
console.log('═'.repeat(80));
console.log();
console.log('Table created:');
console.log('  ✅ cascadian_clean.system_wallet_map');
console.log();
console.log('Next steps:');
console.log('  1. Update PnL views to use remapped wallets');
console.log('  2. Re-run wallet PnL for known wallets');
console.log('  3. Verify against Polymarket UI');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
