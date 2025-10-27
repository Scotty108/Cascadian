#!/usr/bin/env npx tsx

import { request, gql } from 'graphql-request'

const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_clw5e70ge00e401x08dmb6b6l/subgraphs/polymarket/prod/gn'

const QUERY = gql`
  query GetResolvedMarkets {
    fpmms(first: 10, where: { resolved: true }) {
      id
      conditionId
      resolved
      condition {
        id
        outcomeSlotCount
        resolutionTimestamp
      }
    }
  }
`

async function testGoldskyResolutions() {
  console.log('Testing Goldsky for resolved market data...\n')

  try {
    const data: any = await request(GOLDSKY_ENDPOINT, QUERY)

    console.log(`Found ${data.fpmms.length} resolved markets in Goldsky\n`)

    data.fpmms.forEach((market: any, i: number) => {
      console.log(`[${i+1}] Condition ID: ${market.conditionId}`)
      console.log(`    Resolved: ${market.resolved}`)
      console.log(`    Resolution Timestamp: ${market.condition?.resolutionTimestamp || 'null'}`)
      console.log(`    Outcome Slots: ${market.condition?.outcomeSlotCount || 'null'}\n`)
    })

  } catch (error) {
    console.error('Error:', error)
  }
}

testGoldskyResolutions()
