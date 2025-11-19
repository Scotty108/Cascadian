#!/usr/bin/env npx tsx
/**
 * Check if vw_trades_canonical has duplicates
 *
 * Investigate why it has 2.5x more trades than fact_trades_clean
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
  console.log('\n🔍 CHECKING VW_TRADES_CANONICAL FOR DUPLICATES\n');
  console.log('═'.repeat(100));

  // 1. Check uniqueness by trade_key
  console.log('\n1️⃣ CHECK TRADE_KEY UNIQUENESS\n');

  const tradeKeyCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT trade_key) as unique_trade_keys,
        total_rows - unique_trade_keys as duplicates
      FROM default.vw_trades_canonical
    `,
    format: 'JSONEachRow'
  });
  const tkc = (await tradeKeyCheck.json())[0];

  console.log(`  Total rows:          ${parseInt(tkc.total_rows).toLocaleString()}`);
  console.log(`  Unique trade_keys:   ${parseInt(tkc.unique_trade_keys).toLocaleString()}`);
  console.log(`  Duplicates:          ${parseInt(tkc.duplicates).toLocaleString()}`);

  if (parseInt(tkc.duplicates) > 0) {
    console.log(`  ⚠️  ${((parseInt(tkc.duplicates) / parseInt(tkc.total_rows)) * 100).toFixed(2)}% of rows are duplicates!`);
  } else {
    console.log(`  ✅ No duplicates by trade_key`);
  }

  // 2. Check uniqueness by transaction_hash
  console.log('\n2️⃣ CHECK TRANSACTION_HASH UNIQUENESS\n');

  const txHashCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT transaction_hash) as unique_tx_hashes,
        total_rows - unique_tx_hashes as duplicates
      FROM default.vw_trades_canonical
    `,
    format: 'JSONEachRow'
  });
  const thc = (await txHashCheck.json())[0];

  console.log(`  Total rows:          ${parseInt(thc.total_rows).toLocaleString()}`);
  console.log(`  Unique tx_hashes:    ${parseInt(thc.unique_tx_hashes).toLocaleString()}`);
  console.log(`  Duplicates:          ${parseInt(thc.duplicates).toLocaleString()}`);
  console.log(`  Avg rows per tx:     ${(parseInt(thc.total_rows) / parseInt(thc.unique_tx_hashes)).toFixed(2)}`);

  if (parseInt(thc.duplicates) > 0) {
    const ratio = parseInt(thc.total_rows) / parseInt(thc.unique_tx_hashes);
    console.log(`  ⚠️  Each transaction has ${ratio.toFixed(2)} rows on average`);
    if (ratio >= 2.4 && ratio <= 2.6) {
      console.log(`  💡 This could explain the 2.49x ratio! Each trade might have ~2.5 rows`);
    }
  }

  // 3. Sample duplicate transaction hashes
  console.log('\n3️⃣ SAMPLE DUPLICATE TRANSACTIONS\n');

  const duplicateSample = await ch.query({
    query: `
      WITH tx_counts AS (
        SELECT
          transaction_hash,
          COUNT(*) as row_count
        FROM default.vw_trades_canonical
        GROUP BY transaction_hash
        HAVING row_count > 1
        ORDER BY row_count DESC
        LIMIT 5
      )
      SELECT
        vtc.transaction_hash,
        vtc.wallet_address_norm,
        vtc.trade_direction,
        vtc.shares,
        vtc.usd_value,
        vtc.outcome_index,
        vtc.timestamp
      FROM default.vw_trades_canonical vtc
      INNER JOIN tx_counts tc ON vtc.transaction_hash = tc.transaction_hash
      ORDER BY vtc.transaction_hash, vtc.outcome_index
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samples = await duplicateSample.json();

  console.log('Sample transactions with multiple rows:\n');

  let currentTx = '';
  let txCount = 0;
  samples.forEach((row, idx) => {
    if (row.transaction_hash !== currentTx) {
      if (currentTx) console.log('');
      currentTx = row.transaction_hash;
      txCount++;
      console.log(`  Transaction ${txCount}: ${row.transaction_hash.substring(0, 10)}... (${row.timestamp})`);
    }
    console.log(`    ${idx + 1}. Wallet: ${row.wallet_address_norm.substring(0, 10)}... | ${row.trade_direction} | Outcome ${row.outcome_index} | Shares: ${parseFloat(row.shares).toFixed(2)} | $${parseFloat(row.usd_value).toFixed(2)}`);
  });

  // 4. Compare with fact_trades_clean for same transaction
  console.log('\n4️⃣ COMPARE WITH FACT_TRADES_CLEAN\n');

  if (samples.length > 0) {
    const sampleTx = samples[0].transaction_hash;
    console.log(`Checking transaction: ${sampleTx.substring(0, 16)}...\n`);

    const vtcRows = await ch.query({
      query: `
        SELECT COUNT(*) as count
        FROM default.vw_trades_canonical
        WHERE transaction_hash = '${sampleTx}'
      `,
      format: 'JSONEachRow'
    });
    const vtcCount = (await vtcRows.json())[0];

    const ftcRows = await ch.query({
      query: `
        SELECT COUNT(*) as count
        FROM default.fact_trades_clean
        WHERE tx_hash = '${sampleTx}'
      `,
      format: 'JSONEachRow'
    });
    const ftcCount = (await ftcRows.json())[0];

    console.log(`  vw_trades_canonical rows:  ${ftcCount.count}`);
    console.log(`  fact_trades_clean rows:    ${vtcCount.count}`);
    console.log(`  Ratio:                     ${(parseInt(vtcCount.count) / parseInt(ftcCount.count)).toFixed(2)}x`);
  }

  // 5. Check granularity differences
  console.log('\n5️⃣ GRANULARITY ANALYSIS\n');

  const granularity = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_fact_trades,
        COUNT(DISTINCT tx_hash) as unique_tx_hashes_in_fact,
        total_fact_trades / unique_tx_hashes_in_fact as avg_rows_per_tx_in_fact
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });
  const gran = (await granularity.json())[0];

  console.log(`fact_trades_clean:`);
  console.log(`  Total rows:          ${parseInt(gran.total_fact_trades).toLocaleString()}`);
  console.log(`  Unique tx_hashes:    ${parseInt(gran.unique_tx_hashes_in_fact).toLocaleString()}`);
  console.log(`  Avg rows per tx:     ${parseFloat(gran.avg_rows_per_tx_in_fact).toFixed(2)}\n`);

  console.log(`vw_trades_canonical:`);
  console.log(`  Total rows:          ${parseInt(thc.total_rows).toLocaleString()}`);
  console.log(`  Unique tx_hashes:    ${parseInt(thc.unique_tx_hashes).toLocaleString()}`);
  console.log(`  Avg rows per tx:     ${(parseInt(thc.total_rows) / parseInt(thc.unique_tx_hashes)).toFixed(2)}`);

  console.log('\n═'.repeat(100));
  console.log('\n📊 CONCLUSION\n');

  const vtcPerTx = parseInt(thc.total_rows) / parseInt(thc.unique_tx_hashes);
  const ftcPerTx = parseFloat(gran.avg_rows_per_tx_in_fact);
  const ratio = vtcPerTx / ftcPerTx;

  console.log(`vw_trades_canonical has ${vtcPerTx.toFixed(2)} rows per transaction`);
  console.log(`fact_trades_clean has ${ftcPerTx.toFixed(2)} rows per transaction`);
  console.log(`Ratio: ${ratio.toFixed(2)}x\n`);

  if (ratio >= 2.4 && ratio <= 2.6) {
    console.log('💡 LIKELY EXPLANATION:');
    console.log('   vw_trades_canonical stores ~2.5 rows per transaction');
    console.log('   This matches the 2.49x overall ratio');
    console.log('   Possible reasons:');
    console.log('     - Each trade split into BUY and SELL legs');
    console.log('     - USDC transfer + token transfer = 2 rows');
    console.log('     - Multi-outcome positions recorded separately\n');
  }

  console.log('📋 RECOMMENDATION:\n');
  if (parseInt(tkc.duplicates) === 0) {
    console.log('✅ vw_trades_canonical has unique trade_keys (no duplicates)');
    console.log('✅ Safe to use as source for P&L calculations');
    console.log('⚠️  BUT: Need to understand granularity difference vs fact_trades_clean');
    console.log('   To avoid double-counting, ensure we aggregate properly by wallet+market+outcome\n');
  } else {
    console.log('❌ vw_trades_canonical HAS DUPLICATES');
    console.log('⚠️  Need to deduplicate before using for P&L calculations\n');
  }

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
