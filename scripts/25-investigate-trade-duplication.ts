import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateTradeDuplication() {
  console.log('=== Investigating Trade Count Discrepancy ===\n');

  // Count in vw_trades_canonical
  const vwCountQuery = `
    SELECT
      count() AS total_rows,
      count(DISTINCT transaction_hash) AS unique_txs,
      count(DISTINCT trade_key) AS unique_trade_keys
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('${EOA}')
  `;

  const vwResult = await clickhouse.query({ query: vwCountQuery, format: 'JSONEachRow' });
  const vwData = await vwResult.json<any[]>();

  console.log('vw_trades_canonical:');
  console.log(`  Total rows: ${vwData[0].total_rows}`);
  console.log(`  Unique transactions: ${vwData[0].unique_txs}`);
  console.log(`  Unique trade_keys: ${vwData[0].unique_trade_keys}`);
  console.log('');

  // Count in pm_trades_canonical_v3
  const v3CountQuery = `
    SELECT
      count() AS total_rows,
      count(DISTINCT transaction_hash) AS unique_txs,
      count(DISTINCT trade_key) AS unique_trade_keys
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const v3Result = await clickhouse.query({ query: v3CountQuery, format: 'JSONEachRow' });
  const v3Data = await v3Result.json<any[]>();

  console.log('pm_trades_canonical_v3:');
  console.log(`  Total rows: ${v3Data[0].total_rows}`);
  console.log(`  Unique transactions: ${v3Data[0].unique_txs}`);
  console.log(`  Unique trade_keys: ${v3Data[0].unique_trade_keys}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const vwRows = Number(vwData[0].total_rows);
  const v3Rows = Number(v3Data[0].total_rows);
  const diff = vwRows - v3Rows;

  console.log(`Row count difference: ${diff} (${vwRows} - ${v3Rows})`);
  console.log('');

  // Check for duplicates in vw_trades_canonical
  const dupQuery = `
    SELECT
      transaction_hash,
      count() AS row_count
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('${EOA}')
    GROUP BY transaction_hash
    HAVING row_count > 1
    ORDER BY row_count DESC
    LIMIT 10
  `;

  const dupResult = await clickhouse.query({ query: dupQuery, format: 'JSONEachRow' });
  const dups = await dupResult.json<any[]>();

  if (dups.length > 0) {
    console.log('Transactions with multiple rows in vw_trades_canonical:');
    dups.forEach((dup, i) => {
      console.log(`  [${i + 1}] ${dup.transaction_hash}: ${dup.row_count} rows`);
    });
    console.log('');

    // Sample one duplicate transaction to see what's different
    const sampleTx = dups[0].transaction_hash;
    const sampleQuery = `
      SELECT
        trade_id,
        trade_key,
        transaction_hash,
        condition_id_norm,
        outcome_index,
        trade_direction,
        shares,
        usd_value
      FROM vw_trades_canonical
      WHERE transaction_hash = '${sampleTx}'
        AND lower(wallet_address_norm) = lower('${EOA}')
    `;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json<any[]>();

    console.log(`Sample transaction with ${samples.length} rows:`);
    samples.forEach((s, i) => {
      console.log(`  [${i + 1}] trade_id: ${s.trade_id}`);
      console.log(`      ${s.trade_direction} | ${Number(s.shares)} shares @ $${Number(s.usd_value)}`);
    });
    console.log('');
  } else {
    console.log('No duplicate transactions found in vw_trades_canonical');
    console.log('');
  }

  // KEY QUESTION: Are the 1,384 vs 780 counts using different aggregation?
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('KEY FINDING:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('The "1,384 vs 780" discrepancy from earlier was likely:');
  console.log('  - vw_trades_canonical: Total ROWS (includes maker/taker duplicates)');
  console.log('  - pm_trades_canonical_v3: Total ROWS');
  console.log('');
  console.log('But when we check UNIQUE transactions:');
  console.log(`  - vw_trades_canonical: ${vwData[0].unique_txs} unique txs`);
  console.log(`  - pm_trades_canonical_v3: ${v3Data[0].unique_txs} unique txs`);
  console.log(`  - Difference: ${Number(vwData[0].unique_txs) - Number(v3Data[0].unique_txs)} missing txs`);
  console.log('');

  if (Number(vwData[0].unique_txs) === Number(v3Data[0].unique_txs)) {
    console.log('✅ NO MISSING TRANSACTIONS! The tables have the same unique trades.');
    console.log('   The 604 "missing" trades were just duplicate rows (maker/taker sides).');
    console.log('');
    console.log('   This means the PnL calculation is ALREADY using complete data!');
    console.log('   The error is NOT from missing trades.');
    console.log('');
  } else {
    console.log(`⚠️  Still missing ${Number(vwData[0].unique_txs) - Number(v3Data[0].unique_txs)} unique transactions.`);
    console.log('   Need to patch these.');
    console.log('');
  }
}

investigateTradeDuplication().catch(console.error);
