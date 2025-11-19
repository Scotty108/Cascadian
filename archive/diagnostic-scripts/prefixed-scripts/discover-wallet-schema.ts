import { getClickHouseClient } from './lib/clickhouse/client'

const client = getClickHouseClient()

interface TableInfo {
  table_name: string
  engine: string
}

interface ColumnInfo {
  name: string
  type: string
}

async function discoverWalletTables() {
  try {
    // First, get all tables and views
    const tableList = await client.query({
      query: `
        SELECT 
          name as table_name,
          engine
        FROM system.tables
        WHERE database = currentDatabase()
        ORDER BY name
      `,
      format: 'JSONEachRow',
    })

    const tables = await tableList.json<TableInfo[]>()
    console.log(`\n=== Found ${tables.length} total tables/views ===\n`)

    interface WalletTable {
      table_name: string
      engine: string
      walletColumns: ColumnInfo[]
      allColumns: number
    }

    const walletTables: WalletTable[] = []

    for (const table of tables) {
      try {
        const colResult = await client.query({
          query: `
            SELECT 
              name,
              type
            FROM system.columns
            WHERE database = currentDatabase() 
            AND table = '${table.table_name}'
          `,
          format: 'JSONEachRow',
        })

        const columns = await colResult.json<ColumnInfo[]>()
        const walletColumns = columns.filter(col => 
          /wallet|trader|account|user_address|address|from|to|sender|recipient/i.test(col.name)
        )

        if (walletColumns.length > 0) {
          walletTables.push({
            table_name: table.table_name,
            engine: table.engine,
            walletColumns: walletColumns,
            allColumns: columns.length
          })
        }
      } catch (err) {
        // Skip tables we can't read
      }
    }

    console.log('=== TABLES WITH WALLET FIELDS ===\n')
    
    const sorted = walletTables.sort((a, b) => a.table_name.localeCompare(b.table_name))
    
    for (const t of sorted) {
      console.log(`📊 ${t.table_name}`)
      console.log(`   Engine: ${t.engine}`)
      console.log(`   Total Columns: ${t.allColumns}`)
      console.log(`   Wallet Fields:`)
      for (const col of t.walletColumns) {
        console.log(`     - ${col.name} (${col.type})`)
      }
      console.log()
    }

    // Now get row counts for each
    console.log('\n=== ROW COUNTS ===\n')
    for (const t of walletTables) {
      try {
        const countResult = await client.query({
          query: `SELECT count() as cnt FROM \`${t.table_name}\` LIMIT 1`,
          format: 'JSONEachRow',
        })
        const countRows = await countResult.json<Array<{cnt: number}>>()
        if (countRows.length > 0) {
          const cnt = countRows[0].cnt
          console.log(`${t.table_name.padEnd(40)}: ${cnt.toString().padStart(15)} rows`)
        }
      } catch (err) {
        console.log(`${t.table_name.padEnd(40)}: [count failed]`)
      }
    }

    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

discoverWalletTables()
