import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  const query = `
    SELECT
      COUNT(*) as total_trades,
      COUNT(DISTINCT wallet_address) as unique_wallets,
      COUNT(CASE WHEN market_id = '' THEN 1 END) as empty_market_ids,
      COUNT(CASE WHEN condition_id LIKE 'token_%' THEN 1 END) as placeholder_conditions
    FROM trades_raw
  `
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]
  console.log(JSON.stringify(data[0], null, 2))
}

main().catch(console.error)
