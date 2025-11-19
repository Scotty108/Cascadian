#!/usr/bin/env tsx
/**
 * Phase 5: Generalized Data-API Connector (CLI-enabled)
 *
 * Purpose: Fetch trades from Polymarket's Data-API for any wallet + markets.
 *          Now accepts CLI arguments for flexible backfilling.
 *
 * Data Source: https://data-api.polymarket.com/activity
 * Method: GET /activity with user + market filters
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

// Rate limit backoff settings
const BASE_RATE_LIMIT_BACKOFF_MS = 30000;  // 30 seconds
const MAX_RATE_LIMIT_BACKOFF_MS = 300000;  // 5 minutes
const MAX_RATE_LIMIT_RETRIES = 5;

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Default values (xcnstrategy ghost markets - backward compatibility)
const DEFAULT_WALLETS = [
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // xcnstrategy EOA
  '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723'  // xcnstrategy proxy
];

const DEFAULT_CONDITION_IDS = [
  '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
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
  wallets: string[];
  conditionIds: string[];
  since?: Date;
  until?: Date;
  dryRun: boolean;
  fromGhostWallets: boolean;
  fromGhostWalletsAll: boolean;
  walletDelayMs: number;
}

function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const options: CLIOptions = {
    wallets: [],
    conditionIds: [],
    since: undefined,
    until: undefined,
    dryRun: args.includes('--dry-run'),
    fromGhostWallets: args.includes('--from-ghost-wallets'),
    fromGhostWalletsAll: args.includes('--from-ghost-wallets-all'),
    walletDelayMs: 0  // Default: no delay (will be set by batch script)
  };

  // Parse --wallet (repeatable)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wallet' && args[i + 1]) {
      options.wallets.push(args[i + 1]);
      i++;
    }
  }

  // Parse --condition-id (repeatable or comma-separated)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--condition-id' && args[i + 1]) {
      const ids = args[i + 1].split(',').map(id => id.trim());
      options.conditionIds.push(...ids);
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

  // Default mode: xcnstrategy ghost markets (backward compatibility)
  if (options.wallets.length === 0) {
    options.wallets = DEFAULT_WALLETS;
  }

  if (options.conditionIds.length === 0) {
    options.conditionIds = DEFAULT_CONDITION_IDS;
  }

  return options;
}

/**
 * Generate stable, unique external_trade_id from API fields
 * Format: data_api_{tx_hash}_{condition_id}_{user}_{timestamp}_{side}_{size}
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

/**
 * Fetch activities with exponential backoff on 429 errors
 */
