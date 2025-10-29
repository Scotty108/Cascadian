#!/usr/bin/env tsx
/**
 * Run Step D (Resumable): Populate P&L and Resolution Flags
 *
 * CRASH-RESUMABLE with dual checkpointing:
 * - Local: runtime/full-enrichment.state.json
 * - Remote: Supabase ops_job_checkpoints table
 *
 * USAGE:
 * # Fresh start
 * nohup BATCH_SIZE=300 npx tsx scripts/run-step-d-resumable.ts >> runtime/full-enrichment.console.log 2>&1 &
 * echo $! > runtime/full-enrichment.pid
 *
 * # Resume from checkpoint
 * nohup BATCH_SIZE=300 npx tsx scripts/run-step-d-resumable.ts --resume >> runtime/full-enrichment.console.log 2>&1 &
 * echo $! > runtime/full-enrichment.pid
 *
 * # Monitor progress
 * tail -f runtime/full-enrichment.console.log
 * cat runtime/full-enrichment.state.json
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { getMutationStatus } from '@/lib/clickhouse/mutations'
import pg from 'pg'

const { Pool } = pg

const RESOLUTION_MAP_FILE = resolve(process.cwd(), 'data/expanded_resolution_map.json')
const STATE_FILE = resolve(process.cwd(), 'runtime/full-enrichment.state.json')
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '300')
const RESUME = process.argv.includes('--resume')

interface Resolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: number
  payout_no: number
}

interface CheckpointState {
  job: string
  step: string
  batch_idx: number
  pairs_done: number
  last_mutations: number
  updated_at: string
}

let postgresPool: pg.Pool | null = null

// Initialize Postgres connection (optional - gracefully fail if not configured)
try {
  if (process.env.POSTGRES_URL) {
    postgresPool = new Pool({
      connectionString: process.env.POSTGRES_URL
    })
  }
} catch (error) {
  console.log('   ⚠️  Postgres not configured - using local checkpoints only')
}

/**
 * Load checkpoint from local file
 */
function loadLocalCheckpoint(): CheckpointState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.warn('   ⚠️  Failed to load local checkpoint:', error)
  }
  return null
}

/**
 * Save checkpoint to local file
 */
function saveLocalCheckpoint(state: CheckpointState) {
  try {
    // Ensure runtime directory exists
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('   ❌ Failed to save local checkpoint:', error)
  }
}

/**
 * Load checkpoint from Supabase
 */
async function loadRemoteCheckpoint(): Promise<CheckpointState | null> {
  if (!postgresPool) return null

  try {
    const result = await postgresPool.query(
      'SELECT * FROM ops_job_checkpoints WHERE job = $1 AND step = $2',
      ['enrichment', 'D']
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]
      return {
        job: row.job,
        step: row.step,
        batch_idx: row.batch_idx,
        pairs_done: row.pairs_done,
        last_mutations: row.last_mutations,
        updated_at: row.updated_at
      }
    }
  } catch (error) {
    console.warn('   ⚠️  Failed to load remote checkpoint:', error)
  }

  return null
}

/**
 * Save checkpoint to Supabase
 */
async function saveRemoteCheckpoint(state: CheckpointState) {
  if (!postgresPool) return

  try {
    await postgresPool.query(`
      INSERT INTO ops_job_checkpoints (job, step, batch_idx, pairs_done, last_mutations, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (job, step) DO UPDATE SET
        batch_idx = EXCLUDED.batch_idx,
        pairs_done = EXCLUDED.pairs_done,
        last_mutations = EXCLUDED.last_mutations,
        updated_at = EXCLUDED.updated_at
    `, [state.job, state.step, state.batch_idx, state.pairs_done, state.last_mutations, state.updated_at])
  } catch (error) {
    console.warn('   ⚠️  Failed to save remote checkpoint:', error)
  }
}

/**
 * Save checkpoint (both local and remote)
 */
async function saveCheckpoint(batchIdx: number, pairsDone: number) {
  const mutationStatus = await getMutationStatus()

  const state: CheckpointState = {
    job: 'enrichment',
    step: 'D',
    batch_idx: batchIdx,
    pairs_done: pairsDone,
    last_mutations: mutationStatus.pending,
    updated_at: new Date().toISOString()
  }

  // Save to both locations
  saveLocalCheckpoint(state)
  await saveRemoteCheckpoint(state)
}

/**
 * Wait for mutations to complete
 */
