import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client.js'

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723'
const EOA_LOWER = EOA.toLowerCase()
const PROXY_LOWER = PROXY.toLowerCase()

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('ERC1155 TRANSFER COVERAGE ANALYSIS: xcnstrategy Wallet')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  // STEP 1: Discover ERC1155 tables
  console.log('STEP 1: Discovering ERC1155 Transfer Tables')
  console.log('─────────────────────────────────────────────\n')
  
  const tablesQuery = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableQuantity(total_bytes) as size_human
      FROM system.tables
      WHERE database = 'default'
        AND (name ILIKE '%erc1155%' 
             OR name ILIKE '%1155%'
             OR (name ILIKE '%transfer%' AND name NOT ILIKE '%trade%'))
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })
  
  const tables = await tablesQuery.json<any>()
  console.log(`Found ${tables.length} ERC1155-related tables:\n`)
  tables.forEach(t => {
    console.log(`  • ${t.name}`)
    console.log(`    Engine: ${t.engine} | Rows: ${t.total_rows} | Size: ${t.size_human}\n`)
  })
  
  // STEP 2: Schema analysis for each table
  console.log('\nSTEP 2: Analyzing Table Schemas')
  console.log('───────────────────────────────\n')
  
  const tableSchemas: Record<string, any[]> = {}
  
  for (const table of tables) {
    console.log(`${table.name}:`)
    const schema = await clickhouse.query({
      query: `DESCRIBE TABLE ${table.name}`,
      format: 'JSONEachRow'
    })
    const cols = await schema.json<any>()
    tableSchemas[table.name] = cols
    
    cols.forEach(c => {
      console.log(`  - ${c.name}: ${c.type}`)
    })
    console.log()
  }
  
  // STEP 3: Sample data
  console.log('\nSTEP 3: Sampling Data')
  console.log('─────────────────────\n')
  
  for (const table of tables) {
    try {
      const sample = await clickhouse.query({
        query: `SELECT * FROM ${table.name} LIMIT 1 FORMAT JSONEachRow`,
        format: 'JSONEachRow'
      })
      const rows = await sample.json<any>()
      if (rows.length > 0) {
        console.log(`${table.name} - Sample Row:`)
        console.log(JSON.stringify(rows[0], null, 2))
        console.log()
      }
    } catch (e: any) {
      console.log(`${table.name}: Error sampling - ${e.message}\n`)
    }
  }
  
  // STEP 4: Check for xcnstrategy wallet transfers
  console.log('\nSTEP 4: Locating xcnstrategy Transfers')
  console.log('──────────────────────────────────────\n')
  
  const walletTransfers: Record<string, number> = {}
  
  for (const table of tables) {
    try {
      // Try common column names for from/to addresses
      const schema = tableSchemas[table.name]
      const hasFrom = schema.some((c: any) => c.name.toLowerCase() === 'from')
      const hasTo = schema.some((c: any) => c.name.toLowerCase() === 'to')
      const hasFromAddress = schema.some((c: any) => c.name.toLowerCase() === 'from_address')
      const hasToAddress = schema.some((c: any) => c.name.toLowerCase() === 'to_address')
      
      if (!hasFrom && !hasTo && !hasFromAddress && !hasToAddress) {
        console.log(`${table.name}: No address columns found, skipping`)
        continue
      }
      
      // Build WHERE clause based on available columns
      let whereClause = '1=0'
      if (hasFrom || hasFromAddress) {
        const col = hasFrom ? 'from' : 'from_address'
        whereClause = `(${col} = '${EOA_LOWER}' OR ${col} = '${PROXY_LOWER}')`
      }
      if (hasTo || hasToAddress) {
        const col = hasTo ? 'to' : 'to_address'
        if (whereClause === '1=0') {
          whereClause = `(${col} = '${EOA_LOWER}' OR ${col} = '${PROXY_LOWER}')`
        } else {
          whereClause += ` OR (${col} = '${EOA_LOWER}' OR ${col} = '${PROXY_LOWER}')`
        }
      }
      
      const countQuery = await clickhouse.query({
        query: `SELECT COUNT(*) as cnt FROM ${table.name} WHERE ${whereClause}`,
        format: 'JSONEachRow'
      })
      const result = await countQuery.json<any>()
      const count = result[0]?.cnt
      if (count > 0) {
        walletTransfers[table.name] = count
        console.log(`${table.name}: ${count} transfers found`)
      }
    } catch (e: any) {
      console.log(`${table.name}: Error querying - ${e.message}`)
    }
  }
  
  console.log('\n' + JSON.stringify({ walletTransfers }, null, 2))
}

main().catch(console.error)
