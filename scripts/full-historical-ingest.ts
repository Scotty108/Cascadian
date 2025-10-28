#!/usr/bin/env tsx
/**
 * Full Historical Ingest Orchestrator
 *
 * PURPOSE:
 * This is a LONG-RUNNING script that performs complete historical data enrichment.
 * It runs ALL data ingestion steps in order, including ClickHouse mutations and external API calls.
 *
 * STEPS:
 * 1. Ensure ClickHouse tables ready (migrations 001, 014, 015)
 * 2. Publish dimension data (markets_dim, events_dim)
 * 3. Build/refresh global condition → market → event → category map (~50K condition_ids)
 * 4. Backfill trades_raw with correct market_id (UPDATE mutations)
 * 5. Populate realized_pnl_usd and is_resolved for ALL trades (UPDATE mutations)
 * 6. Recompute wallet_resolution_outcomes for EVERY wallet (TRUNCATE + INSERT)
 * 7. Generate final health snapshot JSON
 *
 * IDEMPOTENT: Safe to re-run. Won't duplicate data or corrupt existing records.
 *
 * PROGRESS TRACKING:
 * - Main log: runtime/full-ingest.log
 * - Progress JSONL: runtime/full-ingest.progress.jsonl (one line per step)
 * - Console log: runtime/full-ingest.console.log (when run with nohup)
 * - Final output: FINAL_HEALTH_SNAPSHOT: {json} (machine-readable)
 *
 * EXECUTION TIME: 60-90 minutes for ~50K condition_ids
 *
 * SAFETY NOTE:
 * This script DOES execute mutations and long-running API calls automatically when run.
 * It is designed to be run manually via nohup & for overnight/background execution.
 * Do NOT run multiple instances simultaneously - it will conflict.
 *
 * Usage:
 *   # Foreground (for testing)
 *   npx tsx scripts/full-historical-ingest.ts
 *
 *   # Background (recommended for production)
 *   nohup npx tsx scripts/full-historical-ingest.ts >> runtime/full-ingest.console.log 2>&1 &
 *   echo $! > runtime/full-ingest.pid
 *
 *   # Monitor progress
 *   tail -f runtime/full-ingest.log
 *   tail -f runtime/full-ingest.progress.jsonl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { getCanonicalCategoryForEvent } from '@/lib/category/canonical-category'

// ============================================================================
// LOGGING
// ============================================================================

const LOG_FILE = resolve(process.cwd(), 'runtime/full-ingest.log')
const LOOKUP_RESULTS_FILE = resolve(process.cwd(), 'data/market_id_lookup_results.jsonl')
const SUMMARY_FILE = resolve(process.cwd(), 'runtime/full-ingest-summary.json')
const PROGRESS_FILE = resolve(process.cwd(), 'runtime/full-ingest.progress.jsonl')

function log(message: string, toStdout = true) {
  const timestamp = new Date().toISOString()
  const logLine = `${timestamp} | ${message}\n`
  fs.appendFileSync(LOG_FILE, logLine)
  if (toStdout) {
    console.log(message)
  }
}

function writeProgress(progressObj: any) {
  const progressLine = JSON.stringify(progressObj) + '\n'
  fs.appendFileSync(PROGRESS_FILE, progressLine)
}

// ============================================================================
// STEP 1: ENSURE CLICKHOUSE TABLES READY
// ============================================================================

async function ensureClickHouseTables(): Promise<void> {
  log('========================================')
  log('STEP 1: Ensuring ClickHouse tables ready')
  log('========================================')

  // Check if trades_raw exists, create if not
  try {
    const tradesCheck = await clickhouse.query({
      query: 'DESCRIBE TABLE trades_raw',
      format: 'JSONEachRow'
    })
    await tradesCheck.json()
    log('✅ trades_raw table exists')
  } catch (err) {
    log('❌ trades_raw table missing - applying migration 001')
    const migration001Path = resolve(process.cwd(), 'migrations/clickhouse/001_create_trades_table.sql')
    const migration001 = fs.readFileSync(migration001Path, 'utf-8')

    // Split into individual statements (ClickHouse Cloud doesn't allow multi-statement queries)
    const statements = migration001
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    for (const statement of statements) {
      if (statement.length < 10) continue
      await clickhouse.exec({ query: statement })
    }
    log('✅ Migration 001 applied (trades_raw created)')
  }

  // Apply migration 014 to add extra columns (idempotent - uses ADD COLUMN IF NOT EXISTS)
  log('Applying migration 014 to ensure all columns exist...')
  const migration014Path = resolve(process.cwd(), 'migrations/clickhouse/014_create_ingestion_spine_tables.sql')
  const migration014 = fs.readFileSync(migration014Path, 'utf-8')

  // Split into individual statements (ClickHouse Cloud doesn't allow multi-statement queries)
  const statements = migration014
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  for (const statement of statements) {
    if (statement.length < 10) continue // Skip empty/comment-only
    try {
      await clickhouse.exec({ query: statement })
    } catch (err) {
      // Ignore "column already exists" errors (idempotent)
      const errMsg = err instanceof Error ? err.message : String(err)
      if (!errMsg.includes('already exists') && !errMsg.includes('Duplicate column')) {
        throw err
      }
    }
  }
  log('✅ Migration 014 applied (added realized_pnl_usd, is_resolved, dimension tables)')

  // Check if wallet_resolution_outcomes exists
  try {
    const resolutionCheck = await clickhouse.query({
      query: 'DESCRIBE TABLE wallet_resolution_outcomes',
      format: 'JSONEachRow'
    })
    await resolutionCheck.json()
    log('✅ wallet_resolution_outcomes table exists')
  } catch (err) {
    log('❌ wallet_resolution_outcomes table missing - applying migration 015')
    const migration015Path = resolve(process.cwd(), 'migrations/clickhouse/015_create_wallet_resolution_outcomes.sql')
    const migration015 = fs.readFileSync(migration015Path, 'utf-8')

    // Split into individual statements (ClickHouse Cloud doesn't allow multi-statement queries)
    const statements = migration015
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    for (const statement of statements) {
      if (statement.length < 10) continue
      await clickhouse.exec({ query: statement })
    }
    log('✅ Migration 015 applied')
  }

  log('✅ STEP 1 COMPLETE: All ClickHouse tables ready\n')
}

// ============================================================================
// STEP 2: PUBLISH DIMENSION DATA
// ============================================================================

async function publishDimensionData(): Promise<void> {
  log('========================================')
  log('STEP 2: Publishing dimension data')
  log('========================================')

  // Load dimension files
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')

  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  log(`Loaded ${markets.length} markets, ${events.length} events`)

  // Check if data already exists
  const marketsCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM markets_dim',
    format: 'JSONEachRow'
  })
  const marketsCountRows = await marketsCountResult.json() as any[]
  const existingMarketsCount = parseInt(marketsCountRows[0].count)

  if (existingMarketsCount > 0) {
    log(`⚠️  markets_dim already has ${existingMarketsCount} rows - skipping insert (idempotent)`)
  } else {
    log('Inserting markets_dim...')
    await clickhouse.insert({
      table: 'markets_dim',
      values: markets,
      format: 'JSONEachRow'
    })
    log(`✅ Inserted ${markets.length} markets`)
  }

  const eventsCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM events_dim',
    format: 'JSONEachRow'
  })
  const eventsCountRows = await eventsCountResult.json() as any[]
  const existingEventsCount = parseInt(eventsCountRows[0].count)

  if (existingEventsCount > 0) {
    log(`⚠️  events_dim already has ${existingEventsCount} rows - skipping insert (idempotent)`)
  } else {
    log('Inserting events_dim...')
    await clickhouse.insert({
      table: 'events_dim',
      values: events,
      format: 'JSONEachRow'
    })
    log(`✅ Inserted ${events.length} events`)
  }

  log('✅ STEP 2 COMPLETE: Dimension data published\n')
}

// ============================================================================
// STEP 3: BUILD GLOBAL CONDITION → MARKET → EVENT → CATEGORY MAP
// ============================================================================

interface ConditionMapping {
  condition_id: string
  market_id: string | null
  event_id: string | null
  canonical_category: string
  raw_tags: string[]
  resolved_at: string | null
  error: string | null
}

async function resolveConditionIdToMarket(conditionId: string): Promise<{
  market_id: string | null
  error: string | null
}> {
  try {
    const url = `https://clob.polymarket.com/markets/${conditionId}`
    const response = await fetch(url)

    if (!response.ok) {
      return { market_id: null, error: `HTTP ${response.status}` }
    }

    const data = await response.json()

    if (!data || !data.market_id) {
      return { market_id: null, error: 'No market_id in response' }
    }

    return { market_id: data.market_id, error: null }
  } catch (err) {
    return { market_id: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

async function buildGlobalConditionMap(): Promise<void> {
  log('========================================')
  log('STEP 3: Building global condition → market → event → category map')
  log('========================================')

  // Get all unique condition_ids from trades_raw
  const conditionsResult = await clickhouse.query({
    query: 'SELECT DISTINCT condition_id FROM trades_raw ORDER BY condition_id',
    format: 'JSONEachRow'
  })
  const conditionRows = await conditionsResult.json() as any[]
  const allConditions = conditionRows.map((row: any) => row.condition_id)

  log(`Found ${allConditions.length} unique condition_ids in trades_raw`)

  // Load existing mappings from JSONL file (if exists)
  const existingMappings = new Map<string, ConditionMapping>()
  if (fs.existsSync(LOOKUP_RESULTS_FILE)) {
    const lines = fs.readFileSync(LOOKUP_RESULTS_FILE, 'utf-8').split('\n').filter(line => line.trim())
    for (const line of lines) {
      const mapping = JSON.parse(line) as ConditionMapping
      if (mapping.market_id) {
        existingMappings.set(mapping.condition_id, mapping)
      }
    }
    log(`Loaded ${existingMappings.size} existing mappings from JSONL`)
  }

  // Load dimension data for enrichment
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')
  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))

  const marketMap = new Map<string, any>()
  for (const market of markets) {
    marketMap.set(market.condition_id, market)
  }

  const eventMap = new Map<string, any>()
  for (const event of events) {
    eventMap.set(event.event_id, event)
  }

  log('Resolving condition_ids to market_ids via external API...')
  log('(This will take a while - rate limited to avoid hammering Polymarket)')

  let resolved = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < allConditions.length; i++) {
    const conditionId = allConditions[i]

    // Skip if already resolved
    if (existingMappings.has(conditionId)) {
      skipped++
      if (i % 100 === 0) {
        log(`Progress: ${i}/${allConditions.length} (${resolved} resolved, ${skipped} skipped, ${failed} failed)`, false)
      }
      continue
    }

    // Resolve via external API
    const { market_id, error } = await resolveConditionIdToMarket(conditionId)

    let mapping: ConditionMapping = {
      condition_id: conditionId,
      market_id: market_id,
      event_id: null,
      canonical_category: 'Uncategorized',
      raw_tags: [],
      resolved_at: null,
      error: error
    }

    // Enrich with dimension data if we got a market_id
    if (market_id) {
      const market = marketMap.get(conditionId)
      if (market) {
        mapping.event_id = market.event_id
        mapping.resolved_at = market.resolved_at

        // Get canonical category
        if (market.event_id) {
          const event = eventMap.get(market.event_id)
          if (event) {
            const categoryResult = getCanonicalCategoryForEvent({
              category: event.category,
              tags: event.tags || []
            })
            mapping.canonical_category = categoryResult.canonical_category
            mapping.raw_tags = categoryResult.raw_tags
          }
        }
      }
    }

    // Write to JSONL
    fs.appendFileSync(LOOKUP_RESULTS_FILE, JSON.stringify(mapping) + '\n')

    if (market_id) {
      resolved++
    } else {
      failed++
    }

    // Progress logging every 100 conditions
    if (i % 100 === 0) {
      log(`Progress: ${i}/${allConditions.length} (${resolved} resolved, ${skipped} skipped, ${failed} failed)`)
    }

    // Rate limiting - sleep 50ms between requests
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  log(`✅ STEP 3 COMPLETE: ${resolved} new resolutions, ${skipped} skipped, ${failed} failed`)
  log(`Total mappings in JSONL: ${existingMappings.size + resolved}\n`)

  // Write progress telemetry
  writeProgress({
    step: '3_condition_map',
    done: true,
    resolved: resolved,
    failed: failed,
    timestamp: new Date().toISOString()
  })
}

// ============================================================================
// STEP 4: BACKFILL TRADES_RAW WITH MARKET_ID
// ============================================================================

async function waitForMutations(): Promise<void> {
  log('Waiting for ClickHouse mutations to complete...')
  let attempts = 0
  const maxAttempts = 60 // 5 minutes max

  while (attempts < maxAttempts) {
    const result = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM system.mutations
        WHERE is_done = 0
          AND table = 'trades_raw'
      `,
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    const pendingMutations = parseInt(rows[0].count)

    if (pendingMutations === 0) {
      log('✅ All mutations complete')
      return
    }

    attempts++
    log(`⏳ ${pendingMutations} mutations pending (attempt ${attempts}/${maxAttempts})`, false)
    await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5s
  }

  log('⚠️  Mutations did not complete within timeout - continuing anyway')
}

async function backfillTradesRaw(): Promise<void> {
  log('========================================')
  log('STEP 4: Backfilling trades_raw with market_id')
  log('========================================')

  // Load mappings from JSONL
  const mappings = new Map<string, string>() // condition_id → market_id
  if (!fs.existsSync(LOOKUP_RESULTS_FILE)) {
    log('❌ No JSONL file found - cannot backfill. Run Step 3 first.')
    return
  }

  const lines = fs.readFileSync(LOOKUP_RESULTS_FILE, 'utf-8').split('\n').filter(line => line.trim())
  for (const line of lines) {
    const mapping = JSON.parse(line) as ConditionMapping
    if (mapping.market_id) {
      mappings.set(mapping.condition_id, mapping.market_id)
    }
  }

  log(`Loaded ${mappings.size} condition_id → market_id mappings`)

  // Check how many trades need backfill
  const nullMarketIdResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM trades_raw
      WHERE market_id = ''
    `,
    format: 'JSONEachRow'
  })
  const nullMarketIdRows = await nullMarketIdResult.json() as any[]
  const nullCount = parseInt(nullMarketIdRows[0].count)

  if (nullCount === 0) {
    log('✅ All trades already have market_id - skipping (idempotent)')
    log('✅ STEP 4 COMPLETE\n')
    return
  }

  log(`${nullCount} trades need market_id backfill`)

  // Get distinct condition_ids that need backfill
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE market_id = ''
    `,
    format: 'JSONEachRow'
  })
  const conditionRows = await conditionsResult.json() as any[]
  const conditionsNeedingBackfill = conditionRows.map((row: any) => row.condition_id)

  log(`${conditionsNeedingBackfill.length} unique condition_ids need backfill`)

  // Update in batches
  let updated = 0
  let skipped = 0

  for (const conditionId of conditionsNeedingBackfill) {
    const marketId = mappings.get(conditionId)

    if (!marketId) {
      skipped++
      continue
    }

    // UPDATE query
    await clickhouse.exec({
      query: `
        ALTER TABLE trades_raw
        UPDATE market_id = '${marketId}'
        WHERE condition_id = '${conditionId}'
          AND market_id = ''
      `
    })

    updated++

    if (updated % 100 === 0) {
      log(`Progress: ${updated}/${conditionsNeedingBackfill.length} condition_ids updated`, false)
    }
  }

  log(`Issued ${updated} UPDATE mutations (${skipped} skipped - no mapping)`)

  // Wait for mutations to complete
  await waitForMutations()

  // Verify
  const verifyResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM trades_raw
      WHERE market_id = ''
    `,
    format: 'JSONEachRow'
  })
  const verifyRows = await verifyResult.json() as any[]
  const remainingNull = parseInt(verifyRows[0].count)

  // Calculate coverage
  const totalTradesResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const totalTradesRows = await totalTradesResult.json() as any[]
  const totalTrades = parseInt(totalTradesRows[0].count)
  const coveragePct = totalTrades > 0 ? ((totalTrades - remainingNull) / totalTrades) * 100 : 0

  log(`✅ STEP 4 COMPLETE: ${remainingNull} trades still have empty market_id (unmapped)\n`)

  // Write progress telemetry
  writeProgress({
    step: '4_backfill_trades_raw',
    done: true,
    coverage_pct: parseFloat(coveragePct.toFixed(2)),
    timestamp: new Date().toISOString()
  })
}

// ============================================================================
// STEP 5: POPULATE REALIZED P&L AND IS_RESOLVED
// ============================================================================

interface Resolution {
  condition_id: string
  market_id: string
  outcome: 'YES' | 'NO'
  resolved_at: string
}

function loadResolutions(): Map<string, Resolution> {
  const resolutionMapPath = resolve(process.cwd(), 'data/expanded_resolution_map.json')
  const resolutionData = JSON.parse(fs.readFileSync(resolutionMapPath, 'utf-8'))

  const resolutionMap = new Map<string, Resolution>()
  for (const res of resolutionData) {
    resolutionMap.set(res.condition_id, res)
  }

  return resolutionMap
}

interface Trade {
  wallet_address: string
  condition_id: string
  side: string
  shares: number
  price: number
  timestamp: string
}

function calculateRealizedPnl(trades: Trade[], resolution: Resolution): number {
  // Calculate net position
  let netYesShares = 0
  let netNoShares = 0

  for (const trade of trades) {
    if (trade.side === 'YES') {
      netYesShares += trade.shares
    } else if (trade.side === 'NO') {
      netNoShares += trade.shares
    }
  }

  // Determine final side
  const netPosition = netYesShares - netNoShares
  const finalSide = netPosition > 0 ? 'YES' : 'NO'
  const finalShares = Math.abs(netPosition)

  // Determine outcome value
  const outcomeValue = resolution.outcome === finalSide ? 1.0 : 0.0

  // Calculate weighted average entry price
  let totalCost = 0
  let totalShares = 0

  for (const trade of trades) {
    if (trade.side === finalSide) {
      totalCost += trade.shares * trade.price
      totalShares += trade.shares
    }
  }

  const avgEntryPrice = totalShares > 0 ? totalCost / totalShares : 0

  // P&L = shares × (outcome - entry_price)
  const pnl = finalShares * (outcomeValue - avgEntryPrice)

  return pnl
}

async function populateRealizedPnl(): Promise<void> {
  log('========================================')
  log('STEP 5: Populating realized_pnl_usd and is_resolved')
  log('========================================')

  // Load resolutions
  const resolutionMap = loadResolutions()
  log(`Loaded ${resolutionMap.size} resolutions`)

  // Get all distinct (wallet, condition_id) pairs
  const pairsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address, condition_id
      FROM trades_raw
      WHERE market_id != ''
      ORDER BY wallet_address, condition_id
    `,
    format: 'JSONEachRow'
  })
  const pairs = await pairsResult.json() as any[]
  log(`Found ${pairs.length} (wallet, condition_id) pairs to process`)

  let resolved = 0
  let unresolved = 0
  let updated = 0

  for (let i = 0; i < pairs.length; i++) {
    const { wallet_address, condition_id } = pairs[i]

    const resolution = resolutionMap.get(condition_id)

    if (!resolution) {
      unresolved++
      if (i % 500 === 0) {
        log(`Progress: ${i}/${pairs.length} (${resolved} resolved, ${unresolved} unresolved, ${updated} updated)`, false)
      }
      continue
    }

    resolved++

    // Get all trades for this (wallet, condition_id)
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          condition_id,
          side,
          shares,
          price,
          timestamp
        FROM trades_raw
        WHERE wallet_address = '${wallet_address}'
          AND condition_id = '${condition_id}'
        ORDER BY timestamp
      `,
      format: 'JSONEachRow'
    })
    const trades = await tradesResult.json() as Trade[]

    // Calculate P&L
    const pnl = calculateRealizedPnl(trades, resolution)

    // Update trades with P&L and is_resolved
    await clickhouse.exec({
      query: `
        ALTER TABLE trades_raw
        UPDATE
          realized_pnl_usd = ${pnl / trades.length},
          is_resolved = 1
        WHERE wallet_address = '${wallet_address}'
          AND condition_id = '${condition_id}'
          AND is_resolved = 0
      `
    })

    updated++

    if (i % 500 === 0) {
      log(`Progress: ${i}/${pairs.length} (${resolved} resolved, ${unresolved} unresolved, ${updated} updated)`)
    }

    // Rate limiting
    if (i % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  log(`Issued ${updated} UPDATE mutations`)

  // Wait for mutations
  await waitForMutations()

  log(`✅ STEP 5 COMPLETE: ${resolved} resolved, ${unresolved} unresolved\n`)

  // Write progress telemetry
  writeProgress({
    step: '5_populate_pnl',
    done: true,
    updated_trades: updated,
    timestamp: new Date().toISOString()
  })
}

// ============================================================================
// STEP 6: RECOMPUTE WALLET_RESOLUTION_OUTCOMES
// ============================================================================

async function recomputeResolutionOutcomes(): Promise<void> {
  log('========================================')
  log('STEP 6: Recomputing wallet_resolution_outcomes for ALL wallets')
  log('========================================')

  // Truncate existing data
  await clickhouse.exec({
    query: 'TRUNCATE TABLE wallet_resolution_outcomes'
  })
  log('Truncated wallet_resolution_outcomes')

  // Load resolutions
  const resolutionMap = loadResolutions()
  log(`Loaded ${resolutionMap.size} resolutions`)

  // Load category mappings
  const mappings = new Map<string, string>() // condition_id → canonical_category
  if (fs.existsSync(LOOKUP_RESULTS_FILE)) {
    const lines = fs.readFileSync(LOOKUP_RESULTS_FILE, 'utf-8').split('\n').filter(line => line.trim())
    for (const line of lines) {
      const mapping = JSON.parse(line) as ConditionMapping
      if (mapping.canonical_category) {
        mappings.set(mapping.condition_id, mapping.canonical_category)
      }
    }
  }
  log(`Loaded ${mappings.size} category mappings`)

  // Get all wallets
  const walletsResult = await clickhouse.query({
    query: 'SELECT DISTINCT wallet_address FROM trades_raw ORDER BY wallet_address',
    format: 'JSONEachRow'
  })
  const walletRows = await walletsResult.json() as any[]
  const allWallets = walletRows.map((row: any) => row.wallet_address)

  log(`Found ${allWallets.length} unique wallets`)

  let totalOutcomes = 0

  for (let w = 0; w < allWallets.length; w++) {
    const walletAddress = allWallets[w]

    // Get all resolved positions for this wallet
    const positionsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          side,
          SUM(shares) as total_shares,
          COUNT(*) as num_trades
        FROM trades_raw
        WHERE wallet_address = '${walletAddress}'
          AND is_resolved = 1
        GROUP BY condition_id, side
        ORDER BY condition_id, side
      `,
      format: 'JSONEachRow'
    })
    const positions = await positionsResult.json() as any[]

    // Group by condition_id
    const conditionGroups = new Map<string, any[]>()
    for (const pos of positions) {
      if (!conditionGroups.has(pos.condition_id)) {
        conditionGroups.set(pos.condition_id, [])
      }
      conditionGroups.get(pos.condition_id)!.push(pos)
    }

    // For each condition, determine final position and won/loss
    for (const [conditionId, group] of conditionGroups) {
      const resolution = resolutionMap.get(conditionId)
      if (!resolution) continue

      // Calculate net position
      let netYesShares = 0
      let netNoShares = 0
      let numTrades = 0

      for (const pos of group) {
        if (pos.side === 'YES') {
          netYesShares += parseFloat(pos.total_shares)
        } else if (pos.side === 'NO') {
          netNoShares += parseFloat(pos.total_shares)
        }
        numTrades += parseInt(pos.num_trades)
      }

      const netPosition = netYesShares - netNoShares

      // Skip flat positions
      if (Math.abs(netPosition) < 0.01) {
        continue
      }

      // Determine final_side
      const finalSide = netPosition > 0 ? 'YES' : 'NO'
      const finalShares = Math.abs(netPosition)

      // Determine won
      const won = finalSide === resolution.outcome ? 1 : 0

      // Get canonical category
      const canonicalCategory = mappings.get(conditionId) || 'Uncategorized'

      // Insert into wallet_resolution_outcomes
      const outcome = {
        wallet_address: walletAddress,
        condition_id: conditionId,
        market_id: resolution.market_id,
        resolved_outcome: resolution.outcome,
        final_side: finalSide,
        won: won,
        resolved_at: resolution.resolved_at,
        canonical_category: canonicalCategory,
        num_trades: numTrades,
        final_shares: finalShares,
        ingested_at: new Date().toISOString()
      }

      await clickhouse.insert({
        table: 'wallet_resolution_outcomes',
        values: [outcome],
        format: 'JSONEachRow'
      })

      totalOutcomes++
    }

    if (w % 50 === 0) {
      log(`Progress: ${w}/${allWallets.length} wallets (${totalOutcomes} outcomes computed)`, false)
    }
  }

  log(`✅ STEP 6 COMPLETE: ${totalOutcomes} resolution outcomes computed for ${allWallets.length} wallets\n`)

  // Write progress telemetry
  writeProgress({
    step: '6_resolution_outcomes',
    done: true,
    distinct_wallets: allWallets.length,
    rows: totalOutcomes,
    timestamp: new Date().toISOString()
  })
}

// ============================================================================
// STEP 7: GENERATE HEALTH SNAPSHOT
// ============================================================================

async function generateHealthSnapshot(): Promise<void> {
  log('========================================')
  log('STEP 7: Generating final health snapshot')
  log('========================================')

  const snapshot: any = {
    timestamp: new Date().toISOString(),
    tables: {}
  }

  // trades_raw
  const tradesCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const tradesCountRows = await tradesCountResult.json() as any[]
  snapshot.tables.trades_raw = {
    total_rows: parseInt(tradesCountRows[0].count)
  }

  const tradesWithMarketIdResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE market_id != ''`,
    format: 'JSONEachRow'
  })
  const tradesWithMarketIdRows = await tradesWithMarketIdResult.json() as any[]
  snapshot.tables.trades_raw.rows_with_market_id = parseInt(tradesWithMarketIdRows[0].count)

  const tradesResolvedResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE is_resolved = 1',
    format: 'JSONEachRow'
  })
  const tradesResolvedRows = await tradesResolvedResult.json() as any[]
  snapshot.tables.trades_raw.rows_resolved = parseInt(tradesResolvedRows[0].count)

  // markets_dim
  const marketsCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM markets_dim',
    format: 'JSONEachRow'
  })
  const marketsCountRows = await marketsCountResult.json() as any[]
  snapshot.tables.markets_dim = {
    total_rows: parseInt(marketsCountRows[0].count)
  }

  // events_dim
  const eventsCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM events_dim',
    format: 'JSONEachRow'
  })
  const eventsCountRows = await eventsCountResult.json() as any[]
  snapshot.tables.events_dim = {
    total_rows: parseInt(eventsCountRows[0].count)
  }

  // wallet_resolution_outcomes
  const outcomesCountResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM wallet_resolution_outcomes',
    format: 'JSONEachRow'
  })
  const outcomesCountRows = await outcomesCountResult.json() as any[]
  snapshot.tables.wallet_resolution_outcomes = {
    total_rows: parseInt(outcomesCountRows[0].count)
  }

  const walletsWithOutcomesResult = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_resolution_outcomes',
    format: 'JSONEachRow'
  })
  const walletsWithOutcomesRows = await walletsWithOutcomesResult.json() as any[]
  snapshot.tables.wallet_resolution_outcomes.wallets_tracked = parseInt(walletsWithOutcomesRows[0].count)

  // Write to JSON
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(snapshot, null, 2))

  log('Health Snapshot:')
  log(JSON.stringify(snapshot, null, 2))
  log(`Written to: ${SUMMARY_FILE}`)
  log('✅ STEP 7 COMPLETE\n')

  // Determine status
  const tradesWithMarketPct = snapshot.tables.trades_raw.total_rows > 0
    ? (snapshot.tables.trades_raw.rows_with_market_id / snapshot.tables.trades_raw.total_rows) * 100
    : 0
  const status = tradesWithMarketPct >= 90 && snapshot.tables.wallet_resolution_outcomes.total_rows > 0
    ? 'READY_FOR_DEMO'
    : 'INCOMPLETE'

  // Write progress telemetry
  writeProgress({
    step: '7_health_snapshot',
    done: true,
    summary_file: 'runtime/full-ingest-summary.json',
    status: status,
    timestamp: new Date().toISOString()
  })

  return snapshot
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

async function main() {
  log('🚀 Starting Full Historical Ingest')
  log(`Started at: ${new Date().toISOString()}\n`)

  const startTime = Date.now()

  try {
    await ensureClickHouseTables()
    await publishDimensionData()
    await buildGlobalConditionMap()
    await backfillTradesRaw()
    await populateRealizedPnl()
    await recomputeResolutionOutcomes()
    const healthSnapshot = await generateHealthSnapshot()

    const endTime = Date.now()
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2)

    log('========================================')
    log('✅ FULL HISTORICAL INGEST COMPLETE')
    log(`Duration: ${durationSeconds}s`)
    log(`Completed at: ${new Date().toISOString()}`)
    log('========================================')

    // Output final health snapshot to stdout (machine-readable)
    console.log(`FINAL_HEALTH_SNAPSHOT: ${JSON.stringify(healthSnapshot)}`)
  } catch (err) {
    log('❌ ERROR during full historical ingest:')
    log(err instanceof Error ? err.message : String(err))
    log(err instanceof Error && err.stack ? err.stack : '')
    process.exit(1)
  }
}

main()
