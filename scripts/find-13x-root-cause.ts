import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient } from '@/lib/goldsky/client'

async function findRootCause() {
  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  console.log('🔍 Finding Root Cause of 13.24x Multiplier\n')

  // Theory: Goldsky PnL subgraph might be tracking EACH outcome token separately
  // Polymarket uses Conditional Token Framework (CTF) which creates tokens for each outcome
  // A binary market = 2 tokens (YES/NO)
  // Multi-outcome market = N tokens
  // If we're summing PnL across all outcome tokens, we're counting the same market multiple times!

  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
        id
        tokenId
        realizedPnl
        amount
      }
    }
  `

  const data = await pnlClient.request<any>(query, {
    wallet: wallet.toLowerCase(),
  })

  const positions = data.userPositions
  const positionsWithPnL = positions.filter((p: any) => parseFloat(p.realizedPnl) !== 0)

  console.log(`Total positions: ${positions.length}`)
  console.log(`Positions with PnL: ${positionsWithPnL.length}\n`)

  // Try to extract condition IDs from token IDs
  // Token IDs in CTF encode: conditionId + outcomeIndex
  // They're usually huge numbers with patterns

  console.log('🔍 Analyzing token ID structure...\n')

  // Group by potential condition (markets might share prefixes or patterns)
  const tokenIdGroups = new Map<string, any[]>()

  positionsWithPnL.forEach((p: any) => {
    // Try different grouping strategies
    const tokenId = p.tokenId

    // Strategy 1: Group by first 30 characters (might capture condition ID)
    const prefix = tokenId.substring(0, 30)

    if (!tokenIdGroups.has(prefix)) {
      tokenIdGroups.set(prefix, [])
    }
    tokenIdGroups.get(prefix)!.push(p)
  })

  console.log(`Unique token prefixes (30 chars): ${tokenIdGroups.size}`)

  // Calculate average positions per group
  const avgPositionsPerGroup = positionsWithPnL.length / tokenIdGroups.size
  console.log(`Average positions per group: ${avgPositionsPerGroup.toFixed(2)}`)

  if (Math.abs(avgPositionsPerGroup - 13.24) < 1) {
    console.log('✅ FOUND IT! ~13 positions per group on average')
    console.log('   This suggests markets have ~13 outcome tokens on average')
    console.log('   Goldsky is summing PnL across ALL outcome tokens per market!')
  }

  // Let's check: is there a field that tells us which outcome this is?
  console.log('\n\n🔍 Checking for outcome/condition fields in schema...\n')

  const detailedQuery = `
    query GetDetailedPosition($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1) {
        id
        user
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  const detailedData = await pnlClient.request<any>(detailedQuery, {
    wallet: wallet.toLowerCase(),
  })

  console.log('Sample position structure:')
  console.log(JSON.stringify(detailedData.userPositions[0], null, 2))

  // Check if there are related fields we're missing
  const introspectionQuery = `
    {
      __type(name: "UserPosition") {
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `

  const schemaData = await pnlClient.request<any>(introspectionQuery)
  const fields = schemaData.__type.fields

  console.log('\n\n📋 All UserPosition fields available:')
  fields.forEach((f: any) => {
    console.log(`  - ${f.name}: ${f.type.name || f.type.kind}`)
  })

  // Look for aggregation fields
  console.log('\n\n💡 Looking for aggregated queries...\n')

  const aggregateQuery = `
    {
      __schema {
        queryType {
          fields {
            name
          }
        }
      }
    }
  `

  const aggregateData = await pnlClient.request<any>(aggregateQuery)
  const queries = aggregateData.__schema.queryType.fields

  console.log('Available queries:')
  queries.forEach((q: any) => {
    if (q.name.toLowerCase().includes('aggregate') ||
        q.name.toLowerCase().includes('total') ||
        q.name.toLowerCase().includes('summary')) {
      console.log(`  ✨ ${q.name} - might aggregate correctly!`)
    } else {
      console.log(`  - ${q.name}`)
    }
  })

  console.log('\n\n🎯 SOLUTION PATHS:')
  console.log('1. GROUP BY condition/market before summing PnL')
  console.log('   - Only count unique markets, not every outcome token')
  console.log('   - Would need to extract condition ID from token ID')
  console.log('')
  console.log('2. USE AGGREGATE QUERY if available')
  console.log('   - Goldsky might have a query that pre-aggregates')
  console.log('   - Check for user-level or condition-level summaries')
  console.log('')
  console.log('3. APPLY CORRECTION FACTOR /13.24')
  console.log('   - Simplest fix, works empirically')
  console.log('   - But doesn\'t fix root cause')
}

findRootCause()
