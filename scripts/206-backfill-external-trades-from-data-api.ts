#!/usr/bin/env tsx
/**
 * Phase 7: Automated Backfill Driver for External Trades
 *
 * Purpose: Process wallet_backfill_plan systematically, ingesting external
 *          trades for each wallet via the Polymarket Data-API connector.
 *
 * Strategy:
 *   1. Read pending wallets from wallet_backfill_plan (priority order)
 *   2. For each wallet, call ingestExternalTrades() from script 203
 *   3. Update status: pending → in_progress → done/error
 *   4. Rate limiting: sleep between wallets to avoid API limits
 *   5. Resumable: can be stopped and restarted without losing progress
 *
 * Usage:
 *   npx tsx scripts/206-backfill-external-trades-from-data-api.ts [options]
 *
 * Options:
 *   --limit N         Process at most N wallets (default: all pending)
 *   --skip N          Skip first N pending wallets
 *   --dry-run         Preview mode (no actual ingestion or status updates)
 *   --sleep-ms N      Sleep N milliseconds between wallets (default: 2000)
 *   --since YYYY-MM-DD  Fetch trades from this date onwards
 *   --until YYYY-MM-DD  Fetch trades up to this date
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { ingestExternalTrades } from './203-ingest-amm-trades-from-data-api.js';

// Configuration
const DEFAULT_SLEEP_MS = 2000; // 2 seconds between wallets (30 wallets/min max)
const DEFAULT_START_DATE = '2020-05-01'; // Polymarket launch

interface BackfillOptions {
  limit?: number;
  skip: number;
  dryRun: boolean;
  sleepMs: number;
  since?: Date;
  until?: Date;
}

interface WalletPlanRow {
  wallet_address: string;
  trade_count: number;
  notional: number;
  priority_rank: number;
  status: string;
}

function parseCLIArgs(): BackfillOptions {
  const args = process.argv.slice(2);

  const options: BackfillOptions = {
    limit: undefined,
    skip: 0,
    dryRun: args.includes('--dry-run'),
    sleepMs: DEFAULT_SLEEP_MS,
    since: new Date(DEFAULT_START_DATE),
    until: undefined
  };

  // Parse --limit
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1]);
      i++;
    }
  }

  // Parse --skip
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) {
      options.skip = parseInt(args[i + 1]);
      i++;
    }
  }

  // Parse --sleep-ms
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sleep-ms' && args[i + 1]) {
      options.sleepMs = parseInt(args[i + 1]);
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

  return options;
}

async function getPendingWallets(skip: number, limit?: number): Promise<WalletPlanRow[]> {
  const limitClause = limit ? `LIMIT ${limit}` : '';

  const query = `
    SELECT
      wallet_address,
      trade_count,
      notional,
      priority_rank,
      status
    FROM wallet_backfill_plan
    WHERE status = 'pending'
    ORDER BY priority_rank ASC
    ${limitClause}
    OFFSET ${skip}
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  return result.json<WalletPlanRow[]>();
}

async function updateWalletStatus(
  walletAddress: string,
  status: 'in_progress' | 'done' | 'error',
  errorMessage: string = ''
) {
  const query = `
    ALTER TABLE wallet_backfill_plan
    UPDATE
      status = '${status}',
      error_message = '${errorMessage.replace(/'/g, "\\'")}',
      last_run_at = now(),
      updated_at = now()
    WHERE wallet_address = '${walletAddress}'
  `;

  await clickhouse.command({ query });
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processWallet(
  wallet: WalletPlanRow,
  options: BackfillOptions
): Promise<{ success: boolean; error?: string }> {
  const { since, until, dryRun } = options;

  console.log(`  Processing wallet ${wallet.wallet_address.substring(0, 16)}...`);
  console.log(`    Rank: ${wallet.priority_rank}`);
  console.log(`    CLOB trades: ${wallet.trade_count.toLocaleString()}`);
  console.log(`    Notional: $${wallet.notional.toFixed(2)}`);
  console.log('');

  try {
    // Mark as in_progress (unless dry-run)
    if (!dryRun) {
      await updateWalletStatus(wallet.wallet_address, 'in_progress');
    }

    // Call the generalized Data-API connector
    // Note: We're fetching ALL markets for this wallet, not filtering by condition_id
    const result = await ingestExternalTrades({
      wallets: [wallet.wallet_address],
      conditionIds: [], // Empty = fetch all markets
      since,
      until,
      dryRun
    });

    console.log(`    ✅ Ingested ${result.trades} trades`);
    console.log(`    ✅ ${result.shares.toFixed(2)} shares`);
    console.log(`    ✅ $${result.value.toFixed(2)} value`);
    console.log('');

    // Mark as done (unless dry-run)
    if (!dryRun) {
      await updateWalletStatus(wallet.wallet_address, 'done');
    }

    return { success: true };

  } catch (error: any) {
    console.error(`    ❌ Failed: ${error.message}`);
    console.log('');

    // Mark as error (unless dry-run)
    if (!dryRun) {
      await updateWalletStatus(wallet.wallet_address, 'error', error.message);
    }

    return { success: false, error: error.message };
  }
}

async function main() {
  const options = parseCLIArgs();

  console.log('═'.repeat(80));
  console.log('Phase 7: Automated External Trade Backfill Driver');
  console.log('═'.repeat(80));
  console.log('');

  console.log(`Mode: ${options.dryRun ? '🔍 DRY RUN (no ingestion or status updates)' : '✍️  LIVE (will ingest and update status)'}`);
  console.log('');

  console.log('Configuration:');
  console.log(`  Skip:       ${options.skip} wallets`);
  console.log(`  Limit:      ${options.limit ? options.limit + ' wallets' : 'all pending wallets'}`);
  console.log(`  Sleep:      ${options.sleepMs}ms between wallets`);
  console.log(`  Date Range: ${options.since ? options.since.toISOString().split('T')[0] : 'all'} → ${options.until ? options.until.toISOString().split('T')[0] : 'now'}`);
  console.log('');

  // Fetch pending wallets
  console.log('Fetching pending wallets from wallet_backfill_plan...');
  console.log('');

  const pendingWallets = await getPendingWallets(options.skip, options.limit);

  if (pendingWallets.length === 0) {
    console.log('⚠️  No pending wallets found');
    console.log('');
    console.log('All wallets may already be processed, or try adjusting --skip/--limit');
    return;
  }

  console.log(`Found ${pendingWallets.length} pending wallets to process`);
  console.log('');

  // Process each wallet
  const results: Array<{
    wallet: string;
    rank: number;
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < pendingWallets.length; i++) {
    const wallet = pendingWallets[i];

    console.log(`─`.repeat(80));
    console.log(`Wallet ${i + 1}/${pendingWallets.length}`);
    console.log(`─`.repeat(80));
    console.log('');

    const result = await processWallet(wallet, options);

    results.push({
      wallet: wallet.wallet_address.substring(0, 16) + '...',
      rank: wallet.priority_rank,
      success: result.success,
      error: result.error
    });

    // Sleep between wallets (unless last one or dry-run)
    if (i < pendingWallets.length - 1 && !options.dryRun) {
      console.log(`Sleeping ${options.sleepMs}ms before next wallet...`);
      console.log('');
      await sleep(options.sleepMs);
    }
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('BACKFILL SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  console.log(`Total wallets processed: ${results.length}`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Errors:  ${errorCount}`);
  console.log('');

  if (errorCount > 0) {
    console.log('Failed wallets:');
    console.table(results.filter(r => !r.success));
    console.log('');
  }

  // Show updated plan status
  if (!options.dryRun) {
    console.log('Updated backfill plan status:');
    console.log('');

    const statusResult = await clickhouse.query({
      query: `
        SELECT
          status,
          COUNT(*) as wallet_count,
          SUM(trade_count) as total_trades,
          SUM(notional) as total_notional
        FROM wallet_backfill_plan
        GROUP BY status
        ORDER BY status
      `,
      format: 'JSONEachRow'
    });

    const statusBreakdown = await statusResult.json();
    console.table(statusBreakdown);
    console.log('');
  }

  console.log('Next Steps:');
  console.log('  1. Review error messages if any wallets failed');
  console.log('  2. Re-run with --skip to continue from next batch');
  console.log('  3. Validate ingestion via scripts/204-validate-external-ingestion.ts');
  console.log('  4. Proceed to Phase 8: Generate coverage metrics');
  console.log('');

  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Backfill driver failed:', error);
  process.exit(1);
});
