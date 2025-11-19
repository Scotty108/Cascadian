import { createClient } from '@clickhouse/client'

const client = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default',
})

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('CRITICAL INVESTIGATION: Finding where condition_ids are stored')
  console.log('='.repeat(80) + '\n')

  try {
    // SEARCH 1: Get all tables
    console.log('SEARCH 1: Enumerating ALL tables in database...\n')
    const tablesQuery = `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
      ORDER BY total_rows DESC
    `
    const tablesResult = await client.query({ query: tablesQuery, format: 'JSONEachRow' })
    const tables = await tablesResult.json()

    console.log(`Found ${tables.length} total tables:\n`)
    tables.forEach(t => {
      console.log(`  ${t.name}: ${Number(t.total_rows).toLocaleString()} rows (${t.engine})`)
    })

    // SEARCH 2: Find tables with condition_id column
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 2: Finding tables with condition_id column...\n')

    const tablesWithCondition = []

    for (const table of tables) {
      try {
        const descQuery = `DESCRIBE TABLE ${table.name}`
        const descResult = await client.query({ query: descQuery, format: 'JSONEachRow' })
        const cols = await descResult.json()
        const hasConditionId = cols.some(c => c.name === 'condition_id')

        if (hasConditionId) {
          tablesWithCondition.push(table.name)
          console.log(`  ✓ ${table.name} has condition_id`)
        }
      } catch (e) {
        // Skip tables that error
      }
    }

    console.log(`\nTotal tables with condition_id column: ${tablesWithCondition.length}`)

    // SEARCH 3: Check population of condition_id in each table
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 3: Checking condition_id population...\n')

    const populationStats = []

    for (const tableName of tablesWithCondition) {
      try {
        const countQuery = `
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 ELSE 0 END) as with_condition_id
          FROM ${tableName}
        `
        const countResult = await client.query({ query: countQuery, format: 'JSONEachRow' })
        const data = await countResult.json()

        const stat = data[0] || {}
        const total = Number(stat.total) || 0
        const withCondition = Number(stat.with_condition_id) || 0
        const pct = total > 0 ? Math.round((withCondition / total) * 100) : 0

        populationStats.push({
          table: tableName,
          total,
          with_condition_id: withCondition,
          percentage: pct,
        })

        console.log(`  ${tableName}: ${withCondition}/${total} (${pct}%)`)
      } catch (e) {
        console.error(`  ✗ Error querying ${tableName}`)
      }
    }

    // SEARCH 4: Find test wallet
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 4: Hunting for test wallet 0x961b5ad4c66ec18d073c216054ddd42523336a1d...\n')

    const testWallet = '0x961b5ad4c66ec18d073c216054ddd42523336a1d'
    const walletCols = ['wallet', 'address', 'from_address', 'to_address', 'user_address', 'trader_address']

    let walletFound = false

    for (const table of tables.slice(0, 25)) {
      try {
        for (const col of walletCols) {
          try {
            const checkQuery = `
              SELECT COUNT(*) as cnt
              FROM ${table.name}
              WHERE ${col} = '${testWallet}'
              LIMIT 1
            `
            const checkResult = await client.query({ query: checkQuery, format: 'JSONEachRow' })
            const result = await checkResult.json()

            const count = Number(result[0]?.cnt) || 0
            if (count > 0) {
              console.log(`  ✓ Found wallet in ${table.name}.${col}: ${count} rows`)
              walletFound = true

              // Get sample
              const sampleQuery = `
                SELECT *
                FROM ${table.name}
                WHERE ${col} = '${testWallet}'
                LIMIT 3
              `
              const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' })
              const samples = await sampleResult.json()

              if (samples.length > 0) {
                const keys = Object.keys(samples[0])
                console.log(`    Columns (${keys.length}): ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`)

                if (samples[0].condition_id) {
                  console.log(`    Sample condition_id: ${samples[0].condition_id}`)
                  console.log(`    Other key data:`)
                  console.log(`      - tx_hash: ${samples[0].tx_hash || 'N/A'}`)
                  console.log(`      - market_id: ${samples[0].market_id || 'N/A'}`)
                  console.log(`      - token_id: ${samples[0].token_id || 'N/A'}`)
                  console.log(`      - side: ${samples[0].side || 'N/A'}`)
                }
              }
            }
          } catch (e) {
            // Column doesn't exist, skip
          }
        }
      } catch (e) {
        // Skip table
      }
    }

    if (!walletFound) {
      console.log('  ⚠️  Test wallet not found in first 25 tables')
    }

    // SEARCH 5: Look for mapping tables
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 5: Looking for mapping/lookup/resolution tables...\n')

    const mappingTables = tables.filter(t =>
      t.name.includes('map') || t.name.includes('lookup') ||
      t.name.includes('index') || t.name.includes('resolution') ||
      t.name.includes('outcome') || t.name.includes('market')
    )

    if (mappingTables.length > 0) {
      console.log('Found mapping-related tables:')
      mappingTables.forEach(t => {
        console.log(`  - ${t.name}: ${Number(t.total_rows).toLocaleString()} rows`)
      })
    } else {
      console.log('No mapping tables found')
    }

    // ANALYSIS
    console.log('\n' + '='.repeat(80))
    console.log('ANALYSIS & RECOMMENDATIONS\n')

    const populated = populationStats.filter(s => s.with_condition_id > 0)
    const empty = populationStats.filter(s => s.with_condition_id === 0)

    console.log(`📊 SUMMARY:`)
    console.log(`   Tables with condition_id column: ${tablesWithCondition.length}`)
    console.log(`   Tables with populated data: ${populated.length}`)
    console.log(`   Tables with ZERO data: ${empty.length}`)

    if (populated.length > 0) {
      console.log(`\n✅ TABLES WITH CONDITION_ID DATA:`)
      populated.sort((a, b) => b.percentage - a.percentage).forEach(s => {
        const bar = '█'.repeat(Math.round(s.percentage / 5)) + '░'.repeat(20 - Math.round(s.percentage / 5))
        console.log(`   ${s.table.padEnd(30)} [${bar}] ${s.with_condition_id}/${s.total} (${s.percentage}%)`)
      })

      console.log(`\n🔍 PATH A - JOIN & RECONSTRUCTION:`)
      console.log(`   ✓ condition_ids ARE available in other tables`)
      console.log(`   → Strategy: JOIN trades_raw with populated tables`)
      const best = populated[0]
      console.log(`   → Primary source: ${best.table} (${best.percentage}% populated)`)
      console.log(`   → This can reconstruct ~${best.percentage}% of missing condition_ids`)
    } else {
      console.log(`\n❌ NO TABLES HAVE CONDITION_ID DATA!`)
      console.log(`   → condition_ids may be completely lost`)
      console.log(`   → Alternative path: Reconstruct from token_id mappings`)
    }

    if (empty.length > 0) {
      console.log(`\n⚠️  EMPTY TABLES (with condition_id column but no data):`)
      empty.slice(0, 5).forEach(s => {
        console.log(`   - ${s.table}`)
      })
      if (empty.length > 5) {
        console.log(`   ... and ${empty.length - 5} more`)
      }
    }

    // Check trades_raw specifically
    console.log(`\n📋 TRADES_RAW STATUS:`)
    const tradesRawStat = populationStats.find(s => s.table === 'trades_raw')
    if (tradesRawStat) {
      const emptyPct = 100 - tradesRawStat.percentage
      console.log(`   Total trades: ${tradesRawStat.total.toLocaleString()}`)
      console.log(`   With condition_id: ${tradesRawStat.with_condition_id.toLocaleString()} (${tradesRawStat.percentage}%)`)
      console.log(`   Missing condition_id: ${tradesRawStat.total - tradesRawStat.with_condition_id} (${emptyPct}%)`)

      if (populated.length > 1) {
        const other = populated.find(s => s.table !== 'trades_raw')
        if (other) {
          console.log(`   → Can recover ~${Math.min(tradesRawStat.total - tradesRawStat.with_condition_id, other.with_condition_id)} via JOIN with ${other.table}`)
        }
      }
    }

    console.log('\n' + '='.repeat(80) + '\n')

    await client.close()
  } catch (error) {
    console.error('❌ Investigation failed:', error.message)
    process.exit(1)
  }
}

main()
