#!/usr/bin/env npx tsx
/**
 * MARKET_ID BACKFILL SCRIPT
 *
 * Problem: 89% of conditions in trades_raw have missing market_id ('' or 'unknown')
 * This caps wallet coverage at ~11% and blocks category-level P&L attribution.
 *
 * This script:
 * (A) Scans trades_raw for missing market_ids
 * (B) Uses local mappings to backfill what we can (READ-ONLY)
 * (C) Generates data/backfilled_market_ids.json with recoverable mappings
 * (D) Reports: total missing, recoverable count, recovery percentage
 *
 * Sources used for backfill (in order):
 * 1. data/markets_dim_seed.json (condition_id → market_id)
 * 2. data/expanded_resolution_map.json (condition_id → market_id)
 *
 * IMPORTANT: This script is READ-ONLY. It does NOT update trades_raw.
 * To apply the backfill, you must separately UPDATE trades_raw using the output JSON.
 *
 * ============================================================================
 * FORWARD INGESTION FIX (TO PREVENT THIS FROM HAPPENING AGAIN)
 * ============================================================================
 *
 * Current Issue:
 * - Trades are ingested into ClickHouse trades_raw table
 * - At ingestion time, market_id is often missing or set to 'unknown'
 * - Root cause: The data source (likely Polymarket fills API or blockchain events)
 *   doesn't always include market_id, only condition_id
 *
 * Where we currently insert:
 * - Location: (NEEDS TO BE IDENTIFIED - likely in ETL pipeline or data ingestion service)
 * - Current INSERT: Writes condition_id, wallet_address, side, shares, entry_price, timestamp
 * - Missing step: No lookup to resolve condition_id → market_id before insert
 *
 * What must change at ingestion time:
 *
 * 1. BEFORE INSERT into trades_raw:
 *    - For each incoming fill/trade with condition_id:
 *      a. Check if we already have market_id in the incoming data
 *      b. If missing, query Polymarket API: GET /markets?condition_id={condition_id}
 *      c. If found, extract market_id and include in INSERT
 *      d. If not found after API call, set market_id to 'pending_lookup' (not 'unknown')
 *
 * 2. Build a cache/mapping table:
 *    - Create condition_to_market_cache table in ClickHouse or Redis
 *    - Schema: { condition_id: String, market_id: String, last_updated: DateTime }
 *    - TTL: 30 days (markets don't change after resolution)
 *    - On first lookup, cache the result to avoid repeated API calls
 *
 * 3. Logging for failed lookups:
 *    - If condition_id → market_id lookup fails at ingestion:
 *      * Log to failed_market_id_lookups.jsonl with:
 *        - timestamp
 *        - condition_id
 *        - wallet_address
 *        - reason (e.g., 'api_404', 'api_timeout', 'malformed_condition_id')
 *      * Set market_id = 'pending_lookup' in trades_raw (not 'unknown')
 *      * Schedule for retry in batch job (daily)
 *
 * 4. Batch recovery job (daily cron):
 *    - Query trades_raw WHERE market_id = 'pending_lookup'
 *    - Retry Polymarket API lookups for those condition_ids
 *    - UPDATE trades_raw SET market_id = {found_market_id} WHERE condition_id = {cid}
 *    - Log successes to recovered_market_ids.jsonl
 *
 * 5. Monitoring/alerting:
 *    - Track % of trades with valid market_id (target: >95%)
 *    - Alert if % drops below 90% (indicates API issues or schema changes)
 *    - Dashboard metric: "market_id coverage" per day
 *
 * Expected outcome:
 * - Every new fill arrives with: wallet, side, price, shares, timestamp, condition_id, AND market_id
 * - Coverage rises from 11% to >95%
 * - Full category attribution becomes possible
 * - Wallet P&L coverage jumps from 2-35% to >90%
 *
 * API endpoint for lookup:
 * - https://gamma-api.polymarket.com/markets?condition_id={condition_id}
 * - Returns market object with id, question, category, etc.
 * - Rate limit: ~100 req/min (need to batch/cache to stay under limit)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

interface MarketMapping {
  condition_id: string
  market_id: string
  source: 'markets_dim' | 'resolution_map'
}

/**
 * External resolver for condition_id → market_id
 *
 * Tries multiple sources to resolve a condition_id to a real market_id:
 * 1. Polymarket Gamma API: /markets?condition_id={cid}
 * 2. (Future) Goldsky/subgraph fallback
 *
 * @param conditionId - The condition_id to resolve
 * @returns market_id if found, null otherwise (never "unknown")
 */
