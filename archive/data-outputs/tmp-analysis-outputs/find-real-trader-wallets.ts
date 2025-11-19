#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function findRealTraders() {
  const client = getClickHouseClient()

  try {
    console.log('Finding real trader wallets (filtering out infrastructure)...\n')

    // Get wallets with characteristics of real traders:
    // - 10-100 markets (active but not infrastructure)
    // - $1K-$100K P&L (meaningful activity, not whales)
    // - Reasonable trade frequency
    const query = await client.query({
      query: `
        SELECT
          wallet,
          sum(realized_pnl_usd) as total_pnl,
          count() as market_count
        FROM realized_pnl_by_market_final
        GROUP BY wallet
        HAVING market_count BETWEEN 10 AND 100
          AND abs(total_pnl) BETWEEN 1000 AND 100000
        ORDER BY abs(total_pnl) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })

    const wallets = await query.json<Array<{
      wallet: string
      total_pnl: string
      market_count: string
    }>>()

    console.log(`Found ${wallets.length} candidate wallets:\n`)

    wallets.forEach((w, idx) => {
      const pnl = parseFloat(w.total_pnl)
      const markets = parseInt(w.market_count)

      console.log(`${idx + 1}. ${w.wallet}`)
      console.log(`   P&L: $${pnl.toLocaleString()} | Markets: ${markets}`)
      console.log(`   Check: https://polymarket.com/profile/${w.wallet}`)
      console.log('')
    })

    console.log('Pick one that shows up on Polymarket UI with real activity')

  } catch (error: any) {
    console.error('Error:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

findRealTraders()
