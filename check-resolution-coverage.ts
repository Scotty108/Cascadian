#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('═'.repeat(80))
  console.log('              RESOLUTION COVERAGE ANALYSIS')
  console.log('═'.repeat(80))
  console.log('')

  // Total conditions in our database
  const totalConditions = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT condition_id) as count FROM trades_raw WHERE condition_id NOT LIKE 'token_%'`,
    format: 'JSONEachRow'
  })
  const totalData: any = await totalConditions.json()
  console.log('Total distinct conditions in database:', totalData[0].count)

  // How many have resolutions
  const resolvedConditions = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT condition_id) as count FROM trades_raw WHERE is_resolved = 1`,
    format: 'JSONEachRow'
  })
  const resolvedData: any = await resolvedConditions.json()
  console.log('Conditions with resolution data:', resolvedData[0].count)

  const coveragePct = (parseInt(resolvedData[0].count) / parseInt(totalData[0].count) * 100).toFixed(1)
  console.log(`Resolution coverage: ${coveragePct}%`)

  console.log('')
  console.log('─'.repeat(80))

  // Breakdown by wallet
  const walletBreakdown = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT wallet_address) as total_wallets,
        COUNT(DISTINCT CASE WHEN has_resolved > 0 THEN wallet_address END) as wallets_with_resolved,
        COUNT(DISTINCT CASE WHEN has_resolved = 0 THEN wallet_address END) as wallets_no_resolved
      FROM (
        SELECT
          wallet_address,
          SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as has_resolved
        FROM trades_raw
        WHERE condition_id NOT LIKE 'token_%'
        GROUP BY wallet_address
      )
    `,
    format: 'JSONEachRow'
  })
  const breakdown: any = await walletBreakdown.json()

  console.log('')
  console.log('Wallet breakdown:')
  console.log(\`  Total wallets: \${breakdown[0].total_wallets}\`)
  console.log(\`  Wallets with >=1 resolved trade: \${breakdown[0].wallets_with_resolved}\`)
  console.log(\`  Wallets with ZERO resolved trades: \${breakdown[0].wallets_no_resolved}\`)

  const walletPct = (parseInt(breakdown[0].wallets_no_resolved) / parseInt(breakdown[0].total_wallets) * 100).toFixed(1)
  console.log(\`  → \${walletPct}% of wallets have NO resolved trades\`)

  console.log('')
  console.log('═'.repeat(80))
  console.log('                    THE PATH FORWARD')
  console.log('═'.repeat(80))
  console.log('')
  console.log('To get all 28k wallets on the leaderboard, we need:')
  console.log('')
  console.log('1. ✅ Fix P&L calculation (IN PROGRESS - 2-3 hours)')
  console.log('2. ⏳ Fetch MORE resolution data from Polymarket')
  console.log(\`   Currently: \${resolvedData[0].count} resolved out of \${totalData[0].count} conditions (\${coveragePct}%)\`)
  console.log(\`   Need: ~\${parseInt(totalData[0].count) - parseInt(resolvedData[0].count)} more resolutions\`)
  console.log('')
  console.log('3. ⏳ Apply new resolutions to trades')
  console.log('4. ⏳ Re-compute metrics for all wallets')
  console.log('')
  console.log(\`The REAL bottleneck: \${walletPct}% of wallets are trading OPEN markets (not resolved yet)\`)
  console.log('')
  console.log('Options:')
  console.log('  A. Sync MORE resolution data from Polymarket API (fastest)')
  console.log('  B. Wait for current markets to resolve (slow)')
  console.log('  C. Load MORE historical trades from already-resolved markets')
  console.log('')
  console.log('═'.repeat(80))
}

main()
