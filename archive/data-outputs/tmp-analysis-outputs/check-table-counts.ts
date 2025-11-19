import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '..', '.env.local') })
import { clickhouse } from '../lib/clickhouse/client'

const tables = [
  'default.trades_raw',
  'cascadian_clean.trades_raw',
  'default.trade_direction_assignments',
  'default.trades_with_direction',
  'default.vw_trades_canonical',
  'default.fact_trades',
  'default.fact_trades_staging'
]

async function main() {
  for (const tbl of tables) {
    try {
      const res = await clickhouse.query({
        query: `SELECT count() AS c FROM ${tbl}`,
        format: 'JSONEachRow'
      })
      const data = await res.json<{ c: string }[]>()
      console.log(tbl, data[0]?.c ?? '0')
    } catch (error: any) {
      console.log(tbl, 'error', error?.message || error)
    }
  }
}

main().finally(() => process.exit(0))
