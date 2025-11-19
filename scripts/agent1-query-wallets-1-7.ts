import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync, mkdirSync } from 'fs'

const ch = getClickHouseClient()

const WALLETS = [
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
  '0xd748c701ad93cfec32a3420e10f3b08e68612125',
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0x7f3c8979d0afa00007bae4747d5347122af05613',
  '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
  '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397',
]

async function queryWallets() {
  const results = []

  console.log('Starting Agent 1 wallet queries (wallets 1-7)...\n')

  for (const wallet of WALLETS) {
    process.stdout.write(`Querying ${wallet}... `)

    try {
      // Query vw_trades_canonical
      const vwQ = await ch.query({
        query: `SELECT count() as cnt FROM default.vw_trades_canonical WHERE lower(wallet_address_norm) = lower('${wallet}')`,
        format: 'JSONEachRow',
      })
      const vwData = await vwQ.json()
      const vwCount = vwData.length > 0 ? vwData[0].cnt : 0

      // Query fact_trades_clean
      const factQ = await ch.query({
        query: `SELECT count() as cnt FROM cascadian_clean.fact_trades_clean WHERE lower(wallet_address) = lower('${wallet}')`,
        format: 'JSONEachRow',
      })
      const factData = await factQ.json()
      const factCount = factData.length > 0 ? factData[0].cnt : 0

      // Query wallet_metrics
      const metricsQ = await ch.query({
        query: `SELECT realized_pnl, gross_gains_usd, gross_losses_usd FROM default.wallet_metrics WHERE lower(wallet_address) = lower('${wallet}') AND time_window = 'lifetime' LIMIT 1`,
        format: 'JSONEachRow',
      })
      const metricsData = await metricsQ.json()
      const metrics = metricsData.length > 0 ? metricsData[0] : null

      results.push({
        wallet,
        vw_trades_canonical: vwCount,
        fact_trades_clean: factCount,
        realized_pnl: metrics?.realized_pnl || null,
        gross_gains_usd: metrics?.gross_gains_usd || null,
        gross_losses_usd: metrics?.gross_losses_usd || null,
      })

      console.log(
        `✓ vw=${vwCount}, fact=${factCount}, pnl=${metrics?.realized_pnl || 'N/A'}`
      )
    } catch (error) {
      console.error(`✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      results.push({
        wallet,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Ensure tmp directory exists
  try {
    mkdirSync('tmp', { recursive: true })
  } catch (e) {
    // Directory may already exist
  }

  writeFileSync('tmp/agent1-results.json', JSON.stringify(results, null, 2))
  console.log('\n✅ Agent 1 complete - saved to tmp/agent1-results.json')
  console.log(`\nSummary: Queried ${results.length} wallets`)
}

queryWallets().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
