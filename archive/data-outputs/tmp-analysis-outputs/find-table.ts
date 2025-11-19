import { createClient } from '@clickhouse/client'
import { config } from 'dotenv'

const pattern = process.argv[2]
if (!pattern) {
  console.error('Usage: tsx tmp/find-table.ts <pattern>')
  process.exit(1)
}

config({ path: '.env.local' })

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default'
  })

  const query = `SELECT database, name FROM system.tables WHERE name ILIKE '%${pattern}%' ORDER BY database, name`
  const result = await client.query({ query, format: 'JSONEachRow' })
  const rows = await result.json()
  console.log(rows)
  await client.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
