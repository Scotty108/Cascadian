#!/usr/bin/env tsx
/**
 * Full Enrichment Pass (Phase 4)
 *
 * PURPOSE:
 * Complete enrichment of all trades after Goldsky historical load.
 * This is the critical phase that adds market_id, P&L, resolutions, and resolution accuracy.
 *
 * STEPS:
 * a. extendConditionMarketMapping() - Resolve ALL condition_ids to market_ids
 * b. backfillMarketIdsIntoTradesRaw() - UPDATE trades_raw with market_ids
 * c. refreshResolutionMap() - Fetch missing resolutions from Polymarket
 * d. populatePnlAndResolutionFlags() - Calculate P&L for all resolved trades
 * e. recomputeResolutionOutcomesForAllWallets() - Rebuild wallet_resolution_outcomes for ALL wallets
 *
 * RESOLUTION ACCURACY:
 * Step (e) is where we compute resolution hit rate / conviction accuracy for every wallet.
 * For each wallet + resolved market, we determine:
 * - final_side (YES or NO based on net position)
 * - won (1 if final_side === resolved_outcome, else 0)
 * Resolution accuracy % = AVG(won) * 100
 *
 * PROGRESS TRACKING:
 * Each step writes a JSON line to runtime/full-enrichment.progress.jsonl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const PROGRESS_LOG = resolve(process.cwd(), 'runtime/full-enrichment.progress.jsonl')
const LOOKUP_RESULTS_FILE = resolve(process.cwd(), 'data/market_id_lookup_results.jsonl')
const RESOLUTION_MAP_FILE = resolve(process.cwd(), 'data/expanded_resolution_map.json')

const BATCH_SIZE = 100
const API_DELAY_MS = 0  // No delay to speed up failed lookups

interface StepProgress {
  step: string
  done: boolean
  metrics: Record<string, any>
  timestamp: string
}

interface ConditionMarketMapping {
  condition_id: string
  market_id: string
}

interface Resolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: number
  payout_no: number
  resolved_at: string | null
}

interface ResolutionMapFile {
  total_conditions: number
  resolved_conditions: number
  last_updated: string
  resolutions: Resolution[]
}

interface Trade {
  trade_id: string
  wallet_address: string
  condition_id: string
  market_id: string
  side: 'YES' | 'NO'
  shares: number
  usd_value: number
  timestamp: number
}

function logStepProgress(progress: StepProgress) {
  const line = JSON.stringify(progress) + '\n'
  fs.appendFileSync(PROGRESS_LOG, line)
  console.log(`✅ ${progress.step} complete`)
  console.log(`   Metrics: ${JSON.stringify(progress.metrics, null, 2)}`)
}

function ensureRuntimeDir() {
  const runtimeDir = resolve(process.cwd(), 'runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * STEP A: Extend Condition → Market Mapping for ALL condition_ids
 */
