#!/usr/bin/env npx tsx
/**
 * IDENTIFY SYSTEM WALLETS
 *
 * Find Polymarket infrastructure wallets (relayers, venues) that pollute user metrics
 * Criteria: High trade count + low CID variety = infrastructure
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
console.log('IDENTIFY SYSTEM WALLETS');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q1: Top wallets by trade count
// ============================================================================

console.log('Q1: Top 20 wallets by trade count');
console.log('─'.repeat(80));

try {
  const topWallets = await client.query({
    query: `
      SELECT
        wallet_address,
        count() AS trade_count,
        uniqExact(cid_hex) AS unique_markets,
        uniqExact(tx_hash) AS unique_txs,
        round(100.0 * trade_count / (SELECT count() FROM cascadian_clean.fact_trades_clean), 2) AS pct_of_total,
        round(trade_count / nullIf(unique_markets, 0), 2) AS trades_per_market
      FROM cascadian_clean.fact_trades_clean
      GROUP BY wallet_address
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const topData = await topWallets.json<Array<{
    wallet_address: string;
    trade_count: number;
    unique_markets: number;
    unique_txs: number;
    pct_of_total: number;
    trades_per_market: number;
  }>>();

  console.log();
  console.log('Top 20 wallets:');
  console.log();
  topData.forEach((row, i) => {
    const flag = row.trades_per_market > 1000 ? '🚨 SYSTEM' : row.trades_per_market > 100 ? '⚠️  BOT?' : '';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${row.wallet_address}`);
    console.log(`      Trades: ${row.trade_count.toLocaleString().padStart(10)} (${row.pct_of_total}% of total)`);
    console.log(`      Markets: ${row.unique_markets.toLocaleString().padStart(9)} | Trades/Market: ${row.trades_per_market.toLocaleString()} ${flag}`);
    console.log();
  });

  const systemWallets = topData.filter(r => r.trades_per_market > 1000);
  console.log(`Identified ${systemWallets.length} likely system wallets (>1000 trades/market)`);
  console.log();

} catch (error: any) {
  console.error('❌ Q1 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q2: Check specific suspicious wallet
// ============================================================================

console.log('Q2: Deep dive on 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e');
console.log('─'.repeat(80));

try {
  const suspectWallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  const analysis = await client.query({
    query: `
      SELECT
        count() AS total_trades,
        uniqExact(cid_hex) AS unique_markets,
        uniqExact(tx_hash) AS unique_txs,
        uniqExact(direction) AS unique_directions,
        groupArray(DISTINCT direction) AS directions,
        min(block_time) AS first_trade,
        max(block_time) AS last_trade
      FROM cascadian_clean.fact_trades_clean
      WHERE wallet_address = '${suspectWallet}'
    `,
    format: 'JSONEachRow',
  });

  const suspectData = await analysis.json<Array<{
    total_trades: number;
    unique_markets: number;
    unique_txs: number;
    unique_directions: number;
    directions: string[];
    first_trade: string;
    last_trade: string;
  }>>();

  const s = suspectData[0];

  console.log();
  console.log(`Analysis of ${suspectWallet}:`);
  console.log(`  Total trades:        ${s.total_trades.toLocaleString()}`);
  console.log(`  Unique markets:      ${s.unique_markets.toLocaleString()}`);
  console.log(`  Unique txs:          ${s.unique_txs.toLocaleString()}`);
  console.log(`  Trades per market:   ${(s.total_trades / s.unique_markets).toFixed(0)}`);
  console.log(`  Directions:          ${s.directions.join(', ')}`);
  console.log(`  First trade:         ${s.first_trade}`);
  console.log(`  Last trade:          ${s.last_trade}`);
  console.log();

  if (s.total_trades / s.unique_markets > 1000) {
    console.log('🚨 CONFIRMED SYSTEM WALLET');
    console.log('   This is infrastructure (relayer/venue), not a human trader');
  }
  console.log();

} catch (error: any) {
  console.error('❌ Q2 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q3: Can we find real users in trades_raw_enriched_final?
// ============================================================================

console.log('Q3: Check if trades_raw_enriched_final has counterparty data');
console.log('─'.repeat(80));

try {
  const schema = await client.query({
    query: 'DESCRIBE default.trades_raw_enriched_final',
    format: 'JSONEachRow',
  });

  const columns = await schema.json<Array<{ name: string; type: string }>>();

  console.log();
  console.log('Checking for counterparty columns:');
  const relevantCols = columns.filter(c =>
    c.name.includes('maker') ||
    c.name.includes('taker') ||
    c.name.includes('wallet') ||
    c.name.includes('user')
  );

  if (relevantCols.length > 0) {
    console.log('✅ Found counterparty columns:');
    relevantCols.forEach(c => {
      console.log(`  - ${c.name} (${c.type})`);
    });
  } else {
    console.log('⚠️  No obvious counterparty columns found');
    console.log('   May need to use trade_direction_assignments or other source');
  }
  console.log();

} catch (error: any) {
  console.error('❌ Q3 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q4: Sample transaction to see structure
// ============================================================================

console.log('Q4: Sample transaction structure');
console.log('─'.repeat(80));

try {
  const suspectWallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  const sample = await client.query({
    query: `
      SELECT
        f.tx_hash,
        f.wallet_address AS fact_wallet,
        f.cid_hex,
        t.wallet_address AS tref_wallet,
        t.market_id
      FROM cascadian_clean.fact_trades_clean f
      LEFT JOIN default.trades_raw_enriched_final t
        ON t.transaction_hash = f.tx_hash
       AND t.wallet_address = f.wallet_address
      WHERE f.wallet_address = '${suspectWallet}'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await sample.json<Array<{
    tx_hash: string;
    fact_wallet: string;
    cid_hex: string;
    tref_wallet: string;
    market_id: string;
  }>>();

  console.log();
  console.log('Sample transactions:');
  sampleData.forEach((row, i) => {
    console.log(`  ${i + 1}. TX: ${row.tx_hash.substring(0, 16)}...`);
    console.log(`     FACT wallet: ${row.fact_wallet}`);
    console.log(`     TREF wallet: ${row.tref_wallet || 'NULL'}`);
    console.log(`     Market ID:   ${row.market_id || 'NULL'}`);
  });
  console.log();

} catch (error: any) {
  console.error('❌ Q4 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log();
console.log('Next steps:');
console.log('  1. Create system_wallets table with identified infrastructure addresses');
console.log('  2. Find mapping to real users (check trade_direction_assignments)');
console.log('  3. Create remapped PnL views that exclude/replace system wallets');
console.log('  4. Verify against Polymarket UI');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
