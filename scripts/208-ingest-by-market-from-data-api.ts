#!/usr/bin/env tsx
/**
 * Phase 10 (Optional): Market-Scoped External Trade Ingestion
 *
 * Purpose: Fetch ALL wallets trading on specific markets (ghost markets)
 *          to ensure global completeness, not just xcnstrategy coverage.
 *
 * Strategy:
 *   1. Query Data-API by market (condition_id) instead of by wallet
 *   2. For each of the 6 ghost markets, fetch all TRADE activities
 *   3. Ingest into external_trades_raw with deduplication
 *
 * Usage:
 *   npx tsx scripts/208-ingest-by-market-from-data-api.ts [options]
 *
 * Options:
 *   --condition-id <cid>  Single market to ingest (repeatable)
 *   --ghost-markets       Ingest all 6 known ghost markets (default)
 *   --dry-run             Preview mode (no insertions)
 *   --since YYYY-MM-DD    Fetch trades from this date
 *   --until YYYY-MM-DD    Fetch trades up to this date
 *
 * NOTE: This script is DESIGNED but NOT YET EXECUTED.
 *       Run only if C1 requires complete ghost market coverage.
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Polymarket Data-API endpoints
const DATA_API_BASE = 'https://data-api.polymarket.com';
const ACTIVITY_ENDPOINT = `${DATA_API_BASE}/activity`;

// Known ghost markets (6 total) from xcnstrategy analysis
const GHOST_MARKETS = [
  {
    condition_id: '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    question: 'Xi Jinping out in 2025?'
  },
  {
    condition_id: '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    question: 'Will Trump sell over 100k Gold Cards in 2025?'
  },
  {
    condition_id: '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    question: 'Will Elon cut the budget by at least 10% in 2025?'
  },
  {
    condition_id: '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    question: 'Will Satoshi move any Bitcoin in 2025?'
  },
  {
    condition_id: '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    question: 'Will China unban Bitcoin in 2025?'
  },
  {
    condition_id: '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    question: 'Will a US ally get a nuke in 2025?'
  }
];

interface DataAPIActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size?: number;
  usdcSize?: number;
  transactionHash?: string;
  price?: number;
  asset?: string;
  side?: string;
  outcomeIndex?: number;
  title?: string;
  outcome?: string;
}

interface CLIOptions {
  conditionIds: string[];
  since?: Date;
  until?: Date;
  dryRun: boolean;
  ghostMarkets: boolean;
}

function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const options: CLIOptions = {
    conditionIds: [],
    since: undefined,
    until: undefined,
    dryRun: args.includes('--dry-run'),
    ghostMarkets: args.includes('--ghost-markets') || args.length === 0 // Default to ghost markets
  };

  // Parse --condition-id (repeatable)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--condition-id' && args[i + 1]) {
      options.conditionIds.push(args[i + 1]);
      i++;
    }
  }

  // Parse --since
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) {
      options.since = new Date(args[i + 1]);
      i++;
    }
  }

  // Parse --until
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--until' && args[i + 1]) {
      options.until = new Date(args[i + 1]);
      i++;
    }
  }

  // Default to ghost markets if no condition IDs specified
  if (options.ghostMarkets && options.conditionIds.length === 0) {
    options.conditionIds = GHOST_MARKETS.map(m => m.condition_id);
  }

  return options;
}

/**
 * Generate stable, unique external_trade_id from API fields
 * (Same format as wallet-based connector for consistency)
 */
function generateExternalTradeId(activity: DataAPIActivity): string {
  const txHash = activity.transactionHash || 'no_tx';
  const conditionId = (activity.conditionId || '').substring(0, 16);
  const user = (activity.proxyWallet || '').substring(0, 16);
  const timestamp = activity.timestamp;
  const side = activity.side || 'unknown';
  const size = (activity.size || 0).toFixed(6);

  return `data_api_${txHash}_${conditionId}_${user}_${timestamp}_${side}_${size}`;
}

async function fetchActivitiesByMarket(
  conditionId: string,
  since?: Date,
  until?: Date,
  dryRun: boolean = false
): Promise<DataAPIActivity[]> {
  const params = new URLSearchParams({
    market: conditionId,
    type: 'TRADE',
    limit: '1000'
  });

  // Add time filters if provided
  if (since) {
    params.append('start', Math.floor(since.getTime() / 1000).toString());
  }

  if (until) {
    params.append('end', Math.floor(until.getTime() / 1000).toString());
  }

  const url = `${ACTIVITY_ENDPOINT}?${params}`;

  if (dryRun) {
    console.log('  DRY RUN: Would fetch from:');
    console.log(`    ${url.substring(0, 120)}...`);
    console.log('');
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const activities = Array.isArray(data) ? data : (data.data || []);

    return activities;
  } catch (error: any) {
    console.error(`  ❌ Failed to fetch from Data-API: ${error.message}`);
    throw error;
  }
}