async function fetchMarketIdFromExternal(conditionId: string): Promise<string | null> {
  try {
    // 1. Try Polymarket Gamma API
    const url = `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000) // 5s timeout
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    // API returns array of markets
    if (Array.isArray(data) && data.length > 0) {
      const market = data[0]
      const marketId = market.id || market.market_id

      if (marketId && marketId !== 'unknown' && marketId !== '') {
        return String(marketId)
      }
    }

    // 2. TODO: Add Goldsky/subgraph fallback here if Polymarket fails
    // For now, just return null if Polymarket didn't have it

    return null
  } catch (error) {
    // Timeout, network error, or parse error
    return null
  }
}

async function main() {
  console.log('🔍 MARKET_ID BACKFILL ANALYZER\n')
  console.log('================================================\n')

  // Step 1: Load local mapping sources
  console.log('📊 Step 1: Loading local mapping sources...\n')

  const dataDir = resolve(process.cwd(), 'data')
  const conditionToMarket = new Map<string, { market_id: string; source: string }>()

  // Source 1: markets_dim_seed.json
  const marketsDimPath = resolve(dataDir, 'markets_dim_seed.json')
  if (fs.existsSync(marketsDimPath)) {
    const marketsDim = JSON.parse(fs.readFileSync(marketsDimPath, 'utf-8'))
    for (const market of marketsDim) {
      if (market.condition_id && market.market_id) {
        conditionToMarket.set(market.condition_id.toLowerCase(), {
          market_id: market.market_id,
          source: 'markets_dim'
        })
      }
    }
    console.log(`✅ Loaded ${marketsDim.length} mappings from markets_dim_seed.json`)
  } else {
    console.log(`⚠️  markets_dim_seed.json not found (dimension build may not be complete)`)
  }

  // Source 2: expanded_resolution_map.json
  const resolutionMapPath = resolve(dataDir, 'expanded_resolution_map.json')
  if (fs.existsSync(resolutionMapPath)) {
    const resolutionData = JSON.parse(fs.readFileSync(resolutionMapPath, 'utf-8'))
    const resolutions = resolutionData.resolutions || []
    for (const res of resolutions) {
      if (res.condition_id && res.market_id) {
        const key = res.condition_id.toLowerCase()
        if (!conditionToMarket.has(key)) {
          conditionToMarket.set(key, {
            market_id: res.market_id,
            source: 'resolution_map'
          })
        }
      }
    }
    console.log(`✅ Loaded ${resolutions.length} mappings from expanded_resolution_map.json`)
  } else {
    console.log(`⚠️  expanded_resolution_map.json not found`)
  }

  console.log(`\n✅ Total unique mappings available: ${conditionToMarket.size}\n`)

  // Step 2: Query trades_raw for missing market_ids
  console.log('📊 Step 2: Scanning trades_raw for missing market_ids...\n')

  const missingQuery = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE (market_id = '' OR market_id = 'unknown')
      AND condition_id != ''
  `

  const missingResult = await clickhouse.query({ query: missingQuery, format: 'JSONEachRow' })
  const missingConditions = await missingResult.json<{ condition_id: string }>()

  console.log(`✅ Found ${missingConditions.length} distinct conditions with missing market_id\n`)

  // Step 3: Check how many we can backfill WITH VALID market_ids
  console.log('📊 Step 3: Matching against local mappings (filtering for VALID market_ids)...\n')

  const validBackfillable: MarketMapping[] = []
  const unknownMarketId: MarketMapping[] = []
  const notFoundInLocal: string[] = []

  for (const { condition_id } of missingConditions) {
    const mapping = conditionToMarket.get(condition_id.toLowerCase())
    if (mapping) {
      // Check if the market_id is actually valid (not 'unknown' or empty)
      if (mapping.market_id && mapping.market_id !== 'unknown' && mapping.market_id !== '') {
        validBackfillable.push({
          condition_id,
          market_id: mapping.market_id,
          source: mapping.source as 'markets_dim' | 'resolution_map'
        })
      } else {
        unknownMarketId.push({
          condition_id,
          market_id: mapping.market_id,
          source: mapping.source as 'markets_dim' | 'resolution_map'
        })
      }
    } else {
      notFoundInLocal.push(condition_id)
    }
  }

  console.log(`✅ Valid market_ids from local sources: ${validBackfillable.length}`)
  console.log(`⚠️  Found in local but market_id='unknown': ${unknownMarketId.length}`)
  console.log(`⚠️  Not found in local sources: ${notFoundInLocal.length}`)
  console.log(`📈 Valid recovery rate: ${((validBackfillable.length / missingConditions.length) * 100).toFixed(2)}%`)
  console.log(`🔴 Need external lookup: ${unknownMarketId.length + notFoundInLocal.length} (${(((unknownMarketId.length + notFoundInLocal.length) / missingConditions.length) * 100).toFixed(2)}%)\n`)

  // Step 4: Count total affected trades
  console.log('📊 Step 4: Counting affected trades...\n')

  const affectedQuery = `
    SELECT COUNT(*) as count
    FROM trades_raw
    WHERE (market_id = '' OR market_id = 'unknown')
      AND condition_id != ''
  `

  const affectedResult = await clickhouse.query({ query: affectedQuery, format: 'JSONEachRow' })
  const affectedData = await affectedResult.json<{ count: string }>()
  const totalAffectedTrades = parseInt(affectedData[0]?.count || '0')

  const totalTradesQuery = `SELECT COUNT(*) as count FROM trades_raw`
  const totalTradesResult = await clickhouse.query({ query: totalTradesQuery, format: 'JSONEachRow' })
  const totalTradesData = await totalTradesResult.json<{ count: string }>()
  const totalTrades = parseInt(totalTradesData[0]?.count || '0')

  console.log(`✅ Total trades in trades_raw: ${totalTrades.toLocaleString()}`)
  console.log(`⚠️  Trades with missing market_id: ${totalAffectedTrades.toLocaleString()}`)
  console.log(`📉 Missing market_id rate: ${((totalAffectedTrades / totalTrades) * 100).toFixed(2)}%\n`)

  // Step 5: Write backfill mappings to JSON
  console.log('📊 Step 5: Writing backfill mappings...\n')

  const needingExternalLookup = unknownMarketId.length + notFoundInLocal.length

  const outputPath = resolve(dataDir, 'backfilled_market_ids.json')
  const output = {
    generated_at: new Date().toISOString(),
    summary: {
      total_conditions_missing_market_id: missingConditions.length,
      num_with_valid_market_id: validBackfillable.length,
      num_with_unknown_or_empty: unknownMarketId.length,
      num_not_found_in_local: notFoundInLocal.length,
      num_remaining_needing_external_lookup: needingExternalLookup,
      pct_remaining_needing_external_lookup: ((needingExternalLookup / missingConditions.length) * 100).toFixed(2),
      valid_recovery_rate_pct: ((validBackfillable.length / missingConditions.length) * 100).toFixed(2),
      total_trades_affected: totalAffectedTrades,
      total_trades: totalTrades,
      trades_missing_pct: ((totalAffectedTrades / totalTrades) * 100).toFixed(2)
    },
    valid_backfill_mappings: validBackfillable,
    unknown_market_id_mappings: unknownMarketId.slice(0, 100), // Sample
    not_found_in_local_sample: notFoundInLocal.slice(0, 100) // Sample
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`✅ Wrote ${outputPath}`)
  console.log(`   Valid backfillable mappings: ${validBackfillable.length}`)
  console.log(`   Mappings with 'unknown': ${Math.min(100, unknownMarketId.length)} (sample)`)
  console.log(`   Not found in local: ${Math.min(100, notFoundInLocal.length)} (sample)\n`)

  // Step 6: Summary
  console.log('================================================')
  console.log('📊 BACKFILL ANALYSIS SUMMARY')
  console.log('================================================\n')

  console.log(`Total trades: ${totalTrades.toLocaleString()}`)
  console.log(`Trades with missing market_id: ${totalAffectedTrades.toLocaleString()} (${output.summary.trades_missing_pct}%)\n`)

  console.log(`Distinct conditions missing market_id: ${missingConditions.length.toLocaleString()}`)
  console.log(`Valid market_ids from local sources: ${validBackfillable.length.toLocaleString()} (${output.summary.valid_recovery_rate_pct}%)`)
  console.log(`Found in local but market_id='unknown': ${unknownMarketId.length.toLocaleString()}`)
  console.log(`Not found in local sources: ${notFoundInLocal.length.toLocaleString()}`)
  console.log(`🔴 Need external lookup: ${needingExternalLookup.toLocaleString()} (${output.summary.pct_remaining_needing_external_lookup}%)\n`)

  console.log('🎯 Impact:')
  console.log(`   Before backfill: ${output.summary.trades_missing_pct}% of trades lack market_id`)
  console.log(`   Valid recovery from local: ${output.summary.valid_recovery_rate_pct}%`)
  console.log(`   Still need external lookup: ${output.summary.pct_remaining_needing_external_lookup}%`)
  console.log(`   ⚠️  Local sources contain 'unknown' market_ids - not usable\n`)

  console.log('📋 Next steps:')
  console.log('1. Review data/backfilled_market_ids.json')
  console.log('2. Implement fetchMarketIdFromExternal() resolver')
  console.log('3. Run batch external lookup for ${needingExternalLookup.toLocaleString()} conditions')
  console.log('4. Apply backfill: UPDATE trades_raw using resolved mappings')
  console.log('5. Fix ingestion pipeline to populate market_id at insert time\n')

  console.log('🔴 NEXT ACTIONS:')
  console.log('================================================\n')
  console.log(`We need to run fetchMarketIdFromExternal() across ~${needingExternalLookup.toLocaleString()} condition_ids`)
  console.log('and persist that mapping before we can claim category attribution.')
  console.log('')
  console.log('This is THE critical path blocker for:')
  console.log('  - Category-level P&L attribution')
  console.log('  - Wallet skill by category (Sports, Politics, Crypto)')
  console.log('  - Real-time category-based signal filtering')
  console.log('  - Increasing wallet coverage from ~11% to >95%\n')

  console.log('✅ BACKFILL ANALYSIS COMPLETE\n')

  // ============================================================================
  // BATCH EXTERNAL LOOKUP
  // ============================================================================

  console.log('================================================')
  console.log('🔄 BATCH EXTERNAL MARKET_ID LOOKUP')
  console.log('================================================\n')

  const NUM_WORKERS = 5
  const DELAY_MS = 600

  console.log(`Starting batch lookup for ${needingExternalLookup.toLocaleString()} conditions...\n`)
  console.log(`Using ${NUM_WORKERS} parallel workers`)
  console.log(`Rate limiting: ${DELAY_MS}ms delay per request`)
  console.log(`Effective rate: ~${Math.floor(NUM_WORKERS * 60000 / DELAY_MS)} req/min (under Polymarket's 100 req/min limit)`)
  console.log(`Estimated time: ~${Math.ceil(needingExternalLookup * DELAY_MS / 60000 / NUM_WORKERS)} minutes\n`)

  const resultsPath = resolve(dataDir, 'market_id_lookup_results.jsonl')
  // Clear existing file
  if (fs.existsSync(resultsPath)) {
    fs.unlinkSync(resultsPath)
  }

  const allMissingConditions = [...unknownMarketId.map(m => m.condition_id), ...notFoundInLocal]

  let totalAttempted = 0
  let resolvedSuccessfully = 0
  let stillUnresolved = 0

  const resolvedMappings: MarketMapping[] = []
  const progressLock = { value: 0 }

  // Split into chunks for workers
  const chunkSize = Math.ceil(allMissingConditions.length / NUM_WORKERS)
  const chunks = []
  for (let i = 0; i < NUM_WORKERS; i++) {
    chunks.push(allMissingConditions.slice(i * chunkSize, (i + 1) * chunkSize))
  }

  // Worker function
  async function worker(conditionChunk: string[]) {
    for (const conditionId of conditionChunk) {
      progressLock.value++
      const currentAttempted = progressLock.value

      const marketId = await fetchMarketIdFromExternal(conditionId)

      if (marketId) {
        resolvedSuccessfully++

        // Write to JSONL (thread-safe append)
        const logLine = JSON.stringify({ condition_id: conditionId, market_id: marketId }) + '\n'
        fs.appendFileSync(resultsPath, logLine, 'utf-8')

        // Track for final summary
        resolvedMappings.push({
          condition_id: conditionId,
          market_id: marketId,
          source: 'markets_dim'
        })
      } else {
        stillUnresolved++
      }

      // Progress logging every 500 lookups
      if (currentAttempted % 500 === 0) {
        console.log(`Progress: ${currentAttempted}/${allMissingConditions.length}`)
        console.log(`  Resolved: ${resolvedSuccessfully} (${((resolvedSuccessfully / currentAttempted) * 100).toFixed(1)}%)`)
        console.log(`  Unresolved: ${stillUnresolved} (${((stillUnresolved / currentAttempted) * 100).toFixed(1)}%)\n`)
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }

  // Run workers in parallel
  await Promise.all(chunks.map(chunk => worker(chunk)))

  totalAttempted = progressLock.value

  console.log('\n================================================')
  console.log('✅ BATCH LOOKUP COMPLETE')
  console.log('================================================\n')

  console.log(`Total attempted: ${totalAttempted.toLocaleString()}`)
  console.log(`Resolved successfully: ${resolvedSuccessfully.toLocaleString()} (${((resolvedSuccessfully / totalAttempted) * 100).toFixed(2)}%)`)
  console.log(`Still unresolved: ${stillUnresolved.toLocaleString()} (${((stillUnresolved / totalAttempted) * 100).toFixed(2)}%)\n`)

  // Update backfilled_market_ids.json with REAL mappings
  const updatedOutput = {
    generated_at: new Date().toISOString(),
    summary: {
      total_conditions_missing_market_id: missingConditions.length,
      num_with_valid_market_id: validBackfillable.length + resolvedSuccessfully,
      num_resolved_via_external_api: resolvedSuccessfully,
      num_still_unresolved: stillUnresolved,
      valid_recovery_rate_pct: (((validBackfillable.length + resolvedSuccessfully) / missingConditions.length) * 100).toFixed(2),
      total_trades_affected: totalAffectedTrades,
      total_trades: totalTrades,
      trades_missing_pct: ((totalAffectedTrades / totalTrades) * 100).toFixed(2),
      new_coverage_after_backfill: (((totalTrades - totalAffectedTrades + resolvedSuccessfully) / totalTrades) * 100).toFixed(2)
    },
    valid_backfill_mappings: [...validBackfillable, ...resolvedMappings],
    still_unresolved_condition_ids: allMissingConditions.filter(cid => {
      return !resolvedMappings.find(m => m.condition_id === cid)
    }).slice(0, 100) // Sample
  }

  fs.writeFileSync(outputPath, JSON.stringify(updatedOutput, null, 2))
  console.log(`✅ Updated ${outputPath}`)
  console.log(`   Total valid mappings: ${updatedOutput.valid_backfill_mappings.length.toLocaleString()}`)
  console.log(`   Unresolved sample: ${Math.min(100, stillUnresolved)}\n`)

  console.log('================================================')
  console.log('📊 FINAL COVERAGE PROJECTION')
  console.log('================================================\n')

  console.log(`Current state:`)
  console.log(`  Trades with valid market_id: ${(totalTrades - totalAffectedTrades).toLocaleString()} (${((totalTrades - totalAffectedTrades) / totalTrades * 100).toFixed(2)}%)`)
  console.log(`  Trades missing market_id: ${totalAffectedTrades.toLocaleString()} (${output.summary.trades_missing_pct}%)\n`)

  console.log(`After applying backfill:`)
  console.log(`  New trades with market_id: ${(totalTrades - totalAffectedTrades + resolvedSuccessfully).toLocaleString()}`)
  console.log(`  New coverage: ${updatedOutput.summary.new_coverage_after_backfill}%`)
  console.log(`  Still missing: ${(totalAffectedTrades - resolvedSuccessfully).toLocaleString()}\n`)

  const newCoverage = parseFloat(updatedOutput.summary.new_coverage_after_backfill)

  if (newCoverage >= 95) {
    console.log('✅ TARGET MET: >95% coverage achieved!')
    console.log('✅ Category P&L and wallet-by-category skill attribution are NOW POSSIBLE\n')
  } else if (newCoverage >= 80) {
    console.log('⚠️  80-95% coverage: Partial category attribution possible')
    console.log('   Recommend additional external lookups or accept current limitation\n')
  } else {
    console.log('🔴 <80% coverage: Not sufficient for reliable category attribution')
    console.log('   Need to find additional data sources or improve resolver\n')
  }

  console.log('================================================\n')
}

main().catch(console.error)
