#!/usr/bin/env npx tsx
/**
 * IDENTIFY PHANTOM MARKET
 * Find one condition_id that exists in P&L for wallet but NOT in fills
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'

async function identifyPhantom() {
  const client = getClickHouseClient()

  try {
    console.log('\n🔍 IDENTIFYING PHANTOM MARKET\n')
    console.log(`Wallet: ${TARGET_WALLET}\n`)

    // Get condition_ids from fills
    console.log('Step 1: Getting condition_ids from fills...\n')

    const fillsResult = await client.query({
      query: `
        SELECT DISTINCT lower(replaceAll(\`cf.condition_id\`, '0x', '')) as condition_id_norm
        FROM vw_clob_fills_enriched
        WHERE lower(user_eoa) = lower('${TARGET_WALLET}')
           OR lower(proxy_wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const fillsIds = await fillsResult.json<any[]>()
    const fillsSet = new Set(fillsIds.map(r => r.condition_id_norm.toLowerCase()))

    console.log(`✅ Found ${fillsSet.size} unique condition_ids in fills\n`)

    // Get condition_ids from P&L snapshot
    console.log('Step 2: Getting condition_ids from P&L snapshot...\n')

    const pnlResult = await client.query({
      query: `
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_norm
        FROM realized_pnl_by_market_backup_20251111
        WHERE lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const pnlIds = await pnlResult.json<any[]>()
    const pnlSet = new Set(pnlIds.map(r => r.condition_id_norm.toLowerCase()))

    console.log(`✅ Found ${pnlSet.size} unique condition_ids in P&L\n`)

    // Find phantoms (in P&L but NOT in fills)
    const phantoms = [...pnlSet].filter(id => !fillsSet.has(id))

    console.log('Step 3: Identifying phantom markets...\n')
    console.log(`✅ Found ${phantoms.length} phantom condition_ids\n`)

    if (phantoms.length === 0) {
      console.log('❌ No phantoms found - unexpected!\n')
      return
    }

    // Pick first phantom and get details
    const phantomId = phantoms[0]

    console.log('=' .repeat(80))
    console.log('PHANTOM MARKET IDENTIFIED')
    console.log('='.repeat(80))
    console.log(`\nCondition ID: ${phantomId}`)
    console.log(`\nThis market appears in P&L but wallet never traded it.\n`)

    // Get P&L details for this phantom
    const phantomPnlResult = await client.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          realized_pnl_usd
        FROM realized_pnl_by_market_backup_20251111
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${phantomId}'
          AND lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const phantomPnl = await phantomPnlResult.json<any[]>()

    if (phantomPnl.length > 0) {
      console.log('P&L entry for this phantom market:')
      console.log(`  Wallet: ${phantomPnl[0].wallet}`)
      console.log(`  Condition: ${phantomPnl[0].condition_id_norm}`)
      console.log(`  P&L: $${(parseFloat(phantomPnl[0].realized_pnl_usd) / 1000).toFixed(1)}K\n`)
    }

    // Check if OTHER wallets traded this market
    console.log('Step 4: Checking if OTHER wallets traded this phantom market...\n')

    const otherWalletsResult = await client.query({
      query: `
        SELECT
          user_eoa as wallet,
          COUNT(*) as fill_count,
          SUM(price * size) as total_volume
        FROM vw_clob_fills_enriched
        WHERE lower(replaceAll(\`cf.condition_id\`, '0x', '')) = '${phantomId}'
        GROUP BY user_eoa
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const otherWallets = await otherWalletsResult.json<any[]>()

    if (otherWallets.length > 0) {
      console.log(`✅ Found ${otherWallets.length} OTHER wallets who DID trade this market:\n`)
      otherWallets.forEach((w: any, idx: number) => {
        console.log(`${idx + 1}. ${w.wallet}`)
        console.log(`   Fills: ${w.fill_count}, Volume: $${(parseFloat(w.total_volume) / 1000).toFixed(1)}K\n`)
      })

      console.log('🔍 HYPOTHESIS: JOIN is pulling this market from another wallet\'s trades!\n')
    } else {
      console.log('❌ No other wallets traded this market either - data corruption?\n')
    }

    // Check P&L for those other wallets
    if (otherWallets.length > 0) {
      console.log('Step 5: Checking if those other wallets also have P&L entries...\n')

      const otherWalletAddrs = otherWallets.map(w => `'${w.wallet.toLowerCase()}'`).join(',')

      const otherPnlResult = await client.query({
        query: `
          SELECT
            wallet,
            realized_pnl_usd
          FROM realized_pnl_by_market_backup_20251111
          WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${phantomId}'
            AND lower(wallet) IN (${otherWalletAddrs})
        `,
        format: 'JSONEachRow'
      })
      const otherPnl = await otherPnlResult.json<any[]>()

      console.log(`Found ${otherPnl.length} P&L entries for the same phantom market:\n`)
      otherPnl.forEach((p: any, idx: number) => {
        console.log(`${idx + 1}. ${p.wallet}: $${(parseFloat(p.realized_pnl_usd) / 1000).toFixed(1)}K`)
      })

      if (otherPnl.length === 0) {
        console.log('❌ Other wallets who TRADED this market have NO P&L entries!')
        console.log('   But target wallet who NEVER traded it HAS a P&L entry!')
        console.log('   This confirms JOIN logic is backwards or misconfigured.\n')
      }
    }

    console.log('='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))
    console.log(`\nPhantom condition_id: ${phantomId}`)
    console.log(`Target wallet traded it: NO`)
    console.log(`Target wallet has P&L for it: YES`)
    console.log(`Other wallets traded it: ${otherWallets.length > 0 ? 'YES (' + otherWallets.length + ')' : 'NO'}`)
    console.log(`\nNext: Trace this condition_id through rebuild pipeline to find JOIN fan-out\n`)

    // Save for next script
    const output = {
      phantom_condition_id: phantomId,
      target_wallet: TARGET_WALLET,
      target_wallet_traded: false,
      target_wallet_has_pnl: true,
      other_wallets_who_traded: otherWallets.map(w => w.wallet),
      hypothesis: 'JOIN pulling trades from other wallets into target wallet P&L'
    }

    const fs = require('fs')
    fs.writeFileSync('tmp/phantom-market-identified.json', JSON.stringify(output, null, 2))
    console.log('📝 Saved details to: tmp/phantom-market-identified.json\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

identifyPhantom()
