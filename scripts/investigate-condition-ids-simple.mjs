#!/usr/bin/env node
/**
 * CRITICAL INVESTIGATION: Find where condition_ids are stored
 * Using ClickHouse HTTP API directly
 */

import axios from 'axios'

const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123'
const username = process.env.CLICKHOUSE_USER || 'default'
const password = process.env.CLICKHOUSE_PASSWORD || 'password'

// Handle ClickHouse Cloud URLs (they use /query endpoint)
const isCloud = host.includes('.clickhouse.cloud')
const baseURL = isCloud ? host : host

const client = axios.create({
  baseURL,
  timeout: 30000,
})

// Add basic auth to all requests
client.interceptors.request.use((config) => {
  const auth = Buffer.from(`${username}:${password}`).toString('base64')
  config.headers.Authorization = `Basic ${auth}`
  return config
})

async function query(sql) {
  try {
    const response = await client.post('/', sql, {
      headers: { 'Content-Type': 'text/plain' },
      params: {
        format: 'JSON',
      },
    })
    return response.data
  } catch (error) {
    if (error.response?.status === 404) {
      console.error('404 Error: Check your ClickHouse URL')
      console.error('URL:', host)
    }
    console.error('Query error:', error.message)
    throw error
  }
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('CRITICAL INVESTIGATION: Finding condition_id storage locations')
  console.log('='.repeat(80) + '\n')

  try {
    // SEARCH 1: Get all tables
    console.log('SEARCH 1: Enumerating ALL tables in database...\n')
    const tablesResult = await query(`
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
      ORDER BY total_rows DESC
    `)

    const tables = tablesResult.data || []
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
        // Check if table has condition_id column
        const descResult = await query(`DESC TABLE ${table.name}`)
        const cols = descResult.data || []
        const hasConditionId = cols.some(c => c.name === 'condition_id')

        if (hasConditionId) {
          tablesWithCondition.push(table.name)
          console.log(`  ✓ ${table.name} has condition_id`)
        }
      } catch (e) {
        // Skip tables that error
      }
    }

    // SEARCH 3: Check population of condition_id in each table
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 3: Checking condition_id population...\n')

    const populationStats = []

    for (const tableName of tablesWithCondition) {
      try {
        const countResult = await query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 ELSE 0 END) as with_condition_id
          FROM ${tableName}
        `)

        const data = countResult.data?.[0] || {}
        const total = Number(data.total) || 0
        const withCondition = Number(data.with_condition_id) || 0
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

    for (const table of tables.slice(0, 15)) {
      try {
        // Try to find wallet in common columns
        const result = await query(`
          SELECT COUNT(*) as cnt
          FROM ${table.name}
          WHERE wallet = '${testWallet}' OR address = '${testWallet}'
                OR from_address = '${testWallet}' OR to_address = '${testWallet}'
          LIMIT 1
        `)

        const count = Number(result.data?.[0]?.cnt) || 0
        if (count > 0) {
          console.log(`  ✓ Found wallet in ${table.name}: ${count} rows`)

          // Get sample
          const sampleResult = await query(`
            SELECT *
            FROM ${table.name}
            WHERE wallet = '${testWallet}' OR address = '${testWallet}'
            LIMIT 1
          `)

          if (sampleResult.data?.length > 0) {
            const keys = Object.keys(sampleResult.data[0])
            console.log(`    Columns: ${keys.join(', ')}`)
            if (sampleResult.data[0].condition_id) {
              console.log(`    condition_id: ${sampleResult.data[0].condition_id}`)
            }
          }
        }
      } catch (e) {
        // Skip
      }
    }

    // SEARCH 5: Look for mapping tables
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 5: Looking for mapping/lookup tables...\n')

    const mappingTables = tables.filter(t =>
      t.name.includes('map') || t.name.includes('lookup') ||
      t.name.includes('index') || t.name.includes('resolution')
    )

    if (mappingTables.length > 0) {
      console.log('Found mapping tables:')
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
    console.log(`   Tables with condition_id: ${tablesWithCondition.length}`)
    console.log(`   Tables with data: ${populated.length}`)
    console.log(`   Tables with NO data: ${empty.length}`)

    if (populated.length > 0) {
      console.log(`\n✅ TABLES WITH CONDITION_ID DATA:`)
      populated.sort((a, b) => b.percentage - a.percentage).forEach(s => {
        console.log(`   ${s.table}: ${s.with_condition_id}/${s.total} (${s.percentage}%)`)
      })
      console.log(`\n🔍 PATH A - RECONSTRUCTION:`)
      console.log(`   condition_ids ARE available in other tables`)
      console.log(`   → Use JOIN to fill trades_raw.condition_id from:`)
      populated.forEach(s => {
        if (s.percentage > 50) {
          console.log(`      - ${s.table} (${s.percentage}% populated)`)
        }
      })
    } else {
      console.log(`\n❌ NO TABLES HAVE CONDITION_ID DATA`)
      console.log(`   This means condition_ids may be completely lost OR`)
      console.log(`   they're stored with different column names`)
    }

    console.log('\n' + '='.repeat(80) + '\n')

  } catch (error) {
    console.error('❌ Investigation failed:', error.message)
    process.exit(1)
  }
}

main()
