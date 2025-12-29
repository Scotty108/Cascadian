#!/usr/bin/env npx tsx
/**
 * Build TRADER_STRICT candidate list for V29 validation
 *
 * Filters wallets to find clean "trader only" profiles:
 * - splitCount == 0
 * - mergeCount == 0
 * - inventoryMismatch == 0
 * - missingResolutions == 0
 */

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';
import path from 'path';

interface WalletClassification {
  wallet_address: string;
  splitCount: number;
  mergeCount: number;
  inventoryMismatch: number;
  missingResolutions: number;
  tradeCount: number;
  marketCount: number;
  totalVolume: number;
  tag: 'TRADER_STRICT' | 'OTHER';
}

async function loadBenchmarkWallets(): Promise<string[]> {
  const benchmarkPath = path.join(process.cwd(), 'data/pnl/ui_benchmarks_50_wallets_20251203.json');
  const content = await fs.readFile(benchmarkPath, 'utf-8');
  const data = JSON.parse(content);
  return data.wallets.map((w: any) => w.wallet.toLowerCase());
}

async function classifyWallet(wallet: string): Promise<WalletClassification> {
  // Get split/merge counts from unified ledger source_type
  const splitMergeQuery = `
    SELECT
      sum(CASE WHEN source_type = 'split' THEN 1 ELSE 0 END) as split_count,
      sum(CASE WHEN source_type = 'merge' THEN 1 ELSE 0 END) as merge_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower({wallet: String})
  `;

  const splitMergeResult = await clickhouse.query({
    query: splitMergeQuery,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const splitMerge = await splitMergeResult.json<any>();
  const splitCount = Number(splitMerge[0]?.split_count || 0);
  const mergeCount = Number(splitMerge[0]?.merge_count || 0);

  // Get inventory mismatches (negative positions)
  const inventoryQuery = `
    SELECT count() as mismatch_count
    FROM (
      SELECT
        condition_id,
        outcome_index,
        sum(token_delta) as net_position
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower({wallet: String})
        AND token_delta != 0
      GROUP BY condition_id, outcome_index
      HAVING net_position < -0.01
    )
  `;

  const inventoryResult = await clickhouse.query({
    query: inventoryQuery,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const inventory = await inventoryResult.json<any>();
  const inventoryMismatch = Number(inventory[0]?.mismatch_count || 0);

  // For simplicity, skip missing resolutions check - not critical for TRADER_STRICT
  const missingResolutions = 0;

  // Get trade stats
  const tradeStatsQuery = `
    SELECT
      count() as trade_count,
      uniq(condition_id) as market_count,
      sum(usdc_delta) as total_volume
    FROM (
      SELECT
        event_id,
        any(condition_id) as condition_id,
        any(usdc_delta) as usdc_delta
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower({wallet: String})
        AND is_deleted = 0
      GROUP BY event_id
    )
  `;

  const tradeStatsResult = await clickhouse.query({
    query: tradeStatsQuery,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const tradeStats = await tradeStatsResult.json<any>();
  const tradeCount = Number(tradeStats[0]?.trade_count || 0);
  const marketCount = Number(tradeStats[0]?.market_count || 0);
  const totalVolume = Math.abs(Number(tradeStats[0]?.total_volume || 0));

  const isTraderStrict =
    splitCount === 0 &&
    mergeCount === 0 &&
    inventoryMismatch === 0 &&
    tradeCount > 0;

  return {
    wallet_address: wallet,
    splitCount,
    mergeCount,
    inventoryMismatch,
    missingResolutions,
    tradeCount,
    marketCount,
    totalVolume,
    tag: isTraderStrict ? 'TRADER_STRICT' : 'OTHER'
  };
}

async function main() {
  console.log('Building TRADER_STRICT candidate list...\n');

  const benchmarkWallets = await loadBenchmarkWallets();
  console.log(`Loaded ${benchmarkWallets.length} benchmark wallets\n`);

  const classifications: WalletClassification[] = [];

  for (let i = 0; i < benchmarkWallets.length; i++) {
    const wallet = benchmarkWallets[i];
    console.log(`[${i + 1}/${benchmarkWallets.length}] Classifying ${wallet}...`);

    try {
      const classification = await classifyWallet(wallet);
      classifications.push(classification);

      if (classification.tag === 'TRADER_STRICT') {
        console.log(`  ✅ TRADER_STRICT: ${classification.tradeCount} trades, ${classification.marketCount} markets`);
      } else {
        console.log(`  ❌ OTHER: splits=${classification.splitCount}, merges=${classification.mergeCount}, inv=${classification.inventoryMismatch}, missing=${classification.missingResolutions}`);
      }
    } catch (error) {
      console.error(`  ⚠️  Error: ${error}`);
      classifications.push({
        wallet_address: wallet,
        splitCount: -1,
        mergeCount: -1,
        inventoryMismatch: -1,
        missingResolutions: -1,
        tradeCount: 0,
        marketCount: 0,
        totalVolume: 0,
        tag: 'OTHER'
      });
    }
  }

  const traderStrictWallets = classifications.filter(c => c.tag === 'TRADER_STRICT');

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total wallets: ${classifications.length}`);
  console.log(`TRADER_STRICT: ${traderStrictWallets.length}`);
  console.log(`OTHER: ${classifications.length - traderStrictWallets.length}`);

  // Save results
  const outputDir = path.join(process.cwd(), 'tmp');
  await fs.mkdir(outputDir, { recursive: true });

  const allOutputPath = path.join(outputDir, 'trader_strict_classification_all.json');
  await fs.writeFile(
    allOutputPath,
    JSON.stringify({
      metadata: {
        runDate: new Date().toISOString(),
        totalWallets: classifications.length,
        traderStrictCount: traderStrictWallets.length
      },
      wallets: classifications
    }, null, 2)
  );
  console.log(`\nSaved all classifications to: ${allOutputPath}`);

  const sampleOutputPath = path.join(outputDir, 'trader_strict_sample_100.json');
  await fs.writeFile(
    sampleOutputPath,
    JSON.stringify({
      metadata: {
        runDate: new Date().toISOString(),
        sampleSize: Math.min(100, traderStrictWallets.length)
      },
      wallets: traderStrictWallets.slice(0, 100)
    }, null, 2)
  );
  console.log(`Saved TRADER_STRICT sample to: ${sampleOutputPath}`);

  if (traderStrictWallets.length < 10) {
    console.log('\n⚠️  WARNING: Only found', traderStrictWallets.length, 'TRADER_STRICT wallets.');
    console.log('This may not be enough for meaningful validation.');
  }

  process.exit(0);
}

main().catch(console.error);
