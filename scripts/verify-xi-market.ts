#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function verifyXiMarket() {
  console.log('🔍 Verifying Xi Market Data...\n');

  const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

  // 1. Check xcnstrategy has 0 Xi trades in canonical table
  console.log('Step 1: Checking Xi market trades for xcnstrategy...');
  const xiTradesResult = await clickhouse.query({
    query: `
      SELECT
        count() AS xi_trades,
        sum(usd_value) AS xi_volume,
        groupArray(trade_id) AS trade_ids
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
        AND condition_id_norm_v3 = '${XI_MARKET_CID}'
    `,
    format: 'JSONEachRow'
  });
  const xiTrades = (await xiTradesResult.json<any>())[0];

  console.log(`\n📊 Xi Market Trades for xcnstrategy:`);
  console.log(`Trades: ${xiTrades.xi_trades}`);
  console.log(`Volume: $${Math.round(xiTrades.xi_volume || 0).toLocaleString()}`);

  if (xiTrades.xi_trades === 0) {
    console.log('✅ CONFIRMED: xcnstrategy has 0 Xi market trades in canonical table\n');
  } else {
    console.log(`⚠️  UNEXPECTED: Found ${xiTrades.xi_trades} Xi trades!\n`);
  }

  // 2. Check for orphan trades (NULL or empty condition_id)
  console.log('Step 2: Checking for orphan trades from xcnstrategy...');
  const orphanResult = await clickhouse.query({
    query: `
      SELECT
        count() AS orphan_trades,
        sum(usd_value) AS orphan_volume,
        min(timestamp) AS earliest_trade,
        max(timestamp) AS latest_trade
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
        AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64)
    `,
    format: 'JSONEachRow'
  });
  const orphans = (await orphanResult.json<any>())[0];

  console.log(`\n📊 Orphan Trades for xcnstrategy:`);
  console.log(`Orphan trades: ${orphans.orphan_trades.toLocaleString()}`);
  console.log(`Orphan volume: $${Math.round(orphans.orphan_volume || 0).toLocaleString()}`);
  console.log(`Date range: ${orphans.earliest_trade} to ${orphans.latest_trade}`);

  // 3. Sample orphan trades to check if any could be Xi market
  if (orphans.orphan_trades > 0) {
    console.log('\n\nStep 3: Sampling orphan trades from xcnstrategy...');
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          transaction_hash,
          timestamp,
          usd_value,
          shares,
          trade_direction,
          condition_id_norm_v3
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
          AND (condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64)
        ORDER BY usd_value DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json<any>();

    console.log('\n📋 Top 20 Orphan Trades (by value):');
    for (const trade of samples) {
      console.log(`\nTrade: ${trade.trade_id.substring(0, 50)}...`);
      console.log(`  Tx: ${trade.transaction_hash}`);
      console.log(`  Time: ${trade.timestamp} | Value: $${Math.round(trade.usd_value * 100) / 100}`);
      console.log(`  Direction: ${trade.trade_direction} | Shares: ${trade.shares}`);
      console.log(`  CID: ${trade.condition_id_norm_v3 || 'NULL'}`);
    }

    // Estimate if orphans match "174 trades, ~$159K" claim
    console.log(`\n\n📊 Orphan Volume Estimate:`);
    if (orphans.orphan_trades === 174 && Math.abs(orphans.orphan_volume - 159000) < 10000) {
      console.log(`✅ MATCHES: 174 trades, ~$159K (matches expected Xi market data)`);
    } else {
      console.log(`⚠️  MISMATCH:`);
      console.log(`   Expected: 174 trades, ~$159K`);
      console.log(`   Found: ${orphans.orphan_trades} trades, $${Math.round(orphans.orphan_volume).toLocaleString()}`);
    }
  }

  // 4. Check total xcnstrategy stats
  console.log('\n\nStep 4: Overall xcnstrategy statistics...');
  const totalResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        sum(usd_value) AS total_volume,
        count(DISTINCT condition_id_norm_v3) AS unique_markets,
        countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '' OR length(condition_id_norm_v3) != 64) AS orphan_count,
        round(100.0 * orphan_count / total_trades, 2) AS orphan_pct
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
    `,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json<any>())[0];

  console.log(`\n📊 xcnstrategy Overall Stats:`);
  console.log(`Total trades: ${total.total_trades.toLocaleString()}`);
  console.log(`Total volume: $${Math.round(total.total_volume).toLocaleString()}`);
  console.log(`Unique markets: ${total.unique_markets.toLocaleString()}`);
  console.log(`Orphan trades: ${total.orphan_count.toLocaleString()} (${total.orphan_pct}%)`);

  // 5. Recommendation
  console.log('\n\n📋 Recommendation:');
  if (xiTrades.xi_trades === 0 && orphans.orphan_trades > 0) {
    console.log('✅ CONFIRMED: Xi market trades are likely in orphan set (NULL condition_id)');
    console.log('🔧 FIX REQUIRED: Backfill orphan condition_ids from CLOB API or ERC1155 data');
    console.log('❌ NO DATABASE PATCH NEEDED: Issue is upstream (CLOB ingestion)');
  } else if (xiTrades.xi_trades > 0) {
    console.log('⚠️  Xi trades found in canonical table - investigate further');
  } else {
    console.log('⚠️  No orphan trades found - unexpected, investigate wallet address');
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    wallet: XCNSTRATEGY_WALLET,
    xi_market_cid: XI_MARKET_CID,
    xi_trades: xiTrades,
    orphan_stats: orphans,
    total_stats: total,
    recommendation: xiTrades.xi_trades === 0 && orphans.orphan_trades > 0
      ? 'Backfill orphan condition_ids from external source'
      : 'Investigate further'
  };

  writeFileSync(
    '/tmp/XI_MARKET_VERIFICATION_REPORT.json',
    JSON.stringify(report, null, 2)
  );

  console.log('\n\n✅ Verification complete! Report saved to /tmp/XI_MARKET_VERIFICATION_REPORT.json');

  return report;
}

verifyXiMarket().catch(console.error);
