#!/usr/bin/env tsx
/**
 * Apply Backlog to ClickHouse (WRITE-ONLY after gates pass)
 *
 * PURPOSE:
 * Bulk-insert trades from NDJSON backlog file into ClickHouse trades_raw table.
 * Safely manages mutations and provides crash-resumability.
 *
 * SAFETY:
 * - Waits for mutations to clear before each batch
 * - Respects mutation limit (max 900 pending)
 * - Checkpoint-based resume after crashes
 * - SIGINT/SIGTERM handlers for graceful shutdown
 *
 * INPUT:
 * - runtime/ingest_backlog.jsonl (from goldsky shadow mode)
 *
 * CHECKPOINT:
 * - runtime/apply-backlog.checkpoint.json (lines_applied, last_batch_idx)
 *
 * USAGE:
 * npx tsx scripts/apply-backlog-to-clickhouse.ts
 * npx tsx scripts/apply-backlog-to-clickhouse.ts --resume
 * npx tsx scripts/apply-backlog-to-clickhouse.ts --backlog=runtime/ingest_backlog.jsonl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { waitUntilSafeToMutate, getMutationStatus } from '@/lib/clickhouse/mutations'

// Parse command-line arguments
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const BACKLOG_FILE = getArg('backlog') || resolve(process.cwd(), 'runtime/ingest_backlog.jsonl')
const CHECKPOINT_FILE = resolve(process.cwd(), 'runtime/apply-backlog.checkpoint.json')
const BATCH_SIZE = parseInt(getArg('batch-size') || '5000')
const MAX_PENDING_MUTATIONS = 900
const RESUME = process.argv.includes('--resume')

interface PreparedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string
  timestamp: number
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
  realized_pnl_usd: number
  is_resolved: number
}

interface Checkpoint {
  lines_applied: number
  batch_idx: number
  total_inserted: number
  timestamp: string
}

let shutdownRequested = false

/**
 * Load checkpoint if exists
 */
function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const content = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.warn('⚠️  Failed to load checkpoint:', error)
  }
  return null
}

/**
 * Save checkpoint
 */
function saveCheckpoint(checkpoint: Checkpoint): void {
  try {
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
  } catch (error) {
    console.error('❌ Failed to save checkpoint:', error)
  }
}

/**
 * Load trades from NDJSON backlog file
 */
function loadBacklogTrades(startLine: number = 0): PreparedTrade[] {
  if (!fs.existsSync(BACKLOG_FILE)) {
    throw new Error(`Backlog file not found: ${BACKLOG_FILE}`)
  }

  console.log(`📄 Loading trades from: ${BACKLOG_FILE}`)
  console.log(`   Starting from line: ${startLine}`)

  const content = fs.readFileSync(BACKLOG_FILE, 'utf-8')
  const lines = content.split('\n').filter(Boolean)

  console.log(`   Total lines in file: ${lines.length.toLocaleString()}`)

  const trades: PreparedTrade[] = []
  let parseErrors = 0

  for (let i = startLine; i < lines.length; i++) {
    try {
      const trade = JSON.parse(lines[i]) as PreparedTrade
      trades.push(trade)
    } catch (error) {
      console.warn(`⚠️  Failed to parse line ${i + 1}: ${error}`)
      parseErrors++
    }
  }

  console.log(`   Loaded ${trades.length.toLocaleString()} valid trades`)
  if (parseErrors > 0) {
    console.log(`   Skipped ${parseErrors} lines with parse errors`)
  }

  return trades
}

/**
 * Insert batch of trades to ClickHouse
 */
