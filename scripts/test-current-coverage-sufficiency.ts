#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function testCoverageSufficiency() {
  console.log('\n🎯 TESTING: Is Current Coverage Sufficient for PnL Calculations?');
  console.log('='.repeat(80));
  console.log('Goal: ≥95% coverage for accurate win rate, omega ratio, ROI, PnL by category\n');

  // Test Top 10 Wallets
  console.log('📊 PART 1: Coverage Test for Top 10 Wallets');
  console.log('='.repeat(80));

  const walletCoverage = await client.query({
    query: `
      WITH raw_wallet_txs AS (
        SELECT
          wallet_address,
          count(DISTINCT transaction_hash) as txs_in_raw
        FROM trades_raw
        WHERE transaction_hash != ''
          AND length(transaction_hash) = 66
        GROUP BY wallet_address
        ORDER BY txs_in_raw DESC
        LIMIT 10
      ),
      direction_wallet_txs AS (
        SELECT
          wallet_address,
          count(DISTINCT tx_hash) as txs_in_direction
        FROM trades_with_direction
        GROUP BY wallet_address
      )
      SELECT
        r.wallet_address,
        r.txs_in_raw,
        COALESCE(d.txs_in_direction, 0) as txs_in_direction,
        COALESCE(d.txs_in_direction, 0) * 100.0 / r.txs_in_raw as coverage_pct,
        r.txs_in_raw - COALESCE(d.txs_in_direction, 0) as missing_txs
      FROM raw_wallet_txs r
      LEFT JOIN direction_wallet_txs d ON r.wallet_address = d.wallet_address
      ORDER BY r.txs_in_raw DESC
    `,
    format: 'JSONEachRow',
  });
  const wallets = await walletCoverage.json();

  let sufficientCount = 0;
  let insufficientCount = 0;

  wallets.forEach((w: any, i: number) => {
    const coverage = parseFloat(w.coverage_pct);
    const status = coverage >= 95 ? '✅' : '❌';

    if (coverage >= 95) sufficientCount++;
    else insufficientCount++;

    console.log(`\n${i+1}. ${status} Wallet: ${w.wallet_address}`);
    console.log(`   trades_raw: ${parseInt(w.txs_in_raw).toLocaleString()} txs`);
    console.log(`   trades_with_direction: ${parseInt(w.txs_in_direction).toLocaleString()} txs`);
    console.log(`   Coverage: ${coverage.toFixed(1)}%`);

    if (coverage < 95) {
      console.log(`   ❌ MISSING: ${parseInt(w.missing_txs).toLocaleString()} transactions (${(100 - coverage).toFixed(1)}% gap)`);
    }
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Top 10 Wallets Summary:`);
  console.log(`  ✅ Sufficient coverage (≥95%): ${sufficientCount}`);
  console.log(`  ❌ Insufficient coverage (<95%): ${insufficientCount}`);

  if (insufficientCount === 0) {
    console.log(`\n🎉 EXCELLENT! All top 10 wallets have ≥95% coverage!`);
    console.log(`   You can calculate accurate PnL metrics NOW!\n`);
  } else {
    console.log(`\n❌ INSUFFICIENT COVERAGE for ${insufficientCount} wallets!`);
    console.log(`   Cannot calculate accurate PnL until coverage gaps are filled.\n`);
  }

  // Global Coverage Test
  console.log('\n📊 PART 2: Overall Coverage Statistics');
  console.log('='.repeat(80));

  const globalCoverage = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count(DISTINCT transaction_hash) as unique_txs,
        count(*) as total_rows
      FROM trades_raw
      WHERE transaction_hash != '' AND length(transaction_hash) = 66

      UNION ALL

      SELECT
        'trades_with_direction' as source,
        count(DISTINCT tx_hash) as unique_txs,
        count(*) as total_rows
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const globalData = await globalCoverage.json();

  const rawTxs = parseInt((globalData.find((r: any) => r.source === 'trades_raw') as any).unique_txs);
  const directionTxs = parseInt((globalData.find((r: any) => r.source === 'trades_with_direction') as any).unique_txs);

  console.log(`\ntrades_raw: ${rawTxs.toLocaleString()} unique transactions`);
  console.log(`trades_with_direction: ${directionTxs.toLocaleString()} unique transactions`);
  console.log(`\nGlobal coverage: ${(directionTxs * 100.0 / rawTxs).toFixed(1)}%`);

  if (directionTxs > rawTxs) {
    console.log(`\n✅ trades_with_direction has MORE transactions than trades_raw!`);
    console.log(`   Extra: ${(directionTxs - rawTxs).toLocaleString()} transactions`);
  }

  // Quality Check
  console.log('\n📊 PART 3: Data Quality Check');
  console.log('='.repeat(80));

  const qualityCheck = await client.query({
    query: `
      SELECT
        count(*) as total_rows,
        countIf(condition_id_norm != '' AND length(condition_id_norm) >= 64) as has_condition_id,
        has_condition_id * 100.0 / total_rows as condition_id_pct,

        countIf(market_id != '' AND market_id != '12' AND length(market_id) >= 20) as has_market_id,
        has_market_id * 100.0 / total_rows as market_id_pct
      FROM trades_with_direction
    `,
    format: 'JSONEachRow',
  });
  const quality: any = (await qualityCheck.json())[0];

  console.log(`\nData quality in trades_with_direction:`);
  console.log(`  Total rows: ${parseInt(quality.total_rows).toLocaleString()}`);
  console.log(`  Has valid condition_id: ${parseInt(quality.has_condition_id).toLocaleString()} (${parseFloat(quality.condition_id_pct).toFixed(1)}%)`);
  console.log(`  Has valid market_id: ${parseInt(quality.has_market_id).toLocaleString()} (${parseFloat(quality.market_id_pct).toFixed(1)}%)`);

  if (parseFloat(quality.condition_id_pct) >= 95) {
    console.log(`\n✅ EXCELLENT data quality!`);
  } else {
    console.log(`\n⚠️  Data quality needs improvement`);
  }

  // Final Verdict
  console.log('\n\n📊 FINAL VERDICT');
  console.log('='.repeat(80));

  if (insufficientCount === 0 && parseFloat(quality.condition_id_pct) >= 95) {
    console.log('✅ STATUS: Current coverage IS SUFFICIENT');
    console.log('✅ ACTION: You can calculate PnL metrics NOW');
    console.log('✅ QUALITY: ≥95% of trades have valid condition_ids');
    console.log('✅ RECOMMENDATION: Proceed with PnL calculations\n');
  } else if (insufficientCount > 0) {
    console.log('❌ STATUS: Current coverage is INSUFFICIENT');
    console.log(`❌ PROBLEM: ${insufficientCount}/10 top wallets have <95% coverage`);
    console.log('❌ IMPACT: Cannot calculate accurate PnL metrics');
    console.log('❌ RECOMMENDATION: Need to recover missing transaction data\n');
  } else if (parseFloat(quality.condition_id_pct) < 95) {
    console.log('⚠️  STATUS: Coverage OK but data quality needs improvement');
    console.log('⚠️  PROBLEM: Too many trades missing condition_ids');
    console.log('⚠️  RECOMMENDATION: Recover condition_ids before calculating PnL\n');
  }

  await client.close();
}

testCoverageSufficiency().catch(console.error);
