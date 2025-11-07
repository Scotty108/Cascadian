import { getClickHouseClient } from './lib/clickhouse/client'

async function auditAllTables() {
  const client = getClickHouseClient()
  
  try {
    // Get all tables
    const result = await client.query({
      query: `
        SELECT
          name,
          engine,
          table_type,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database = currentDatabase()
        ORDER BY name
      `,
      format: 'JSONEachRow',
    })

    const tables = await result.json()
    console.log('=== ALL TABLES ===')
    for (const t of tables) {
      console.log(`${t.name}: ${t.total_rows} rows, ${t.engine}`)
    }
    
  } catch (error) {
    console.error('Error:', error)
  }
}

auditAllTables()