async function insertBatch(trades: PreparedTrade[]): Promise<void> {
  if (trades.length === 0) {
    return
  }

  try {
    await clickhouse.insert({
      table: 'trades_raw',
      values: trades,
      format: 'JSONEachRow',
    })
  } catch (error) {
    console.error('❌ Failed to insert batch:', error)
    throw error
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('📥 Apply Backlog to ClickHouse\n')

  // Check if backlog file exists
  if (!fs.existsSync(BACKLOG_FILE)) {
    throw new Error(`Backlog file not found: ${BACKLOG_FILE}\nRun goldsky loader in shadow mode first.`)
  }

  // Load checkpoint if resuming
  let checkpoint: Checkpoint | null = null
  if (RESUME) {
    checkpoint = loadCheckpoint()
    if (checkpoint) {
      console.log(`📌 Resuming from checkpoint:`)
      console.log(`   Lines applied: ${checkpoint.lines_applied.toLocaleString()}`)
      console.log(`   Batch index: ${checkpoint.batch_idx}`)
      console.log(`   Total inserted: ${checkpoint.total_inserted.toLocaleString()}`)
      console.log(`   Last updated: ${checkpoint.timestamp}\n`)
    } else {
      console.log('⚠️  No checkpoint found, starting fresh\n')
    }
  }

  const startLine = checkpoint ? checkpoint.lines_applied : 0
  let totalInserted = checkpoint ? checkpoint.total_inserted : 0
  let batchIdx = checkpoint ? checkpoint.batch_idx + 1 : 0

  // Load all trades from backlog (skipping already-applied lines)
  const allTrades = loadBacklogTrades(startLine)

  if (allTrades.length === 0) {
    console.log('\n✅ No trades to apply - backlog is empty or fully applied')
    return
  }

  console.log(`\n📊 Backlog summary:`)
  console.log(`   Total trades to insert: ${allTrades.length.toLocaleString()}`)
  console.log(`   Batch size: ${BATCH_SIZE.toLocaleString()}`)
  console.log(`   Estimated batches: ${Math.ceil(allTrades.length / BATCH_SIZE)}`)
  console.log(`   Max pending mutations: ${MAX_PENDING_MUTATIONS}\n`)

  // Setup signal handlers
  process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT - saving checkpoint and shutting down...')
    shutdownRequested = true
  })

  process.on('SIGTERM', async () => {
    console.log('\n\n⚠️  Received SIGTERM - saving checkpoint and shutting down...')
    shutdownRequested = true
  })

  const startTime = Date.now()

  // Process trades in batches
  for (let i = 0; i < allTrades.length; i += BATCH_SIZE) {
    if (shutdownRequested) {
      console.log('\n⚠️  Shutdown requested - saving checkpoint and exiting...')
      const finalCheckpoint: Checkpoint = {
        lines_applied: startLine + i,
        batch_idx: batchIdx - 1,
        total_inserted: totalInserted,
        timestamp: new Date().toISOString()
      }
      saveCheckpoint(finalCheckpoint)
      console.log(`✅ Checkpoint saved. Resume with: npx tsx scripts/apply-backlog-to-clickhouse.ts --resume`)
      process.exit(0)
    }

    const batch = allTrades.slice(i, i + BATCH_SIZE)
    const progress = ((i + batch.length) / allTrades.length * 100).toFixed(1)

    console.log(`\n[Batch ${batchIdx + 1}] ${progress}% - Inserting ${batch.length.toLocaleString()} trades...`)

    // Wait for safe mutation window
    console.log('   ⏳ Checking mutation status...')
    await waitUntilSafeToMutate({
      maxPending: MAX_PENDING_MUTATIONS,
      pollIntervalMs: 5000,
      timeoutMs: 30 * 60 * 1000 // 30 minute timeout
    })

    const mutationStatus = await getMutationStatus()
    console.log(`   ✅ Safe to mutate (${mutationStatus.pending} pending mutations)`)

    // Insert batch
    console.log(`   📥 Inserting batch...`)
    await insertBatch(batch)
    totalInserted += batch.length

    console.log(`   ✅ Inserted successfully`)
    console.log(`   📊 Total inserted so far: ${totalInserted.toLocaleString()}`)

    // Save checkpoint after each batch
    const newCheckpoint: Checkpoint = {
      lines_applied: startLine + i + batch.length,
      batch_idx: batchIdx,
      total_inserted: totalInserted,
      timestamp: new Date().toISOString()
    }
    saveCheckpoint(newCheckpoint)
    console.log(`   💾 Checkpoint saved`)

    batchIdx++
  }

  // Final summary
  const endTime = Date.now()
  const durationMs = endTime - startTime
  const durationHours = durationMs / (1000 * 60 * 60)

  console.log('\n\n✅ Backlog application complete!')
  console.log('═'.repeat(60))
  console.log(`📊 Summary:`)
  console.log(`   Total trades inserted: ${totalInserted.toLocaleString()}`)
  console.log(`   Batches processed: ${batchIdx}`)
  console.log(`   Duration: ${durationHours.toFixed(2)} hours`)
  console.log(`   Average: ${(totalInserted / (durationMs / 1000 / 60)).toFixed(0)} trades/minute`)
  console.log('═'.repeat(60))
  console.log('\n📁 Files:')
  console.log(`   Backlog file: ${BACKLOG_FILE}`)
  console.log(`   Checkpoint: ${CHECKPOINT_FILE}`)
  console.log('\n📊 Next steps:')
  console.log('   1. Run full-enrichment-pass.ts to enrich the new trades')
  console.log('   2. Run print-gates.ts to verify data integrity')
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}

export { main }