async function fetchActivityWithBackoff(
  wallet: string,
  conditionIds: string[],
  since?: Date,
  until?: Date,
  walletDelayMs: number = 0,
  dryRun: boolean = false
): Promise<DataAPIActivity[]> {
  const params = new URLSearchParams({
    user: wallet,
    type: 'TRADE',
    limit: '1000'
  });

  // Only add market filter if condition IDs are specified
  if (conditionIds.length > 0) {
    params.append('market', conditionIds.join(','));
  }

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
    return [];
  }

  // Respect wallet delay before making request
  if (walletDelayMs > 0) {
    await sleep(walletDelayMs);
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < MAX_RATE_LIMIT_RETRIES) {
    try {
      const response = await fetch(url);

      // Success case
      if (response.ok) {
        const data = await response.json();
        const activities = Array.isArray(data) ? data : (data.data || []);
        return activities;
      }

      // Rate limit case - exponential backoff
      if (response.status === 429) {
        attempt++;

        if (attempt >= MAX_RATE_LIMIT_RETRIES) {
          console.log(`    ✗ GAVE UP on wallet ${wallet.substring(0, 16)}... after ${attempt} 429 retries`);
          throw new Error(`HTTP 429: Too Many Requests (exhausted ${MAX_RATE_LIMIT_RETRIES} retries)`);
        }

        // Calculate exponential backoff with jitter
        const baseBackoff = BASE_RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt - 1);
        const cappedBackoff = Math.min(baseBackoff, MAX_RATE_LIMIT_BACKOFF_MS);
        const jitter = Math.random() * 1000;  // 0-1000ms random jitter
        const backoffMs = cappedBackoff + jitter;

        console.log(`    ⏳ Rate limited for wallet ${wallet.substring(0, 16)}..., backing off for ${Math.round(backoffMs / 1000)}s (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES})`);

        await sleep(backoffMs);
        continue;
      }

      // Other HTTP errors - retry with smaller backoff
      if (attempt < 2) {  // Only retry non-429 errors twice
        attempt++;
        const backoffMs = 5000 + Math.random() * 2000;  // 5-7 seconds
        console.log(`    ⏳ HTTP ${response.status} for wallet ${wallet.substring(0, 16)}..., retrying in ${Math.round(backoffMs / 1000)}s`);
        await sleep(backoffMs);
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error: any) {
      lastError = error;

      // Network errors - retry with small backoff
      if (attempt < 2 && (error.message.includes('fetch') || error.message.includes('network'))) {
        attempt++;
        const backoffMs = 5000;
        console.log(`    ⏳ Network error for wallet ${wallet.substring(0, 16)}..., retrying in ${backoffMs / 1000}s`);
        await sleep(backoffMs);
        continue;
      }

      console.error(`    ✗ Failed to fetch wallet ${wallet.substring(0, 16)}...: ${error.message}`);
      throw error;
    }
  }

  // Should not reach here, but handle it anyway
  throw lastError || new Error('Max retries exceeded');
}

