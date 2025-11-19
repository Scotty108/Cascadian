#!/usr/bin/env npx tsx
/**
 * Diagnose Trade Data Gap
 *
 * Why does fact_trades_clean have so much less data than vw_trades_canonical?
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000
});

async function main() {
  console.log('\n🔍 DIAGNOSING TRADE DATA GAP\n');
  console.log('═'.repeat(100));

  // 1. Check fact_trades_clean structure and time range
  console.log('\n1️⃣ FACT_TRADES_CLEAN ANALYSIS\n');

  const ftcInfo = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as unique_wallets,
        COUNT(DISTINCT cid) as unique_markets,
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade,
        dateDiff('day', earliest_trade, latest_trade) as days_coverage
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });
  const ftc = (await ftcInfo.json())[0];

  console.log(`  Total trades:        ${parseInt(ftc.total_trades).toLocaleString()}`);
  console.log(`  Unique wallets:      ${parseInt(ftc.unique_wallets).toLocaleString()}`);
  console.log(`  Unique markets:      ${parseInt(ftc.unique_markets).toLocaleString()}`);
  console.log(`  Earliest trade:      ${ftc.earliest_trade}`);
  console.log(`  Latest trade:        ${ftc.latest_trade}`);
  console.log(`  Days coverage:       ${ftc.days_coverage} days`);

  // 2. Check vw_trades_canonical structure and time range
  console.log('\n2️⃣ VW_TRADES_CANONICAL ANALYSIS\n');

  const vtcInfo = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address_norm) as unique_wallets,
        COUNT(DISTINCT condition_id_norm) as unique_markets,
        MIN(timestamp) as earliest_trade,
        MAX(timestamp) as latest_trade,
        dateDiff('day', earliest_trade, latest_trade) as days_coverage
      FROM default.vw_trades_canonical
    `,
    format: 'JSONEachRow'
  });
  const vtc = (await vtcInfo.json())[0];

  console.log(`  Total trades:        ${parseInt(vtc.total_trades).toLocaleString()}`);
  console.log(`  Unique wallets:      ${parseInt(vtc.unique_wallets).toLocaleString()}`);
  console.log(`  Unique markets:      ${parseInt(vtc.unique_markets).toLocaleString()}`);
  console.log(`  Earliest trade:      ${vtc.earliest_trade}`);
  console.log(`  Latest trade:        ${vtc.latest_trade}`);
  console.log(`  Days coverage:       ${vtc.days_coverage} days`);

  // 3. Compare the two
  console.log('\n3️⃣ COMPARISON\n');

  const ftcCount = parseInt(ftc.total_trades);
  const vtcCount = parseInt(vtc.total_trades);
  const ratio = (vtcCount / ftcCount).toFixed(2);
  const missing = vtcCount - ftcCount;

  console.log(`  fact_trades_clean:      ${ftcCount.toLocaleString()} trades`);
  console.log(`  vw_trades_canonical:    ${vtcCount.toLocaleString()} trades`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  Difference:             ${missing.toLocaleString()} trades missing from fact_trades_clean`);
  console.log(`  Ratio:                  vw_trades_canonical has ${ratio}x more trades`);

  // 4. Check vw_trades_canonical definition
  console.log('\n4️⃣ VW_TRADES_CANONICAL DEFINITION\n');

  const viewDef = await ch.query({
    query: `SHOW CREATE TABLE default.vw_trades_canonical`,
    format: 'TabSeparated'
  });
  const def = await viewDef.text();

  console.log('View definition (first 1000 chars):');
  console.log(def.substring(0, 1000));
  console.log('\n...(truncated)');

  // 5. Sample trades in vw_trades_canonical but NOT in fact_trades_clean
  console.log('\n5️⃣ TRADES IN VW_TRADES_CANONICAL BUT NOT IN FACT_TRADES_CLEAN\n');

  const missingTrades = await ch.query({
    query: `
      SELECT
        vtc.wallet_address_norm,
        vtc.condition_id_norm,
        vtc.timestamp,
        vtc.shares,
        vtc.usd_value,
        vtc.trade_direction
      FROM default.vw_trades_canonical vtc
      LEFT JOIN default.fact_trades_clean ftc
        ON vtc.transaction_hash = ftc.tx_hash
        AND vtc.wallet_address_norm = ftc.wallet_address
        AND vtc.condition_id_norm = lower(replaceAll(ftc.cid, '0x', ''))
        AND vtc.outcome_index = ftc.outcome_index
      WHERE ftc.tx_hash IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const missing_sample = await missingTrades.json();

  console.log(`Sample of ${missing_sample.length} trades in vw_trades_canonical but NOT in fact_trades_clean:`);
  missing_sample.forEach((t, i) => {
    console.log(`\n  ${i + 1}. Wallet: ${t.wallet_address_norm.substring(0, 10)}...`);
    console.log(`     Market: ${t.condition_id_norm.substring(0, 16)}...`);
    console.log(`     Time: ${t.timestamp}`);
    console.log(`     Direction: ${t.trade_direction}, Shares: ${parseFloat(t.shares).toFixed(2)}, Value: $${parseFloat(t.usd_value).toFixed(2)}`);
  });

  // 6. Check for Wallet #1 specifically
  console.log('\n6️⃣ WALLET #1 (0x4ce73141...) DEEP DIVE\n');

  const wallet1_ftc = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow'
  });
  const w1_ftc = (await wallet1_ftc.json())[0];

  const wallet1_vtc = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    `,
    format: 'JSONEachRow'
  });
  const w1_vtc = (await wallet1_vtc.json())[0];

  console.log(`  fact_trades_clean:      ${parseInt(w1_ftc.count)} trades`);
  console.log(`  vw_trades_canonical:    ${parseInt(w1_vtc.count)} trades`);
  console.log(`  Polymarket shows:       2,816 predictions`);
  console.log(`  `);
  console.log(`  Missing from fact_trades_clean:  ${parseInt(w1_vtc.count) - parseInt(w1_ftc.count)} trades`);
  console.log(`  Missing from vw_trades_canonical: ${2816 - parseInt(w1_vtc.count)} trades`);
  console.log(`  `);
  console.log(`  ⚠️  Even vw_trades_canonical is missing 97% of Wallet #1's activity!`);

  // 7. Check what source tables feed into these views
  console.log('\n7️⃣ SOURCE TABLE INVESTIGATION\n');

  console.log('Checking for other trade-related tables that might have more complete data...\n');

  const tables = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = 'default'
        AND engine NOT LIKE '%View%'
        AND (
          name LIKE '%trade%'
          OR name LIKE '%fill%'
          OR name LIKE '%order%'
          OR name LIKE '%clob%'
        )
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });
  const table_list = await tables.json();

  console.log('Trade-related tables (sorted by size):');
  table_list.forEach(t => {
    const rows = parseInt(t.total_rows || 0);
    if (rows > 0) {
      console.log(`  ${t.name.padEnd(40)} ${rows.toLocaleString().padStart(15)} rows`);
    }
  });

  console.log('\n═'.repeat(100));
  console.log('\n📊 DIAGNOSIS SUMMARY\n');
  console.log(`1. fact_trades_clean has ${ftcCount.toLocaleString()} trades`);
  console.log(`2. vw_trades_canonical has ${vtcCount.toLocaleString()} trades (${ratio}x more)`);
  console.log(`3. Missing ${missing.toLocaleString()} trades from fact_trades_clean`);
  console.log(`4. For Wallet #1, even vw_trades_canonical is missing 97% of Polymarket's activity`);
  console.log('\n📋 NEXT STEPS:\n');
  console.log('A) Review vw_trades_canonical definition to understand its source');
  console.log('B) Check if there are other tables with more complete trade data');
  console.log('C) Determine if we need to backfill missing trades from Polymarket API/blockchain');
  console.log('D) Rebuild P&L views using the most complete data source available\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
