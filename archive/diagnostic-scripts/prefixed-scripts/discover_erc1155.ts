import { getClickHouseClient } from './lib/clickhouse/client'

const client = getClickHouseClient()

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723'

// Normalize addresses for query
const eoa_lower = EOA.toLowerCase()
const proxy_lower = PROXY.toLowerCase()

async function main() {
  console.log('Starting ERC1155 coverage analysis...\n')
  
  // Step 1: Discover ERC1155 tables
  console.log('=== STEP 1: Discovering ERC1155 Tables ===')
  const tables = await client.query({
    query: `
      SELECT 
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = 'default'
        AND (name ILIKE '%erc1155%' OR name ILIKE '%transfer%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })
  
  const tableRows = await tables.json<any>()
  console.log(`Found ${tableRows.length} potential ERC1155-related tables:`)
  tableRows.forEach(t => {
    console.log(`  - ${t.name} (${t.engine}) - ${t.total_rows} rows`)
  })
  
  // Step 2: Examine each table schema
  console.log('\n=== STEP 2: Examining Table Schemas ===')
  for (const table of tableRows) {
    const schema = await client.query({
      query: `DESCRIBE TABLE ${table.name}`,
      format: 'JSONEachRow'
    })
    const cols = await schema.json<any>()
    console.log(`\n${table.name} columns:`)
    cols.forEach(c => {
      console.log(`  - ${c.name}: ${c.type}`)
    })
  }
  
  // Step 3: Sample data from each table
  console.log('\n=== STEP 3: Sampling Data ===')
  for (const table of tableRows) {
    try {
      const sample = await client.query({
        query: `SELECT * FROM ${table.name} LIMIT 1 FORMAT JSONEachRow`,
        format: 'JSONEachRow'
      })
      const rows = await sample.json<any>()
      if (rows.length > 0) {
        console.log(`\n${table.name} sample:`)
        console.log(JSON.stringify(rows[0], null, 2))
      }
    } catch (e: any) {
      console.log(`${table.name}: Error sampling - ${e.message}`)
    }
  }
  
  // Step 4: Check for xcnstrategy transfers
  console.log('\n=== STEP 4: Checking for xcnstrategy Transfers ===')
  for (const table of tableRows) {
    try {
      const count = await client.query({
        query: `
          SELECT COUNT(*) as cnt
          FROM ${table.name}
          WHERE (from = '${eoa_lower}' OR to = '${eoa_lower}'
                 OR from = '${proxy_lower}' OR to = '${proxy_lower}')
        `,
        format: 'JSONEachRow'
      })
      const result = await count.json<any>()
      if (result[0]?.cnt > 0) {
        console.log(`${table.name}: ${result[0].cnt} transfers for xcnstrategy`)
      }
    } catch (e: any) {
      console.log(`${table.name}: Could not query - ${e.message}`)
    }
  }
}

main().catch(console.error)
