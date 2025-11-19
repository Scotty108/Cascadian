import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * ERC1155 CONDITION ID EXTRACTOR WORKER
 *
 * Extracts condition_ids from ERC1155 token transfers on-chain.
 * For Polymarket's CTF (Conditional Token Framework):
 * - token_id >> 1 = condition_id
 * - token_id & 1 = outcome_index
 *
 * This gives us ALL markets that have ever been traded (not just active ones)
 * Expected: 10-20K+ unique condition_ids
 */

async function runERC1155Worker() {
  try {
    console.log('═'.repeat(70))
    console.log('🔗 ERC1155 CONDITION ID EXTRACTOR WORKER')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Create extraction table
    console.log('Step 1: Creating erc1155_condition_map table...')

    try {
      await clickhouse.query({
        query: 'DROP TABLE IF EXISTS erc1155_condition_map'
      })
    } catch (e) {}

    // Extract condition_id from token_id: token_id >> 1
    await clickhouse.query({
      query: `
CREATE TABLE erc1155_condition_map (
  condition_id String,
  market_address String,
  token_id String,
  source_timestamp DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (condition_id, market_address)
      `
    })

    console.log('✓ Table created')
    console.log()

    // Step 2: Extract condition_ids from erc1155_transfers
    console.log('Step 2: Extracting condition_ids from ERC1155 transfers...')

    // For each unique token_id, extract the condition_id by shifting right 1 bit
    // In ClickHouse: bitShiftRight(token_id_as_int, 1)
    // token_id is stored as hex string, we need to:
    // 1. Convert hex string to decimal (or work with hex directly)
    // 2. Shift right by 1 bit
    // 3. Convert back to hex

    const insertQuery = `
INSERT INTO erc1155_condition_map (condition_id, market_address, token_id)
SELECT
  DISTINCT
  lower(hex(bitShiftRight(reinterpretAsUInt256(unhex(ltrim(token_id, '0x'))), 1))) as condition_id,
  ltrim(token_id, '0x') as market_address,
  token_id
FROM erc1155_transfers
WHERE token_id != ''
  AND token_id IS NOT NULL
GROUP BY token_id
    `

    try {
      await clickhouse.query({ query: insertQuery })
      console.log('✓ Extraction complete')
    } catch (e: any) {
      // If bit operations fail, fall back to string manipulation
      console.log('⚠️  Bit shift method failed, using string extraction...')

      const fallbackQuery = `
INSERT INTO erc1155_condition_map (condition_id, market_address, token_id)
SELECT
  DISTINCT
  lower(substring(token_id, 1, 66)) as condition_id,
  lower(substring(token_id, 1, 42)) as market_address,
  token_id
FROM erc1155_transfers
WHERE token_id != ''
  AND token_id IS NOT NULL
GROUP BY token_id
      `

      await clickhouse.query({ query: fallbackQuery })
      console.log('✓ Extraction complete (via string method)')
    }

    console.log()

    // Step 3: Verify results
    console.log('Step 3: Verification')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT condition_id) as cnt FROM erc1155_condition_map'
    })

    const count = parseInt(JSON.parse(await countResult.text()).data[0].cnt)
    console.log(`✓ Unique condition_ids extracted: ${count.toLocaleString()}`)
    console.log()

    // Step 4: Test enrichment potential
    console.log('Step 4: Testing enrichment potential on missing trades...')

    const testResult = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT t.market_id) as unique_markets,
  COUNT(CASE WHEN e.condition_id IS NOT NULL THEN 1 END) as can_enrich_rows
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  WHERE condition_id = '' OR condition_id IS NULL
  LIMIT 1000000
) t
LEFT JOIN (
  SELECT DISTINCT lower(substring(token_id, 1, 42)) as market_address, condition_id FROM erc1155_condition_map
) e ON lower(t.market_id) = e.market_address
      `
    })

    const testData = JSON.parse(await testResult.text()).data[0]
    const testMarkets = parseInt(testData.unique_markets)
    const testEnrichable = parseInt(testData.can_enrich_rows)
    const enrichRate = testMarkets > 0 ? ((testEnrichable / testMarkets) * 100).toFixed(1) : '0'

    console.log(`  Markets tested: ${testMarkets}`)
    console.log(`  Can be enriched: ${testEnrichable} (${enrichRate}%)`)
    console.log()

    console.log('═'.repeat(70))
    console.log('✅ ERC1155 WORKER COMPLETE')
    console.log('═'.repeat(70))
    console.log(`Result: ${count.toLocaleString()} condition_ids from blockchain transfers`)
    console.log(`Estimated enrichment potential: +${enrichRate}%`)
    console.log()

    return {
      success: true,
      conditionIdsFound: count,
      estimatedCoverage: enrichRate,
      timestamp: new Date().toISOString()
    }

  } catch (e: any) {
    console.error('❌ ERC1155 WORKER ERROR:', e.message.substring(0, 200))
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    }
  }
}

// Run worker
runERC1155Worker().then(result => {
  console.log('Worker Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
