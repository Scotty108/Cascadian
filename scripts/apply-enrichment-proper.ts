import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { execSync } from 'child_process'

/**
 * PROPER ENRICHMENT - Using condition_market_map
 *
 * The solution has been in the database the whole time:
 * condition_market_map has 151,843 complete mappings
 *
 * Strategy: Use curl to avoid protocol buffer issues
 */

async function enrichProper() {
  try {
    console.log('═'.repeat(70))
    console.log('PROPER ENRICHMENT - Using condition_market_map')
    console.log('═'.repeat(70))
    console.log()

    const host = 'igm38nvzub.us-central1.gcp.clickhouse.cloud'
    const port = '8443'
    const user = 'default'
    const password = process.env.CLICKHOUSE_PASSWORD || ''

    // Step 1: Verify condition_market_map exists
    console.log('Step 1: Verifying condition_market_map...')

    const checkCmd = `curl -s -X POST "https://${host}:${port}/?user=${user}&password=${password}&default_format=JSON" \
      -d "SELECT COUNT(*) as cnt, COUNT(DISTINCT market_id) as unique_markets FROM condition_market_map"`

    const checkResult = execSync(checkCmd, { encoding: 'utf-8' })
    const checkData = JSON.parse(checkResult).data[0]

    console.log(`  ✓ condition_market_map: ${checkData.cnt} entries`)
    console.log(`  ✓ Unique markets: ${checkData.unique_markets}`)
    console.log()

    // Step 2: Check current trades_raw state
    console.log('Step 2: Analyzing trades_raw...')

    const analyzeCmd = `curl -s -X POST "https://${host}:${port}/?user=${user}&password=${password}&default_format=JSON" \
      -d "SELECT COUNT(*) as total, SUM(IF(condition_id='', 1, 0)) as missing, SUM(IF(condition_id!='', 1, 0)) as existing FROM trades_raw"`

    const analyzeResult = execSync(analyzeCmd, { encoding: 'utf-8' })
    const analyzeData = JSON.parse(analyzeResult).data[0]

    console.log(`  Total trades: ${analyzeData.total}`)
    console.log(`  Missing condition_id: ${analyzeData.missing}`)
    console.log(`  Already have: ${analyzeData.existing}`)
    console.log()

    // Step 3: Drop old enriched table
    console.log('Step 3: Creating new enriched table...')

    const dropCmd = `curl -s -X POST "https://${host}:${port}/?user=${user}&password=${password}" \
      -d "DROP TABLE IF EXISTS trades_raw_enriched_v2"`

    execSync(dropCmd, { encoding: 'utf-8' })

    // Step 4: Create enriched table with proper join to condition_market_map
    console.log('  Creating table with enrichment...')

    const createCmd = `curl -s -X POST "https://${host}:${port}/?user=${user}&password=${password}" \
      -d "CREATE TABLE trades_raw_enriched_v2 ENGINE = MergeTree() ORDER BY (wallet_address, timestamp) AS SELECT t.trade_id, t.wallet_address, t.market_id, COALESCE(m.condition_id, t.condition_id) as condition_id, t.timestamp, t.shares, t.entry_price, t.side FROM trades_raw t LEFT JOIN condition_market_map m ON t.market_id = m.market_id"`

    try {
      execSync(createCmd, { encoding: 'utf-8', stdio: 'pipe' })
      console.log('  ✓ Table created')
    } catch (e: any) {
      console.log(`  ⚠️  ${(e as any).message.substring(0, 100)}`)
    }

    console.log()

    // Step 5: Verify enrichment
    console.log('Step 5: Verifying enrichment results...')

    const verifyCmd = `curl -s -X POST "https://${host}:${port}/?user=${user}&password=${password}&default_format=JSON" \
      -d "SELECT COUNT(*) as total, SUM(IF(condition_id='', 1, 0)) as missing, SUM(IF(condition_id!='', 1, 0)) as with_id FROM trades_raw_enriched_v2"`

    const verifyResult = execSync(verifyCmd, { encoding: 'utf-8' })
    const verifyData = JSON.parse(verifyResult).data[0]

    const coverage = ((verifyData.with_id / verifyData.total) * 100).toFixed(2)

    console.log(`  Total rows: ${verifyData.total}`)
    console.log(`  With condition_id: ${verifyData.with_id}`)
    console.log(`  Missing: ${verifyData.missing}`)
    console.log(`  Coverage: ${coverage}%`)
    console.log()

    // Step 6: Compare
    console.log('Step 6: Comparison...')

    const previousCoverage = 51.07
    const newCoverage = parseFloat(coverage)
    const improvement = newCoverage - previousCoverage

    console.log(`  Previous: ${previousCoverage}%`)
    console.log(`  New: ${newCoverage}%`)
    console.log(`  Improvement: +${improvement.toFixed(2)}%`)
    console.log()

    console.log('═'.repeat(70))

    if (newCoverage >= 95) {
      console.log('✅ SUCCESS: Achieved 95%+ coverage!')
    } else if (newCoverage >= 90) {
      console.log('✅ SUCCESS: Achieved 90%+ coverage!')
    } else if (newCoverage > previousCoverage) {
      console.log(`✅ SIGNIFICANT IMPROVEMENT: ${previousCoverage}% → ${newCoverage}%`)
    }

    console.log('═'.repeat(70))
    console.log()

    return {
      success: true,
      previousCoverage,
      newCoverage,
      improvement,
      totalRows: verifyData.total,
      withConditionId: verifyData.with_id,
      missingConditionId: verifyData.missing,
      timestamp: new Date().toISOString()
    }

  } catch (e: any) {
    console.error('ERROR:', e.message)
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    }
  }
}

enrichProper().then(result => {
  console.log('Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
