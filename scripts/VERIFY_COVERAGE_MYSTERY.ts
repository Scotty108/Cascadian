#!/usr/bin/env tsx

/**
 * VERIFY COVERAGE MYSTERY
 *
 * Investigate where the 56,575 / 24.8% number came from
 */

import * as dotenv from 'dotenv'
import { getClickHouseClient } from './lib/clickhouse/client'

dotenv.config({ path: '.env.local' })

const client = getClickHouseClient()

async function run() {
  console.log('='.repeat(100))
  console.log('COVERAGE MYSTERY INVESTIGATION: Where did 56,575 come from?')
  console.log('='.repeat(100))
  console.log()

  // Theory 1: Different resolution table used
  console.log('THEORY 1: Counting different resolution tables\n')

  const tables = [
    'market_resolutions_final',
    'market_resolutions',
    'market_resolutions_by_market',
    'gamma_resolved',
    'resolution_candidates',
    'staging_resolutions_union',
    'cascadian_clean.resolutions_by_cid',
    'cascadian_clean.resolutions_src_api'
  ]

  for (const table of tables) {
    try {
      const result = await client.query({
        query: `SELECT count(DISTINCT condition_id_norm) as unique_markets FROM ${table}`,
        format: 'JSONEachRow'
      })
      const data = await result.json<{unique_markets: string}>()
      const match = parseInt(data[0].unique_markets) === 56575 ? '🎯 MATCH!' : ''
      console.log(`${table.padEnd(40)} ${data[0].unique_markets.padStart(10)} ${match}`)
    } catch (e: any) {
      // Try alternative column names
      const altColumns = ['cid', 'cid_hex', 'condition_id', 'condition_id_32b', 'market_id']

      for (const col of altColumns) {
        try {
          const result = await client.query({
            query: `SELECT count(DISTINCT ${col}) as unique_markets FROM ${table}`,
            format: 'JSONEachRow'
          })
          const data = await result.json<{unique_markets: string}>()
          const match = parseInt(data[0].unique_markets) === 56575 ? '🎯 MATCH!' : ''
          console.log(`${table.padEnd(40)} ${data[0].unique_markets.padStart(10)} ${match}`)
          break
        } catch (e2) {
          continue
        }
      }
    }
  }

  // Theory 2: Counting with specific filters
  console.log('\n\nTHEORY 2: Counting with specific filters\n')

  // Try filtering by end date
  try {
    const result = await client.query({
      query: `
        SELECT count(DISTINCT condition_id_norm) as unique_markets
        FROM market_resolutions_final
        WHERE end_date_iso IS NOT NULL
          AND end_date_iso < now()
          AND payout_denominator > 0
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{unique_markets: string}>()
    const match = parseInt(data[0].unique_markets) === 56575 ? '🎯 MATCH!' : ''
    console.log(`Ended markets with payouts:              ${data[0].unique_markets.padStart(10)} ${match}`)
  } catch (e) {
    console.log('Cannot filter by end_date_iso (column may not exist)')
  }

  // Try filtering by source
  try {
    const result = await client.query({
      query: `
        SELECT
          source,
          count(DISTINCT condition_id_norm) as unique_markets
        FROM market_resolutions_final
        GROUP BY source
        ORDER BY unique_markets DESC
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{source: string, unique_markets: string}>()
    console.log('\nMarkets by source:')
    for (const row of data) {
      const match = parseInt(row.unique_markets) === 56575 ? '🎯 MATCH!' : ''
      console.log(`  ${row.source.padEnd(20)} ${row.unique_markets.padStart(10)} ${match}`)
    }
  } catch (e) {
    console.log('Cannot group by source (column may not exist)')
  }

  // Theory 3: Counting markets with specific outcome count
  console.log('\n\nTHEORY 3: Filtering by outcome_count or market type\n')

  try {
    const result = await client.query({
      query: `
        SELECT
          outcome_count,
          count(DISTINCT condition_id_norm) as unique_markets
        FROM market_resolutions_final
        WHERE payout_denominator > 0
        GROUP BY outcome_count
        ORDER BY outcome_count
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{outcome_count: string, unique_markets: string}>()
    console.log('Markets by outcome_count:')
    for (const row of data) {
      const match = parseInt(row.unique_markets) === 56575 ? '🎯 MATCH!' : ''
      console.log(`  ${row.outcome_count} outcomes: ${row.unique_markets.padStart(10)} markets ${match}`)
    }
  } catch (e) {
    console.log('Cannot group by outcome_count')
  }

  // Theory 4: Old snapshot or historical count
  console.log('\n\nTHEORY 4: Historical snapshot\n')

  try {
    const result = await client.query({
      query: `
        SELECT
          toDate(resolved_at) as date,
          count(DISTINCT condition_id_norm) as markets_that_day,
          sum(count(DISTINCT condition_id_norm)) OVER (ORDER BY toDate(resolved_at)) as cumulative_markets
        FROM market_resolutions_final
        WHERE resolved_at IS NOT NULL
          AND payout_denominator > 0
        GROUP BY date
        HAVING cumulative_markets >= 56500 AND cumulative_markets <= 56600
        ORDER BY date
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{date: string, markets_that_day: string, cumulative_markets: string}>()
    if (data.length > 0) {
      console.log('Dates when cumulative count was near 56,575:')
      for (const row of data) {
        const match = parseInt(row.cumulative_markets) === 56575 ? '🎯 MATCH!' : ''
        console.log(`  ${row.date}: cumulative ${row.cumulative_markets} ${match}`)
      }
    } else {
      console.log('No dates found with cumulative count near 56,575')
    }
  } catch (e) {
    console.log('Cannot analyze historical snapshot (resolved_at may not exist)')
  }

  // Theory 5: Specific wallet or volume filter
  console.log('\n\nTHEORY 5: Markets with significant trading activity\n')

  try {
    const result = await client.query({
      query: `
        SELECT count(DISTINCT condition_id_norm) as markets_with_10plus_trades
        FROM (
          SELECT condition_id_norm, count() as trade_count
          FROM vw_trades_canonical
          GROUP BY condition_id_norm
          HAVING trade_count >= 10
        )
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{markets_with_10plus_trades: string}>()
    const match = parseInt(data[0].markets_with_10plus_trades) === 56575 ? '🎯 MATCH!' : ''
    console.log(`Markets with 10+ trades:                  ${data[0].markets_with_10plus_trades.padStart(10)} ${match}`)
  } catch (e) {
    console.log('Cannot analyze trade activity')
  }

  // Final summary
  console.log('\n\n' + '='.repeat(100))
  console.log('SUMMARY')
  console.log('='.repeat(100))
  console.log('\nIf no exact match found above, the 56,575 number likely came from:')
  console.log('  1. An old snapshot of data (before more resolutions were added)')
  console.log('  2. A specific filtered query (by category, date range, etc.)')
  console.log('  3. A different database or table not checked here')
  console.log('  4. A calculation error in the original query')
  console.log('\nThe CORRECT coverage is: 157,222 / 227,838 = 69.01%')

  await client.close()
}

run().catch(console.error)
