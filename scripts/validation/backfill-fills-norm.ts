#!/usr/bin/env npx tsx
/**
 * Backfill pm_fills_norm_v1 - Pre-normalized fills table
 *
 * Creates a pre-joined table combining pm_trader_events_v3 with pm_token_to_condition_map_v5
 * for faster PnL queries. Uses a Dictionary for efficient lookups instead of JOIN.
 *
 * Usage:
 *   npx tsx scripts/validation/backfill-fills-norm.ts
 *   npx tsx scripts/validation/backfill-fills-norm.ts --create-only  # Just create table + dictionary
 *   npx tsx scripts/validation/backfill-fills-norm.ts --start-from=5  # Resume from chunk 5
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 600000, // 10 minute timeout
});

// Hex characters for wallet bucketing (16 buckets based on first char after 0x)
const HEX_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

interface BackfillProgress {
  chunk: number;
  hexChar: string;
  rowsInserted: number;
  durationMs: number;
}

async function createDictionary(): Promise<boolean> {
  console.log('Creating token map dictionary...');

  try {
    await ch.command({
      query: `
        CREATE DICTIONARY IF NOT EXISTS pm_token_map_dict (
          token_id_dec String,
          condition_id String,
          outcome_index Int64
        )
        PRIMARY KEY token_id_dec
        SOURCE(CLICKHOUSE(
          TABLE 'pm_token_to_condition_map_v5'
          DB 'default'
        ))
        LAYOUT(HASHED())
        LIFETIME(MIN 3600 MAX 7200)
      `
    });
    console.log('  ✅ Dictionary created (or already exists)');
    return true;
  } catch (error) {
    console.error('  ❌ Failed to create dictionary:', error);
    return false;
  }
}

async function createTable(): Promise<boolean> {
  console.log('Creating pm_fills_norm_v1 table...');

  try {
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_fills_norm_v1 (
          wallet String,
          ts DateTime,
          tx_hash String,
          event_id String,
          condition_id String,
          outcome_index UInt8,
          side String,
          token_amount Float64,
          usdc_amount Float64,
          fee_amount Float64,
          role String,
          _created_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(_created_at)
        ORDER BY (wallet, condition_id, outcome_index, ts, event_id)
      `
    });
    console.log('  ✅ Table created (or already exists)');
    return true;
  } catch (error) {
    console.error('  ❌ Failed to create table:', error);
    return false;
  }
}

async function getTableStats(): Promise<{ rows: number; sizeBytes: number }> {
  try {
    const result = await ch.query({
      query: `
        SELECT
          count() as rows,
          sum(bytes_on_disk) as size_bytes
        FROM system.parts
        WHERE database = currentDatabase()
          AND table = 'pm_fills_norm_v1'
          AND active = 1
      `,
      format: 'JSONEachRow'
    });
    const stats = (await result.json()) as any[];
    return {
      rows: parseInt(stats[0]?.rows || '0'),
      sizeBytes: parseInt(stats[0]?.size_bytes || '0')
    };
  } catch {
    return { rows: 0, sizeBytes: 0 };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

async function backfillChunk(hexChar: string, chunkIndex: number): Promise<BackfillProgress> {
  const startTime = Date.now();

  // Wallet ranges based on hex character
  // e.g., hexChar='0' means wallets starting with 0x0...
  const lowerBound = `0x${hexChar}`;
  const upperChar = HEX_CHARS[HEX_CHARS.indexOf(hexChar) + 1] || 'g';
  const upperBound = `0x${upperChar}`;

  console.log(`\n[Chunk ${chunkIndex + 1}/${HEX_CHARS.length}] Processing wallets ${lowerBound}* to ${upperBound}*...`);

  try {
    // Use dictionary lookup instead of JOIN - much more memory efficient
    // Process in 16 sub-batches (2-char prefix) for larger chunks
    console.log(`  Processing in 16 sub-batches with dictionary lookup...`);

    let subBatchesComplete = 0;
    let errorCount = 0;
    const MAX_ERRORS = 5;

    for (let sub1 = 0; sub1 < 16; sub1++) {
      const subHex1 = HEX_CHARS[sub1];
      const subLower = `0x${hexChar}${subHex1}`;
      const subUpper = sub1 < 15
        ? `0x${hexChar}${HEX_CHARS[sub1 + 1]}`
        : upperBound;

      try {
        await ch.command({
          query: `
            INSERT INTO pm_fills_norm_v1 (wallet, ts, tx_hash, event_id, condition_id, outcome_index, side, token_amount, usdc_amount, fee_amount, role)
            SELECT
              lower(trader_wallet) as wallet,
              trade_time as ts,
              substring(event_id, 1, 66) as tx_hash,
              event_id,
              dictGet('pm_token_map_dict', 'condition_id', token_id) as condition_id,
              toUInt8(dictGet('pm_token_map_dict', 'outcome_index', token_id)) as outcome_index,
              side,
              token_amount / 1000000.0 as token_amount,
              usdc_amount / 1000000.0 as usdc_amount,
              fee_amount / 1000000.0 as fee_amount,
              role
            FROM pm_trader_events_v3
            WHERE lower(trader_wallet) >= '${subLower}'
              AND lower(trader_wallet) < '${subUpper}'
              AND dictGet('pm_token_map_dict', 'condition_id', token_id) != ''
            SETTINGS max_execution_time = 600
          `,
          clickhouse_settings: {
            max_execution_time: 600
          }
        });
      } catch (err: any) {
        errorCount++;
        console.log(`\n  ⚠️  Error in sub-batch ${subLower}: ${err.message?.substring(0, 100)}... (${errorCount}/${MAX_ERRORS})`);
        if (errorCount >= MAX_ERRORS) {
          throw err;
        }
        // Wait and continue with next sub-batch
        await new Promise(r => setTimeout(r, 3000));
      }

      subBatchesComplete++;
      process.stdout.write(`  Sub-batch ${subBatchesComplete}/16 complete (${Math.round(subBatchesComplete / 16 * 100)}%)\r`);
    }
    console.log(`  Sub-batch 16/16 complete (100%)          `);

    // Count rows inserted for this chunk
    const countResult = await ch.query({
      query: `
        SELECT count() as cnt
        FROM pm_fills_norm_v1
        WHERE wallet >= '${lowerBound}' AND wallet < '${upperBound}'
      `,
      format: 'JSONEachRow'
    });
    const count = (await countResult.json()) as any[];
    const totalInserted = parseInt(count[0]?.cnt || '0');

    const durationMs = Date.now() - startTime;
    console.log(`  ✅ Inserted ${totalInserted.toLocaleString()} rows in ${formatDuration(durationMs)}`);

    return {
      chunk: chunkIndex,
      hexChar,
      rowsInserted: totalInserted,
      durationMs
    };

  } catch (error) {
    console.error(`  ❌ Error processing chunk ${hexChar}:`, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const createOnly = args.includes('--create-only');
  const startFromArg = args.find(a => a.startsWith('--start-from='));
  const startFrom = startFromArg ? parseInt(startFromArg.split('=')[1]) : 0;

  console.log('\n' + '='.repeat(70));
  console.log('  BACKFILL pm_fills_norm_v1 - Pre-normalized fills table');
  console.log('='.repeat(70));

  // Step 1: Create dictionary (for efficient lookups)
  const dictCreated = await createDictionary();
  if (!dictCreated) {
    process.exit(1);
  }

  // Step 2: Create table
  const created = await createTable();
  if (!created) {
    process.exit(1);
  }

  if (createOnly) {
    console.log('\n--create-only flag set, exiting after table/dictionary creation.');
    await ch.close();
    return;
  }

  // Get initial stats
  const initialStats = await getTableStats();
  console.log(`\nInitial state: ${initialStats.rows.toLocaleString()} rows, ${formatBytes(initialStats.sizeBytes)}`);

  if (startFrom > 0) {
    console.log(`\nResuming from chunk ${startFrom} (wallets starting with 0x${HEX_CHARS[startFrom]}...)`);
  }

  // Step 3: Backfill in chunks
  console.log(`\nBackfilling ${HEX_CHARS.length - startFrom} chunks (0x0-0xf wallet ranges)...`);
  const startTime = Date.now();

  const results: BackfillProgress[] = [];
  let totalRows = 0;

  for (let i = startFrom; i < HEX_CHARS.length; i++) {
    try {
      const result = await backfillChunk(HEX_CHARS[i], i);
      results.push(result);
      totalRows += result.rowsInserted;

      // Progress update
      const elapsed = Date.now() - startTime;
      const chunksComplete = i - startFrom + 1;
      const chunksRemaining = HEX_CHARS.length - i - 1;
      const avgTimePerChunk = elapsed / chunksComplete;
      const eta = chunksRemaining * avgTimePerChunk;

      console.log(`  Progress: ${chunksComplete}/${HEX_CHARS.length - startFrom} chunks | ` +
                  `Total: ${totalRows.toLocaleString()} rows | ` +
                  `ETA: ${formatDuration(eta)}`);

    } catch (error) {
      console.error(`\n⚠️  Error at chunk ${i} (0x${HEX_CHARS[i]}). Resume with: --start-from=${i}`);
      await ch.close();
      process.exit(1);
    }
  }

  // Final stats
  const finalStats = await getTableStats();
  const totalDuration = Date.now() - startTime;

  console.log('\n' + '='.repeat(70));
  console.log('  BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Rows inserted: ${totalRows.toLocaleString()}`);
  console.log(`  Final table size: ${finalStats.rows.toLocaleString()} rows, ${formatBytes(finalStats.sizeBytes)}`);
  console.log(`  Total duration: ${formatDuration(totalDuration)}`);
  console.log('='.repeat(70) + '\n');

  // Verify with a sample query
  console.log('Verifying with sample query...');
  const sample = await ch.query({
    query: `
      SELECT wallet, condition_id, count() as trades
      FROM pm_fills_norm_v1
      GROUP BY wallet, condition_id
      ORDER BY trades DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleRows = await sample.json() as any[];
  console.log('Top 5 wallet-condition pairs by trade count:');
  for (const r of sampleRows) {
    console.log(`  ${r.wallet} | ${r.condition_id.substring(0, 16)}... | ${r.trades} trades`);
  }

  await ch.close();
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await ch.close();
  process.exit(1);
});
