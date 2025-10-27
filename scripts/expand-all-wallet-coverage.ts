#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const RATE_LIMIT_MS = 1200 // 50 requests/min

interface WalletPnL {
  wallet: string
  realized_pnl_usd: number
  resolved_conditions_covered: number
  total_conditions_seen: number
  coverage_pct: number
}

interface ConditionResolution {
  condition_id: string
  market_id: string
  resolved_outcome: string
  payout_yes: number
  payout_no: number
  resolved_at?: string
}

interface ResolutionMap {
  total_conditions: number
  resolved_conditions: number
  resolutions: ConditionResolution[]
}

/**
 * Fetch market resolution from Polymarket API
 *
 * CRITICAL INVARIANT: outcomePrices must parse to exactly [1,0] or [0,1]
 * Polymarket API returns string arrays, so Number() conversion is required
 */
async function fetchMarketResolution(marketId: string): Promise<{
  resolved_outcome: string | null
  payout_yes: number
  payout_no: number
} | null> {
  try {
    const url = `https://gamma-api.polymarket.com/markets/${marketId}`
    const response = await fetch(url)

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    const isClosed = data.closed === true
    if (!isClosed) {
      return null
    }

    // CRITICAL: Parse outcomePrices and validate binary resolution
    let prices: number[] = []
    if (data.outcomePrices) {
      if (typeof data.outcomePrices === 'string') {
        prices = JSON.parse(data.outcomePrices)
      } else if (Array.isArray(data.outcomePrices)) {
        prices = data.outcomePrices
      }
    }

    // Validate array structure
    if (!Array.isArray(prices) || prices.length !== 2) {
      console.error(`⚠️  VALIDATION FAILED: Market ${marketId} has invalid outcomePrices structure: ${JSON.stringify(prices)}`)
      return null
    }

    // Convert to numbers (API returns strings like "1" and "0")
    const price0 = Number(prices[0])
    const price1 = Number(prices[1])

    // Validate conversion succeeded
    if (isNaN(price0) || isNaN(price1)) {
      console.error(`⚠️  VALIDATION FAILED: Market ${marketId} outcomePrices not numeric: [${prices[0]}, ${prices[1]}]`)
      return null
    }

    // CRITICAL: Must be exactly [1,0] or [0,1] for binary resolution
    let resolved_outcome: string | null = null
    let payout_yes = 0
    let payout_no = 0

    if (price0 === 1 && price1 === 0) {
      resolved_outcome = 'YES'
      payout_yes = 1
      payout_no = 0
    } else if (price0 === 0 && price1 === 1) {
      resolved_outcome = 'NO'
      payout_yes = 0
      payout_no = 1
    } else {
      console.error(`⚠️  VALIDATION FAILED: Market ${marketId} has ambiguous resolution: [${price0}, ${price1}] (must be [1,0] or [0,1])`)
      return null
    }

    console.log(`    ✅ Resolved to ${resolved_outcome}`)
    return { resolved_outcome, payout_yes, payout_no }

  } catch (error) {
    console.error(`⚠️  ERROR fetching market ${marketId}: ${error instanceof Error ? error.message : 'Unknown'}`)
    return null
  }
}