async function extendConditionMarketMapping(): Promise<void> {
  console.log('\n📍 Step A: Extend Condition → Market Mapping')

  // Get all distinct condition_ids from trades_raw, but SKIP placeholder tokens
  console.log('   Querying distinct condition_ids from trades_raw (excluding placeholder token_* conditions)...')
  const result = await clickhouse.query({
    query: `SELECT DISTINCT condition_id FROM trades_raw
             WHERE condition_id != '' AND NOT condition_id LIKE 'token_%'
             ORDER BY condition_id`,
    format: 'JSONEachRow',
  })

  const rows = await result.json<{ condition_id: string }>()
  const allConditionIds = rows.map(r => r.condition_id)
  console.log(`   Found ${allConditionIds.length} distinct real condition_ids (skipped placeholder tokens)`)

  // Load existing mappings from JSONL
  const existingMappings = new Map<string, string>()
  if (fs.existsSync(LOOKUP_RESULTS_FILE)) {
    const lines = fs.readFileSync(LOOKUP_RESULTS_FILE, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const mapping = JSON.parse(line) as ConditionMarketMapping
        existingMappings.set(mapping.condition_id, mapping.market_id)
      } catch (e) {
        console.warn(`   Skipping invalid JSONL line: ${line}`)
      }
    }
  }
  console.log(`   Loaded ${existingMappings.size} existing mappings`)

  // Find unmapped condition_ids
  const unmappedConditionIds = allConditionIds.filter(id => !existingMappings.has(id))
  console.log(`   Found ${unmappedConditionIds.length} unmapped condition_ids`)

  let newlyResolved = 0
  let failedToResolve = 0

  // Resolve each unmapped condition_id
  for (let i = 0; i < unmappedConditionIds.length; i++) {
    const conditionId = unmappedConditionIds[i]

    try {
      // Fetch from Polymarket CLOB API
      const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`)

      if (!response.ok) {
        console.warn(`   ❌ Failed to fetch condition ${conditionId}: ${response.status}`)
        failedToResolve++
        await sleep(API_DELAY_MS)
        continue
      }

      const data = await response.json()

      // Extract market_id (sometimes called "market" or "marketId")
      const marketId = data.market_id || data.market || data.marketId || data.id

      if (!marketId) {
        console.warn(`   ❌ No market_id found for condition ${conditionId}`)
        failedToResolve++
        await sleep(API_DELAY_MS)
        continue
      }

      // Append to JSONL
      const mapping: ConditionMarketMapping = {
        condition_id: conditionId,
        market_id: String(marketId)
      }
      fs.appendFileSync(LOOKUP_RESULTS_FILE, JSON.stringify(mapping) + '\n')
      existingMappings.set(conditionId, String(marketId))
      newlyResolved++

      // Progress logging
      if ((i + 1) % 100 === 0) {
        console.log(`   Progress: ${i + 1}/${unmappedConditionIds.length} (${newlyResolved} resolved, ${failedToResolve} failed)`)
      }

      // Rate limiting
      await sleep(API_DELAY_MS)

    } catch (error) {
      console.warn(`   ❌ Error fetching condition ${conditionId}:`, error instanceof Error ? error.message : error)
      failedToResolve++
      await sleep(API_DELAY_MS)
    }
  }

  const metrics = {
    total_condition_ids: allConditionIds.length,
    already_mapped: existingMappings.size - newlyResolved,
    newly_resolved: newlyResolved,
    failed_to_resolve: failedToResolve
  }

  logStepProgress({
    step: 'extendConditionMarketMapping',
    done: true,
    metrics,
    timestamp: new Date().toISOString()
  })
}

/**
 * STEP B: Backfill market_id into trades_raw
 */
async function backfillMarketIdsIntoTradesRaw(): Promise<void> {
  console.log('\n📍 Step B: Backfill market_id into trades_raw')

  // Load all mappings
  const mappings = new Map<string, string>()
  if (fs.existsSync(LOOKUP_RESULTS_FILE)) {
    const lines = fs.readFileSync(LOOKUP_RESULTS_FILE, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const mapping = JSON.parse(line) as ConditionMarketMapping
        mappings.set(mapping.condition_id, mapping.market_id)
      } catch (e) {
        // skip invalid lines
      }
    }
  }
  console.log(`   Loaded ${mappings.size} condition→market mappings`)

  // Get before stats (excluding placeholder tokens - these won't get market_ids anyway)
  const beforeResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE market_id != '' AND condition_id NOT LIKE 'token_%'`,
    format: 'JSONEachRow',
  })
  const beforeData = await beforeResult.json<{ count: string }>()
  const beforeCount = parseInt(beforeData[0]?.count || '0')

  const totalResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE condition_id NOT LIKE 'token_%'`,
    format: 'JSONEachRow',
  })
  const totalData = await totalResult.json<{ count: string }>()
  const totalCount = parseInt(totalData[0]?.count || '0')

  const coveragePct = (beforeCount/totalCount*100)
  console.log(`   Before: ${beforeCount}/${totalCount} trades have market_id (${coveragePct.toFixed(2)}%)`)

  // Skip updates if coverage is already 100%
  if (coveragePct >= 99.9) {
    console.log(`   ✅ Coverage is already ${coveragePct.toFixed(2)}% - skipping updates`)
    logStepProgress({
      step: 'backfillMarketIdsIntoTradesRaw',
      done: true,
      metrics: {
        trades_before_with_market_id: beforeCount,
        trades_after_with_market_id: beforeCount,
        coverage_pct_before: coveragePct,
        coverage_pct_after: coveragePct,
        updates_issued: 0,
        skipped_reason: 'Coverage already at 100%'
      },
      timestamp: new Date().toISOString()
    })
    return
  }

  // Issue UPDATE statements in batches
  let updatesIssued = 0
  const mappingEntries = Array.from(mappings.entries())

  for (let i = 0; i < mappingEntries.length; i += BATCH_SIZE) {
    const batch = mappingEntries.slice(i, i + BATCH_SIZE)

    for (const [conditionId, marketId] of batch) {
      try {
        await clickhouse.command({
          query: `
            ALTER TABLE trades_raw
            UPDATE market_id = '${marketId}'
            WHERE condition_id = '${conditionId}' AND market_id = ''
          `,
        })
        updatesIssued++
      } catch (error) {
        console.warn(`   ❌ Failed to update condition ${conditionId}:`, error instanceof Error ? error.message : error)
      }
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      console.log(`   Progress: ${updatesIssued} updates issued`)
    }
  }

  console.log(`   Issued ${updatesIssued} UPDATE mutations`)

  // Wait for mutations to complete
  console.log('   Waiting for mutations to complete...')
  await waitForMutations()

  // Get after stats
  const afterResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE market_id != ''`,
    format: 'JSONEachRow',
  })
  const afterData = await afterResult.json<{ count: string }>()
  const afterCount = parseInt(afterData[0]?.count || '0')

  console.log(`   After: ${afterCount}/${totalCount} trades have market_id (${(afterCount/totalCount*100).toFixed(2)}%)`)

  const metrics = {
    trades_before_with_market_id: beforeCount,
    trades_after_with_market_id: afterCount,
    coverage_pct_before: parseFloat((beforeCount/totalCount*100).toFixed(2)),
    coverage_pct_after: parseFloat((afterCount/totalCount*100).toFixed(2)),
    updates_issued: updatesIssued
  }

  logStepProgress({
    step: 'backfillMarketIdsIntoTradesRaw',
    done: true,
    metrics,
    timestamp: new Date().toISOString()
  })
}

