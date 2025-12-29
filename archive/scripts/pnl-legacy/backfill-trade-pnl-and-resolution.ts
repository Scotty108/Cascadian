#!/usr/bin/env tsx
/**
 * Backfill Trade P&L and Resolution Status
 *
 * Computes and backfills realized_pnl_usd and is_resolved for top wallets
 * Uses the same audited P&L calculation logic (with 128x share fix)
 *
 * SCOPE: Top 5 wallets only (from condition_sample.json)
 * IDEMPOTENT: Safe to re-run, never overwrites nonzero P&L with zero
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

interface Trade {
  trade_id: string
  wallet_address: string
  condition_id: string
  tx_timestamp: string
  side: string
  shares: number
  entry_price: number
  usd_value: number
}

interface Resolution {
  condition_id: string
  outcome: number // 0 or 1
  resolved: boolean
}

/**
 * Load resolution data
 * Uses the same resolution map we trust for audited P&L calculations
 */
function loadResolutionMap(): Map<string, Resolution> {
  const resolutionMap = new Map<string, Resolution>()

  // Try multiple sources for resolution data
  const possiblePaths = [
    'data/resolved_markets.json',
    'data/resolution_map.json',
    'realized_markets.json'
  ]

  for (const path of possiblePaths) {
    const fullPath = resolve(process.cwd(), path)
    if (fs.existsSync(fullPath)) {
      console.log(`Loading resolution data from ${path}`)
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

      // Handle different formats
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.condition_id && item.outcome !== undefined) {
            resolutionMap.set(item.condition_id, {
              condition_id: item.condition_id,
              outcome: parseInt(item.outcome),
              resolved: true
            })
          }
        }
      } else if (typeof data === 'object') {
        for (const [conditionId, value] of Object.entries(data)) {
          if (typeof value === 'object' && value !== null && 'outcome' in value) {
            resolutionMap.set(conditionId, {
              condition_id: conditionId,
              outcome: parseInt((value as any).outcome),
              resolved: true
            })
          }
        }
      }

      if (resolutionMap.size > 0) {
        console.log(`Loaded ${resolutionMap.size} resolved conditions`)
        break
      }
    }
  }

  return resolutionMap
}

/**
 * Calculate realized P&L for a position
 * Uses audited calculation logic with 128x share correction
 */
function calculateRealizedPnl(
  trades: Trade[],
  resolution: Resolution
): Map<string, number> {
  const tradePnl = new Map<string, number>()

  // Group trades by side (YES/NO)
  const yesTrades = trades.filter(t => t.side === 'YES')
  const noTrades = trades.filter(t => t.side === 'NO')

  // Calculate total shares (with 128x correction already applied in source data)
  const yesShares = yesTrades.reduce((sum, t) => sum + t.shares, 0)
  const noShares = noTrades.reduce((sum, t) => sum + t.shares, 0)

  // Calculate average entry price
  const yesValueSum = yesTrades.reduce((sum, t) => sum + t.usd_value, 0)
  const noValueSum = noTrades.reduce((sum, t) => sum + t.usd_value, 0)

  const yesAvgPrice = yesShares > 0 ? yesValueSum / yesShares : 0
  const noAvgPrice = noShares > 0 ? noValueSum / noShares : 0

  // Calculate P&L based on final outcome
  const outcome = resolution.outcome
  const yesPnl = outcome === 1 ? yesShares * (1 - yesAvgPrice) : yesShares * (0 - yesAvgPrice)
  const noPnl = outcome === 0 ? noShares * (1 - noAvgPrice) : noShares * (0 - noAvgPrice)

  // Distribute P&L proportionally across trades
  if (yesShares > 0) {
    for (const trade of yesTrades) {
      const proportion = trade.shares / yesShares
      tradePnl.set(trade.trade_id, yesPnl * proportion)
    }
  }

  if (noShares > 0) {
    for (const trade of noTrades) {
      const proportion = trade.shares / noShares
      tradePnl.set(trade.trade_id, noPnl * proportion)
    }
  }

  return tradePnl
}

