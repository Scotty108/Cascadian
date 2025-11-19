#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function investigateClobIngestion() {
  const client = getClickHouseClient()

  try {
    console.log('='.repeat(80))
    console.log('CLOB INGESTION INVESTIGATION: Wallet 0xcce2')
    console.log('='.repeat(80))
    console.log('')

    // Step 1: Check all proxy addresses used by this wallet in clob_fills
    console.log('1. PROXY WALLET ANALYSIS:')
    console.log('-'.repeat(80))

    const proxyCheck = await client.query({
      query: `
        SELECT
          proxy_wallet,
          user_eoa,
          count() as fill_count,
          count(DISTINCT condition_id) as unique_markets,
          sum(abs(price * size / 1000000)) as volume,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
        GROUP BY proxy_wallet, user_eoa
        ORDER BY fill_count DESC
      `,
      format: 'JSONEachRow'
    })
    const proxyData = await proxyCheck.json<any[]>()

    console.log(`Found ${proxyData.length} proxy/EOA combinations:`)
    proxyData.forEach((p, idx) => {
      console.log(`\n  ${idx + 1}. Proxy: ${p.proxy_wallet}`)
      console.log(`     EOA: ${p.user_eoa}`)
      console.log(`     Fills: ${p.fill_count}`)
      console.log(`     Markets: ${p.unique_markets}`)
      console.log(`     Volume: $${parseFloat(p.volume).toLocaleString()}`)
      console.log(`     Time range: ${p.first_trade} to ${p.last_trade}`)
    })
    console.log('')

    // Step 2: Check if there are OTHER proxy wallets for this user
    console.log('2. REVERSE LOOKUP - Find all proxies for this EOA:')
    console.log('-'.repeat(80))

    const reverseCheck = await client.query({
      query: `
        SELECT
          proxy_wallet,
          count() as fill_count,
          count(DISTINCT condition_id) as unique_markets,
          sum(abs(price * size / 1000000)) as volume
        FROM clob_fills
        WHERE user_eoa = '${WALLET}'
        GROUP BY proxy_wallet
        ORDER BY fill_count DESC
      `,
      format: 'JSONEachRow'
    })
    const reverseData = await reverseCheck.json<any[]>()

    if (reverseData.length === 0) {
      console.log(`⚠️  NO fills found with user_eoa = '${WALLET}'`)
      console.log(`   This suggests the wallet trades through proxies only`)
    } else {
      console.log(`Found ${reverseData.length} proxy addresses for this EOA:`)
      reverseData.forEach((p, idx) => {
        console.log(`  ${idx + 1}. ${p.proxy_wallet}: ${p.fill_count} fills, ${p.unique_markets} markets, $${parseFloat(p.volume).toLocaleString()}`)
      })
    }
    console.log('')

    // Step 3: Check temporal coverage
    console.log('3. TEMPORAL COVERAGE:')
    console.log('-'.repeat(80))

    const temporalCheck = await client.query({
      query: `
        SELECT
          toYYYYMM(timestamp) as month,
          count() as fill_count,
          count(DISTINCT condition_id) as unique_markets,
          sum(abs(price * size / 1000000)) as volume
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `,
      format: 'JSONEachRow'
    })
    const temporalData = await temporalCheck.json<any[]>()

    console.log('Last 12 months of trading:')
    temporalData.forEach(t => {
      console.log(`  ${t.month}: ${t.fill_count} fills, ${t.unique_markets} markets, $${parseFloat(t.volume).toLocaleString()}`)
    })
    console.log('')

    // Step 4: Sample some fill_ids to check against Polymarket
    console.log('4. SAMPLE FILL IDs (first 10):')
    console.log('-'.repeat(80))

    const sampleFills = await client.query({
      query: `
        SELECT
          fill_id,
          timestamp,
          side,
          condition_id,
          outcome,
          price,
          size / 1000000 as size_usdc
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
        ORDER BY timestamp DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const fillData = await sampleFills.json<any[]>()

    fillData.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${f.fill_id}`)
      console.log(`     ${f.timestamp} | ${f.side} | ${f.outcome} | Price: $${f.price} | Size: $${parseFloat(f.size_usdc).toFixed(2)}`)
    })
    console.log('')

    // Step 5: Check global clob_fills statistics
    console.log('5. GLOBAL CLOB_FILLS TABLE STATISTICS:')
    console.log('-'.repeat(80))

    const globalStats = await client.query({
      query: `
        SELECT
          count() as total_fills,
          count(DISTINCT proxy_wallet) as unique_proxies,
          count(DISTINCT user_eoa) as unique_eoas,
          min(timestamp) as first_fill,
          max(timestamp) as last_fill
        FROM clob_fills
      `,
      format: 'JSONEachRow'
    })
    const stats = await globalStats.json<any[]>()

    console.log(`Total fills in database: ${parseInt(stats[0].total_fills).toLocaleString()}`)
    console.log(`Unique proxy wallets: ${parseInt(stats[0].unique_proxies).toLocaleString()}`)
    console.log(`Unique EOAs: ${parseInt(stats[0].unique_eoas).toLocaleString()}`)
    console.log(`Time range: ${stats[0].first_fill} to ${stats[0].last_fill}`)
    console.log('')

    // Step 6: Diagnosis
    console.log('='.repeat(80))
    console.log('DIAGNOSIS')
    console.log('='.repeat(80))
    console.log('')

    const totalFills = proxyData.reduce((sum, p) => sum + parseInt(p.fill_count), 0)
    const totalMarkets = Math.max(...proxyData.map(p => parseInt(p.unique_markets)))
    const totalVolume = proxyData.reduce((sum, p) => sum + parseFloat(p.volume), 0)

    console.log(`Summary for wallet ${WALLET}:`)
    console.log(`  Captured fills: ${totalFills}`)
    console.log(`  Captured markets: ${totalMarkets}`)
    console.log(`  Captured volume: $${totalVolume.toLocaleString()}`)
    console.log(`  Expected markets: 192 (from Polymarket UI)`)
    console.log(`  Expected volume: $1,380,000 (from Polymarket UI)`)
    console.log('')
    console.log(`  Market coverage: ${(totalMarkets / 192 * 100).toFixed(1)}%`)
    console.log(`  Volume coverage: ${(totalVolume / 1380000 * 100).toFixed(1)}%`)
    console.log('')

    if (proxyData.length === 1) {
      console.log('⚠️  POTENTIAL ISSUE: Only 1 proxy/EOA combination found')
      console.log('   → This wallet may use multiple proxy addresses')
      console.log('   → Our proxy resolution may be incomplete')
    }

    if (reverseData.length === 0) {
      console.log('⚠️  CRITICAL: No fills found with user_eoa matching this wallet')
      console.log('   → This means we only capture fills where proxy_wallet matches')
      console.log('   → If the wallet uses different proxies, we miss those fills')
    }

    console.log('')
    console.log('Next steps:')
    console.log('1. Query Polymarket CLOB API directly for this wallet')
    console.log('2. Compare fill_ids between our DB and Polymarket')
    console.log('3. Identify missing proxy addresses')
    console.log('4. Check CLOB ingestion scripts for pagination/filtering issues')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

investigateClobIngestion()