/**
 * Wait for all ClickHouse mutations to complete
 * Reference: scripts/path-b-resume-enrichment.ts lines 236-253
 */
async function waitForMutations(maxWaitMs = 300000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const result = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM system.mutations
        WHERE is_done = 0 AND table = 'trades_raw'
      `,
      format: 'JSONEachRow',
    })

    const data = await result.json<{ count: string }>()
    const pendingCount = parseInt(data[0]?.count || '0')

    if (pendingCount === 0) {
      console.log('   ✅ All mutations complete')
      return
    }

    console.log(`   Still ${pendingCount} mutations pending...`)
    await sleep(5000)
  }

  console.warn('   ⚠️  Timeout waiting for mutations')
}

/**
 * STEP C: Refresh Resolution Map
 */
async function refreshResolutionMap(): Promise<void> {
  console.log('\n📍 Step C: Refresh Resolution Map')

  // Load current resolution map
  let resolutionMap: ResolutionMapFile
  if (fs.existsSync(RESOLUTION_MAP_FILE)) {
    const content = fs.readFileSync(RESOLUTION_MAP_FILE, 'utf-8')
    resolutionMap = JSON.parse(content)
  } else {
    resolutionMap = {
      total_conditions: 0,
      resolved_conditions: 0,
      last_updated: new Date().toISOString(),
      resolutions: []
    }
  }

  const existingResolutions = new Map<string, Resolution>()
  for (const res of resolutionMap.resolutions) {
    existingResolutions.set(res.market_id, res)
  }

  console.log(`   Loaded ${existingResolutions.size} existing resolutions`)

  // Get all distinct market_ids from trades_raw
  const result = await clickhouse.query({
    query: `SELECT DISTINCT market_id FROM trades_raw WHERE market_id != '' ORDER BY market_id`,
    format: 'JSONEachRow',
  })

  const rows = await result.json<{ market_id: string }>()
  const allMarketIds = rows.map(r => r.market_id)
  console.log(`   Found ${allMarketIds.length} distinct market_ids in trades_raw`)

  // Find unmapped market_ids
  const unmappedMarketIds = allMarketIds.filter(id => !existingResolutions.has(id))
  console.log(`   Found ${unmappedMarketIds.length} unmapped market_ids`)

  let newlyFetched = 0
  let failedFetches = 0

  // Fetch resolutions for unmapped market_ids
  for (let i = 0; i < unmappedMarketIds.length; i++) {
    const marketId = unmappedMarketIds[i]

    try {
      const response = await fetch(`https://gamma-api.polymarket.com/markets/${marketId}`)

      if (!response.ok) {
        failedFetches++
        await sleep(API_DELAY_MS)
        continue
      }

      const data = await response.json()

      // Validate binary market with valid resolution
      const outcomePrices = data.outcomePrices
      if (!Array.isArray(outcomePrices) || outcomePrices.length !== 2) {
        failedFetches++
        await sleep(API_DELAY_MS)
        continue
      }

      const [priceYes, priceNo] = outcomePrices.map((p: string) => parseFloat(p))

      // Must be resolved: [1,0] or [0,1]
      const isResolvedYes = priceYes === 1 && priceNo === 0
      const isResolvedNo = priceYes === 0 && priceNo === 1

      if (!isResolvedYes && !isResolvedNo) {
        // Not a resolved binary market, skip
        await sleep(API_DELAY_MS)
        continue
      }

      const resolution: Resolution = {
        condition_id: data.conditionId || '',
        market_id: marketId,
        resolved_outcome: isResolvedYes ? 'YES' : 'NO',
        payout_yes: priceYes,
        payout_no: priceNo,
        resolved_at: data.endDate || data.resolvedAt || null
      }

      resolutionMap.resolutions.push(resolution)
      existingResolutions.set(marketId, resolution)
      newlyFetched++

      if ((i + 1) % 100 === 0) {
        console.log(`   Progress: ${i + 1}/${unmappedMarketIds.length} (${newlyFetched} resolved, ${failedFetches} failed)`)
      }

      await sleep(API_DELAY_MS)

    } catch (error) {
      console.warn(`   ❌ Error fetching market ${marketId}:`, error instanceof Error ? error.message : error)
      failedFetches++
      await sleep(API_DELAY_MS)
    }
  }

  // Update metadata and save
  resolutionMap.total_conditions = resolutionMap.resolutions.length
  resolutionMap.resolved_conditions = resolutionMap.resolutions.length
  resolutionMap.last_updated = new Date().toISOString()

  fs.writeFileSync(RESOLUTION_MAP_FILE, JSON.stringify(resolutionMap, null, 2))

  const metrics = {
    resolutions_before: existingResolutions.size - newlyFetched,
    resolutions_after: existingResolutions.size,
    newly_fetched: newlyFetched,
    failed_fetches: failedFetches
  }

  logStepProgress({
    step: 'refreshResolutionMap',
    done: true,
    metrics,
    timestamp: new Date().toISOString()
  })
}