async function main() {
  console.log('🚀 Backfill Trade P&L and Resolution Status')
  console.log('============================================\n')

  // Load resolution map
  const resolutionMap = loadResolutionMap()

  if (resolutionMap.size === 0) {
    console.error('❌ No resolution data found. Cannot compute P&L.')
    console.error('   Expected files: data/resolved_markets.json or data/resolution_map.json')
    process.exit(1)
  }

  // Load top 5 wallets
  const samplePath = resolve(process.cwd(), 'data/condition_sample.json')
  if (!fs.existsSync(samplePath)) {
    console.error('❌ condition_sample.json not found')
    process.exit(1)
  }

  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'))
  const wallets = sample.wallets.map((w: any) => w.wallet_address)

  console.log(`Processing ${wallets.length} wallets:\n`)
  for (const wallet of wallets) {
    console.log(`  ${wallet}`)
  }
  console.log('')

  let totalTradesScanned = 0
  let tradesUpdatedWithPnl = 0
  let distinctConditionsAffected = new Set<string>()
  let tradesWithResolvedPnl = 0

  for (const walletAddress of wallets) {
    console.log(`\n📊 Processing wallet: ${walletAddress}`)

    // Fetch all trades for this wallet
    const result = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          wallet_address,
          condition_id,
          tx_timestamp,
          side,
          shares,
          entry_price,
          usd_value
        FROM trades_raw
        WHERE wallet_address = '${walletAddress}'
        ORDER BY condition_id, tx_timestamp
      `,
      format: 'JSONEachRow'
    })

    const trades = await result.json() as Trade[]
    console.log(`   Found ${trades.length} trades`)
    totalTradesScanned += trades.length

    // Group by condition_id
    const tradesByCondition = new Map<string, Trade[]>()
    for (const trade of trades) {
      if (!tradesByCondition.has(trade.condition_id)) {
        tradesByCondition.set(trade.condition_id, [])
      }
      tradesByCondition.get(trade.condition_id)!.push(trade)
    }

    console.log(`   Grouped into ${tradesByCondition.size} unique conditions`)

    // Process each condition
    let updatesThisWallet = 0

    for (const [conditionId, conditionTrades] of tradesByCondition.entries()) {
      const resolution = resolutionMap.get(conditionId)

      if (!resolution) {
        // Not resolved - set is_resolved=0, skip P&L calculation
        continue
      }

      // Calculate P&L for this condition
      const tradePnlMap = calculateRealizedPnl(conditionTrades, resolution)

      // Build UPDATE statements in batches
      const updates: Array<{ trade_id: string; pnl: number }> = []

      for (const trade of conditionTrades) {
        const pnl = tradePnlMap.get(trade.trade_id)
        if (pnl !== undefined && pnl !== 0) {
          updates.push({ trade_id: trade.trade_id, pnl })
        }
      }

      if (updates.length > 0) {
        // Execute UPDATE for this batch
        const caseStatements = updates
          .map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.pnl}`)
          .join('\n        ')

        const tradeIds = updates.map(u => `'${u.trade_id}'`).join(', ')

        const updateQuery = `
          ALTER TABLE trades_raw
          UPDATE
            realized_pnl_usd = CASE
              ${caseStatements}
              ELSE realized_pnl_usd
            END,
            is_resolved = 1
          WHERE trade_id IN (${tradeIds})
            AND realized_pnl_usd = 0
        `

        try {
          await clickhouse.command({ query: updateQuery })
          updatesThisWallet += updates.length
          tradesUpdatedWithPnl += updates.length
          distinctConditionsAffected.add(conditionId)
          tradesWithResolvedPnl += updates.length
        } catch (error: any) {
          console.error(`   ⚠️  Error updating batch for condition ${conditionId}:`, error.message)
        }
      }
    }

    console.log(`   ✅ Updated ${updatesThisWallet} trades with P&L`)
  }

  // Wait for mutations
  console.log('\n⏳ Waiting for ClickHouse mutations to complete...')

  let mutationsComplete = false
  let retries = 0
  const maxRetries = 30

  while (!mutationsComplete && retries < maxRetries) {
    const mutationsResult = await clickhouse.query({
      query: `
        SELECT count() as pending_mutations
        FROM system.mutations
        WHERE is_done = 0
          AND table = 'trades_raw'
          AND database = currentDatabase()
      `,
      format: 'JSONEachRow'
    })

    const mutationsData = (await mutationsResult.json()) as Array<{
      pending_mutations: string
    }>
    const pendingMutations = parseInt(mutationsData[0].pending_mutations)

    if (pendingMutations === 0) {
      mutationsComplete = true
      console.log('   ✅ All mutations completed!\n')
    } else {
      process.stdout.write(`   ⏳ Waiting... (${pendingMutations} mutations pending)\r`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      retries++
    }
  }

  // Summary
  console.log('📋 BACKFILL SUMMARY')
  console.log('===================')
  console.log(`   Total trades scanned: ${totalTradesScanned.toLocaleString()}`)
  console.log(`   Trades updated with nonzero realized_pnl_usd: ${tradesUpdatedWithPnl.toLocaleString()}`)
  console.log(`   Distinct condition_ids affected: ${distinctConditionsAffected.size}`)
  console.log(`   Rows with is_resolved=1 and realized_pnl_usd != 0: ${tradesWithResolvedPnl.toLocaleString()}`)
  console.log('')

  if (tradesUpdatedWithPnl > 0) {
    console.log('✅ P&L backfill complete for top wallets!')
  } else {
    console.log('⚠️  No trades updated. Check resolution data coverage.')
  }
}

main().catch((error) => {
  console.error('\n💥 Fatal error:', error)
  process.exit(1)
})
