#!/usr/bin/env npx tsx
/**
 * Progress Checkpoint Script
 *
 * Monitors progress of:
 * 1. Dimension build (markets enrichment)
 * 2. Market_id backfill (external lookups)
 * 3. Projected trade coverage after backfill
 */

import { resolve } from 'path'
import * as fs from 'fs'

async function main() {
  const dataDir = resolve(process.cwd(), 'data')

  console.log('📊 PROGRESS CHECKPOINT')
  console.log('================================================\n')

  // 1. Check dimension build progress
  console.log('🏗️  DIMENSION BUILD')
  console.log('-------------------')

  const dimensionLog = resolve(dataDir, 'dimension-build.log')
  if (fs.existsSync(dimensionLog)) {
    const logContent = fs.readFileSync(dimensionLog, 'utf-8')
    const lines = logContent.split('\n')

    // Find latest progress line
    let latestProgress = null
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Progress:')) {
        latestProgress = lines[i].trim()
        break
      }
    }

    if (latestProgress) {
      // Parse: "Progress: 850/4961 (611 enriched)"
      const match = latestProgress.match(/Progress: (\d+)\/(\d+) \((\d+) enriched\)/)
      if (match) {
        const [_, current, total, enriched] = match
        const pct = ((parseInt(current) / parseInt(total)) * 100).toFixed(1)
        const enrichPct = ((parseInt(enriched) / parseInt(current)) * 100).toFixed(1)

        console.log(`Markets processed: ${current}/${total} (${pct}%)`)
        console.log(`Enriched with event_id: ${enriched}/${current} (${enrichPct}%)`)
        console.log(`Status: ${parseInt(current) === parseInt(total) ? '✅ Complete' : '🔄 Running'}`)
      } else {
        console.log(`Latest: ${latestProgress}`)
      }
    } else {
      console.log('No progress data yet')
    }

    // Check if events were fetched
    const eventsFetched = logContent.match(/Fetched (\d+) total events/)?.[1]
    const conditionMappings = logContent.match(/Built mapping for (\d+) conditions/)?.[1]
    if (eventsFetched && conditionMappings) {
      console.log(`Events fetched: ${parseInt(eventsFetched).toLocaleString()}`)
      console.log(`Condition mappings: ${parseInt(conditionMappings).toLocaleString()}`)
    }
  } else {
    console.log('⚠️  No dimension-build.log found')
  }

  console.log('')

  // 2. Check backfill progress
  console.log('🔍 MARKET_ID BACKFILL')
  console.log('---------------------')

  const backfillLog = resolve(dataDir, 'backfill-run.log')
  if (fs.existsSync(backfillLog)) {
    const logContent = fs.readFileSync(backfillLog, 'utf-8')
    const lines = logContent.split('\n')

    // Find latest progress line
    let latestProgress = null
    let latestResolved = null
    let latestUnresolved = null

    for (let i = lines.length - 1; i >= 0; i--) {
      if (!latestProgress && lines[i].includes('Progress:')) {
        latestProgress = lines[i].trim()
      }
      if (!latestResolved && lines[i].includes('Resolved:')) {
        latestResolved = lines[i].trim()
      }
      if (!latestUnresolved && lines[i].includes('Unresolved:')) {
        latestUnresolved = lines[i].trim()
      }
      if (latestProgress && latestResolved && latestUnresolved) break
    }

    if (latestProgress) {
      // Parse: "Progress: 500/44047"
      const match = latestProgress.match(/Progress: (\d+)\/(\d+)/)
      if (match) {
        const [_, current, total] = match
        const pct = ((parseInt(current) / parseInt(total)) * 100).toFixed(1)

        console.log(`Conditions processed: ${parseInt(current).toLocaleString()}/${parseInt(total).toLocaleString()} (${pct}%)`)

        // Parse resolved count
        if (latestResolved) {
          const resolvedMatch = latestResolved.match(/Resolved: (\d+) \(([\d.]+)%\)/)
          if (resolvedMatch) {
            const [_, resolved, resPct] = resolvedMatch
            console.log(`✅ Resolved to real market_id: ${parseInt(resolved).toLocaleString()} (${resPct}%)`)
          }
        }

        // Parse unresolved count
        if (latestUnresolved) {
          const unresolvedMatch = latestUnresolved.match(/Unresolved: (\d+) \(([\d.]+)%\)/)
          if (unresolvedMatch) {
            const [_, unresolved, unresPct] = unresolvedMatch
            console.log(`⚠️  Unresolved: ${parseInt(unresolved).toLocaleString()} (${unresPct}%)`)
          }
        }

        console.log(`Status: ${parseInt(current) === parseInt(total) ? '✅ Complete' : '🔄 Running'}`)

        // ETA calculation
        if (parseInt(current) < parseInt(total)) {
          const remaining = parseInt(total) - parseInt(current)
          const etaMinutes = Math.ceil(remaining * 0.6 / 60) // 600ms per request with 5 workers
          console.log(`ETA: ~${etaMinutes} minutes`)
        }
      }
    } else {
      console.log('No progress data yet (job may be starting)')
    }

    // Count results in JSONL file
    const resultsPath = resolve(dataDir, 'market_id_lookup_results.jsonl')
    if (fs.existsSync(resultsPath)) {
      const lines = fs.readFileSync(resultsPath, 'utf-8').trim().split('\n').filter(l => l)
      console.log(`JSONL file has ${lines.length.toLocaleString()} resolved mappings`)
    }
  } else {
    console.log('⚠️  No backfill-run.log found (job may not have started)')
  }

  console.log('')

  // 3. Calculate projected coverage
  console.log('📈 TRADE COVERAGE PROJECTION')
  console.log('----------------------------')

  const backfilledPath = resolve(dataDir, 'backfilled_market_ids.json')
  if (fs.existsSync(backfilledPath)) {
    const data = JSON.parse(fs.readFileSync(backfilledPath, 'utf-8'))

    const totalTrades = parseInt(data.summary.total_trades || 0)
    const tradesWithMarketId = totalTrades - parseInt(data.summary.total_trades_affected || 0)
    const numResolved = parseInt(data.summary.num_resolved_via_external_api || 0)

    const currentCoverage = ((tradesWithMarketId / totalTrades) * 100).toFixed(2)
    const projectedCoverage = (((tradesWithMarketId + numResolved) / totalTrades) * 100).toFixed(2)

    console.log(`Current coverage: ${currentCoverage}%`)
    console.log(`  Trades with market_id: ${tradesWithMarketId.toLocaleString()}`)
    console.log(`  Trades missing: ${parseInt(data.summary.total_trades_affected).toLocaleString()}`)
    console.log('')
    console.log(`After backfill (projected): ${projectedCoverage}%`)
    console.log(`  New trades with market_id: ${(tradesWithMarketId + numResolved).toLocaleString()}`)
    console.log(`  Remaining missing: ${(parseInt(data.summary.total_trades_affected) - numResolved).toLocaleString()}`)
    console.log('')

    if (parseFloat(projectedCoverage) >= 95) {
      console.log('✅ Target met: >95% coverage!')
      console.log('   Category P&L attribution ready')
    } else if (parseFloat(projectedCoverage) >= 80) {
      console.log('⚠️  80-95% coverage: Partial attribution possible')
    } else {
      console.log('🔴 <80% coverage: Need more data')
    }
  } else {
    console.log('⚠️  No backfilled_market_ids.json found yet')
  }

  console.log('')
  console.log('================================================')
  console.log(`Checked at: ${new Date().toLocaleTimeString()}`)
  console.log('Run again anytime: npx tsx scripts/check-progress.ts')
  console.log('================================================\n')
}

main().catch(console.error)
