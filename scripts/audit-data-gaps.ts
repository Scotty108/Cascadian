#!/usr/bin/env npx tsx

/**
 * AUDIT: What data gaps actually exist?
 *
 * Determines:
 * 1. How many trades have missing condition_ids?
 * 2. Do complete resolution tables exist?
 * 3. Can we JOIN trades to resolutions without backfill?
 * 4. What's the actual bottleneck?
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('═'.repeat(100))
  console.log('DATA GAP AUDIT - Ground Truth Analysis')
  console.log('═'.repeat(100))

  try {
    // 1. Check trades_raw completeness
    console.log('\n[STEP 1] trades_raw condition_id coverage')
    console.log('─'.repeat(100))

    const tradesStats = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 ELSE 0 END) as missing_ids,
          COUNT(DISTINCT condition_id) as unique_ids
        FROM trades_raw
        FORMAT JSONCompact
      `
    })
    const tradesText = await tradesStats.text()
    const tradesParsed = JSON.parse(tradesText)
    const tradesData = tradesParsed.data?.[0] || []

    console.log(`Total trades: ${(tradesData[0] as any).toLocaleString?.() || tradesData[0]}`)
    console.log(`Missing condition_ids: ${(tradesData[1] as any).toLocaleString?.() || tradesData[1]}`)
    console.log(`Missing %: ${(((tradesData[1] as any) / (tradesData[0] as any)) * 100).toFixed(1)}%`)
    console.log(`Unique condition_ids: ${(tradesData[2] as any).toLocaleString?.() || tradesData[2]}`)

    // 2. Check market_resolutions_final
    console.log('\n[STEP 2] market_resolutions_final completeness')
    console.log('─'.repeat(100))

    try {
      const resStats = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total_resolutions,
            COUNT(DISTINCT condition_id) as unique_conditions,
            SUM(CASE WHEN payout_numerators IS NOT NULL AND length(payout_numerators) > 0 THEN 1 ELSE 0 END) as with_payouts
          FROM market_resolutions_final
          FORMAT JSONCompact
        `
      })
      const resText = await resStats.text()
      const resParsed = JSON.parse(resText)
      const resData = resParsed.data?.[0] || []

      console.log(`Total resolutions: ${(resData[0] as any).toLocaleString?.() || resData[0]}`)
      console.log(`Unique conditions: ${(resData[1] as any).toLocaleString?.() || resData[1]}`)
      console.log(`With payout vectors: ${(resData[2] as any).toLocaleString?.() || resData[2]}`)
    } catch (e: any) {
      console.log(`Table not found or error: ${e.message.substring(0, 80)}`)
    }

    // 3. Check winning_index
    console.log('\n[STEP 3] winning_index completeness')
    console.log('─'.repeat(100))

    try {
      const winStats = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total_rows,
            COUNT(DISTINCT condition_id) as unique_conditions
          FROM winning_index
          FORMAT JSONCompact
        `
      })
      const winText = await winStats.text()
      const winParsed = JSON.parse(winText)
      const winData = winParsed.data?.[0] || []

      console.log(`Total winning_index rows: ${(winData[0] as any).toLocaleString?.() || winData[0]}`)
      console.log(`Unique conditions indexed: ${(winData[1] as any).toLocaleString?.() || winData[1]}`)
    } catch (e: any) {
      console.log(`Table not found or error: ${e.message.substring(0, 80)}`)
    }

    // 4. Test JOIN between trades_raw and market_resolutions_final
    console.log('\n[STEP 4] Test JOIN: Can we match trades to resolutions?')
    console.log('─'.repeat(100))

    try {
      const joinTest = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as matched_trades,
            COUNT(DISTINCT t.transaction_hash) as unique_txs
          FROM trades_raw t
          LEFT JOIN market_resolutions_final r
            ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id)
          WHERE (t.condition_id != '' AND t.condition_id IS NOT NULL)
            AND r.condition_id IS NOT NULL
          LIMIT 1
          FORMAT JSONCompact
        `
      })
      const joinText = await joinTest.text()
      const joinParsed = JSON.parse(joinText)
      const joinData = joinParsed.data?.[0] || []

      console.log(`Trades that can JOIN to resolutions: ${(joinData[0] as any).toLocaleString?.() || joinData[0]}`)
      console.log(`Unique transactions matched: ${(joinData[1] as any).toLocaleString?.() || joinData[1]}`)
    } catch (e: any) {
      console.log(`Join test failed: ${e.message.substring(0, 80)}`)
    }

    // 5. Summary and recommendation
    console.log('\n[STEP 5] Summary & Recommendation')
    console.log('─'.repeat(100))

    const missingPct = ((tradesData[1] as any) / (tradesData[0] as any)) * 100

    if (missingPct > 50) {
      console.log(`\n⚠️  CRITICAL: ${missingPct.toFixed(1)}% of trades missing condition_ids`)
      console.log(`   → RPC BACKFILL IS NECESSARY`)
      console.log(`   → Estimated time: 3-4 hours (16 workers)`)
    } else if (missingPct > 10) {
      console.log(`\n⚠️  MODERATE: ${missingPct.toFixed(1)}% of trades missing condition_ids`)
      console.log(`   → Consider backfill OR proceed with existing data`)
      console.log(`   → P&L coverage: ${(100 - missingPct).toFixed(1)}% of trades`)
    } else {
      console.log(`\n✅ GOOD: Only ${missingPct.toFixed(1)}% missing`)
      console.log(`   → SKIP BACKFILL - Proceed with existing data`)
      console.log(`   → Fix queries to use market_resolutions_final`)
      console.log(`   → Deploy P&L dashboard`)
    }

  } catch (e: any) {
    console.error(`❌ Audit failed: ${e.message}`)
  }

  console.log('\n' + '═'.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
