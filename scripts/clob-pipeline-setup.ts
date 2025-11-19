#!/usr/bin/env npx tsx

/**
 * CLOB Pipeline Setup - Phase 1
 *
 * Purpose: Stand up Polymarket CLOB ingestion + proxy mapping pipeline
 *
 * Steps:
 * 1. Create staging tables (pm_user_proxy_wallets_v2, clob_fills_v2)
 * 2. Build proxy mappings for benchmark wallets
 * 3. Ingest CLOB fills for mapped proxies
 * 4. Validate coverage
 *
 * Usage: npx tsx scripts/clob-pipeline-setup.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { resolveProxyViaAPI } from '../lib/polymarket/resolver';

// Benchmark wallets from mg_wallet_baselines.md
const BENCHMARK_WALLETS = [
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // baseline
  '0xd748c701ad93cfec32a3420e10f3b08e68612125',
  '0x7f3c8979d0afa00007bae4747d5347122af05613',
  '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
  '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
];

const CLOB_API_BASE = 'https://clob.polymarket.com';

interface ClobTrade {
  id: string;
  trader: string;
  market: string;
  asset_id: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  timestamp: number;
  order_hash: string;
  transaction_hash: string;
  fee_rate_bps: string;
  bucket_index: number;
}

async function step1_createStagingTables() {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 1: CREATE STAGING TABLES');
  console.log('='.repeat(80) + '\n');

  // Create pm_user_proxy_wallets_v2
  console.log('Creating pm_user_proxy_wallets_v2...');
  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.pm_user_proxy_wallets_v2 (
        user_eoa String NOT NULL,
        proxy_wallet String NOT NULL,
        source LowCardinality(String) DEFAULT 'api',
        first_seen_at DateTime DEFAULT now(),
        last_seen_at DateTime DEFAULT now(),
        is_active UInt8 DEFAULT 1,
        metadata String DEFAULT ''
      )
      ENGINE = ReplacingMergeTree(last_seen_at)
      ORDER BY (user_eoa, proxy_wallet)
      PARTITION BY toYYYYMM(last_seen_at)
      SETTINGS index_granularity = 8192
    `,
  });
  console.log('✅ pm_user_proxy_wallets_v2 created\n');

  // Create clob_fills_v2
  console.log('Creating clob_fills_v2...');
  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.clob_fills_v2 (
        fill_id String NOT NULL,
        proxy_wallet String NOT NULL,
        user_eoa String,
        market_slug String,
        condition_id String,
        asset_id String,
        outcome LowCardinality(String),
        side LowCardinality(String),
        price Decimal64(18),
        size Decimal64(18),
        fee_rate_bps UInt32,
        timestamp DateTime,
        order_hash String,
        tx_hash String,
        bucket_index UInt32,
        ingested_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(ingested_at)
      ORDER BY (proxy_wallet, timestamp, fill_id)
      PARTITION BY toYYYYMM(timestamp)
      SETTINGS index_granularity = 8192
    `,
  });
  console.log('✅ clob_fills_v2 created\n');

  console.log('✅ STEP 1 COMPLETE: Staging tables ready\n');
}

async function step2_buildProxyMappings() {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: BUILD PROXY MAPPINGS');
  console.log('='.repeat(80) + '\n');

  console.log(`Resolving proxies for ${BENCHMARK_WALLETS.length} benchmark wallets...\n`);

  const results = {
    resolved: 0,
    failed: 0,
    direct: 0, // wallets that trade directly (no proxy)
  };

  for (const wallet of BENCHMARK_WALLETS) {
    process.stdout.write(`  ${wallet.slice(0, 10)}... `);

    try {
      const proxyInfo = await resolveProxyViaAPI(wallet);

      if (!proxyInfo) {
        console.log('❌ No proxy info returned');
        results.failed++;
        continue;
      }

      // Insert into staging table
      await clickhouse.insert({
        table: 'pm_user_proxy_wallets_v2',
        values: [{
          user_eoa: proxyInfo.user_eoa,
          proxy_wallet: proxyInfo.proxy_wallet,
          source: proxyInfo.source,
          first_seen_at: new Date(),
          last_seen_at: new Date(),
          is_active: 1,
          metadata: '',
        }],
        format: 'JSONEachRow',
      });

      if (proxyInfo.user_eoa === proxyInfo.proxy_wallet) {
        console.log(`✅ Direct trader (no proxy)`);
        results.direct++;
      } else {
        console.log(`✅ Proxy: ${proxyInfo.proxy_wallet.slice(0, 10)}...`);
        results.resolved++;
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.log(`❌ Error: ${(error as Error).message}`);
      results.failed++;
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`Resolved: ${results.resolved} proxies`);
  console.log(`Direct:   ${results.direct} wallets (no proxy)`);
  console.log(`Failed:   ${results.failed} wallets`);
  console.log('-'.repeat(80) + '\n');

  // Verify
  const checkResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_user_proxy_wallets_v2',
    format: 'JSONEachRow',
  });
  const count = await checkResult.json();
  console.log(`✅ STEP 2 COMPLETE: ${count[0].count} proxy mappings in staging table\n`);
}

async function step3_ingestClobFills() {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: INGEST CLOB FILLS');
  console.log('='.repeat(80) + '\n');

  // Get all proxy wallets from staging
  const proxiesResult = await clickhouse.query({
    query: `
      SELECT DISTINCT proxy_wallet, user_eoa
      FROM pm_user_proxy_wallets_v2
      ORDER BY proxy_wallet
    `,
    format: 'JSONEachRow',
  });
  const proxies = await proxiesResult.json<{proxy_wallet: string, user_eoa: string}[]>();

  console.log(`Fetching CLOB fills for ${proxies.length} proxy wallets...\n`);

  let totalFills = 0;
  const errors: string[] = [];

  for (const proxy of proxies) {
    process.stdout.write(`  ${proxy.proxy_wallet.slice(0, 10)}... `);

    try {
      // Fetch fills from CLOB API
      const url = `${CLOB_API_BASE}/trades?maker=${proxy.proxy_wallet}&limit=100`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        console.log(`❌ API error: ${response.status}`);
        errors.push(`${proxy.proxy_wallet}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as ClobTrade[];
      const fills = Array.isArray(data) ? data : [];

      if (fills.length === 0) {
        console.log(`⚠️  No fills found`);
        continue;
      }

      // Transform and insert
      const records = fills.map((fill: ClobTrade) => ({
        fill_id: fill.id,
        proxy_wallet: proxy.proxy_wallet,
        user_eoa: proxy.user_eoa,
        market_slug: fill.market || '',
        condition_id: fill.asset_id || '',
        asset_id: fill.asset_id || '',
        outcome: fill.outcome || '',
        side: fill.side || 'UNKNOWN',
        price: parseFloat(fill.price),
        size: parseFloat(fill.size),
        fee_rate_bps: parseInt(fill.fee_rate_bps || '0'),
        timestamp: new Date(fill.timestamp * 1000),
        order_hash: fill.order_hash || '',
        tx_hash: fill.transaction_hash || '',
        bucket_index: fill.bucket_index || 0,
        ingested_at: new Date(),
      }));

      await clickhouse.insert({
        table: 'clob_fills_v2',
        values: records,
        format: 'JSONEachRow',
      });

      totalFills += fills.length;
      console.log(`✅ ${fills.length} fills`);

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (error) {
      console.log(`❌ ${(error as Error).message}`);
      errors.push(`${proxy.proxy_wallet}: ${(error as Error).message}`);
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`Total fills ingested: ${totalFills}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  - ${e}`));
  }
  console.log('-'.repeat(80) + '\n');

  // Verify
  const fillsResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_fills,
        COUNT(DISTINCT proxy_wallet) as unique_proxies,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
      FROM clob_fills_v2
    `,
    format: 'JSONEachRow',
  });
  const stats = await fillsResult.json();
  console.log('Ingestion Stats:');
  console.log(`  Total fills: ${stats[0].total_fills}`);
  console.log(`  Unique proxies: ${stats[0].unique_proxies}`);
  console.log(`  Date range: ${stats[0].earliest} → ${stats[0].latest}`);
  console.log('\n✅ STEP 3 COMPLETE: CLOB fills ingested\n');
}

async function step4_validateCoverage() {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: VALIDATE COVERAGE');
  console.log('='.repeat(80) + '\n');

  console.log('Checking coverage for first 3 benchmark wallets...\n');

  for (const wallet of BENCHMARK_WALLETS.slice(0, 3)) {
    console.log('-'.repeat(80));
    console.log(`Wallet: ${wallet}`);

    // Get proxy mapping
    const proxyResult = await clickhouse.query({
      query: `
        SELECT proxy_wallet
        FROM pm_user_proxy_wallets_v2
        WHERE user_eoa = '${wallet.toLowerCase()}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const proxyData = await proxyResult.json<{proxy_wallet: string}[]>();

    if (proxyData.length === 0) {
      console.log('  ❌ No proxy mapping found\n');
      continue;
    }

    const proxyWallet = proxyData[0].proxy_wallet;
    console.log(`  Proxy: ${proxyWallet}`);

    // Check CLOB fills
    const fillsResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_fills,
          COUNT(DISTINCT condition_id) as unique_markets,
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade
        FROM clob_fills_v2
        WHERE proxy_wallet = '${proxyWallet}'
      `,
      format: 'JSONEachRow',
    });
    const fillsData = await fillsResult.json();

    console.log(`  CLOB Fills: ${fillsData[0].total_fills}`);
    console.log(`  Markets: ${fillsData[0].unique_markets}`);
    console.log(`  Date range: ${fillsData[0].first_trade || 'N/A'} → ${fillsData[0].last_trade || 'N/A'}`);
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('✅ STEP 4 COMPLETE: Validation done\n');
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('CLOB PIPELINE SETUP - PHASE 1');
  console.log('═'.repeat(80));
  console.log('Purpose: Stand up Polymarket CLOB ingestion + proxy mapping');
  console.log('Status: NON-DESTRUCTIVE (staging tables only)');
  console.log('═'.repeat(80) + '\n');

  try {
    await step1_createStagingTables();
    await step2_buildProxyMappings();
    await step3_ingestClobFills();
    await step4_validateCoverage();

    console.log('\n' + '═'.repeat(80));
    console.log('✅ CLOB PIPELINE SETUP COMPLETE');
    console.log('═'.repeat(80));
    console.log('\nNext steps:');
    console.log('  1. Review validation results above');
    console.log('  2. Check reports/sessions/2025-11-11-clob-setup-session.md');
    console.log('  3. Once ERC-1155 backfill completes, run promotion script');
    console.log('\nStaging tables created:');
    console.log('  - pm_user_proxy_wallets_v2');
    console.log('  - clob_fills_v2');
    console.log('');

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  }
}

main();
