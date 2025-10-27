#!/usr/bin/env npx tsx

/**
 * Debug Market Resolution Structure
 *
 * Fetches ~20 closed/inactive events from Polymarket to identify
 * which fields actually encode the winner for resolved markets.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { fetchEvents } from '@/lib/polymarket/client'

async function debugResolutionStructure() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('     DEBUG: MARKET RESOLUTION DATA STRUCTURE              ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('📊 Fetching events with no filter...\n')

  const events = await fetchEvents()
  console.log(`✅ Fetched ${events.length} total events\n`)

  // Find events that are closed or inactive
  const closedEvents = events.filter(e => {
    const hasMarkets = e.markets && e.markets.length > 0
    if (!hasMarkets) return false

    const firstMarket = e.markets[0]
    return firstMarket.closed === true || firstMarket.active === false
  })

  console.log(`✅ Found ${closedEvents.length} closed/inactive events\n`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Examine first 20 closed events in detail
  const samplesToExamine = Math.min(20, closedEvents.length)

  for (let i = 0; i < samplesToExamine; i++) {
    const event = closedEvents[i]
    const market = event.markets[0]

    console.log(`[${i + 1}] Event: ${event.title?.substring(0, 60)}...`)
    console.log(`    Event ID: ${event.id}`)
    console.log(`    Market ID: ${market.id}`)
    console.log(`    Condition ID: ${market.conditionId}`)
    console.log(`    Active: ${market.active}`)
    console.log(`    Closed: ${market.closed}`)
    console.log(`    End Date: ${market.endDate}`)
    console.log(`    Question: ${market.question?.substring(0, 60)}...`)

    // Check for all possible resolution-related fields
    console.log(`\n    Resolution Fields:`)
    console.log(`    - resolvedOutcome: ${JSON.stringify(market.resolvedOutcome)}`)
    console.log(`    - resolved: ${JSON.stringify((market as any).resolved)}`)
    console.log(`    - outcome: ${JSON.stringify((market as any).outcome)}`)
    console.log(`    - winningOutcome: ${JSON.stringify((market as any).winningOutcome)}`)
    console.log(`    - winner: ${JSON.stringify((market as any).winner)}`)
    console.log(`    - outcomePrices: ${JSON.stringify(market.outcomePrices)}`)
    console.log(`    - outcomes: ${JSON.stringify(market.outcomes)}`)
    console.log(`    - outcomeTokens: ${JSON.stringify((market as any).outcomeTokens)}`)

    // Check if there are any other relevant fields
    const relevantKeys = Object.keys(market).filter(key =>
      key.toLowerCase().includes('outcome') ||
      key.toLowerCase().includes('resol') ||
      key.toLowerCase().includes('winner') ||
      key.toLowerCase().includes('settle') ||
      key.toLowerCase().includes('final')
    )

    if (relevantKeys.length > 0) {
      console.log(`\n    Other Relevant Fields Found:`)
      relevantKeys.forEach(key => {
        console.log(`    - ${key}: ${JSON.stringify((market as any)[key])}`)
      })
    }

    console.log(`\n    Full Market Object Keys: ${Object.keys(market).join(', ')}`)
    console.log('    ───────────────────────────────────────────────────────\n')
  }

  console.log('═══════════════════════════════════════════════════════════')
  console.log('                     ANALYSIS                              ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Analyze which fields are populated for closed markets
  const fieldCounts = {
    resolvedOutcome: 0,
    resolved: 0,
    outcome: 0,
    winningOutcome: 0,
    winner: 0,
    outcomePrices: 0,
    outcomes: 0,
  }

  const outcomePricePatterns: { [key: string]: number } = {}

  closedEvents.slice(0, samplesToExamine).forEach(event => {
    const market = event.markets[0]

    if (market.resolvedOutcome !== undefined && market.resolvedOutcome !== null) {
      fieldCounts.resolvedOutcome++
    }
    if ((market as any).resolved !== undefined && (market as any).resolved !== null) {
      fieldCounts.resolved++
    }
    if ((market as any).outcome !== undefined && (market as any).outcome !== null) {
      fieldCounts.outcome++
    }
    if ((market as any).winningOutcome !== undefined && (market as any).winningOutcome !== null) {
      fieldCounts.winningOutcome++
    }
    if ((market as any).winner !== undefined && (market as any).winner !== null) {
      fieldCounts.winner++
    }
    if (market.outcomePrices && Array.isArray(market.outcomePrices)) {
      fieldCounts.outcomePrices++

      const pattern = JSON.stringify(market.outcomePrices)
      outcomePricePatterns[pattern] = (outcomePricePatterns[pattern] || 0) + 1
    }
    if (market.outcomes && Array.isArray(market.outcomes)) {
      fieldCounts.outcomes++
    }
  })

  console.log(`Field Population Statistics (out of ${samplesToExamine} markets):`)
  console.log(`  - resolvedOutcome: ${fieldCounts.resolvedOutcome} (${(fieldCounts.resolvedOutcome / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - resolved: ${fieldCounts.resolved} (${(fieldCounts.resolved / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - outcome: ${fieldCounts.outcome} (${(fieldCounts.outcome / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - winningOutcome: ${fieldCounts.winningOutcome} (${(fieldCounts.winningOutcome / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - winner: ${fieldCounts.winner} (${(fieldCounts.winner / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - outcomePrices: ${fieldCounts.outcomePrices} (${(fieldCounts.outcomePrices / samplesToExamine * 100).toFixed(1)}%)`)
  console.log(`  - outcomes: ${fieldCounts.outcomes} (${(fieldCounts.outcomes / samplesToExamine * 100).toFixed(1)}%)`)

  if (Object.keys(outcomePricePatterns).length > 0) {
    console.log(`\noutcomePrices Patterns Found:`)
    Object.entries(outcomePricePatterns)
      .sort((a, b) => b[1] - a[1])
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} markets`)
      })
  }

  console.log('\n═══════════════════════════════════════════════════════════\n')
}

debugResolutionStructure()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
