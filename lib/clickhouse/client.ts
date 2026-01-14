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
    request_timeout: Number(process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS ?? 330000),  // 5.5 min to allow for 5 min query + overhead
    max_open_connections: Number(process.env.CLICKHOUSE_MAX_CONNS ?? 16),
    compression: { request: true, response: true },
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 300000,  // 5 minutes - keep sockets alive for long queries
    },
    clickhouse_settings: {
      async_insert: 1 as any,
      wait_for_async_insert: 0 as any,
      async_insert_busy_timeout_ms: 20000 as any,
      send_progress_in_http_headers: 0 as any,  // Disabled to prevent HTTP header overflow on large scans
      max_execution_time: 300 as any,  // 5 minutes for complex PnL queries
      max_insert_block_size: 10000 as any,
      max_threads: 4 as any,
      idle_connection_timeout: 300 as any,  // 5 minutes server-side
      send_timeout: 300 as any,
      receive_timeout: 300 as any,
    },
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
