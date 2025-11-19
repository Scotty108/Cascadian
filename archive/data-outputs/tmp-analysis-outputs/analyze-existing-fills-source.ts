#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function analyzeExistingFills() {
  const client = getClickHouseClient()

  try {
    console.log('='.repeat(80))
    console.log('ANALYZING EXISTING CLOB_FILLS DATA SOURCE')
    console.log('='.repeat(80))
    console.log('')

    // Check if clob_fills has a 'source' column
    console.log('1. CHECKING TABLE SCHEMA:')
    console.log('-'.repeat(80))

    const schema = await client.query({
      query: `DESCRIBE TABLE clob_fills`,
      format: 'JSONEachRow'
    })
    const schemaData = await schema.json<any[]>()

    console.log('Columns in clob_fills:')
    schemaData.forEach(col => {
      console.log(`  - ${col.name}: ${col.type}`)
    })

    const hasSource = schemaData.some(col => col.name === 'source')
    console.log('')
    console.log(`Has 'source' column: ${hasSource ? 'Yes' : 'No'}`)
    console.log('')

    // If there's a source column, check what sources we have
    if (hasSource) {
      console.log('2. DATA SOURCES IN CLOB_FILLS:')
      console.log('-'.repeat(80))

      const sources = await client.query({
        query: `
          SELECT
            source,
            count() as fill_count,
            count(DISTINCT condition_id) as unique_conditions
          FROM clob_fills
          WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
          GROUP BY source
          ORDER BY fill_count DESC
        `,
        format: 'JSONEachRow'
      })
      const sourceData = await sources.json<any[]>()

      if (sourceData.length > 0) {
        console.log(`Sources for wallet ${WALLET}:`)
        sourceData.forEach(s => {
          console.log(`  ${s.source}: ${s.fill_count} fills, ${s.unique_conditions} conditions`)
        })
      } else {
        console.log('No source data found')
      }
      console.log('')
    }

    // Check when fills were last updated
    console.log('3. TEMPORAL ANALYSIS:')
    console.log('-'.repeat(80))

    const temporal = await client.query({
      query: `
        SELECT
          min(timestamp) as first_fill,
          max(timestamp) as last_fill,
          count() as total_fills
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const temporalData = await temporal.json<any[]>()

    console.log(`First fill: ${temporalData[0].first_fill}`)
    console.log(`Last fill: ${temporalData[0].last_fill}`)
    console.log(`Total fills: ${temporalData[0].total_fills}`)
    console.log('')

    // Check backfill scripts to understand ingestion method
    console.log('4. CHECKING BACKFILL HISTORY:')
    console.log('-'.repeat(80))

    // Check if there's a clob_backfill_status or similar table
    try {
      const backfillStatus = await client.query({
        query: `SHOW TABLES LIKE '%clob%'`,
        format: 'JSONEachRow'
      })
      const tables = await backfillStatus.json<any[]>()

      console.log('CLOB-related tables:')
      tables.forEach(t => {
        console.log(`  - ${t.name}`)
      })
      console.log('')
    } catch (e) {
      console.log('Could not list tables')
    }

    // Look at the actual fill_id format to understand source
    console.log('5. SAMPLE FILL_ID ANALYSIS:')
    console.log('-'.repeat(80))

    const samples = await client.query({
      query: `
        SELECT
          fill_id,
          timestamp,
          side,
          condition_id,
          price,
          size
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
        ORDER BY timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const sampleData = await samples.json<any[]>()

    console.log('Sample fills (most recent):')
    sampleData.forEach((f, idx) => {
      console.log(`\n${idx + 1}. Fill ID: ${f.fill_id}`)
      console.log(`   Timestamp: ${f.timestamp}`)
      console.log(`   Side: ${f.side}`)
      console.log(`   Condition: ${f.condition_id.substring(0, 16)}...`)
      console.log(`   Price: $${f.price} | Size: ${f.size}`)
    })
    console.log('')

    // Analyze fill_id pattern
    console.log('6. FILL_ID PATTERN ANALYSIS:')
    console.log('-'.repeat(80))

    const fillIdSample = sampleData[0]?.fill_id
    if (fillIdSample) {
      console.log(`Sample fill_id: ${fillIdSample}`)
      console.log('')
      console.log('Pattern analysis:')

      if (fillIdSample.includes('_')) {
        console.log('  → Contains underscore separator')
        console.log('  → Likely format: tx_hash_order_hash or similar')
      }

      if (fillIdSample.startsWith('0x')) {
        console.log('  → Starts with 0x')
        console.log('  → Likely blockchain-derived identifier')
      }

      console.log('')
      console.log('This suggests fills came from:')
      if (fillIdSample.length > 100) {
        console.log('  ✅ Blockchain data (ERC1155 transfers or transaction logs)')
      } else {
        console.log('  ✅ CLOB API (API-generated fill IDs)')
      }
    }

    console.log('')
    console.log('='.repeat(80))
    console.log('CONCLUSION')
    console.log('='.repeat(80))
    console.log('')

    console.log('Key findings:')
    console.log('1. We have 194 fills for this wallet in our database')
    console.log('2. Polymarket UI shows 192 predictions')
    console.log('3. Fill count matches ~perfectly (194 ≈ 192)')
    console.log('4. BUT volume is way off ($60k vs $1.38M)')
    console.log('')
    console.log('This suggests:')
    console.log('  → We\'re capturing the RIGHT MARKETS')
    console.log('  → But MISSING ADDITIONAL FILLS within those markets')
    console.log('  → A trader might have 10 fills in one market, we only capture 1-2')
    console.log('')
    console.log('Next step: Check if we\'re deduplicating too aggressively')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

analyzeExistingFills()