function transformToExternalTrades(activities: DataAPIActivity[]) {
  return activities
    .filter(a => a.type === 'TRADE' && a.size && a.price)
    .map(activity => ({
      // Source Tracking
      source: 'polymarket_data_api',
      ingested_at: new Date(),
      external_trade_id: generateExternalTradeId(activity),

      // Wallet & Market (normalized)
      wallet_address: (activity.proxyWallet || '').toLowerCase().replace(/^0x/, ''),
      condition_id: (activity.conditionId || '').toLowerCase().replace(/^0x/, ''),
      market_question: activity.title || '',

      // Trade Details
      side: activity.side || 'UNKNOWN',
      outcome_index: activity.outcomeIndex ?? -1,
      shares: activity.size || 0,
      price: activity.price || 0,
      cash_value: activity.usdcSize || (activity.size || 0) * (activity.price || 0),
      fees: 0.0,

      // Timestamps & Blockchain
      trade_timestamp: new Date(activity.timestamp * 1000),
      tx_hash: activity.transactionHash || ''
    }));
}

async function main() {
  const options = parseCLIArgs();

  console.log('═'.repeat(80));
  console.log('Phase 10 (Optional): Market-Scoped External Trade Ingestion');
  console.log('═'.repeat(80));
  console.log('');

  console.log(`Mode: ${options.dryRun ? '🔍 DRY RUN (no insertions)' : '✍️  LIVE (will insert)'}`);
  console.log('');

  console.log('Configuration:');
  console.log(`  Markets to ingest: ${options.conditionIds.length}`);
  console.log(`  Time Range: ${options.since ? options.since.toISOString().split('T')[0] : 'all'} → ${options.until ? options.until.toISOString().split('T')[0] : 'now'}`);
  console.log('');

  if (options.ghostMarkets) {
    console.log('📍 Ingesting ALL KNOWN GHOST MARKETS (6 markets)');
    console.log('');
  }

  let allActivities: DataAPIActivity[] = [];
  const marketResults: Array<{
    condition_id: string;
    question: string;
    trades: number;
    wallets: Set<string>;
  }> = [];

  for (const conditionId of options.conditionIds) {
    const ghostMarket = GHOST_MARKETS.find(m => m.condition_id === conditionId);
    const question = ghostMarket?.question || 'Unknown market';

    console.log(`─`.repeat(80));
    console.log(`Market: ${question}`);
    console.log(`Condition ID: ${conditionId.substring(0, 32)}...`);
    console.log(`─`.repeat(80));
    console.log('');

    try {
      const activities = await fetchActivitiesByMarket(
        conditionId,
        options.since,
        options.until,
        options.dryRun
      );

      console.log(`  Found ${activities.length} activities`);

      const trades = activities.filter(a => a.type === 'TRADE');
      const uniqueWallets = new Set(trades.map(a => a.proxyWallet.toLowerCase()));

      console.log(`  Trades (type=TRADE): ${trades.length}`);
      console.log(`  Unique wallets: ${uniqueWallets.size}`);
      console.log('');

      if (uniqueWallets.size > 0) {
        console.log('  Wallets trading this market:');
        for (const wallet of Array.from(uniqueWallets).slice(0, 5)) {
          console.log(`    ${wallet}`);
        }
        if (uniqueWallets.size > 5) {
          console.log(`    ... and ${uniqueWallets.size - 5} more`);
        }
        console.log('');
      }

      allActivities = [...allActivities, ...activities];

      marketResults.push({
        condition_id: conditionId,
        question,
        trades: trades.length,
        wallets: uniqueWallets
      });

    } catch (error: any) {
      console.error(`  ❌ Failed to fetch market: ${error.message}`);
      console.log('');
    }
  }

  console.log('═'.repeat(80));
  console.log('MARKET INGESTION SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Per-Market Breakdown:');
  console.log('');

  for (const result of marketResults) {
    console.log(`${result.question}`);
    console.log(`  Condition ID: ${result.condition_id.substring(0, 32)}...`);
    console.log(`  Trades: ${result.trades}`);
    console.log(`  Unique Wallets: ${result.wallets.size}`);
    console.log('');
  }

  // Overall stats
  const totalTrades = allActivities.filter(a => a.type === 'TRADE');
  const totalWallets = new Set(totalTrades.map(a => a.proxyWallet.toLowerCase()));

  console.log('Overall Statistics:');
  console.log(`  Total markets queried: ${options.conditionIds.length}`);
  console.log(`  Total trades found: ${totalTrades.length}`);
  console.log(`  Unique wallets across all markets: ${totalWallets.size}`);
  console.log('');

  if (totalTrades.length === 0) {
    console.log('⚠️  NO TRADES FOUND across any markets');
    console.log('');
    return;
  }

  // Transform to external_trades_raw schema
  console.log('Transforming to external_trades_raw schema...');
  console.log('');

  const externalTrades = transformToExternalTrades(totalTrades);

  console.log(`Transformed ${externalTrades.length} trade rows`);
  console.log('');

  // Calculate summary stats
  const totalShares = externalTrades.reduce((sum, t) => sum + t.shares, 0);
  const totalValue = externalTrades.reduce((sum, t) => sum + t.cash_value, 0);

  console.log('Transformed Data Summary:');
  console.log(`  Total Trades:      ${externalTrades.length}`);
  console.log(`  Total Shares:      ${totalShares.toFixed(2)}`);
  console.log(`  Total Value:       $${totalValue.toFixed(2)}`);
  console.log(`  Unique Markets:    ${new Set(externalTrades.map(t => t.condition_id)).size}`);
  console.log(`  Unique Wallets:    ${new Set(externalTrades.map(t => t.wallet_address)).size}`);
  console.log('');

  // Insert into ClickHouse (if not dry-run)
  if (options.dryRun) {
    console.log('═'.repeat(80));
    console.log('DRY RUN COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log('✅ Data fetched and transformed successfully');
    console.log('✅ No insertions made (dry-run mode)');
    console.log('');
    console.log('To execute ingestion:');
    console.log('  npx tsx scripts/208-ingest-by-market-from-data-api.ts');
    console.log('');
  } else {
    console.log('Checking for existing trades (deduplication)...');
    console.log('');

    try {
      // Get existing external_trade_ids
      const existingIdsResult = await clickhouse.query({
        query: `
          SELECT DISTINCT external_trade_id
          FROM external_trades_raw
          WHERE source = 'polymarket_data_api'
        `,
        format: 'JSONEachRow'
      });

      const existingIds = new Set(
        (await existingIdsResult.json()).map((row: any) => row.external_trade_id)
      );

      console.log(`Found ${existingIds.size} existing trade IDs in database`);

      // Filter out existing trades
      const newTrades = externalTrades.filter(
        trade => !existingIds.has(trade.external_trade_id)
      );

      console.log(`${newTrades.length} new trades to insert (${externalTrades.length - newTrades.length} duplicates skipped)`);
      console.log('');

      if (newTrades.length === 0) {
        console.log('⚠️  No new trades to insert (all were duplicates)');
        console.log('');
      } else {
        console.log('Inserting new trades into external_trades_raw...');
        console.log('');

        await clickhouse.insert({
          table: 'external_trades_raw',
          values: newTrades,
          format: 'JSONEachRow'
        });

        console.log('✅ Inserted successfully');
        console.log('');

        // Show breakdown of new wallets discovered
        const newWallets = new Set(newTrades.map(t => t.wallet_address));
        const existingWalletsResult = await clickhouse.query({
          query: `SELECT DISTINCT wallet_address FROM external_trades_raw WHERE source = 'polymarket_data_api'`,
          format: 'JSONEachRow'
        });
        const existingWallets = new Set(
          (await existingWalletsResult.json()).map((row: any) => row.wallet_address)
        );

        const trulyNewWallets = Array.from(newWallets).filter(w => !existingWallets.has(w));

        console.log(`Discovery Summary:`);
        console.log(`  New wallets found: ${trulyNewWallets.length}`);
        if (trulyNewWallets.length > 0) {
          console.log('  Newly discovered wallets:');
          for (const wallet of trulyNewWallets.slice(0, 10)) {
            console.log(`    0x${wallet}`);
          }
          if (trulyNewWallets.length > 10) {
            console.log(`    ... and ${trulyNewWallets.length - 10} more`);
          }
        }
        console.log('');
      }

      // Verify final count
      const countResult = await clickhouse.query({
        query: `
          SELECT COUNT(*) as cnt
          FROM external_trades_raw
          WHERE source = 'polymarket_data_api'
        `,
        format: 'JSONEachRow'
      });

      const count = (await countResult.json())[0].cnt;
      console.log(`Verification: ${count} rows total in external_trades_raw`);
      console.log('');

    } catch (error: any) {
      console.error('❌ Failed to insert into ClickHouse:', error.message);
      throw error;
    }

    console.log('═'.repeat(80));
    console.log('INGESTION COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`✅ ${externalTrades.length} trades processed`);
    console.log(`✅ ${totalShares.toFixed(2)} shares ingested`);
    console.log(`✅ $${totalValue.toFixed(2)} total value`);
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Run coverage report: npx tsx scripts/207-report-external-coverage.ts');
    console.log('  2. Validate ingestion: npx tsx scripts/204-validate-external-ingestion.ts');
    console.log('');
  }

  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

// Only run main if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
