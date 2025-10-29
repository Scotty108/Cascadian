import { createClient, ClickHouseClient } from '@clickhouse/client'

let clickhouseClient: ClickHouseClient | null = null

export function getClickHouseClient(): ClickHouseClient {
  if (clickhouseClient) {
    return clickhouseClient
  }

  const host = process.env.CLICKHOUSE_HOST
  const username = process.env.CLICKHOUSE_USER || 'default'
  const password = process.env.CLICKHOUSE_PASSWORD
  const database = process.env.CLICKHOUSE_DATABASE || 'default'

  if (!host || !password) {
    throw new Error(
      'Missing ClickHouse credentials. Set CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD in .env.local'
    )
  }

  clickhouseClient = createClient({
    url: host,
    username,
    password,
    database,
    request_timeout: 300000, // 5 minutes for large queries
    max_open_connections: 10,
  })

  return clickhouseClient
}

// Export a getter instead of initializing immediately
export const clickhouse = {
  query: (...args: Parameters<ClickHouseClient['query']>) => getClickHouseClient().query(...args),
  insert: (...args: Parameters<ClickHouseClient['insert']>) => getClickHouseClient().insert(...args),
  command: (...args: Parameters<ClickHouseClient['command']>) => getClickHouseClient().command(...args),
  exec: (...args: Parameters<ClickHouseClient['exec']>) => getClickHouseClient().exec(...args),
}

// Test connection
export async function testClickHouseConnection() {
  try {
    const result = await clickhouse.query({
      query: 'SELECT version() as version',
      format: 'JSONEachRow',
    })

    const data = await result.json<{ version: string }>() as Array<{ version: string }>
    console.log('✅ ClickHouse connected successfully!')
    console.log('   Version:', data[0].version)

    return { success: true, version: data[0].version }
  } catch (error) {
    console.error('❌ ClickHouse connection failed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Get database info
export async function getClickHouseInfo() {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = currentDatabase()
        ORDER BY total_bytes DESC
      `,
      format: 'JSONEachRow',
    })

    const tables = await result.json()
    return { success: true, tables }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