async function main() {
  console.log('🔍 Expanding resolution coverage for all wallets...\n')

  // 1. Load wallet addresses
  const walletPnLPath = resolve(process.cwd(), 'audited_wallet_pnl.json')
  if (!fs.existsSync(walletPnLPath)) {
    throw new Error('audited_wallet_pnl.json not found')
  }

  const walletPnLs: WalletPnL[] = JSON.parse(fs.readFileSync(walletPnLPath, 'utf-8'))
  const walletAddresses = walletPnLs.map(w => w.wallet)

  console.log(`📋 Loaded ${walletAddresses.length} wallet addresses\n`)

  // 2. Load existing resolution map
  const resolutionMapPath = resolve(process.cwd(), 'expanded_resolution_map.json')
  let resolutionMap: ResolutionMap

  if (fs.existsSync(resolutionMapPath)) {
    resolutionMap = JSON.parse(fs.readFileSync(resolutionMapPath, 'utf-8'))
    console.log(`✅ Loaded existing resolution map: ${resolutionMap.resolved_conditions} resolved conditions\n`)
  } else {
    resolutionMap = {
      total_conditions: 0,
      resolved_conditions: 0,
      resolutions: []
    }
    console.log('📝 Creating new resolution map\n')
  }

  // Build lookup set for existing resolutions
  const existingConditions = new Set(resolutionMap.resolutions.map(r => r.condition_id))

  // 3. Get all conditions for all wallets
  console.log('🔎 Querying all conditions from ClickHouse...\n')

  const walletsString = walletAddresses.map(w => `'${w}'`).join(', ')
  const query = `
    SELECT DISTINCT
      condition_id,
      market_id
    FROM trades_raw
    WHERE wallet_address IN (${walletsString})
      AND market_id != ''
      AND market_id != 'unknown'
    ORDER BY condition_id
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const conditions = await result.json() as Array<{ condition_id: string; market_id: string }>
  console.log(`📊 Found ${conditions.length} unique conditions with valid market_ids\n`)

  // 4. Filter to new conditions
  const newConditions = conditions.filter(c => !existingConditions.has(c.condition_id))
  console.log(`🆕 ${newConditions.length} new conditions to resolve\n`)

  if (newConditions.length === 0) {
    console.log('✅ No new conditions to resolve. Coverage is already maximized.\n')
    return
  }

  // 5. Fetch resolutions
  console.log('🌐 Fetching resolutions from Polymarket API...\n')

  let successCount = 0
  let failCount = 0
  const newResolutions: ConditionResolution[] = []

  for (let i = 0; i < newConditions.length; i++) {
    const condition = newConditions[i]
    console.log(`[${i + 1}/${newConditions.length}] Fetching market ${condition.market_id}...`)

    const resolution = await fetchMarketResolution(condition.market_id)

    if (resolution && resolution.resolved_outcome) {
      newResolutions.push({
        condition_id: condition.condition_id,
        market_id: condition.market_id,
        resolved_outcome: resolution.resolved_outcome,
        payout_yes: resolution.payout_yes,
        payout_no: resolution.payout_no,
        resolved_at: new Date().toISOString()
      })
      successCount++
    } else {
      failCount++
    }

    // Rate limiting
    if (i < newConditions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS))
    }
  }

  console.log(`\n📈 Resolution fetch complete:`)
  console.log(`   ✅ Success: ${successCount}`)
  console.log(`   ❌ Failed: ${failCount}`)
  console.log(`   📊 Success rate: ${((successCount / newConditions.length) * 100).toFixed(1)}%\n`)

  // 6. Merge and save
  if (newResolutions.length > 0) {
    resolutionMap.resolutions = [...resolutionMap.resolutions, ...newResolutions]
    resolutionMap.resolved_conditions = resolutionMap.resolutions.length

    // Update total_conditions to include all conditions seen
    const allConditionsSet = new Set<string>()
    for (const wallet of walletAddresses) {
      const walletQuery = `
        SELECT DISTINCT condition_id
        FROM trades_raw
        WHERE wallet_address = '${wallet}'
      `
      const walletResult = await clickhouse.query({
        query: walletQuery,
        format: 'JSONEachRow',
      })
      const walletConditions = await walletResult.json() as Array<{ condition_id: string }>
      walletConditions.forEach(c => allConditionsSet.add(c.condition_id))
    }
    resolutionMap.total_conditions = allConditionsSet.size

    fs.writeFileSync(resolutionMapPath, JSON.stringify(resolutionMap, null, 2))
    console.log(`✅ Updated resolution map saved to ${resolutionMapPath}`)
    console.log(`   Total conditions: ${resolutionMap.total_conditions}`)
    console.log(`   Resolved conditions: ${resolutionMap.resolved_conditions}`)
    console.log(`   Coverage: ${((resolutionMap.resolved_conditions / resolutionMap.total_conditions) * 100).toFixed(2)}%\n`)
  } else {
    console.log('⚠️  No new resolutions to add\n')
  }

  // 7. Trigger audited_wallet_pnl.json regeneration
  console.log('🔄 To regenerate audited_wallet_pnl.json with improved coverage, run:')
  console.log('   npx tsx scripts/calculate-audited-wallet-pnl.ts\n')

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
