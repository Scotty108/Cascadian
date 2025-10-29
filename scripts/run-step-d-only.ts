#!/usr/bin/env tsx
/**
 * Run Step D Only: Populate P&L and Resolution Flags
 *
 * This script runs ONLY Step D from the full enrichment pass.
 * It uses the existing expanded_resolution_map.json file.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const RESOLUTION_MAP_FILE = resolve(process.cwd(), 'data/expanded_resolution_map.json')
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '300')

interface Resolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: number
  payout_no: number
}

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

async function main() {
  console.log('📍 Step D: Populate P&L and Resolution Flags')
  console.log(`   Using BATCH_SIZE: ${BATCH_SIZE}\n`)

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

  // Process pairs in batches
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, Math.min(i + BATCH_SIZE, pairs.length))
    batchCount++

    console.log(`   Processing batch ${batchCount} (pairs ${i + 1}-${Math.min(i + BATCH_SIZE, pairs.length)} of ${pairs.length})...`)

    for (const { wallet_address, condition_id, market_id } of batch) {
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
      } catch (error) {
        console.warn(`   ❌ Error processing pair (${wallet_address}, ${condition_id}):`, error instanceof Error ? error.message : error)
      }
    }

    console.log(`   Batch ${batchCount} complete: ${pairsWithResolution} pairs with resolution, ${tradesUpdated} trades updated`)

    // Wait for mutations after each batch
    if (batchCount % 5 === 0) {
      console.log(`   Waiting for mutations after batch ${batchCount}...`)
      await waitForMutations()
    }
  }

  console.log('\n   Final wait for all mutations to complete...')
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

  console.log('\n📊 Step D Results:')
  console.log(`   Total pairs processed: ${pairs.length}`)
  console.log(`   Pairs with resolution: ${pairsWithResolution}`)
  console.log(`   Trades updated: ${tradesUpdated}`)
  console.log(`   Trades resolved: ${resolvedCount}`)
  console.log(`   Resolved trades: ${(resolvedCount / totalCount * 100).toFixed(2)}%`)

  console.log('\n✅ Step D complete!')
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