/**
 * STEP D: Populate P&L and Resolution Flags
 * Reference: scripts/path-b-resume-enrichment.ts lines 184-220
 */
async function populatePnlAndResolutionFlags(): Promise<void> {
  console.log('\n📍 Step D: Populate P&L and Resolution Flags')

  // Load resolution map
  if (!fs.existsSync(RESOLUTION_MAP_FILE)) {
    throw new Error('Resolution map not found. Run step C first.')
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
  console.log(`   Loaded ${resolutionsByMarket.size} resolutions by market_id`)

  // Get all distinct (wallet_address, condition_id) pairs
  const pairsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet_address, condition_id, market_id FROM trades_raw WHERE condition_id != ''`,
    format: 'JSONEachRow',
  })

  const pairs = await pairsResult.json<{ wallet_address: string, condition_id: string, market_id: string }>()
  console.log(`   Found ${pairs.length} distinct (wallet, condition) pairs`)

  let pairsWithResolution = 0
  let tradesUpdated = 0

  // Process each pair
  for (let i = 0; i < pairs.length; i++) {
    const { wallet_address, condition_id, market_id } = pairs[i]

    // Check if we have a resolution for this condition or market
    const resolution = resolutionsByCondition.get(condition_id) || resolutionsByMarket.get(market_id)

    if (!resolution) {
      continue
    }

    pairsWithResolution++

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

        tradesUpdated++
      }

      if ((i + 1) % 100 === 0) {
        console.log(`   Progress: ${i + 1}/${pairs.length} pairs (${pairsWithResolution} with resolution, ${tradesUpdated} trades updated)`)
      }

    } catch (error) {
      console.warn(`   ❌ Error processing pair (${wallet_address}, ${condition_id}):`, error instanceof Error ? error.message : error)
    }
  }

  console.log('   Waiting for mutations to complete...')
  await waitForMutations()

  // Verify
  const verifyResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE is_resolved = 1`,
    format: 'JSONEachRow',
  })
  const verifyData = await verifyResult.json<{ count: string }>()
  const resolvedCount = parseInt(verifyData[0]?.count || '0')

  const totalResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw`,
    format: 'JSONEachRow',
  })
  const totalData = await totalResult.json<{ count: string }>()
  const totalCount = parseInt(totalData[0]?.count || '0')

  const metrics = {
    wallet_condition_pairs: pairs.length,
    pairs_with_resolution: pairsWithResolution,
    trades_updated: tradesUpdated,
    trades_resolved: resolvedCount,
    resolved_trades_pct: parseFloat((resolvedCount / totalCount * 100).toFixed(2))
  }

  logStepProgress({
    step: 'populatePnlAndResolutionFlags',
    done: true,
    metrics,
    timestamp: new Date().toISOString()
  })
}

/**
 * STEP E: Recompute Resolution Outcomes for ALL Wallets
 */
async function recomputeResolutionOutcomesForAllWallets(): Promise<void> {
  console.log('\n📍 Step E: Recompute Resolution Outcomes for ALL Wallets')
  console.log('   This is the conviction accuracy metric.')

  // Load resolution map
  if (!fs.existsSync(RESOLUTION_MAP_FILE)) {
    throw new Error('Resolution map not found. Run step C first.')
  }

  const content = fs.readFileSync(RESOLUTION_MAP_FILE, 'utf-8')
  const resolutionMap: ResolutionMapFile = JSON.parse(content)

  const resolutionsByCondition = new Map<string, Resolution>()
  const resolutionsByMarket = new Map<string, Resolution>()

  for (const res of resolutionMap.resolutions) {
    if (res.condition_id) {
      resolutionsByCondition.set(res.condition_id, res)
    }
    resolutionsByMarket.set(res.market_id, res)
  }

  // Truncate wallet_resolution_outcomes
  console.log('   Truncating wallet_resolution_outcomes...')
  await clickhouse.command({
    query: `TRUNCATE TABLE wallet_resolution_outcomes`,
  })

  // Get all distinct wallet addresses
  const walletsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet_address FROM trades_raw ORDER BY wallet_address`,
    format: 'JSONEachRow',
  })

  const wallets = await walletsResult.json<{ wallet_address: string }>()
  console.log(`   Found ${wallets.length} distinct wallets`)

  let totalOutcomesInserted = 0
  let walletsProcessed = 0

  // Process each wallet
  for (const { wallet_address } of wallets) {
    try {
      // Get all resolved positions for this wallet
      const positionsResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            market_id,
            side,
            SUM(shares) as total_shares,
            COUNT(*) as num_trades
          FROM trades_raw
          WHERE wallet_address = '${wallet_address}' AND is_resolved = 1
          GROUP BY condition_id, market_id, side
        `,
        format: 'JSONEachRow',
      })

      const positions = await positionsResult.json<{
        condition_id: string,
        market_id: string,
        side: 'YES' | 'NO',
        total_shares: number,
        num_trades: number
      }>()

      // Group by condition_id to calculate net position
      const netPositions = new Map<string, {
        condition_id: string,
        market_id: string,
        net_shares: number,
        num_trades: number
      }>()

      for (const pos of positions) {
        const key = pos.condition_id
        if (!netPositions.has(key)) {
          netPositions.set(key, {
            condition_id: pos.condition_id,
            market_id: pos.market_id,
            net_shares: 0,
            num_trades: 0
          })
        }

        const net = netPositions.get(key)!
        if (pos.side === 'YES') {
          net.net_shares += pos.total_shares
        } else {
          net.net_shares -= pos.total_shares
        }
        net.num_trades += pos.num_trades
      }

      // Process each net position
      for (const net of Array.from(netPositions.values())) {
        // Skip if position is essentially flat
        if (Math.abs(net.net_shares) < 0.01) continue

        // Determine final side
        const finalSide = net.net_shares > 0 ? 'YES' : 'NO'

        // Look up resolution
        const resolution = resolutionsByCondition.get(net.condition_id) || resolutionsByMarket.get(net.market_id)

        if (!resolution) continue

        // Determine if won
        const won = finalSide === resolution.resolved_outcome ? 1 : 0

        // Get canonical category from events_dim via market_id
        let canonicalCategory = 'Unknown'
        try {
          const categoryResult = await clickhouse.query({
            query: `
              SELECT canonical_category
              FROM events_dim
              WHERE market_id = '${net.market_id}'
              LIMIT 1
            `,
            format: 'JSONEachRow',
          })
          const categoryData = await categoryResult.json<{ canonical_category: string }>()
          if (categoryData.length > 0) {
            canonicalCategory = categoryData[0].canonical_category
          }
        } catch (error) {
          // Keep default 'Unknown'
        }

        // Insert into wallet_resolution_outcomes
        await clickhouse.insert({
          table: 'wallet_resolution_outcomes',
          values: [{
            wallet_address,
            condition_id: net.condition_id,
            market_id: net.market_id,
            resolved_outcome: resolution.resolved_outcome,
            final_side: finalSide,
            won,
            resolved_at: resolution.resolved_at || new Date().toISOString(),
            canonical_category: canonicalCategory,
            num_trades: net.num_trades,
            final_shares: Math.abs(net.net_shares),
            ingested_at: new Date().toISOString()
          }],
          format: 'JSONEachRow',
        })

        totalOutcomesInserted++
      }

      walletsProcessed++

      if (walletsProcessed % 100 === 0) {
        console.log(`   Progress: ${walletsProcessed}/${wallets.length} wallets (${totalOutcomesInserted} outcomes)`)
      }

    } catch (error) {
      console.warn(`   ❌ Error processing wallet ${wallet_address}:`, error instanceof Error ? error.message : error)
    }
  }

  // Calculate global metrics
  const globalResult = await clickhouse.query({
    query: `
      SELECT
        AVG(won) * 100 as accuracy_pct,
        COUNT(DISTINCT condition_id) as resolution_markets
      FROM wallet_resolution_outcomes
    `,
    format: 'JSONEachRow',
  })

  const globalData = await globalResult.json<{ accuracy_pct: number, resolution_markets: string }>()
  const globalAccuracy = globalData[0]?.accuracy_pct || 0
  const resolutionMarkets = parseInt(globalData[0]?.resolution_markets || '0')

  console.log(`\n   📊 Global Resolution Accuracy: ${globalAccuracy.toFixed(2)}%`)
  console.log(`   📊 Resolution Markets Tracked: ${resolutionMarkets}`)

  const metrics = {
    wallets_processed: walletsProcessed,
    total_outcomes_inserted: totalOutcomesInserted,
    global_resolution_accuracy_pct: parseFloat(globalAccuracy.toFixed(2)),
    resolution_markets_tracked: resolutionMarkets
  }

  logStepProgress({
    step: 'recomputeResolutionOutcomesForAllWallets',
    done: true,
    metrics,
    timestamp: new Date().toISOString()
  })
}

/**
 * Main execution function
 */
export async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('       Full Enrichment Pass (Phase 4)                     ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log('This will enrich all trades with:')
  console.log('  - market_id (condition → market mapping)')
  console.log('  - realized_pnl_usd (hold-to-resolution P&L)')
  console.log('  - is_resolved flag')
  console.log('  - Resolution accuracy for ALL wallets')
  console.log('')

  ensureRuntimeDir()

  try {
    console.log('Starting full enrichment pipeline...\n')

    await extendConditionMarketMapping()
    await backfillMarketIdsIntoTradesRaw()
    await refreshResolutionMap()
    await populatePnlAndResolutionFlags()
    await recomputeResolutionOutcomesForAllWallets()

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('              ✅ FULL ENRICHMENT COMPLETE!                 ')
    console.log('═══════════════════════════════════════════════════════════\n')

    console.log(`Progress log: ${PROGRESS_LOG}`)

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    throw error
  }
}

// Only run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}