// Legacy wrapper for backward compatibility
async function fetchActivities(
  wallet: string,
  conditionIds: string[],
  since?: Date,
  until?: Date,
  dryRun: boolean = false
): Promise<DataAPIActivity[]> {
  return fetchActivityWithBackoff(wallet, conditionIds, since, until, 0, dryRun);
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

export async function ingestExternalTrades(options: CLIOptions): Promise<{
  trades: number;
  shares: number;
  value: number;
}> {
  const { wallets, conditionIds, since, until, dryRun, walletDelayMs } = options;

  console.log('Fetching activities from Polymarket Data-API...');
  console.log('');

  let allActivities: DataAPIActivity[] = [];

  for (const wallet of wallets) {
    console.log(`  Querying wallet: ${wallet}`);

    try {
      const activities = await fetchActivityWithBackoff(
        wallet,
        conditionIds,
        since,
        until,
        walletDelayMs,
        dryRun
      );
      console.log(`    Found ${activities.length} activities`);
      allActivities = [...allActivities, ...activities];
    } catch (error: any) {
      console.error(`    ❌ Failed: ${error.message}`);
      // Continue with other wallets
    }

    console.log('');
  }

  console.log(`Total activities fetched: ${allActivities.length}`);
  console.log('');

  // Filter to TRADE events only
  const tradeActivities = allActivities.filter(a => a.type === 'TRADE');
  console.log(`Trades (type=TRADE): ${tradeActivities.length}`);
  console.log('');

  if (tradeActivities.length === 0) {
    console.log('⚠️  NO TRADES FOUND');
    console.log('');
    return { trades: 0, shares: 0, value: 0 };
  }

  // Transform to external_trades_raw schema
  console.log('Transforming to external_trades_raw schema...');
  console.log('');

  const externalTrades = transformToExternalTrades(tradeActivities);

  console.log(`Transformed ${externalTrades.length} trade rows`);
  console.log('');

  // Show sample rows
  console.log('Sample transformed rows:');
  console.log('');

  if (externalTrades.length > 0) {
    for (const trade of externalTrades.slice(0, 3)) {
      console.log(`  Trade ID: ${trade.external_trade_id.substring(0, 40)}...`);
      console.log(`    Wallet:    ${trade.wallet_address.substring(0, 16)}...`);
      console.log(`    Market:    ${trade.condition_id.substring(0, 16)}...`);
      console.log(`    Side:      ${trade.side}`);
      console.log(`    Shares:    ${trade.shares}`);
      console.log(`    Price:     ${trade.price}`);
      console.log(`    Value:     $${trade.cash_value.toFixed(2)}`);
      console.log(`    Timestamp: ${trade.trade_timestamp.toISOString()}`);
      console.log('');
    }
  }

  // Calculate summary stats
  const totalShares = externalTrades.reduce((sum, t) => sum + t.shares, 0);
  const totalValue = externalTrades.reduce((sum, t) => sum + t.cash_value, 0);
  const uniqueMarkets = new Set(externalTrades.map(t => t.condition_id)).size;

  console.log('Summary Statistics:');
  console.log(`  Total Trades:      ${externalTrades.length}`);
  console.log(`  Total Shares:      ${totalShares.toFixed(2)}`);
  console.log(`  Total Value:       $${totalValue.toFixed(2)}`);
  console.log(`  Unique Markets:    ${uniqueMarkets}`);
  console.log(`  Unique Wallets:    ${new Set(externalTrades.map(t => t.wallet_address)).size}`);
  console.log('');

  // Insert into ClickHouse (if not dry-run)
  if (dryRun) {
    console.log('═'.repeat(80));
    console.log('DRY RUN COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log('✅ Data fetched and transformed successfully');
    console.log('✅ No insertions made (dry-run mode)');
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
  }

  return {
    trades: externalTrades.length,
    shares: totalShares,
    value: totalValue
  };
}

async function main() {
  const options = parseCLIArgs();

  // Phase 5.2: Load wallets from ghost_market_wallets table if flag is set
  if (options.fromGhostWallets) {
    console.log('═'.repeat(80));
    console.log('Phase 5.2: Loading Ghost Market Wallets from Database');
    console.log('═'.repeat(80));
    console.log('');

    try {
      // Query distinct wallets
      const walletsResult = await clickhouse.query({
        query: `SELECT DISTINCT wallet FROM ghost_market_wallets ORDER BY wallet`,
        format: 'JSONEachRow'
      });
      const walletRows: any[] = await walletsResult.json();
      options.wallets = walletRows.map(row => row.wallet);

      console.log(`✅ Loaded ${options.wallets.length} unique wallets from ghost_market_wallets table`);
      console.log('');

      // Query distinct condition_ids
      const conditionsResult = await clickhouse.query({
        query: `SELECT DISTINCT condition_id FROM ghost_market_wallets ORDER BY condition_id`,
        format: 'JSONEachRow'
      });
      const conditionRows: any[] = await conditionsResult.json();
      options.conditionIds = conditionRows.map(row => row.condition_id);

      console.log(`✅ Loaded ${options.conditionIds.length} unique condition_ids from ghost_market_wallets table`);
      console.log('');

      // Show breakdown by market
      const breakdownResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            COUNT(DISTINCT wallet) as wallet_count
          FROM ghost_market_wallets
          GROUP BY condition_id
          ORDER BY wallet_count DESC
        `,
        format: 'JSONEachRow'
      });
      const breakdown: any[] = await breakdownResult.json();

      console.log('Ghost Market Breakdown:');
      breakdown.forEach(row => {
        console.log(`  ${row.condition_id.substring(0, 24)}... → ${row.wallet_count} wallets`);
      });
      console.log('');

    } catch (error: any) {
      console.error('❌ Failed to load ghost market wallets from database:', error.message);
      console.error('Make sure ghost_market_wallets table exists (run scripts/216-create-ghost-market-wallets-table.ts)');
      throw error;
    }
  }

  // Phase 7.1: Load wallets from ghost_market_wallets_all table if flag is set
  if (options.fromGhostWalletsAll) {
    console.log('═'.repeat(80));
    console.log('Phase 7.1: Loading ALL Ghost Market Wallets from Global Table');
    console.log('═'.repeat(80));
    console.log('');

    try {
      // Query distinct wallets
      const walletsResult = await clickhouse.query({
        query: `SELECT DISTINCT wallet FROM ghost_market_wallets_all ORDER BY wallet`,
        format: 'JSONEachRow'
      });
      const walletRows: any[] = await walletsResult.json();
      options.wallets = walletRows.map(row => row.wallet);

      console.log(`✅ Loaded ${options.wallets.length} unique wallets from ghost_market_wallets_all table`);
      console.log('');

      // Query distinct condition_ids
      const conditionsResult = await clickhouse.query({
        query: `SELECT DISTINCT condition_id FROM ghost_market_wallets_all ORDER BY condition_id`,
        format: 'JSONEachRow'
      });
      const conditionRows: any[] = await conditionsResult.json();
      options.conditionIds = conditionRows.map(row => row.condition_id);

      console.log(`✅ Loaded ${options.conditionIds.length} unique condition_ids from ghost_market_wallets_all table`);
      console.log('');

      // Show top 10 markets by wallet count
      const breakdownResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            COUNT(DISTINCT wallet) as wallet_count
          FROM ghost_market_wallets_all
          GROUP BY condition_id
          ORDER BY wallet_count DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      });
      const breakdown: any[] = await breakdownResult.json();

      console.log('Top 10 Ghost Markets by Wallet Count:');
      breakdown.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.condition_id.substring(0, 24)}... → ${row.wallet_count} wallets`);
      });
      console.log('');

    } catch (error: any) {
      console.error('❌ Failed to load global ghost market wallets from database:', error.message);
      console.error('Make sure ghost_market_wallets_all table exists (run scripts/219-batch-discover-ghost-wallets.ts)');
      throw error;
    }
  }

  console.log('═'.repeat(80));
  console.log('Phase 5: Generalized Data-API Connector');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Mode: ${options.dryRun ? '🔍 DRY RUN (no insertions)' : '✍️  LIVE (will insert)'}`);
  console.log('');

  console.log('Configuration:');
  console.log(`  Wallets:           ${options.wallets.length}`);
  console.log(`  Condition IDs:     ${options.conditionIds.length}`);
  console.log(`  Time Range:        ${options.since ? options.since.toISOString().split('T')[0] : 'all'} → ${options.until ? options.until.toISOString().split('T')[0] : 'now'}`);
  console.log('');

  if (options.fromGhostWalletsAll) {
    console.log('📍 Running in GLOBAL GHOST WALLETS mode (from ghost_market_wallets_all table)');
    console.log('');
  } else if (options.fromGhostWallets) {
    console.log('📍 Running in GHOST WALLETS mode (from ghost_market_wallets table)');
    console.log('');
  } else if (options.wallets.length === DEFAULT_WALLETS.length &&
      options.conditionIds.length === DEFAULT_CONDITION_IDS.length) {
    console.log('📍 Running in DEFAULT mode (xcnstrategy ghost markets)');
    console.log('');
  }

  console.log('Wallets:');
  for (const wallet of options.wallets.slice(0, 5)) {
    console.log(`  ${wallet}`);
  }
  if (options.wallets.length > 5) {
    console.log(`  ... and ${options.wallets.length - 5} more`);
  }
  console.log('');

  console.log('Markets:');
  for (const cid of options.conditionIds.slice(0, 5)) {
    console.log(`  ${cid.substring(0, 32)}...`);
  }
  if (options.conditionIds.length > 5) {
    console.log(`  ... and ${options.conditionIds.length - 5} more`);
  }
  console.log('');

  try {
    const result = await ingestExternalTrades(options);

    console.log('═'.repeat(80));
    console.log('INGESTION COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`✅ ${result.trades} trades processed`);
    console.log(`✅ ${result.shares.toFixed(2)} shares ingested`);
    console.log(`✅ $${result.value.toFixed(2)} total value`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Ingestion failed:', error.message);
    throw error;
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
