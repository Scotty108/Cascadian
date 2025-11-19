import { getClickHouseClient } from './lib/clickhouse/client'

const client = getClickHouseClient()

async function run() {
  const result = await client.query({
    query: 'SELECT name, engine FROM system.tables WHERE database = currentDatabase() ORDER BY name',
    format: 'JSONEachRow',
  })
  const tables = await result.json()
  console.log(JSON.stringify(tables.slice(0, 30), null, 2))
  process.exit(0)
}

run()