async function waitForMutations() {
  let pending = 1
  while (pending > 0) {
    const result = await clickhouse.query({
      query: 'SELECT count() as pending FROM system.mutations WHERE is_done = 0',
      format: 'JSONEachRow'
    })
    const data = await result.json<{ pending: string }>()
    pending = parseInt(data[0].pending)
    if (pending > 0) {
      console.log(`   Waiting for ${pending} mutations to complete...`)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
}

// Signal handlers for graceful shutdown
let shutdownRequested = false

process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Received SIGINT - saving checkpoint and shutting down...')
  shutdownRequested = true
})

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Received SIGTERM - saving checkpoint and shutting down...')
  shutdownRequested = true
})

async function main() {
  console.log('📍 Step D: Populate P&L and Resolution Flags (RESUMABLE)')
  console.log(`   Using BATCH_SIZE: ${BATCH_SIZE}`)
  console.log(`   State file: ${STATE_FILE}\n`)

  // Load checkpoint if --resume flag
  let startBatchIdx = 0
  if (RESUME) {
    console.log('🔄 Attempting to resume from checkpoint...\n')

    // Try remote checkpoint first, fall back to local
    let checkpoint = await loadRemoteCheckpoint()
    if (!checkpoint) {
      checkpoint = loadLocalCheckpoint()
    }

    if (checkpoint) {
      startBatchIdx = checkpoint.batch_idx
      console.log(`   ✅ Found checkpoint at batch ${startBatchIdx}`)
      console.log(`   Pairs done: ${checkpoint.pairs_done}`)
      console.log(`   Last mutations: ${checkpoint.last_mutations}`)
      console.log(`   Timestamp: ${checkpoint.updated_at}\n`)

      // Verify mutations are clear before resuming
      const mutationStatus = await getMutationStatus()
      if (mutationStatus.pending > 0) {
        console.log(`   ⚠️  WARNING: ${mutationStatus.pending} mutations still pending`)
        console.log(`   Waiting for mutations to complete before resuming...\n`)
        await waitForMutations()
        console.log(`   ✅ Mutations clear - resuming\n`)
      }
    } else {
      console.log('   ⚠️  No checkpoint found - starting from beginning\n')
    }
  }

  // Load resolution map
  if (!fs.existsSync(RESOLUTION_MAP_FILE)) {
    throw new Error('Resolution map not found at: ' + RESOLUTION_MAP_FILE)
  }

  const content = fs.readFileSync(RESOLUTION_MAP_FILE, 'utf-8')
  const resolutionData = JSON.parse(content)

  // Validate structure (fix from Phase 1.1)
  if (!resolutionData || typeof resolutionData !== 'object') {
    throw new Error('Invalid resolution data: not an object')
  }

  if (!Array.isArray(resolutionData.resolutions)) {
    throw new Error('Invalid resolution data: resolutions is not an array')
  }

  if (resolutionData.resolutions.length === 0) {
    throw new Error('Invalid resolution data: resolutions array is empty')
  }

  console.log(`   ✅ Loaded resolution data: ${resolutionData.resolved_conditions} conditions, ${resolutionData.resolutions.length} resolutions`)

  // Build lookup by condition_id AND market_id
  const resolutionsByCondition = new Map<string, Resolution>()
  const resolutionsByMarket = new Map<string, Resolution>()

  // Iterate over resolutions array with validation (fix from Phase 1.1)
  resolutionData.resolutions.forEach((res: any, index: number) => {
    // Null check for each resolution entry
    if (!res || typeof res !== 'object') {
      console.warn(`⚠️  Skipping resolution entry at index ${index}: entry is null or not an object`)
      return
    }

    // Validate required fields exist
    if (!res.market_id) {
      console.warn(`⚠️  Skipping resolution entry at index ${index}: missing market_id`)
      return
    }

    if (res.condition_id) {
      resolutionsByCondition.set(res.condition_id, res)
    }
    resolutionsByMarket.set(res.market_id, res)
  })

  console.log(`   Loaded ${resolutionsByCondition.size} resolutions by condition_id`)
  console.log(`   Loaded ${resolutionsByMarket.size} resolutions by market_id\n`)

  // Get all distinct (wallet_address, condition_id) pairs
  console.log('   Fetching distinct (wallet, condition) pairs...')
  const pairsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet_address, condition_id, market_id FROM trades_raw WHERE condition_id != ''`,
    format: 'JSONEachRow',
  })

  const pairs = await pairsResult.json<{ wallet_address: string, condition_id: string, market_id: string }>()
  console.log(`   Found ${pairs.length} distinct (wallet, condition) pairs\n`)

  let pairsWithResolution = 0
  let tradesUpdated = 0
  let batchCount = 0

  // Calculate total batches
  const totalBatches = Math.ceil(pairs.length / BATCH_SIZE)

  // Process pairs in batches, starting from checkpoint
  for (let i = startBatchIdx * BATCH_SIZE; i < pairs.length; i += BATCH_SIZE) {
    // Check for shutdown signal
    if (shutdownRequested) {
      console.log(`\n⚠️  Shutdown requested - saving final checkpoint at batch ${batchCount}`)
      await saveCheckpoint(batchCount, i)
      console.log('✅ Checkpoint saved - exiting gracefully\n')
      process.exit(0)
    }

    const batch = pairs.slice(i, Math.min(i + BATCH_SIZE, pairs.length))
    batchCount++

    console.log(`   Processing batch ${batchCount} (pairs ${i + 1}-${Math.min(i + BATCH_SIZE, pairs.length)} of ${pairs.length})...`)

    let batchPairsWithResolution = 0
    let batchTradesUpdated = 0

    for (const { wallet_address, condition_id, market_id } of batch) {
      // Check for shutdown signal
      if (shutdownRequested) break

      // Check if we have a resolution for this condition or market
      const resolution = resolutionsByCondition.get(condition_id) || resolutionsByMarket.get(market_id)

      if (!resolution) {
        continue
      }

      batchPairsWithResolution++

      try {
        // Fetch all trades for this (wallet, condition)
        const tradesResult = await clickhouse.query({
          query: `
            SELECT
              trade_id,
              side,
              shares,
              usd_value
            FROM trades_raw
            WHERE wallet_address = '${wallet_address}' AND condition_id = '${condition_id}'
            ORDER BY timestamp ASC
          `,
          format: 'JSONEachRow',
        })

        const trades = await tradesResult.json<{
          trade_id: string,
          side: 'YES' | 'NO',
          shares: number,
          usd_value: number
        }>()

        if (trades.length === 0) continue

        // Calculate net position
        let netShares = 0
        let totalCost = 0

        for (const trade of trades) {
          const shares = trade.shares
          if (trade.side === 'YES') {
            netShares += shares
            totalCost += trade.usd_value
          } else {
            netShares -= shares
            totalCost += trade.usd_value
          }
        }

        // Determine final side
        const finalSide = netShares >= 0 ? 'YES' : 'NO'
        const absNetShares = Math.abs(netShares)

        // Calculate weighted average entry price
        const avgEntryPrice = absNetShares > 0 ? totalCost / absNetShares : 0

        // Determine outcome value (1 if won, 0 if lost)
        const outcomeValue = resolution.resolved_outcome === finalSide ? 1 : 0

        // Calculate P&L
        const pnlPerToken = outcomeValue - avgEntryPrice
        const realizedPnlUsd = pnlPerToken * absNetShares

        // Calculate proportional P&L for each trade
        const totalShares = trades.reduce((sum, t) => sum + t.shares, 0)

        for (const trade of trades) {
          const proportion = totalShares > 0 ? trade.shares / totalShares : 0
          const tradePnl = realizedPnlUsd * proportion

          await clickhouse.command({
            query: `
              ALTER TABLE trades_raw
              UPDATE
                realized_pnl_usd = ${tradePnl},
                is_resolved = 1
              WHERE trade_id = '${trade.trade_id}'
            `,
          })

          batchTradesUpdated++
        }
      } catch (error) {
        console.error(`   ❌ Error processing wallet ${wallet_address}, condition ${condition_id}:`, error)
      }
    }

    pairsWithResolution += batchPairsWithResolution
    tradesUpdated += batchTradesUpdated

    console.log(`   Batch ${batchCount} complete: ${batchPairsWithResolution} pairs with resolution, ${batchTradesUpdated} trades updated`)

    // Save checkpoint after each batch
    await saveCheckpoint(batchCount, i + BATCH_SIZE)

    // Wait for mutations every 5 batches to avoid hitting mutation limit
    if (batchCount % 5 === 0) {
      console.log(`   Waiting for mutations after batch ${batchCount}...`)
      await waitForMutations()
    }
  }

  console.log(`\n✅ Step D complete!`)
  console.log(`   Total pairs with resolution: ${pairsWithResolution}`)
  console.log(`   Total trades updated: ${tradesUpdated}`)
  console.log(`   Final checkpoint saved to: ${STATE_FILE}\n`)

  // Clean up Postgres connection
  if (postgresPool) {
    await postgresPool.end()
  }
}

// Auto-execute when run directly
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    // Try to save a checkpoint on fatal error
    if (!shutdownRequested) {
      console.log('Attempting to save emergency checkpoint...')
      // Can't use async here, just log
      console.log(`Check ${STATE_FILE} for last known state`)
    }
    process.exit(1)
  })
}
