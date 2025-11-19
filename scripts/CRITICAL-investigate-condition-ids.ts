#!/usr/bin/env npx ts-node
/**
 * CRITICAL INVESTIGATION: Find where condition_ids are stored
 *
 * Problem: trades_raw has 67% NULL condition_ids
 * Question: Are they in OTHER tables? Can we reconstruct them?
 * Mission: Search EVERY table for condition_id data
 */

import { getClickHouseClient } from '../lib/clickhouse/client'

const client = getClickHouseClient()

interface TableInfo {
  name: string
  engine: string
  total_rows: number
}

interface ColumnInfo {
  table_name: string
  column_name: string
  data_type: string
}

interface PopulationStat {
  table_name: string
  total_rows: number
  with_condition_id: number
  percentage: number
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('CRITICAL INVESTIGATION: Finding condition_id storage locations')
  console.log('='.repeat(80) + '\n')

  try {
    // SEARCH 1: Find all tables with relevant columns
    console.log('SEARCH 1: Finding all tables with condition/market/token columns...\n')
    const tablesResult = await client.query({
      query: `
        SELECT DISTINCT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = currentDatabase()
        AND (
          column_name LIKE '%condition%'
          OR column_name LIKE '%market%'
          OR column_name LIKE '%token%'
          OR column_name LIKE '%ctf%'
          OR table_name LIKE '%trade%'
          OR table_name LIKE '%position%'
        )
        ORDER BY table_name, column_name
      `,
      format: 'JSONEachRow',
    })

    const columnsData = await tablesResult.json<any[]>()

    if (columnsData.length === 0) {
      console.log('⚠️  No relevant columns found with SQL INFO_SCHEMA')
      console.log('Falling back to direct table inspection...\n')
    } else {
      console.log(`Found ${columnsData.length} relevant columns across tables:\n`)

      // Group by table
      const tableColumns: Record<string, string[]> = {}
      columnsData.forEach((col: any) => {
        if (!tableColumns[col.table_name]) tableColumns[col.table_name] = []
        tableColumns[col.table_name].push(`${col.column_name} (${col.data_type})`)
      })

      Object.entries(tableColumns).forEach(([table, cols]) => {
        console.log(`  📊 ${table}:`)
        cols.forEach(col => console.log(`     - ${col}`))
      })
    }

    // SEARCH 2: Get all tables in database
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 2: Enumerating ALL tables in database...\n')

    const allTablesResult = await client.query({
      query: `
        SELECT name, engine, total_rows
        FROM system.tables
        WHERE database = currentDatabase()
        AND name NOT LIKE 'system.%'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow',
    })

    const allTables = await allTablesResult.json<any[]>()
    console.log(`Total tables: ${allTables.length}\n`)

    allTables.forEach((t: any) => {
      console.log(`  ${t.name}: ${t.total_rows?.toLocaleString() || 'N/A'} rows (${t.engine})`)
    })

    // SEARCH 3: Check each table for condition_id column
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 3: Checking for condition_id population across ALL tables...\n')

    const populationStats: PopulationStat[] = []

    for (const table of allTables) {
      // Try to count rows with condition_id populated
      try {
        // First check if column exists
        const descResult = await client.query({
          query: `DESC TABLE ${(table as any).name}`,
          format: 'JSONEachRow',
        })

        const desc = await descResult.json<any[]>()
        const hasConditionId = desc.some((d: any) => d.name === 'condition_id')

        if (hasConditionId && (table as any).total_rows > 0) {
          const countResult = await client.query({
            query: `
              SELECT
                COUNT(*) as total,
                SUM(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 ELSE 0 END) as with_condition
              FROM ${(table as any).name}
            `,
            format: 'JSONEachRow',
          })

          const counts = await countResult.json<any[]>()
          const total = (counts[0] as any)?.total || 0
          const withCondition = (counts[0] as any)?.with_condition || 0
          const pct = total > 0 ? Math.round((withCondition / total) * 100) : 0

          populationStats.push({
            table_name: (table as any).name,
            total_rows: total,
            with_condition_id: withCondition,
            percentage: pct,
          })

          console.log(`  ✓ ${(table as any).name}: ${withCondition}/${total} (${pct}%) have condition_id`)
        }
      } catch (e) {
        // Table might not have condition_id column, skip
      }
    }

    // SEARCH 4: Hunt for test wallet across all tables
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 4: Hunting for test wallet 0x961b5ad4c66ec18d073c216054ddd42523336a1d...\n')

    const testWallet = '0x961b5ad4c66ec18d073c216054ddd42523336a1d'

    for (const table of allTables.slice(0, 20)) { // Check first 20 tables
      try {
        // Try common wallet column names
        const walletCols = ['wallet', 'address', 'from_address', 'to_address', 'user', 'user_id']

        for (const col of walletCols) {
          try {
            const resultSet = await client.query({
              query: `SELECT COUNT(*) as count FROM ${(table as any).name} WHERE ${col} = '${testWallet}' LIMIT 1`,
              format: 'JSONEachRow',
            })

            const result = await resultSet.json<any[]>()
            if ((result[0] as any)?.count > 0) {
              console.log(`  ✓ Found wallet in ${(table as any).name}.${col}: ${(result[0] as any)?.count} rows`)

              // Get sample with condition_id
              const sampleResult = await client.query({
                query: `
                  SELECT *
                  FROM ${(table as any).name}
                  WHERE ${col} = '${testWallet}'
                  LIMIT 1
                `,
                format: 'JSONEachRow',
              })

              const sample = await sampleResult.json<any[]>()
              if (sample.length > 0) {
                console.log(`    Sample row keys: ${Object.keys(sample[0]).join(', ')}`)
                if ((sample[0] as any).condition_id) {
                  console.log(`    condition_id present: ${(sample[0] as any).condition_id}`)
                }
              }
            }
          } catch (e) {
            // Column doesn't exist
          }
        }
      } catch (e) {
        // Skip table
      }
    }

    // SEARCH 5: Check for backup/archive versions
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 5: Checking for backup/archive versions...\n')

    const backupPatterns = ['%backup%', '%archive%', '%v2%', '%v1%', '%old%', '%staging%']

    for (const pattern of backupPatterns) {
      const backupResult = await client.query({
        query: `
          SELECT name
          FROM system.tables
          WHERE database = currentDatabase()
          AND name LIKE '${pattern}'
        `,
        format: 'JSONEachRow',
      })

      const backups = await backupResult.json<any[]>()
      if (backups.length > 0) {
        console.log(`  Tables matching "${pattern}":`)
        backups.forEach((b: any) => console.log(`    - ${b.name}`))
      }
    }

    // SEARCH 6: Look for mapping tables
    console.log('\n' + '='.repeat(80))
    console.log('SEARCH 6: Looking for mapping/lookup tables...\n')

    const mapResult = await client.query({
      query: `
        SELECT name, total_rows
        FROM system.tables
        WHERE database = currentDatabase()
        AND (
          name LIKE '%map%'
          OR name LIKE '%lookup%'
          OR name LIKE '%index%'
          OR name LIKE '%mapping%'
          OR name LIKE '%resolution%'
        )
      `,
      format: 'JSONEachRow',
    })

    const mappings = await mapResult.json<any[]>()
    if (mappings.length > 0) {
      console.log(`Found ${mappings.length} mapping-related tables:`)
      mappings.forEach((m: any) => console.log(`  - ${m.name}: ${m.total_rows?.toLocaleString() || 'N/A'} rows`))
    } else {
      console.log('  No mapping tables found')
    }

    // ANALYSIS & RECOMMENDATIONS
    console.log('\n' + '='.repeat(80))
    console.log('ANALYSIS & RECOMMENDATIONS')
    console.log('='.repeat(80) + '\n')

    // Summary of findings
    const withData = populationStats.filter(s => s.with_condition_id > 0)
    const emptyTables = populationStats.filter(s => s.with_condition_id === 0)

    console.log(`📊 POPULATION SUMMARY:`)
    console.log(`   Tables with condition_id column: ${populationStats.length}`)
    console.log(`   Tables with populated condition_id: ${withData.length}`)
    console.log(`   Tables with NO condition_id: ${emptyTables.length}`)

    if (withData.length > 0) {
      console.log(`\n✅ TABLES WITH CONDITION_ID DATA:`)
      withData.sort((a, b) => b.percentage - a.percentage).forEach(s => {
        console.log(`   ${s.table_name}: ${s.with_condition_id}/${s.total_rows} (${s.percentage}%)`)
      })
    }

    if (emptyTables.length > 0) {
      console.log(`\n❌ TABLES WITH EMPTY CONDITION_ID:`)
      emptyTables.slice(0, 10).forEach(s => {
        console.log(`   ${s.table_name}: 0/${s.total_rows} (0%)`)
      })
      if (emptyTables.length > 10) {
        console.log(`   ... and ${emptyTables.length - 10} more`)
      }
    }

    // Path recommendations
    console.log(`\n🔍 PATH FORWARD:`)
    if (withData.length > 0) {
      console.log(`   PATH A: condition_ids ARE in other tables`)
      console.log(`   → Use JOIN to reconstruct missing values in trades_raw`)
      console.log(`   → Source tables: ${withData.map(s => s.table_name).join(', ')}`)
    } else {
      console.log(`   PATH B: condition_ids NOT in any table`)
      console.log(`   → Check if token_id can be mapped to condition_id`)
      console.log(`   → May need API backfill from Polymarket`)
    }

    console.log('\n' + '='.repeat(80) + '\n')

  } catch (error) {
    console.error('❌ Investigation failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
