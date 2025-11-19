#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function investigateEmptyCID() {
  console.log('🔍 Investigating Empty CID Issues...\n');

  // 1. Global empty CID stats
  console.log('Step 1: Analyzing empty condition_id globally...');
  const globalResult = await clickhouse.query({
    query: `
      SELECT
        count() AS empty_cid_trades,
        sum(usd_value) AS empty_cid_volume,
        round(100.0 * empty_cid_trades / (SELECT count() FROM pm_trades_canonical_v3), 2) AS pct_of_total,
        count(DISTINCT wallet_address) AS affected_wallets,
        count(DISTINCT toYYYYMM(timestamp)) AS affected_months,
        count(DISTINCT source) AS sources,
        groupUniqArray(source) AS source_list
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 IS NULL
         OR condition_id_norm_v3 = ''
         OR length(condition_id_norm_v3) != 64
    `,
    format: 'JSONEachRow'
  });
  const globalStats = (await globalResult.json<any>())[0];

  console.log('\n📊 Global Empty CID Statistics:');
  console.log(`Empty CID trades: ${globalStats.empty_cid_trades.toLocaleString()}`);
  console.log(`Empty CID volume: $${Math.round(globalStats.empty_cid_volume).toLocaleString()}`);
  console.log(`Percentage of total: ${globalStats.pct_of_total}%`);
  console.log(`Affected wallets: ${globalStats.affected_wallets.toLocaleString()}`);
  console.log(`Affected months: ${globalStats.affected_months}`);
  console.log(`Sources: ${globalStats.source_list.join(', ')}`);

  // 2. Monthly breakdown
  console.log('\n\nStep 2: Monthly breakdown of empty CIDs...');
  const monthlyResult = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(timestamp) AS month,
        count() AS total_trades,
        countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS empty_cid,
        round(100.0 * empty_cid / total_trades, 2) AS empty_pct,
        sum(usd_value) AS total_volume,
        sumIf(usd_value, condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS empty_volume
      FROM pm_trades_canonical_v3
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `,
    format: 'JSONEachRow'
  });
  const monthlyData = await monthlyResult.json<any>();

  console.log('\n📅 Monthly Empty CID Trend (Last 24 Months):');
  console.log('Month   | Total Trades | Empty CID | Empty % | Total Volume | Empty Volume');
  console.log('--------|--------------|-----------|---------|--------------|-------------');

  for (const row of monthlyData) {
    console.log(
      `${row.month} | ${String(row.total_trades).padStart(12)} | ${String(row.empty_cid).padStart(9)} | ${String(row.empty_pct).padStart(7)}% | $${String(Math.round(row.total_volume).toLocaleString()).padStart(11)} | $${String(Math.round(row.empty_volume).toLocaleString()).padStart(11)}`
    );
  }

  // 3. October 2025 deep dive
  console.log('\n\nStep 3: October 2025 orphan spike analysis...');
  const octResult = await clickhouse.query({
    query: `
      SELECT
        count() AS oct_trades,
        countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS oct_orphans,
        round(100.0 * oct_orphans / oct_trades, 2) AS orphan_rate,
        sum(usd_value) AS total_volume,
        sumIf(usd_value, condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS orphan_volume,
        count(DISTINCT source) AS sources,
        groupUniqArray(source) AS source_list
      FROM pm_trades_canonical_v3
      WHERE toYYYYMM(timestamp) = 202510
    `,
    format: 'JSONEachRow'
  });
  const octStats = (await octResult.json<any>())[0];

  console.log('\n📊 October 2025 Statistics:');
  console.log(`Total trades: ${octStats.oct_trades.toLocaleString()}`);
  console.log(`Orphan trades: ${octStats.oct_orphans.toLocaleString()}`);
  console.log(`Orphan rate: ${octStats.orphan_rate}%`);
  console.log(`Total volume: $${Math.round(octStats.total_volume).toLocaleString()}`);
  console.log(`Orphan volume: $${Math.round(octStats.orphan_volume).toLocaleString()}`);
  console.log(`Sources: ${octStats.source_list.join(', ')}`);

  // 4. Sample orphan trades from October
  console.log('\n\nStep 4: Sampling October orphan trades...');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        wallet_address,
        timestamp,
        usd_value,
        shares,
        trade_direction,
        source,
        trade_id,
        condition_id_norm_v3
      FROM pm_trades_canonical_v3
      WHERE toYYYYMM(timestamp) = 202510
        AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64)
      ORDER BY usd_value DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json<any>();

  console.log('\n📋 Top 20 October Orphan Trades by Value:');
  for (const trade of samples) {
    console.log(`\nTrade: ${trade.trade_id.substring(0, 50)}...`);
    console.log(`  Tx: ${trade.transaction_hash}`);
    console.log(`  Wallet: ${trade.wallet_address}`);
    console.log(`  Time: ${trade.timestamp} | Value: $${Math.round(trade.usd_value * 100) / 100}`);
    console.log(`  Direction: ${trade.trade_direction} | Shares: ${trade.shares}`);
    console.log(`  Source: ${trade.source} | CID: ${trade.condition_id_norm_v3 || 'NULL'}`);
  }

  // 5. Check wallet_canonical field
  console.log('\n\nStep 5: Checking wallet_canonical field...');
  const walletFieldResult = await clickhouse.query({
    query: `
      SELECT
        name,
        type,
        default_expression
      FROM system.columns
      WHERE database = currentDatabase()
        AND table = 'pm_trades_canonical_v3'
        AND name LIKE '%wallet%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const walletFields = await walletFieldResult.json<any>();

  console.log('\n📋 Wallet-related fields in pm_trades_canonical_v3:');
  for (const field of walletFields) {
    console.log(`   ${field.name}: ${field.type}${field.default_expression ? ` (default: ${field.default_expression})` : ''}`);
  }

  // 6. If wallet_canonical exists, check for empty values
  const hasCanonical = walletFields.some((f: any) => f.name === 'wallet_canonical');
  let canonicalStats = null;

  if (hasCanonical) {
    console.log('\n\nStep 6: Analyzing wallet_canonical field...');
    const canonicalResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(wallet_canonical IS NULL OR wallet_canonical = '') AS empty_canonical,
          round(100.0 * empty_canonical / total_trades, 2) AS empty_pct,
          count(DISTINCT wallet_address) AS unique_addresses,
          count(DISTINCT wallet_canonical) AS unique_canonical
        FROM pm_trades_canonical_v3
      `,
      format: 'JSONEachRow'
    });
    canonicalStats = (await canonicalResult.json<any>())[0];

    console.log('\n📊 wallet_canonical Statistics:');
    console.log(`Total trades: ${canonicalStats.total_trades.toLocaleString()}`);
    console.log(`Empty canonical: ${canonicalStats.empty_canonical.toLocaleString()}`);
    console.log(`Empty percentage: ${canonicalStats.empty_pct}%`);
    console.log(`Unique wallet_address: ${canonicalStats.unique_addresses.toLocaleString()}`);
    console.log(`Unique wallet_canonical: ${canonicalStats.unique_canonical.toLocaleString()}`);
  } else {
    console.log('\n⚠️  wallet_canonical field does not exist in table');
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    global_stats: globalStats,
    monthly_breakdown: monthlyData,
    october_2025: octStats,
    sample_orphans: samples,
    wallet_fields: walletFields,
    wallet_canonical_stats: canonicalStats
  };

  writeFileSync(
    '/tmp/EMPTY_CID_INVESTIGATION_REPORT.json',
    JSON.stringify(report, null, 2)
  );

  console.log('\n\n✅ Investigation complete! Report saved to /tmp/EMPTY_CID_INVESTIGATION_REPORT.json');

  return report;
}

investigateEmptyCID().catch(console.error);
